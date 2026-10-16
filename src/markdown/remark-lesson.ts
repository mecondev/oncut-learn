import type { Code, Paragraph, Parent, Root, RootContent, Text } from 'mdast'
import type { ContainerDirective, LeafDirective, TextDirective } from 'mdast-util-directive'
import { SKIP, visit } from 'unist-util-visit'
import { visitParents } from 'unist-util-visit-parents'
import type { VFile } from 'vfile'
import { isOs, OS_LABELS, OSES } from '../lib/shared.ts'
import { snippetIndex, type Snippet } from './snippets.ts'

// Lesson Markdown rules, enforced at build time:
//
//   :::platform{os="windows"}   text for one OS (or a space-separated list)
//   ::snippet{id="..."}         code from a verified snippet folder
//   ::output{id="..."}          the stdout that snippet is verified to print
//
// A fenced code block is allowed only inside a platform block, and only for a
// shell language. Anything else fails the build.


const SHELL_LANGS = new Set(['powershell', 'sh', 'bash', 'console', 'shell'])

type Directive = ContainerDirective | LeafDirective | TextDirective

function attribute(node: Directive, name: string, file: VFile): string {
  const value = node.attributes?.[name]
  if (!value) file.fail(`::${node.name} needs ${name}="..."`, node)
  return value
}

function only(node: Directive, kind: Directive['type'], file: VFile): void {
  if (node.type !== kind) {
    const form = { containerDirective: ':::', leafDirective: '::', textDirective: ':' }[kind]
    file.fail(`"${node.name}" must be written as ${form}${node.name}`, node)
  }
}

function platformNode(node: ContainerDirective, file: VFile): void {
  only(node, 'containerDirective', file)
  const oses = attribute(node, 'os', file).split(/\s+/)
  for (const os of oses) {
    if (!isOs(os)) {
      file.fail(`Unknown os "${os}" in platform block; use ${OSES.join(', ')}`, node)
    }
  }
  const label: Paragraph = {
    type: 'paragraph',
    data: { hProperties: { className: ['platform-label'] } } as Paragraph['data'],
    children: [{ type: 'text', value: oses.map((os) => OS_LABELS[os as keyof typeof OS_LABELS]).join(', ') }],
  }
  node.children.unshift(label)
  node.data = {
    hName: 'section',
    hProperties: { className: ['platform'], dataOs: oses.join(' ') },
  }
}

type SnippetIndex = Map<string, Snippet>

function findSnippet(node: LeafDirective, snippets: SnippetIndex, file: VFile): Snippet {
  only(node, 'leafDirective', file)
  const id = attribute(node, 'id', file)
  const snippet = snippets.get(id)
  if (!snippet) file.fail(`No snippet with id "${id}" under courses/`, node)
  return snippet
}

function snippetNodes(node: LeafDirective, snippets: SnippetIndex, file: VFile): RootContent[] {
  const snippet = findSnippet(node, snippets, file)
  const id = snippet.id
  return snippet.files.map((source) => ({
    type: 'snippetFigure',
    data: { hName: 'figure', hProperties: { className: ['snippet'], dataSnippet: id } },
    children: [
      {
        type: 'paragraph',
        data: { hName: 'figcaption' },
        children: [{ type: 'text', value: source.name }],
      },
      { type: 'code', lang: source.lang, value: source.code } satisfies Code,
    ],
  })) as unknown as RootContent[]
}

function outputNode(node: LeafDirective, snippets: SnippetIndex, file: VFile): RootContent {
  const snippet = findSnippet(node, snippets, file)
  if (!('stdout' in snippet.output)) {
    file.fail(`::output cannot show snippet "${snippet.id}": ${snippet.output.reason}`, node)
  }
  return {
    type: 'snippetOutput',
    data: { hName: 'pre', hProperties: { className: ['output'], dataSnippet: snippet.id } },
    children: [{ type: 'text', value: snippet.output.stdout.replace(/\n$/, '') }],
  } as unknown as RootContent
}

/** An unknown :name in running text was not meant as a directive ("10:30"). */
function asText(node: TextDirective, file: VFile): Text {
  if (node.attributes && Object.keys(node.attributes).length > 0) {
    file.fail(`Unknown directive ":${node.name}"`, node)
  }
  const label = node.children.map((child) => ('value' in child ? child.value : '')).join('')
  return { type: 'text', value: `:${node.name}${node.children.length ? `[${label}]` : ''}` }
}

/** Fenced code is allowed only as a shell command somewhere inside a platform block. */
function checkFencedCode(tree: Root, file: VFile): void {
  const allowed = new Set<Code>()
  visit(tree, 'containerDirective', (node) => {
    if (node.name !== 'platform') return
    visit(node, 'code', (code) => {
      if (SHELL_LANGS.has(code.lang ?? '')) allowed.add(code)
    })
  })
  visit(tree, 'code', (code) => {
    if (!allowed.has(code)) {
      file.fail(
        'Code in a lesson comes only from ::snippet{id="..."}. A fenced block is allowed only for a ' +
          `shell command inside a platform block (${[...SHELL_LANGS].join(', ')}).`,
        code,
      )
    }
  })
}

function insidePlatform(ancestors: Parent[]): boolean {
  return ancestors.some((node) => node.type === 'containerDirective' && (node as ContainerDirective).name === 'platform')
}

export default function remarkLesson() {
  return (tree: Root, file: VFile) => {
    // Before any snippet is expanded, so snippet code is never mistaken for typed code.
    checkFencedCode(tree, file)
    const snippets = snippetIndex()

    visitParents(tree, (node, ancestors) => {
      if (node.type !== 'containerDirective' && node.type !== 'leafDirective' && node.type !== 'textDirective') return
      const directive = node as Directive
      const parent = ancestors.at(-1) as Parent | undefined
      if (!parent) return
      const index = parent.children.indexOf(directive)
      let replacement: RootContent[]
      switch (directive.name) {
        case 'platform':
          if (insidePlatform(ancestors as Parent[])) {
            file.fail('A platform block cannot contain another platform block', directive)
          }
          platformNode(directive as ContainerDirective, file)
          return
        case 'snippet':
          replacement = snippetNodes(directive as LeafDirective, snippets, file)
          break
        case 'output':
          replacement = [outputNode(directive as LeafDirective, snippets, file)]
          break
        default:
          if (directive.type !== 'textDirective') file.fail(`Unknown directive "${directive.name}"`, directive)
          replacement = [asText(directive as TextDirective, file)]
      }
      parent.children.splice(index, 1, ...(replacement as typeof parent.children))
      return [SKIP, index + replacement.length]
    })
  }
}
