import { applyIdMap, buildExport, idMapVersion, mergeProgress, parseExport, sameProgress, type IdMap } from './backup.ts'
import { getOs, initOsPicker, setOs } from './os.ts'
import {
  CHANGED_EVENT,
  clearAll,
  getAll,
  getLesson,
  getMeta,
  isPersisted,
  listenToOtherTabs,
  mark,
  markExported,
  needsBackup,
  replaceAll,
  setMeta,
  storageStatus,
  type LessonProgress,
} from './store.ts'

// One script for every page: each part runs only if its markup is present.
// The pages are complete without it; this adds OS choice, progress and quiz.

const STATE_LABELS: Record<string, string> = {
  read: 'Διαβάστηκε',
  'quiz-passed': 'Πέρασε το quiz',
  'exercise-done': 'Έγινε η άσκηση',
}

function all<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)]
}

function show(el: HTMLElement | null, visible: boolean): void {
  if (el) el.hidden = !visible
}

function readJson<T>(id: string, fallback: T): T {
  const el = document.getElementById(id)
  if (!el?.textContent) return fallback
  try {
    return JSON.parse(el.textContent) as T
  } catch {
    return fallback
  }
}

// ── Progress badges and the backup reminder (every page) ────────────────────

function describe(progress: LessonProgress): string {
  return Object.keys(STATE_LABELS)
    .filter((state) => progress[state as keyof LessonProgress])
    .map((state) => STATE_LABELS[state])
    .join(' · ')
}

async function refreshProgress(): Promise<void> {
  const progress = await getAll()
  for (const el of all('[data-progress-for]')) {
    const text = describe(progress[el.dataset.progressFor ?? ''] ?? {})
    el.textContent = text
    show(el, text !== '')
  }
  show(document.querySelector<HTMLElement>('[data-backup-reminder]'), await needsBackup())
}

/**
 * Move progress kept under retired lesson ids to their new ids, once per
 * version of the id map. The visitor's backup stays valid, since
 * an import applies the same map, so this is not a change to back up.
 */
async function migrateIdMap(idMap: IdMap): Promise<void> {
  if (Object.keys(idMap).length === 0) return
  const version = idMapVersion(idMap)
  if ((await getMeta<string>('idMapVersion')) === version) return
  const progress = await getAll()
  const migrated = applyIdMap(progress, idMap)
  if (!sameProgress(progress, migrated)) await replaceAll(migrated, { asChange: false })
  await setMeta('idMapVersion', version)
}

// ── Lesson page ─────────────────────────────────────────────────────────────

async function initLesson(article: HTMLElement): Promise<void> {
  const id = article.dataset.lessonId
  if (!id) return
  const button = article.querySelector<HTMLButtonElement>('[data-mark-read]')
  const status = article.querySelector<HTMLElement>('[data-read-status]')

  const render = async () => {
    const progress = await getLesson(id)
    if (button) button.disabled = Boolean(progress.read)
    if (status) status.textContent = progress.read ? 'Το μάθημα σημειώθηκε ως διαβασμένο.' : ''
    const quizStatus = article.querySelector<HTMLElement>('[data-quiz-status]')
    if (quizStatus && progress['quiz-passed']) quizStatus.textContent = 'Έχεις ήδη περάσει αυτό το quiz.'
  }
  button?.addEventListener('click', async () => {
    await mark(id, 'read')
    await render()
  })
  show(button, true)
  await render()
  document.addEventListener(CHANGED_EVENT, () => void render())
}

/**
 * The quiz works whenever this script runs; only saving needs storage.
 * Without JavaScript the page shows the answers in <noscript>.
 */
function initQuiz(section: HTMLElement, canSave: boolean): void {
  const lessonId = section.dataset.lessonId
  const form = section.querySelector('form')
  const result = section.querySelector<HTMLElement>('[data-quiz-result]')
  if (!lessonId || !form || !result) return

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const questions = all<HTMLFieldSetElement>('[data-question]', form)
    let correct = 0
    let unanswered = 0
    for (const fieldset of questions) {
      fieldset.classList.remove('is-correct', 'is-wrong', 'is-unanswered')
      for (const p of all('[data-explanation]', fieldset)) show(p, false)
      const chosen = fieldset.querySelector<HTMLInputElement>('input:checked')
      if (!chosen) {
        unanswered++
        fieldset.classList.add('is-unanswered')
        continue
      }
      const right = chosen.hasAttribute('data-correct')
      if (right) correct++
      fieldset.classList.add(right ? 'is-correct' : 'is-wrong')
      show(fieldset.querySelector<HTMLElement>(`[data-explanation="${chosen.value}"]`), true)
    }
    const total = questions.length
    if (unanswered > 0) {
      result.textContent = `Απάντησε σε όλες τις ερωτήσεις (λείπουν ${unanswered}).`
    } else if (correct === total) {
      result.textContent = canSave
        ? `Σωστές ${correct} από ${total}. Πέρασες το quiz.`
        : `Σωστές ${correct} από ${total}. Πέρασες το quiz. Δεν αποθηκεύτηκε: αυτός ο browser δεν κρατά δεδομένα για τη σελίδα.`
      if (canSave) await mark(lessonId, 'quiz-passed')
    } else {
      result.textContent = `Σωστές ${correct} από ${total}. Διάβασε τις εξηγήσεις και δοκίμασε ξανά.`
    }
  })
}

