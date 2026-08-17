/**
 * Concurrent load test.
 *
 * Not the baseline or anomaly workload — those come later. This exists to answer
 * one question about the deployment: when the workload scripts fire, does the
 * request load actually spread across the pm2 cluster's cores, or does it pile
 * onto one process?
 *
 * It fires a fixed mix of read-heavy storefront requests at a chosen concurrency
 * for a chosen duration, then reports throughput, latency percentiles, and the
 * distribution of responding process ids. The pid distribution is the part that
 * matters: a flat spread across N pids means N cores are serving.
 *
 *   npm run loadtest -- --duration 30 --concurrency 64
 */

// Neither file imports anything, so mark them as modules explicitly —
// otherwise TypeScript treats them as scripts sharing one global scope and the
// two top-level `MEDUSA_URL` declarations collide.
export {}

const MEDUSA_URL = process.env.MEDUSA_URL ?? "http://localhost:9000"

type Args = {
  duration: number
  concurrency: number
  url: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const read = (flag: string, fallback: number): number => {
    const index = argv.indexOf(`--${flag}`)
    if (index === -1 || !argv[index + 1]) {
      return fallback
    }
    const value = Number(argv[index + 1])
    return Number.isFinite(value) && value > 0 ? value : fallback
  }

  const urlIndex = argv.indexOf("--url")

  return {
    duration: read("duration", 20),
    concurrency: read("concurrency", 32),
    url: urlIndex !== -1 && argv[urlIndex + 1] ? argv[urlIndex + 1] : MEDUSA_URL,
  }
}

type Sample = { ms: number; ok: boolean; pid: string | null }

/**
 * Read-only storefront paths, weighted the way a browsing session leans. Kept
 * deliberately cheap: this measures how well the cluster spreads work, so the
 * requests should not be dominated by one slow query.
 */
const PATHS: { path: string; weight: number }[] = [
  { path: "/store/cluster-info", weight: 1 },
  { path: "/store/products?limit=12", weight: 6 },
  { path: "/store/products?limit=12&offset=24", weight: 3 },
  { path: "/store/products?order=title&limit=12", weight: 2 },
  { path: "/store/product-categories?limit=20", weight: 2 },
  { path: "/store/collections?limit=20", weight: 1 },
  { path: "/store/brands?limit=12", weight: 2 },
  { path: "/store/regions", weight: 1 },
]

const WEIGHTED: string[] = PATHS.flatMap(({ path, weight }) =>
  Array.from({ length: weight }, () => path)
)

async function getPublishableKey(baseUrl: string): Promise<string> {
  const email = process.env.ADMIN_EMAIL ?? "admin@ecommerce-load.local"
  const password = process.env.ADMIN_PASSWORD ?? "supersecret"

  const auth = await fetch(`${baseUrl}/auth/user/emailpass`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  })

  if (!auth.ok) {
    throw new Error(
      `Could not authenticate as ${email}. Create the user with:\n` +
        `  cd packages/app && npx medusa user -e ${email} -p ${password}`
    )
  }

  const { token } = (await auth.json()) as { token: string }

  const keys = await fetch(`${baseUrl}/admin/api-keys?type=publishable&limit=1`, {
    headers: { authorization: `Bearer ${token}` },
  })

  const body = (await keys.json()) as { api_keys?: { token: string }[] }
  const key = body.api_keys?.[0]?.token

  if (!key) {
    throw new Error("No publishable API key found — run the seed first.")
  }

  return key
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) {
    return 0
  }
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[index]
}

async function main(): Promise<void> {
  const { duration, concurrency, url } = parseArgs()

  console.log(
    `Load test: ${concurrency} concurrent workers for ${duration}s against ${url}`
  )

  const publishableKey = await getPublishableKey(url)
  const headers = { "x-publishable-api-key": publishableKey }

  const samples: Sample[] = []
  const endAt = Date.now() + duration * 1000
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (Date.now() < endAt) {
      // Round-robin over the weighted list rather than random, so two runs of
      // the same duration issue the same request mix.
      const path = WEIGHTED[cursor++ % WEIGHTED.length]
      const startedAt = performance.now()

      try {
        const res = await fetch(`${url}${path}`, { headers })
        // Every response carries the serving pid — see the middleware in
        // packages/app/src/api/middlewares.ts — so the distribution below is
        // measured over the whole request mix, not one endpoint.
        const pid = res.headers.get("x-medusa-pid")
        await res.arrayBuffer()

        samples.push({ ms: performance.now() - startedAt, ok: res.ok, pid })
      } catch {
        samples.push({ ms: performance.now() - startedAt, ok: false, pid: null })
      }
    }
  }

  const startedAt = Date.now()
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  const elapsed = (Date.now() - startedAt) / 1000

  const ok = samples.filter((s) => s.ok)
  const latencies = ok.map((s) => s.ms).sort((a, b) => a - b)

  console.log(`
Requests    ${samples.length} total, ${ok.length} ok, ${samples.length - ok.length} failed
Throughput  ${(samples.length / elapsed).toFixed(1)} req/s over ${elapsed.toFixed(1)}s
Latency     p50 ${percentile(latencies, 50).toFixed(1)}ms   p90 ${percentile(latencies, 90).toFixed(1)}ms   p99 ${percentile(latencies, 99).toFixed(1)}ms   max ${percentile(latencies, 100).toFixed(1)}ms`)

  const byPid = new Map<string, number>()
  for (const sample of samples) {
    if (sample.pid) {
      byPid.set(sample.pid, (byPid.get(sample.pid) ?? 0) + 1)
    }
  }

  if (byPid.size) {
    const total = [...byPid.values()].reduce((sum, n) => sum + n, 0)
    console.log(`\nServed by ${byPid.size} process(es):`)
    for (const [pid, count] of [...byPid].sort((a, b) => b[1] - a[1])) {
      const share = ((count / total) * 100).toFixed(1)
      const bar = "█".repeat(Math.max(1, Math.round((count / total) * 40)))
      console.log(`  pid ${pid.padStart(7)}  ${share.padStart(5)}%  ${bar}`)
    }
    if (byPid.size === 1) {
      console.log(
        "\nOnly one process answered — the cluster is not spreading load. " +
          "Check `npm run status:app`."
      )
    }
  }

  process.exitCode = ok.length === samples.length ? 0 : 1
}

await main()
