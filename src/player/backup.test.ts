// Tests for the pure export/import logic. Run: npm test (node --test).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyIdMap,
  buildExport,
  idMapVersion,
  mergeProgress,
  parseExport,
  SCHEMA_VERSION,
  sameProgress,
} from './backup.ts'

const T1 = '2026-10-15T10:00:00.000Z'
const T2 = '2026-10-16T10:00:00.000Z'

const fileWith = (progress: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: SCHEMA_VERSION, app: 'oncut-learn', exportedAt: T2, progress, ...extra })

describe('parseExport', () => {
  it('reads what buildExport writes', () => {
    const progress = { 'cpp.setup.hello-world': { read: T1, 'quiz-passed': T2 } }
    const file = parseExport(JSON.stringify(buildExport(progress, 'windows', new Date(T2))))
    assert.deepEqual(file.progress, progress)
    assert.equal(file.os, 'windows')
    assert.equal(file.exportedAt, T2)
  })

  it('rejects files that are not ours', () => {
    assert.throws(() => parseExport('{'), /JSON/)
    assert.throws(() => parseExport('{"app":"other"}'), /oncut learn/)
    assert.throws(() => parseExport(fileWith({}, { schemaVersion: 99 })), /έκδοση 99/)
    assert.throws(() => parseExport(fileWith([])), /πρόοδο/)
  })

  it('rejects bad ids, unknown states and bad times', () => {
    assert.throws(() => parseExport(fileWith({ '</script>': { read: T1 } })), /Άκυρη/)
    assert.throws(() => parseExport(fileWith({ 'cpp.a.b': { skipped: T1 } })), /Άκυρη/)
    assert.throws(() => parseExport(fileWith({ 'cpp.a.b': { read: 'yesterday' } })), /Άκυρη/)
    assert.throws(() => parseExport(fileWith({ 'cpp.a.b': [T1] })), /Άκυρη/)
  })

  it('normalizes times to ISO UTC', () => {
    const file = parseExport(fileWith({ 'cpp.a.b': { read: '2026-10-15T13:00:00+03:00' } }))
    assert.equal(file.progress['cpp.a.b'].read, T1)
  })

  it('ignores an unknown os', () => {
    assert.equal(parseExport(fileWith({}, { os: 'beos' })).os, undefined)
  })
})

describe('mergeProgress', () => {
  it('keeps every lesson and the earliest time per state', () => {
    const merged = mergeProgress(
      { 'cpp.a.one': { read: T2 }, 'cpp.a.two': { read: T1 } },
      { 'cpp.a.one': { read: T1, 'quiz-passed': T2 }, 'cpp.a.three': { read: T2 } },
    )
    assert.deepEqual(merged, {
      'cpp.a.one': { read: T1, 'quiz-passed': T2 },
      'cpp.a.two': { read: T1 },
      'cpp.a.three': { read: T2 },
    })
  })

  it('compares normalized times correctly across offsets', () => {
    const later = parseExport(fileWith({ 'cpp.a.b': { read: '2026-10-15T12:30:00+03:00' } })).progress
    const merged = mergeProgress({ 'cpp.a.b': { read: T1 } }, later)
    assert.equal(merged['cpp.a.b'].read, '2026-10-15T09:30:00.000Z')
  })
})

describe('applyIdMap', () => {
  it('moves a retired id, splits it, and merges into an existing id', () => {
    const progress = { 'cpp.a.old': { read: T1 }, 'cpp.a.split': { read: T2 }, 'cpp.a.kept': { read: T2 } }
    const map = { 'cpp.a.old': 'cpp.a.kept', 'cpp.a.split': ['cpp.a.x', 'cpp.a.y'] }
    assert.deepEqual(applyIdMap(progress, map), {
      'cpp.a.kept': { read: T1 },
      'cpp.a.x': { read: T2 },
      'cpp.a.y': { read: T2 },
    })
  })

  it('leaves progress alone with an empty map', () => {
    const progress = { 'cpp.a.b': { read: T1 } }
    assert.ok(sameProgress(applyIdMap(progress, {}), progress))
  })
})

describe('sameProgress', () => {
  it('compares lessons, states and times', () => {
    assert.ok(sameProgress({ 'cpp.a.b': { read: T1 } }, { 'cpp.a.b': { read: T1 } }))
    assert.ok(!sameProgress({ 'cpp.a.b': { read: T1 } }, { 'cpp.a.b': { read: T2 } }))
    assert.ok(!sameProgress({ 'cpp.a.b': { read: T1 } }, {}))
    assert.ok(sameProgress({}, {}))
  })
})

describe('idMapVersion', () => {
  it('ignores key order and changes with the content', () => {
    const a = idMapVersion({ 'cpp.a.one': 'cpp.a.two', 'cpp.a.three': 'cpp.a.four' })
    const b = idMapVersion({ 'cpp.a.three': 'cpp.a.four', 'cpp.a.one': 'cpp.a.two' })
    assert.equal(a, b)
    assert.notEqual(a, idMapVersion({ 'cpp.a.one': 'cpp.a.five' }))
    assert.match(a, /^[0-9a-f]{8}$/)
  })
})
