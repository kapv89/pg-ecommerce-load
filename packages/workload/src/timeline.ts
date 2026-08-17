/**
 * A single continuous run with an anomaly window inside it.
 *
 *   npm run workload:timeline -- --duration 60 --anomaly-start 20 --anomaly-end 35
 *
 * Sixty minutes of traffic: a normal trading day, a Black Friday from minute 20
 * to minute 35, then back to normal. One driver process throughout, so the pools
 * and caches stay warm across the boundaries and the step change the triage
 * systems see is the workload changing, not the harness restarting.
 *
 * This is the shape the comparison actually needs. Running the baseline and the
 * anomaly as two separate invocations gives two datasets; running them as one
 * timeline gives a *before*, which is what any real triage starts from — "it was
 * fine at 10:00 and it is not fine now" is the whole question.
 */
import { runTimeline, type Phase } from "./lib/engine"
import { setSaleActive } from "./lib/sale"
import { anomaly, baseline } from "./profiles"

const baseUrl = process.env.MEDUSA_URL ?? "http://localhost:9000"

function readArg(flag: string, fallback: number): number {
  const argv = process.argv.slice(2)
  const index = argv.indexOf(`--${flag}`)
  if (index === -1 || !argv[index + 1]) {
    return fallback
  }
  const value = Number(argv[index + 1])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

const durationMinutes = readArg("duration", 30)
const anomalyStartMinutes = readArg("anomaly-start", 10)
const anomalyEndMinutes = readArg("anomaly-end", 20)

if (anomalyStartMinutes >= anomalyEndMinutes) {
  console.error(
    `anomaly-start (${anomalyStartMinutes}) must be before anomaly-end (${anomalyEndMinutes}).`
  )
  process.exit(1)
}

if (anomalyEndMinutes > durationMinutes) {
  console.error(
    `anomaly-end (${anomalyEndMinutes}) is past the end of the run (${durationMinutes}).`
  )
  process.exit(1)
}

const minutes = (n: number): number => Math.round(n * 60)

const phases: Phase[] = []

if (anomalyStartMinutes > 0) {
  phases.push({
    name: "baseline",
    profile: baseline,
    durationSeconds: minutes(anomalyStartMinutes),
    // Defensive: an earlier run that was killed rather than finished can leave
    // the sale switched on, and a "baseline" with the degraded paths live would
    // quietly invalidate everything measured before the anomaly window.
    onEnter: async () => {
      const ended = await setSaleActive(baseUrl, false)
      if (ended) {
        console.log(`   (ended leftover sale "${ended.name}")`)
      }
    },
  })
}

phases.push({
  name: "anomaly",
  profile: anomaly,
  durationSeconds: minutes(anomalyEndMinutes - anomalyStartMinutes),
  onEnter: async () => {
    const sale = await setSaleActive(baseUrl, true)
    console.log(`   SALE ON: "${sale?.name}" — degraded paths are live.`)
  },
})

if (anomalyEndMinutes < durationMinutes) {
  phases.push({
    name: "recovery",
    profile: baseline,
    durationSeconds: minutes(durationMinutes - anomalyEndMinutes),
    onEnter: async () => {
      await setSaleActive(baseUrl, false)
      console.log("   SALE OFF: degraded paths are off again.")
    },
  })
}

console.log(
  `\nTimeline run\n` +
    `${durationMinutes} minutes of traffic, anomaly from minute ` +
    `${anomalyStartMinutes} to minute ${anomalyEndMinutes}.`
)

try {
  await runTimeline(phases, { baseUrl })
} finally {
  // Always end the sale, including on abort or Ctrl-C, so the system is left in
  // its normal state for whatever runs next.
  await setSaleActive(baseUrl, false)
  console.log("\nSale ended — system is back to its baseline configuration.")
}