// ── Progress page: export, import, delete ───────────────────────────────────

interface SaveFilePicker {
  showSaveFilePicker(options: {
    suggestedName: string
    types: { description: string; accept: Record<string, string[]> }[]
  }): Promise<{ createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> }>
}

/**
 * Save the export. Where the browser offers a save dialog with a result
 * (Chromium), the backup counts only once written; elsewhere the file goes to
 * downloads and there is no way to know, so it counts at once.
 * Returns false when the visitor cancelled.
 */
async function saveFile(name: string, text: string): Promise<'saved' | 'downloaded' | 'cancelled'> {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as unknown as SaveFilePicker).showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
      return 'saved'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // Any other failure (a policy, a sandbox): fall back to a download.
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}

async function initProgressPage(page: HTMLElement, idMap: IdMap): Promise<void> {
  const message = page.querySelector<HTMLElement>('[data-backup-message]')
  const say = (text: string) => {
    if (message) message.textContent = text
  }
  show(page.querySelector<HTMLElement>('[data-backup-tools]'), true)

  const persisted = page.querySelector<HTMLElement>('[data-persisted]')
  if (persisted) {
    const state = await isPersisted()
    persisted.textContent =
      state === true
        ? 'Ο browser έχει δεχτεί να μη σβήνει μόνος του αυτά τα δεδομένα.'
        : 'Ο browser μπορεί να σβήσει αυτά τα δεδομένα αν χρειαστεί χώρο. Κράτα ένα αντίγραφο σε αρχείο.'
  }

  page.querySelector('[data-export]')?.addEventListener('click', async () => {
    const file = buildExport(await getAll(), getOs())
    const day = file.exportedAt.slice(0, 10)
    const outcome = await saveFile(`oncut-learn-progress-${day}.json`, `${JSON.stringify(file, null, 2)}\n`)
    if (outcome === 'cancelled') {
      say('Η αποθήκευση ακυρώθηκε. Δεν κρατήθηκε αντίγραφο.')
      return
    }
    await markExported()
    say(
      outcome === 'saved'
        ? 'Το αντίγραφο αποθηκεύτηκε.'
        : 'Ο browser κατέβασε το αρχείο. Έλεγξε ότι είναι στις λήψεις σου.',
    )
  })

  const input = page.querySelector<HTMLInputElement>('[data-import]')
  input?.addEventListener('change', async () => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (file.size > 2_000_000) {
      say('Το αρχείο είναι πολύ μεγάλο για αρχείο προόδου.')
      return
    }
    try {
      const imported = parseExport(await file.text())
      const fromFile = applyIdMap(imported.progress, idMap)
      const merged = mergeProgress(applyIdMap(await getAll(), idMap), fromFile)
      await replaceAll(merged)
      // The file already holds everything this browser has: it is a current
      // backup, so restoring it raises no reminder.
      if (sameProgress(merged, fromFile)) await markExported()
      if (imported.os && !getOs()) setOs(imported.os)
      say(`Η πρόοδος από το αρχείο προστέθηκε (${Object.keys(imported.progress).length} μαθήματα).`)
    } catch (error) {
      say(error instanceof Error ? error.message : 'Το αρχείο δεν διαβάστηκε.')
    }
  })

  // Two presses instead of a confirm() dialog: nothing modal, nothing to miss.
  const clear = page.querySelector<HTMLButtonElement>('[data-clear]')
  let armed = false
  clear?.addEventListener('click', async () => {
    if (!armed) {
      armed = true
      clear.textContent = 'Πάτησε ξανά για να σβηστεί όλη η πρόοδος'
      setTimeout(() => {
        armed = false
        clear.textContent = 'Σβήσε την πρόοδο από αυτόν τον browser'
      }, 5000)
      return
    }
    armed = false
    await clearAll()
    setOs(undefined)
    clear.textContent = 'Σβήσε την πρόοδο από αυτόν τον browser'
    say('Η πρόοδος και η επιλογή συστήματος σβήστηκαν από αυτόν τον browser.')
  })
}

// ── Start ───────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  initOsPicker()
  const status = await storageStatus()
  const quizzes = all('[data-quiz]')
  if (status !== 'ok') {
    for (const quiz of quizzes) initQuiz(quiz, false)
    for (const el of all('[data-needs-storage]')) show(el, false)
    show(document.querySelector<HTMLElement>(status === 'blocked' ? '[data-storage-blocked]' : '[data-no-storage]'), true)
    return
  }
  listenToOtherTabs()
  const idMap = readJson<IdMap>('id-map', {})
  await migrateIdMap(idMap)

  for (const quiz of quizzes) initQuiz(quiz, true)
  const article = document.querySelector<HTMLElement>('article[data-lesson-id]')
  if (article) await initLesson(article)
  const page = document.querySelector<HTMLElement>('[data-progress-page]')
  if (page) await initProgressPage(page, idMap)

  await refreshProgress()
  document.addEventListener(CHANGED_EVENT, () => void refreshProgress())
}

void start()
