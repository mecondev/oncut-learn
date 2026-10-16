// The visitor's operating system, chosen once and changeable at any time.
// Kept in localStorage, not IndexedDB, because public/os-early.js must read it
// synchronously before the first paint. It never leaves the browser.

import { isOs, type Os } from '../lib/shared.ts'

export { isOs, OSES, type Os } from '../lib/shared.ts'

const KEY = 'oncut-learn:os'

export function getOs(): Os | undefined {
  try {
    const value = localStorage.getItem(KEY)
    return isOs(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function setOs(os: Os | undefined): void {
  try {
    if (os) localStorage.setItem(KEY, os)
    else localStorage.removeItem(KEY)
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  applyOs(os)
}

export function applyOs(os: Os | undefined): void {
  const root = document.documentElement
  if (os) root.dataset.os = os
  else delete root.dataset.os
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="os"]')) {
    input.checked = input.value === os
  }
}

/** Wire every OS picker on the page. */
export function initOsPicker(): void {
  applyOs(getOs())
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="os"]')) {
    input.addEventListener('change', () => {
      if (input.checked && isOs(input.value)) setOs(input.value)
    })
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-os-clear]')) {
    button.addEventListener('click', () => setOs(undefined))
  }
  // A choice made in another tab applies here too.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY || event.key === null) applyOs(getOs())
  })
}
