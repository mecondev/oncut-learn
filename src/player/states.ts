// Progress types, kept apart from store.ts so pure modules (backup.ts) and
// their tests can import them without a browser.

export const STATES = ['read', 'quiz-passed', 'exercise-done'] as const
export type State = (typeof STATES)[number]

/** One lesson's progress: each state reached, with the time it was reached. */
export type LessonProgress = Partial<Record<State, string>>
export type Progress = Record<string, LessonProgress>
