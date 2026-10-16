import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getCollection, type CollectionEntry } from 'astro:content'
import { ID_PATTERN } from './shared'

// The course tree, built once per build from the content collections, with
// the checks a single-file schema cannot make. Any problem throws, so the
// build fails with a message naming the file.

export type Lesson = CollectionEntry<'lessons'>
export type Quiz = CollectionEntry<'quizzes'>

export interface LessonNode {
  entry: Lesson
  quiz?: Quiz
  module: ModuleNode
  url: string
}

export interface ModuleNode {
  entry: CollectionEntry<'modules'>
  folder: string
  lessons: LessonNode[]
}

export interface CourseNode {
  entry: CollectionEntry<'courses'>
  folder: string
  modules: ModuleNode[]
  lessons: LessonNode[]
  url: string
  /** Old lesson id -> new id(s), from id-map.json. */
  idMap: Record<string, string | string[]>
}

const IdMap = (value: unknown, file: string): Record<string, string | string[]> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${file}: must be an object of old id -> new id`)
  }
  // Keys and targets must look like lesson ids: the map is written into every
  // page inside a <script> data block (Base.astro).
  for (const [key, target] of Object.entries(value)) {
    if (!ID_PATTERN.test(key)) throw new Error(`${file}: "${key.slice(0, 80)}" is not a lesson id`)
    const targets = typeof target === 'string' ? [target] : Array.isArray(target) ? target : []
    const ok = targets.length > 0 && targets.every((t) => typeof t === 'string' && ID_PATTERN.test(t))
    if (!ok) throw new Error(`${file}: "${key}" must map to a lesson id or a list of lesson ids`)
  }
  return value as Record<string, string | string[]>
}

function fail(message: string): never {
  throw new Error(`[courses] ${message}`)
}

// Drafts appear in `npm run dev`, and in a build only with ONCUT_DRAFTS=1
// (for checking a draft in the browser). The deployed site never has them.
const INCLUDE_DRAFTS = import.meta.env.DEV || process.env.ONCUT_DRAFTS === '1'
const SETUP_TESTS_DIR = resolve(process.cwd(), 'docs', 'setup-tests')

// Top-level paths the site itself uses (src/pages, Astro's assets), which a
// course slug must not take.
const RESERVED_SLUGS = new Set(['progress', '404', '_astro'])

let cache: Promise<CourseNode[]> | undefined

/**
 * The course tree, built once per build. Not cached in dev, so an edited
 * course.json or id-map.json shows on the next request; a failed build is
 * never cached.
 */
export function loadCourses(): Promise<CourseNode[]> {
  if (import.meta.env.DEV) return build()
  cache ??= build().catch((error: unknown) => {
    cache = undefined
    throw error
  })
  return cache
}

function duplicates<T>(items: T[]): T[] {
  return [...new Set(items.filter((item, i) => items.indexOf(item) !== i))]
}

async function build(): Promise<CourseNode[]> {
  const [courses, modules, lessons, quizzes] = await Promise.all([
    getCollection('courses'),
    getCollection('modules'),
    getCollection('lessons'),
    getCollection('quizzes'),
  ])

  // Entry ids are paths: cpp/course, cpp/modules/00-setup/module,
  // cpp/modules/00-setup/lessons/hello-world, .../quizzes/hello-world.
  const part = (id: string, n: number) => id.split('/')[n]
  const seenLessonIds = new Map<string, string>()
  for (const lesson of lessons) {
    const other = seenLessonIds.get(lesson.data.id)
    if (other) fail(`duplicate lesson id "${lesson.data.id}" in ${other} and ${lesson.id}`)
    seenLessonIds.set(lesson.data.id, lesson.id)
  }

  const result: CourseNode[] = []
  for (const slug of duplicates(courses.map((c) => c.data.slug))) fail(`duplicate course slug "${slug}"`)
  for (const course of courses) {
    const folder = part(course.id, 0)
    if (course.data.id !== folder) fail(`${course.id}: id "${course.data.id}" must equal the folder name "${folder}"`)
    if (RESERVED_SLUGS.has(course.data.slug)) fail(`${course.id}: slug "${course.data.slug}" is a path the site uses`)
    for (const m of duplicates(course.data.modules)) fail(`${course.id}: module "${m}" is listed more than once`)

    const courseModules = modules.filter((m) => part(m.id, 0) === folder)
    for (const m of courseModules) {
      if (!course.data.modules.includes(part(m.id, 2))) {
        fail(`${m.id}: module folder is not listed in ${folder}/course.json "modules"`)
      }
    }

    const mapFile = resolve(process.cwd(), 'courses', folder, 'id-map.json')
    let mapJson: unknown
    try {
      mapJson = JSON.parse(readFileSync(mapFile, 'utf8'))
    } catch (error) {
      fail(`${mapFile}: cannot read (${error instanceof Error ? error.message : String(error)}); use {} when no id is retired`)
    }
    const idMap = IdMap(mapJson, mapFile)

    const node: CourseNode = { entry: course, folder, modules: [], lessons: [], url: `/${course.data.slug}/`, idMap }
    const moduleSlugs = new Set<string>()
    for (const moduleFolder of course.data.modules) {
      const entry = courseModules.find((m) => part(m.id, 2) === moduleFolder)
      if (!entry) fail(`${folder}/course.json lists module "${moduleFolder}", but modules/${moduleFolder}/module.json is missing`)
      if (!entry.data.id.startsWith(`${course.data.id}.`)) {
        fail(`${entry.id}: module id "${entry.data.id}" must start with "${course.data.id}."`)
      }
      if (moduleSlugs.has(entry.data.slug)) fail(`${entry.id}: duplicate module slug "${entry.data.slug}"`)
      moduleSlugs.add(entry.data.slug)

      const moduleNode: ModuleNode = { entry, folder: moduleFolder, lessons: [] }
      const prefix = `${folder}/modules/${moduleFolder}/`
      const moduleLessons = lessons
        .filter((l) => l.id.startsWith(`${prefix}lessons/`))
        .sort((a, b) => a.data.order - b.data.order)
      for (const order of duplicates(moduleLessons.map((l) => l.data.order))) {
        fail(`${prefix}lessons: more than one lesson has order ${order}`)
      }
      const lessonSlugs = new Set<string>()
      for (const lesson of moduleLessons) {
        const d = lesson.data
        for (const o of duplicates(d.objectives.map((x) => x.id))) fail(`${lesson.id}: duplicate objective id "${o}"`)
        if (!d.id.startsWith(`${entry.data.id}.`)) fail(`${lesson.id}: lesson id "${d.id}" must start with "${entry.data.id}."`)
        if (lessonSlugs.has(d.slug)) fail(`${lesson.id}: duplicate lesson slug "${d.slug}" in module ${moduleFolder}`)
        lessonSlugs.add(d.slug)

        let quiz: Quiz | undefined
        if (d.quiz) {
          quiz = quizzes.find((q) => q.id === `${prefix}quizzes/${d.quiz}`)
          if (!quiz) fail(`${lesson.id}: quiz "${d.quiz}" not found in ${prefix}quizzes/`)
          if (quiz.data.lesson !== d.id) fail(`${quiz.id}: "lesson" is "${quiz.data.lesson}", expected "${d.id}"`)
          // A repeated question id would share one radio group, and the quiz could never pass.
          for (const q of duplicates(quiz.data.questions.map((x) => x.id))) fail(`${quiz.id}: duplicate question id "${q}"`)
          const objectives = new Set(d.objectives.map((o) => o.id))
          for (const q of quiz.data.questions) {
            if (!objectives.has(q.objective)) fail(`${quiz.id}: question "${q.id}" checks unknown objective "${q.objective}"`)
          }
        }
        const url = `/${course.data.slug}/${entry.data.slug}/${d.slug}/`
        const lessonNode: LessonNode = { entry: lesson, quiz, module: moduleNode, url }
        moduleNode.lessons.push(lessonNode)
        node.lessons.push(lessonNode)
      }
      node.modules.push(moduleNode)
    }

    const ids = new Set(node.lessons.map((l) => l.entry.data.id))
    const drafts = new Set(node.lessons.filter((l) => l.entry.data.draft).map((l) => l.entry.data.id))
    for (const l of node.lessons) {
      const d = l.entry.data
      for (const p of d.prerequisites) {
        if (!ids.has(p)) fail(`${l.entry.id}: prerequisite "${p}" is not a lesson in this course`)
        if (!d.draft && drafts.has(p)) fail(`${l.entry.id}: prerequisite "${p}" is a draft, so this lesson must be one too`)
      }
      for (const record of d.tested) {
        if (!existsSync(resolve(SETUP_TESTS_DIR, record))) fail(`${l.entry.id}: tested "${record}" not found in docs/setup-tests/`)
      }
      // A setup lesson is published only after a clean-machine test
      // is recorded (docs/setup-tests/README.md).
      if (!d.draft && d.verified && d.tested.length === 0) {
        fail(`${l.entry.id}: has "verified" but no "tested" record in docs/setup-tests/; keep it "draft: true" until then`)
      }
    }
    for (const [oldId, target] of Object.entries(idMap)) {
      if (ids.has(oldId)) fail(`${mapFile}: "${oldId}" is still a lesson id; only retired ids belong here`)
      for (const t of [target].flat()) {
        if (!ids.has(t)) fail(`${mapFile}: "${oldId}" maps to "${t}", which is not a lesson id`)
      }
    }
    result.push(node)
  }

  const placed = new Set(result.flatMap((c) => c.lessons.map((l) => l.entry.id)))
  for (const lesson of lessons) {
    if (!placed.has(lesson.id)) fail(`${lesson.id}: not in any module listed in its course.json`)
  }
  for (const quiz of quizzes) {
    if (![...seenLessonIds.keys()].includes(quiz.data.lesson)) fail(`${quiz.id}: lesson "${quiz.data.lesson}" does not exist`)
  }

  // Every check above ran on drafts too; only now are they left out.
  if (!INCLUDE_DRAFTS) {
    for (const course of result) {
      course.lessons = course.lessons.filter((l) => !l.entry.data.draft)
      for (const m of course.modules) m.lessons = m.lessons.filter((l) => !l.entry.data.draft)
    }
  }
  return result
}
