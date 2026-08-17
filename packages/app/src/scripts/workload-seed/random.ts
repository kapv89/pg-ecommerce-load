/**
 * Deterministic pseudo-randomness.
 *
 * The whole point of this project is comparing two triage systems against the
 * same workload, so the dataset has to be reproducible. `Math.random()` would
 * make every seeded database subtly different — different row counts per
 * product, different skew, different plans — and any difference between the two
 * systems' results could then be blamed on the data rather than the systems.
 *
 * Seeded mulberry32: same SEED in, same database out.
 */

export const SEED = 0x636f7276 // "corv"

export function createRng(seed: number = SEED) {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (min: number, max: number): number =>
    Math.floor(next() * (max - min + 1)) + min

  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]

  const pickMany = <T>(items: readonly T[], count: number): T[] => {
    const pool = [...items]
    const out: T[] = []
    const take = Math.min(count, pool.length)
    for (let i = 0; i < take; i++) {
      out.push(pool.splice(int(0, pool.length - 1), 1)[0])
    }
    return out
  }

  const chance = (probability: number): boolean => next() < probability

  /**
   * Weighted pick. Real catalogues are not uniform — a handful of products get
   * most of the traffic — and a uniform distribution would hide exactly the
   * hot-row and skewed-statistics problems worth triaging.
   */
  const weighted = <T>(items: readonly T[], weights: readonly number[]): T => {
    const total = weights.reduce((sum, w) => sum + w, 0)
    let roll = next() * total
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i]
      if (roll <= 0) {
        return items[i]
      }
    }
    return items[items.length - 1]
  }

  /** Zipf-ish index into a list of `size`: index 0 is far more likely than the tail. */
  const zipf = (size: number, skew = 1.1): number => {
    const weights: number[] = []
    for (let i = 1; i <= size; i++) {
      weights.push(1 / Math.pow(i, skew))
    }
    const total = weights.reduce((sum, w) => sum + w, 0)
    let roll = next() * total
    for (let i = 0; i < size; i++) {
      roll -= weights[i]
      if (roll <= 0) {
        return i
      }
    }
    return size - 1
  }

  const dateWithin = (daysBack: number, reference = new Date()): Date => {
    const ms = int(0, daysBack * 24 * 60 * 60 * 1000)
    return new Date(reference.getTime() - ms)
  }

  return { next, int, pick, pickMany, chance, weighted, zipf, dateWithin }
}

export type Rng = ReturnType<typeof createRng>
