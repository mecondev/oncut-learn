// A fixed, seeded order: the same seed always gives the same order, so a
// page builds the same every time, but the order does not follow the source.
// Used for quiz choices, which authors tend to write with the right answer
// first (setup test, 2026-10-17: every right answer was the first choice).

function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** Items in an order fixed by `seed`, each item keeping its original index. */
export function seededShuffle<T>(items: readonly T[], seed: string): { item: T; index: number }[] {
  return items
    .map((item, index) => ({ item, index, key: fnv1a(`${seed}:${index}`) }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map(({ item, index }) => ({ item, index }))
}
