import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ID_PATTERN } from '../lib/shared.ts'

// Snippets are read straight from courses/ at build time. The validator
// (tools/validate/validate.py) owns the full snippet.json schema and runs the
// code; the site checks the fields it uses, with the same rules, so a file the
// validator rejects cannot render here either.
//
// Shown output follows one rule in both places: an expect "run" snippet has
// either a top-level "stdout" (one run, no input) or a non-empty "cases" list,
// never both. ::output shows that one stdout, or the only case; a snippet with
// several cases has no single output to show.

export interface SnippetFile {
  name: string
  lang: string
  code: string
}

export interface Snippet {
  id: string
  dir: string
  files: SnippetFile[]
  /** The verified stdout ::output may show, or why there is none. */
  output: { stdout: string } | { reason: string }
}

const COURSES_DIR = resolve(process.cwd(), 'courses')
const SOURCE_NAME = /^[A-Za-z0-9_.-]+\.(cpp|cc|cxx|h|hpp)$/

const LANG_BY_EXTENSION: Record<string, string> = {
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'cpp',
  hpp: 'cpp',
}

function findSnippetJson(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) findSnippetJson(path, found)
    else if (entry.name === 'snippet.json') found.push(path)
  }
  return found
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function loadSnippet(jsonPath: string): Snippet {
  const fail = (message: string): never => {
    throw new Error(`[snippets] ${jsonPath}: ${message}`)
  }
  const dir = resolve(jsonPath, '..')
  let data: unknown
  try {
    data = JSON.parse(readFileSync(jsonPath, 'utf8'))
  } catch (error) {
    fail(`cannot read: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isObject(data)) return fail('must contain an object')
  const { id, files, expect, stdout, cases } = data
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) fail('"id" must look like course.module.lesson.name')
  if (!Array.isArray(files) || files.length === 0) fail('"files" must be a non-empty list')
  for (const name of files as unknown[]) {
    if (typeof name !== 'string' || !SOURCE_NAME.test(name)) fail(`file "${String(name)}" must be a plain C++ file name`)
  }
  if (expect !== 'run' && expect !== 'compile-only' && expect !== 'compile-fail') {
    fail('"expect" must be run, compile-only or compile-fail')
  }
  if (stdout !== undefined && typeof stdout !== 'string') fail('"stdout" must be a string')
  if (cases !== undefined && (!Array.isArray(cases) || !cases.every((c) => isObject(c) && typeof c.stdout === 'string'))) {
    fail('"cases" must be a list of objects with a "stdout" string')
  }
  const caseList = (cases ?? []) as { stdout: string }[]

  let output: Snippet['output']
  if (expect !== 'run') {
    if (stdout !== undefined || caseList.length > 0) fail('"stdout" and "cases" are only for expect "run"')
    output = { reason: `expect is "${expect as string}", so nothing runs` }
  } else if (stdout !== undefined && caseList.length > 0) {
    output = fail('use either "stdout" or a non-empty "cases", not both')
  } else if (typeof stdout === 'string') {
    output = { stdout }
  } else if (caseList.length === 1) {
    output = { stdout: caseList[0].stdout }
  } else if (caseList.length === 0) {
    output = fail('expect "run" needs "stdout" or at least one case')
  } else {
    output = { reason: `it has ${caseList.length} cases, so there is no single output` }
  }

  const sources = (files as string[]).map((name) => {
    const extension = name.split('.').pop() ?? ''
    let code = ''
    try {
      // Keep the source exactly as compiled, but drop CR so a Windows checkout
      // without .gitattributes renders the same.
      code = readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '')
    } catch {
      fail(`file "${name}" does not exist`)
    }
    return { name, lang: LANG_BY_EXTENSION[extension] ?? 'text', code }
  })
  return { id: id as string, dir, files: sources, output }
}

/**
 * Every snippet under courses/, by id. The remark plugin builds it once per
 * lesson file, so the dev server picks up an edited snippet on the next render
 * of a lesson; the tree is small.
 */
export function snippetIndex(): Map<string, Snippet> {
  const index = new Map<string, Snippet>()
  for (const path of findSnippetJson(COURSES_DIR)) {
    const snippet = loadSnippet(path)
    const other = index.get(snippet.id)
    if (other) throw new Error(`[snippets] duplicate snippet id "${snippet.id}" in ${other.dir} and ${snippet.dir}`)
    index.set(snippet.id, snippet)
  }
  return index
}
