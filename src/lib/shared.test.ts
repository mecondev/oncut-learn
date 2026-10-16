// The files that cannot import src/lib/shared.ts must hold the same values.
// Run: npm test, from the repository root.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { ID_PATTERN, OSES } from './shared.ts'

const read = (path: string) => readFileSync(path, 'utf8')

describe('OS list copies', () => {
  it('public/os-early.js accepts exactly these OSes', () => {
    const accepted = [...read('public/os-early.js').matchAll(/os === '([a-z]+)'/g)].map((m) => m[1])
    assert.deepEqual(accepted, [...OSES])
  })

  it('global.css hides other blocks for exactly these OSes', () => {
    const css = read('src/styles/global.css')
    const rules = [...css.matchAll(/html\[data-os='([a-z]+)'\] \.platform:not\(\[data-os~='([a-z]+)'\]\)/g)]
    assert.deepEqual(
      rules.map((m) => m[1]),
      [...OSES],
    )
    for (const m of rules) assert.equal(m[1], m[2])
  })

  it('validate.py PLATFORMS lists exactly these OSes', () => {
    const line = read('tools/validate/validate.py').match(/^PLATFORMS = \(([^)]*)\)$/m)
    assert.ok(line, 'PLATFORMS tuple not found')
    assert.deepEqual([...line[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]), [...OSES])
  })
})

describe('id pattern copies', () => {
  it('validate.py ID_PATTERN is the same regex', () => {
    const match = read('tools/validate/validate.py').match(/^ID_PATTERN = re\.compile\(r"([^"]+)"\)$/m)
    assert.ok(match, 'ID_PATTERN not found')
    assert.equal(match[1], ID_PATTERN.source)
  })
})
