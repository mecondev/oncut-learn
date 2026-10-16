// Values the build, the player and the validator must agree on. TypeScript
// imports them from here; the files that cannot import (public/os-early.js,
// src/styles/global.css, tools/validate/validate.py) are compared with these
// values by src/lib/shared.test.ts. No DOM or Node APIs here.

/** Operating systems a lesson can address, in display order. */
export const OSES = ['windows', 'linux', 'macos'] as const
export type Os = (typeof OSES)[number]

export const OS_LABELS: Record<Os, string> = {
  windows: 'Windows',
  linux: 'Linux',
  macos: 'macOS',
}

export function isOs(value: unknown): value is Os {
  return typeof value === 'string' && (OSES as readonly string[]).includes(value)
}

/** Lesson and snippet ids: course.module.lesson[.name], lowercase. */
export const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/
