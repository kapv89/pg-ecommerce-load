import { StoreClient } from "./client"
import { MetricsCollector } from "./metrics"
import { createRng } from "./random"
import {
  runAdminSession,
  runShopperSession,
  type Funnel,
  type SessionContext,
} from "./session"
import {
  authenticateAdmin,
  buildCustomerPool,
  getRegionId,
  loadCatalogue,
} from "./setup"

export type Profile = {
  name: string
  description: string
  /** Concurrent virtual users at full ramp. */
  concurrency: number
  durationSeconds: number
  /** Seconds spent ramping from 1 VU to `concurrency`. */
  rampSeconds: number
  thinkTimeMs: [number, number]
  funnel: Funnel
  /** Share of sessions run by a signed-in shopper rather than a guest. */
  authenticatedShare: number
  customerPoolSize: number
}

/**
 * One segment of a run: a profile, for a stretch of wall-clock time.
 *
 * A run made of several phases is a single driver process that changes traffic
 * shape underneath itself, not several runs stitched together. That matters for
 * what this project measures: restarting the driver between baseline and anomaly
 * would empty the connection pools and the caches, so the first minutes of the
 * anomaly would be measuring a cold start rather than a sale.
 */
export type Phase = {
  /** Short label. Appears in progress lines and in the per-phase report. */
  name: string
  profile: Profile
  durationSeconds: number
  /** Run once, at the moment the phase begins — this is where the sale is switched. */
  onEnter?: () => Promise<void>
}

export type RunOptions = {
  baseUrl: string
  seed: number
  /** Abort if the rolling failure rate exceeds this. */
  maxFailureRate: number
}

const DEFAULTS: RunOptions = {
  baseUrl: process.env.MEDUSA_URL ?? "http://localhost:9000",
  seed: 0x636f7276,
  maxFailureRate: 0.1,
}

export async function runWorkload(
  profile: Profile,
  overrides: Partial<RunOptions> = {}
): Promise<MetricsCollector> {
  console.log(`\n${profile.name}\n${profile.description}`)

  return runTimeline(
    [{ name: profile.name, profile, durationSeconds: profile.durationSeconds }],
    overrides
  )
}

