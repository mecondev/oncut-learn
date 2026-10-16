import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'
import { ID_PATTERN } from './lib/shared'

// Content lives in courses/, independent of Astro. These
// schemas fail the build on a bad file; cross-file checks (unique ids, quiz and
// prerequisite references, module order) are in src/lib/course.ts.

// Entry ids are the file path, never a "slug" field: lesson slugs repeat
// across courses, and the permanent lesson id is a frontmatter field.
const byPath = ({ entry }: { entry: string }) => entry.replace(/\.(md|json)$/, '')

const lessonId = z.string().regex(ID_PATTERN, 'ids look like course.module.lesson')
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slugs are lowercase words joined by -')

const courses = defineCollection({
  loader: glob({ base: './courses', pattern: '*/course.json', generateId: byPath }),
  schema: z.strictObject({
    id: z.string().regex(/^[a-z0-9]+$/),
    slug,
    title: z.string().min(1),
    summary: z.string().min(1),
    language: z.enum(['el', 'en']),
    // Module folder names under modules/, in display order.
    modules: z.array(z.string()).min(1),
  }),
})

const modules = defineCollection({
  loader: glob({ base: './courses', pattern: '*/modules/*/module.json', generateId: byPath }),
  schema: z.strictObject({
    id: lessonId,
    slug,
    title: z.string().min(1),
    summary: z.string().min(1),
  }),
})

const lessons = defineCollection({
  // deferRender: Markdown is rendered when the page is built, not during
  // content sync. A sync-time error in remark-lesson.ts is only logged and the
  // last good render is kept, so a broken lesson would still build with exit 0
  // and stale output; at page build the error fails the build.
  loader: glob({ base: './courses', pattern: '*/modules/*/lessons/*.md', generateId: byPath, deferRender: true }),
  schema: z.strictObject({
    id: lessonId,
    order: z.number().int(),
    slug,
    title: z.string().min(1),
    summary: z.string().min(1),
    objectives: z
      .array(z.strictObject({ id: slug, text: z.string().min(1) }))
      // 2 to 4, as the new-lesson skill asks: one idea per section.
      .min(2)
      .max(4),
    prerequisites: z.array(lessonId).default([]),
    version: z.number().int().positive(),
    quiz: slug.optional(),
    // The day installer names, versions and screens were checked.
    verified: z.coerce.date().optional(),
    // A draft is built only by `npm run dev` or with ONCUT_DRAFTS=1, never
    // for the deployed site (src/lib/course.ts).
    draft: z.boolean().default(false),
    // Setup-test records in docs/setup-tests/ (see its README.md). A
    // published lesson with `verified` needs at least one.
    tested: z.array(z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+\.md$/)).default([]),
  }),
})

const quizzes = defineCollection({
  loader: glob({ base: './courses', pattern: '*/modules/*/quizzes/*.json', generateId: byPath }),
  schema: z.strictObject({
    lesson: lessonId,
    questions: z
      .array(
        z.strictObject({
          id: slug,
          objective: slug,
          prompt: z.string().min(1),
          choices: z
            .array(
              z.strictObject({
                text: z.string().min(1),
                correct: z.boolean().default(false),
                explanation: z.string().min(1),
              }),
            )
            .min(2)
            .max(6)
            .refine((choices) => choices.filter((c) => c.correct).length === 1, 'exactly one choice is correct'),
        }),
      )
      .min(1),
  }),
})

export const collections = { courses, modules, lessons, quizzes }
