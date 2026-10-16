import type { LessonProgress, Progress, State } from './states.ts'

// Progress in IndexedDB, keyed on the permanent lesson id. Nothing here is
// ever sent anywhere; export to a file is the backup.

export { STATES, type LessonProgress, type Progress, type State } from './states.ts'

const DB_NAME = 'oncut-learn'
const DB_VERSION = 1
const PROGRESS = 'progress'
const META = 'meta'

/** Fired on document when progress changes, in this tab or another one. */
export const CHANGED_EVENT = 'oncut:progress'

export type StorageStatus = 'ok' | 'blocked' | 'unavailable'

class BlockedError extends Error {}

let dbPromise: Promise<IDBDatabase> | undefined
let channel: BroadcastChannel | undefined

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PROGRESS)) db.createObjectStore(PROGRESS)
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
    }
    req.onsuccess = () => {
      const db = req.result
      // A newer page in another tab wants to upgrade: let it. This
      // tab opens the database again on its next read or write.
      db.onversionchange = () => {
        db.close()
        dbPromise = undefined
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new BlockedError('IndexedDB upgrade is blocked by another tab'))
  }).catch((error: unknown) => {
    dbPromise = undefined
    throw error
  })
  return dbPromise
}

export async function storageStatus(): Promise<StorageStatus> {
  try {
    await open()
    return 'ok'
  } catch (error) {
    return error instanceof BlockedError ? 'blocked' : 'unavailable'
  }
}

/** Relay changes made in other tabs of this site as CHANGED_EVENT. */
export function listenToOtherTabs(): void {
  if (channel || !('BroadcastChannel' in window)) return
  channel = new BroadcastChannel(DB_NAME)
  channel.onmessage = () => document.dispatchEvent(new CustomEvent(CHANGED_EVENT))
}

function changed(): void {
  document.dispatchEvent(new CustomEvent(CHANGED_EVENT))
  channel?.postMessage('changed')
}

export async function getAll(): Promise<Progress> {
  const db = await open()
  const tx = db.transaction(PROGRESS, 'readonly')
  const store = tx.objectStore(PROGRESS)
  const [keys, values] = await Promise.all([
    request(store.getAllKeys()),
    request(store.getAll() as IDBRequest<LessonProgress[]>),
  ])
  const progress: Progress = {}
  keys.forEach((key, i) => {
    progress[String(key)] = values[i]
  })
  return progress
}

export async function getLesson(id: string): Promise<LessonProgress> {
  const db = await open()
  const value = await request(db.transaction(PROGRESS, 'readonly').objectStore(PROGRESS).get(id))
  return (value as LessonProgress | undefined) ?? {}
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await open()
  return (await request(db.transaction(META, 'readonly').objectStore(META).get(key))) as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await open()
  const tx = db.transaction(META, 'readwrite')
  tx.objectStore(META).put(value, key)
  await done(tx)
}

/** Record a state for a lesson; keeps the first time it was reached. */
export async function mark(id: string, state: State): Promise<void> {
  const db = await open()
  const tx = db.transaction([PROGRESS, META], 'readwrite')
  const store = tx.objectStore(PROGRESS)
  // Read and write in the same request callback, so the transaction never
  // sees an idle moment between them.
  const get = store.get(id)
  get.onsuccess = () => {
    const current = (get.result as LessonProgress | undefined) ?? {}
    if (current[state]) return
    current[state] = new Date().toISOString()
    store.put(current, id)
    tx.objectStore(META).put(Date.now(), 'lastChange')
  }
  await done(tx)
  void requestPersistence()
  changed()
}

/**
 * Replace all progress, as after an import. `asChange: false` is for a
 * migration that keeps the visitor's backup valid (the id map applies on
 * import too), so the backup reminder does not appear for it.
 */
export async function replaceAll(progress: Progress, { asChange = true } = {}): Promise<void> {
  const db = await open()
  const tx = db.transaction([PROGRESS, META], 'readwrite')
  const store = tx.objectStore(PROGRESS)
  store.clear()
  for (const [id, value] of Object.entries(progress)) store.put(value, id)
  if (asChange) tx.objectStore(META).put(Date.now(), 'lastChange')
  await done(tx)
  changed()
}

export async function clearAll(): Promise<void> {
  const db = await open()
  const tx = db.transaction([PROGRESS, META], 'readwrite')
  tx.objectStore(PROGRESS).clear()
  tx.objectStore(META).clear()
  await done(tx)
  changed()
}

export async function markExported(): Promise<void> {
  await setMeta('lastExport', Date.now())
  changed()
}

/** True when progress changed after the last export (or was never exported). */
export async function needsBackup(): Promise<boolean> {
  const [lastChange, lastExport] = await Promise.all([getMeta<number>('lastChange'), getMeta<number>('lastExport')])
  return lastChange !== undefined && (lastExport === undefined || lastChange > lastExport)
}

/**
 * Ask the browser not to evict our data. Requested, never promised:
 * Safari may still clear it, so export stays the backup.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function isPersisted(): Promise<boolean | undefined> {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : undefined
  } catch {
    return undefined
  }
}
