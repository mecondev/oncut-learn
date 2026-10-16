import { ID_PATTERN, isOs, type Os } from '../lib/shared.ts'
import { STATES, type LessonProgress, type Progress, type State } from './states.ts'

// The export file: what the visitor downloads as a backup and imports again,
// possibly in another browser. Validated strictly on import; never trusted.
// Pure functions only, tested with `npm test` (backup.test.ts).

export const SCHEMA_VERSION = 1

export interface ExportFile {
  schemaVersion: number
  app: 'oncut-learn'
  exportedAt: string
  os?: Os
  progress: Progress
}

export type IdMap = Record<string, string | string[]>

export function buildExport(progress: Progress, os: Os | undefined, now = new Date()): ExportFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    app: 'oncut-learn',
    exportedAt: now.toISOString(),
    ...(os ? { os } : {}),
    progress,
  }
}

const MAX_LESSONS = 10_000

/**
 * A time as stored here: ISO 8601 in UTC. Anything Date can read is accepted
 * and normalized, so the earliest-wins merge compares like with like.
 */
function normalizeTime(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 40) return undefined
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}

/** Parse an export file. Throws an Error with a Greek message for the visitor. */
export function parseExport(text: string): ExportFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Το αρχείο δεν είναι έγκυρο JSON.')
  }
  if (typeof data !== 'object' || data === null) throw new Error('Το αρχείο δεν είναι αρχείο προόδου του oncut learn.')
  const file = data as Record<string, unknown>
  if (file.app !== 'oncut-learn') throw new Error('Το αρχείο δεν είναι αρχείο προόδου του oncut learn.')
  if (file.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Το αρχείο έχει έκδοση ${String(file.schemaVersion)}, ενώ αυτή η σελίδα διαβάζει την έκδοση ${SCHEMA_VERSION}.`)
  }
  if (typeof file.progress !== 'object' || file.progress === null || Array.isArray(file.progress)) {
    throw new Error('Το αρχείο δεν έχει πρόοδο μαθημάτων.')
  }
  const entries = Object.entries(file.progress as Record<string, unknown>)
  if (entries.length > MAX_LESSONS) throw new Error('Το αρχείο έχει πάρα πολλά μαθήματα.')

  const progress: Progress = {}
  for (const [id, value] of entries) {
    if (!ID_PATTERN.test(id) || typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`Άκυρη εγγραφή για το μάθημα «${id.slice(0, 80)}».`)
    }
    const lesson: LessonProgress = {}
    for (const [state, when] of Object.entries(value as Record<string, unknown>)) {
      const time = normalizeTime(when)
      if (!(STATES as readonly string[]).includes(state) || !time) {
        throw new Error(`Άκυρη εγγραφή για το μάθημα «${id}».`)
      }
      lesson[state as State] = time
    }
    progress[id] = lesson
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    app: 'oncut-learn',
    exportedAt: normalizeTime(file.exportedAt) ?? new Date().toISOString(),
    ...(isOs(file.os) ? { os: file.os } : {}),
    progress,
  }
}

function mergeLesson(a: LessonProgress = {}, b: LessonProgress = {}): LessonProgress {
  const merged: LessonProgress = { ...a }
  for (const state of STATES) {
    const x = a[state]
    const y = b[state]
    if (y && (!x || y < x)) merged[state] = y
  }
  return merged
}

/** Move progress of retired lesson ids to the ids that replaced them. */
export function applyIdMap(progress: Progress, idMap: IdMap): Progress {
  const result: Progress = {}
  for (const [id, value] of Object.entries(progress)) {
    for (const target of idMap[id] === undefined ? [id] : [idMap[id]].flat()) {
      result[target] = mergeLesson(result[target], value)
    }
  }
  return result
}

/** Combine two progress sets; for each state the earliest time wins. */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const result: Progress = { ...a }
  for (const [id, value] of Object.entries(b)) result[id] = mergeLesson(result[id], value)
  return result
}

/** Same lessons, same states, same times. */
export function sameProgress(a: Progress, b: Progress): boolean {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const id of ids) {
    for (const state of STATES) {
      if (a[id]?.[state] !== b[id]?.[state]) return false
    }
  }
  return true
}

/**
 * A short fingerprint of an id map, stored after a local migration so it runs
 * once per map version. FNV-1a over the entries sorted by key.
 */
export function idMapVersion(idMap: IdMap): string {
  const text = JSON.stringify(Object.keys(idMap).sort().map((key) => [key, idMap[key]]))
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