export async function runTimeline(
  phases: Phase[],
  overrides: Partial<RunOptions> = {}
): Promise<MetricsCollector> {
  const options = { ...DEFAULTS, ...overrides }

  if (!phases.length) {
    throw new Error("A run needs at least one phase.")
  }

  const totalSeconds = phases.reduce((sum, p) => sum + p.durationSeconds, 0)
  // Virtual users are allocated once, for the whole run, and phases with a lower
  // concurrency park the surplus (see below). Otherwise a step up in concurrency
  // would mean spawning users mid-run, and their first request would land on a
  // cold client rather than the warm one the phase is meant to measure.
  const peakConcurrency = Math.max(...phases.map((p) => p.profile.concurrency))
  const poolSize = Math.max(...phases.map((p) => p.profile.customerPoolSize))

  console.log(
    `\n  target       ${options.baseUrl}\n` +
      `  duration     ${totalSeconds}s (${(totalSeconds / 60).toFixed(1)} min)\n` +
      `  peak users   ${peakConcurrency} virtual users\n` +
      `  phases       ${phases
        .map((p) => `${p.name} ${p.durationSeconds}s`)
        .join(" -> ")}\n`
  )

  const { token: adminToken, publishableKey } = await authenticateAdmin(
    options.baseUrl
  )
  const catalogue = await loadCatalogue(options.baseUrl, publishableKey)
  const regionId = await getRegionId(options.baseUrl, publishableKey)

  console.log(
    `Catalogue: ${catalogue.productIds.length} products, ${catalogue.variantIds.length} variants`
  )

  const customerTokens = await buildCustomerPool(
    options.baseUrl,
    publishableKey,
    poolSize
  )
  console.log(`Shoppers:  ${customerTokens.length} signed-in accounts\n`)

  const metrics = new MetricsCollector()

  let current = phases[0]
  const ctx: SessionContext = {
    catalogue,
    regionId,
    funnel: current.profile.funnel,
    thinkTimeMs: current.profile.thinkTimeMs,
    phase: current.name,
  }

  // Phase state lives in one mutable context object shared by every virtual
  // user, so a transition is picked up by in-flight sessions too. That is the
  // realistic behaviour: a sale starting does not wait for everyone currently
  // browsing to go home first.
  const enterPhase = async (phase: Phase): Promise<void> => {
    current = phase
    ctx.funnel = phase.profile.funnel
    ctx.thinkTimeMs = phase.profile.thinkTimeMs
    ctx.phase = phase.name
    metrics.setPhase(phase.name)

    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    console.log(
      `\n>> [${elapsed}s] phase "${phase.name}" — ${phase.profile.concurrency} users, ` +
        `think ${phase.profile.thinkTimeMs[0]}-${phase.profile.thinkTimeMs[1]}ms, ` +
        `checkout ${(phase.profile.funnel.checkout * 100).toFixed(0)}%\n`
    )

    if (phase.onEnter) {
      await phase.onEnter()
    }
  }

  const startedAt = Date.now()
  const endAt = startedAt + totalSeconds * 1000
  let aborted = false
  let sessions = 0

  await enterPhase(phases[0])

  const progress = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    const { count, failed } = metrics.totals
    const rate = (metrics.recentFailureRate() * 100).toFixed(1)
    console.log(
      `  [${String(elapsed).padStart(5)}s] ${current.name.padEnd(10)} ` +
        `${String(sessions).padStart(6)} sessions  ` +
        `${String(count).padStart(8)} requests  ${failed} failed  ${rate}% recent`
    )
  }, 10_000)

  /**
   * Walks the schedule on wall-clock time, independent of the virtual users, so
   * a phase boundary lands where it was asked to land even if the system under
   * test is slow enough that sessions are running long.
   */
  const conductor = async (): Promise<void> => {
    for (let i = 1; i < phases.length && !aborted; i++) {
      const boundary =
        startedAt +
        phases.slice(0, i).reduce((sum, p) => sum + p.durationSeconds, 0) * 1000

      while (Date.now() < boundary && !aborted) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(500, Math.max(boundary - Date.now(), 0)))
        )
      }

      if (!aborted) {
        await enterPhase(phases[i])
      }
    }
  }

  /**
   * One virtual user: waits out its share of the ramp, then loops sessions until
   * time is up. Ramping matters — dropping full concurrency on a cold cluster
   * measures connection-pool warm-up rather than steady-state behaviour.
   */
  const virtualUser = async (index: number): Promise<void> => {
    const ramp = phases[0].profile.rampSeconds
    const rampDelay = ramp > 0 ? (index / peakConcurrency) * ramp * 1000 : 0
    await new Promise((resolve) => setTimeout(resolve, rampDelay))

    const rng = createRng(options.seed + index * 7919)

    while (Date.now() < endAt && !aborted) {
      // The safety valve. The anomaly profile is meant to approach saturation,
      // and the failure mode of "approach" is "overshoot" — so give up rather
      // than spend the rest of the run hammering a database that is already
      // refusing connections.
      if (metrics.recentFailureRate() > options.maxFailureRate) {
        aborted = true
        break
      }

      // Users beyond the current phase's concurrency park rather than exit, so
      // the population can step back up when a heavier phase begins without
      // paying to create them again.
      if (index >= current.profile.concurrency) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        continue
      }

      const client = new StoreClient(
        { baseUrl: options.baseUrl, publishableKey, metrics },
        options.seed + sessions * 31 + index
      )

      sessions++

      if (
        customerTokens.length &&
        rng.chance(current.profile.authenticatedShare)
      ) {
        client.setCustomerToken(
          customerTokens[rng.int(0, customerTokens.length - 1)]
        )
      }

      try {
        if (rng.chance(ctx.funnel.adminSession)) {
          await runAdminSession(client, ctx, adminToken)
        } else {
          await runShopperSession(client, ctx)
        }
      } catch {
        // A session that throws is a session lost, not a run lost.
      }
    }
  }

  await Promise.all([
    conductor(),
    ...Array.from({ length: peakConcurrency }, (_, i) => virtualUser(i)),
  ])

  clearInterval(progress)

  if (aborted) {
    console.log(
      `\n!! Aborted: rolling failure rate exceeded ${(options.maxFailureRate * 100).toFixed(0)}%.\n` +
        `   The system was past saturation, not near it. Lower the concurrency and re-run.`
    )
  }

  const label =
    phases.length === 1
      ? `${phases[0].name} — ${sessions} sessions`
      : `Timeline (${phases.map((p) => p.name).join(" -> ")}) — ${sessions} sessions`

  metrics.report(label)

  return metrics
}
