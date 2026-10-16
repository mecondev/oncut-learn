# oncut learn

Free programming lessons in Greek, published at <https://learn.oncut.gr>.
The first course is C++, from a first program in the terminal to modern C++.

Every code example is a real file, compiled and run in CI with GCC, Clang and
MSVC before it reaches a lesson. Lessons are plain Markdown with JSON metadata
in `courses/`, independent of the site that renders them. Progress is kept only
in the visitor's browser: no accounts, no cookies, no analytics.

## Licenses

| What | License |
| --- | --- |
| Code: the site and player (`src/`, `public/`), the validator and tools (`tools/`), workflows, and every snippet under `courses/**/snippets/` | Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE) |
| Lesson text, quizzes and images under `courses/` (everything except `snippets/`) | CC BY-NC-ND 4.0, see [LICENSE-CONTENT](LICENSE-CONTENT): share unchanged, with credit, not commercially |
| Fonts in `src/styles/design/fonts/` (Inter, JetBrains Mono) | SIL Open Font License 1.1, text beside the fonts |
| The oncut name and logo (`src/assets/brand/`, `public/favicon*`, `public/apple-touch-icon.png`) | Not licensed: all rights reserved. Neither license above covers them |

Contributions are not accepted yet: a contributor agreement has not been
decided. Issues pointing out mistakes in a lesson are welcome.

## Working on it

Node 22.18 or later (it runs the TypeScript tests directly), Python 3.12 or later.

```bash
npm ci
npm run dev                  # http://localhost:8193
npm run build                # static site in dist/
npm run check                # astro check
npm test                     # player tests
python tools/validate/validate.py --compiler gcc      # or clang, msvc
python -m unittest discover tools/validate
```

The validator for `msvc` needs `cl` on PATH, so run it inside a Developer
PowerShell for VS.

