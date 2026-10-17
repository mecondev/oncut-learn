// Run: npm test, from the repository root.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { seededShuffle } from './shuffle.ts'

describe('seededShuffle', () => {
  it('is stable for a seed and keeps every item once', () => {
    const items = ['a', 'b', 'c', 'd']
    const one = seededShuffle(items, 'quiz.q1')
    assert.deepEqual(one, seededShuffle(items, 'quiz.q1'))
    assert.deepEqual(one.map((x) => x.item).sort(), items)
    for (const { item, index } of one) assert.equal(items[index], item)
  })

  it('does not keep the first item first for every seed', () => {
    const firsts = Array.from({ length: 20 }, (_, i) => seededShuffle(['right', 'x', 'y'], `q${i}`)[0].item)
    assert.ok(firsts.some((f) => f !== 'right'))
    assert.ok(firsts.some((f) => f === 'right'))
  })
})
