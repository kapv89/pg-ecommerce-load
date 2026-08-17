type OpStats = {
  count: number
  failed: number
  latencies: number[]
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) {
    return 0
  }
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[index]
}

type PhaseStats = OpStats & { startedAt: number; endedAt: number }

export class MetricsCollector {
  private ops = new Map<string, OpStats>()
  private pids = new Map<string, number>()
  private startedAt = Date.now()

  /**
   * Requests are attributed to the phase that was current when they completed.
   *
   * A timeline run is only useful if the anomaly window can be read on its own:
   * a p99 averaged over an hour of which fifteen minutes were a sale tells you
   * nothing about either.
   */
  private phase = "run"
  private phases = new Map<string, PhaseStats>()

  /** Rolling window used by the safety valve, so a late failure spike is caught. */
  private recent: { at: number; ok: boolean }[] = []

  setPhase(name: string): void {
    this.phase = name
    if (!this.phases.has(name)) {
      this.phases.set(name, {
        count: 0,
        failed: 0,
        latencies: [],
        startedAt: Date.now(),
        endedAt: Date.now(),
      })
    }
  }

  record(op: string, ms: number, ok: boolean, pid: string | null): void {
    let stats = this.ops.get(op)
    if (!stats) {
      stats = { count: 0, failed: 0, latencies: [] }
      this.ops.set(op, stats)
    }
    stats.count++
    if (!ok) {
      stats.failed++
    }
    stats.latencies.push(ms)

    const phase = this.phases.get(this.phase)
    if (phase) {
      phase.count++
      if (!ok) {
        phase.failed++
      }
      phase.latencies.push(ms)
      phase.endedAt = Date.now()
    }

    if (pid) {
      this.pids.set(pid, (this.pids.get(pid) ?? 0) + 1)
    }

    const now = Date.now()
    this.recent.push({ at: now, ok })
    const cutoff = now - 10_000
    while (this.recent.length && this.recent[0].at < cutoff) {
      this.recent.shift()
    }
  }

  /** Failure rate over the last 10s — what the safety valve trips on. */
  recentFailureRate(): number {
    if (this.recent.length < 20) {
      return 0
    }
    const failed = this.recent.filter((r) => !r.ok).length
    return failed / this.recent.length
  }

  get totals() {
    let count = 0
    let failed = 0
    const all: number[] = []
    for (const stats of this.ops.values()) {
      count += stats.count
      failed += stats.failed
      all.push(...stats.latencies)
    }
    all.sort((a, b) => a - b)
    return { count, failed, latencies: all }
  }

  report(label: string): void {
    const elapsed = (Date.now() - this.startedAt) / 1000
    const { count, failed, latencies } = this.totals

    console.log(`\n${"=".repeat(78)}\n${label}\n${"=".repeat(78)}`)
    console.log(
      `Requests    ${count} total, ${failed} failed (${((failed / Math.max(count, 1)) * 100).toFixed(2)}%)\n` +
        `Throughput  ${(count / elapsed).toFixed(1)} req/s over ${elapsed.toFixed(0)}s\n` +
        `Latency     p50 ${percentile(latencies, 50).toFixed(0)}ms   p90 ${percentile(latencies, 90).toFixed(0)}ms   ` +
        `p99 ${percentile(latencies, 99).toFixed(0)}ms   max ${percentile(latencies, 100).toFixed(0)}ms`
    )

    console.log(
      `\n${"operation".padEnd(26)}${"calls".padStart(8)}${"fail".padStart(7)}` +
        `${"p50".padStart(9)}${"p90".padStart(9)}${"p99".padStart(9)}`
    )
    console.log("-".repeat(68))

    const rows = [...this.ops.entries()].sort((a, b) => b[1].count - a[1].count)
    for (const [op, stats] of rows) {
      const sorted = [...stats.latencies].sort((a, b) => a - b)
      console.log(
        op.padEnd(26) +
          String(stats.count).padStart(8) +
          String(stats.failed).padStart(7) +
          `${percentile(sorted, 50).toFixed(0)}ms`.padStart(9) +
          `${percentile(sorted, 90).toFixed(0)}ms`.padStart(9) +
          `${percentile(sorted, 99).toFixed(0)}ms`.padStart(9)
      )
    }

    if (this.pids.size) {
      const total = [...this.pids.values()].reduce((sum, n) => sum + n, 0)
      const shares = [...this.pids.values()].map((n) => (n / total) * 100)
      console.log(
        `\nServed by ${this.pids.size} process(es), ` +
          `${Math.min(...shares).toFixed(1)}%-${Math.max(...shares).toFixed(1)}% each`
      )
    }

    this.reportPhases()
  }

  /**
   * The per-phase breakdown. Skipped for a single-profile run, where it would
   * just restate the totals.
   */
  reportPhases(): void {
    if (this.phases.size < 2) {
      return
    }

    console.log(
      `\n${"phase".padEnd(18)}${"secs".padStart(7)}${"calls".padStart(9)}` +
        `${"fail%".padStart(8)}${"req/s".padStart(9)}${"p50".padStart(9)}` +
        `${"p90".padStart(9)}${"p99".padStart(9)}`
    )
    console.log("-".repeat(78))

    for (const [name, stats] of this.phases) {
      const seconds = Math.max((stats.endedAt - stats.startedAt) / 1000, 1)
      const sorted = [...stats.latencies].sort((a, b) => a - b)
      console.log(
        name.padEnd(18) +
          seconds.toFixed(0).padStart(7) +
          String(stats.count).padStart(9) +
          `${((stats.failed / Math.max(stats.count, 1)) * 100).toFixed(2)}`.padStart(8) +
          (stats.count / seconds).toFixed(1).padStart(9) +
          `${percentile(sorted, 50).toFixed(0)}ms`.padStart(9) +
          `${percentile(sorted, 90).toFixed(0)}ms`.padStart(9) +
          `${percentile(sorted, 99).toFixed(0)}ms`.padStart(9)
      )
    }
  }
}
