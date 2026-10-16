// Lesson Markdown rules (remark-lesson.ts), run on small documents against
// the real snippets in courses/. Run: npm test, from the repo root.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Root } from 'mdast'
import remarkDirective from 'remark-directive'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { VFile } from 'vfile'
import remarkLesson from './remark-lesson.ts'

const FENCE = '`'.repeat(3)
const HELLO = 'cpp.setup.hello-world.hello'

function run(markdown: string): Root {
  const processor = unified().use(remarkParse).use(remarkDirective).use(remarkLesson)
  const file = new VFile({ path: 'lesson.md', value: markdown })
  return processor.runSync(processor.parse(file), file) as Root
}

const fails = (markdown: string, message: RegExp) => assert.throws(() => run(markdown), message)

describe('fenced code', () => {
  it('rejects C++ typed into a lesson', () => {
    fails(`${FENCE}cpp\nint main() {}\n${FENCE}\n`, /Code in a lesson comes only from ::snippet/)
  })

  it('rejects a shell command outside a platform block', () => {
    fails(`${FENCE}sh\nls\n${FENCE}\n`, /Code in a lesson comes only from ::snippet/)
  })

  it('rejects a non-shell language inside a platform block', () => {
    fails(`:::platform{os="linux"}\n${FENCE}text\nx\n${FENCE}\n:::\n`, /Code in a lesson/)
  })

  it('accepts a shell command inside a platform block, also in a list', () => {
    run(`:::platform{os="linux"}\n1. Run:\n\n   ${FENCE}sh\n   ls\n   ${FENCE}\n:::\n`)
  })
})

describe('platform blocks', () => {
  it('rejects an unknown OS', () => {
    fails(':::platform{os="bsd"}\nx\n:::\n', /Unknown os "bsd"/)
  })

  it('rejects a block without os', () => {
    fails(':::platform\nx\n:::\n', /needs os=/)
  })

  it('rejects nested blocks', () => {
    fails('::::platform{os="linux"}\n:::platform{os="macos"}\nx\n:::\n::::\n', /cannot contain another platform block/)
  })

  it('labels a block and marks its OSes', () => {
    const tree = run(':::platform{os="linux macos"}\nx\n:::\n')
    const block = tree.children[0] as { data?: { hProperties?: Record<string, unknown> }; children: { children: { value: string }[] }[] }
    assert.equal(block.data?.hProperties?.dataOs, 'linux macos')
    assert.equal(block.children[0].children[0].value, 'Linux, macOS')
  })
})

describe('snippets and output', () => {
  it('expands a snippet into its files', () => {
    const tree = run(`::snippet{id="${HELLO}"}\n`)
    const code = JSON.stringify(tree)
    assert.match(code, /hello\.cpp/)
    assert.match(code, /Hello, World!/)
  })

  it('shows the verified stdout', () => {
    assert.match(JSON.stringify(run(`::output{id="${HELLO}"}\n`)), /Hello, World!/)
  })

  it('rejects an unknown snippet', () => {
    fails('::snippet{id="cpp.nope.x"}\n', /No snippet with id "cpp.nope.x"/)
  })

  it('rejects output for a snippet that does not run', () => {
    fails('::output{id="cpp.setup.hello-world.greek-semicolon"}\n', /expect is "compile-fail"/)
  })

  it('rejects ::snippet written as a text directive', () => {
    fails(`Text :snippet{id="${HELLO}"} here.\n`, /must be written as ::snippet/)
  })
})

describe('other directives', () => {
  it('rejects an unknown block directive', () => {
    fails('::video{src="x"}\n', /Unknown directive "video"/)
  })

  it('keeps a colon in running text as text', () => {
    // remark-directive reads ":30" and ":thing" as directives; the plugin puts
    // them back as text, in separate text nodes that render as one.
    const paragraph = run('At 10:30 the :thing starts.\n').children[0] as { children: { value?: string }[] }
    assert.equal(paragraph.children.map((c) => c.value ?? '?').join(''), 'At 10:30 the :thing starts.')
  })
})
