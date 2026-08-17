/**
 * Seeded PRNG, matching packages/app/src/scripts/workload-seed/random.ts.
 *
 * The workload has to be as reproducible as the dataset: if two runs of the
 * baseline issue different traffic, the two triage systems are not being shown
 * the same thing and any difference in their findings is unattributable. Each
 * virtual user gets its own stream seeded from its index.
 */
export function createRng(seed: number) {
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

  const chance = (probability: number): boolean => next() < probability

  /**
   * Zipf-ish index: index 0 far more likely than the tail. Real catalogues are
   * not browsed uniformly, and the hot-row and cache behaviour under load
   * depends entirely on that skew.
   */
  const zipf = (size: number, skew = 1.1): number => {
    if (size <= 0) {
      return 0
    }
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

  return { next, int, pick, chance, zipf }
}

export type Rng = ReturnType<typeof createRng>
