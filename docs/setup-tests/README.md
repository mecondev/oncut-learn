# Setup tests

One file per test of a setup lesson on a clean machine, named
`YYYY-MM-DD-<os>-<toolchain>.md` (for example `2026-10-20-windows-msys2.md`).
A lesson that names installers (`verified` in its frontmatter) stays
`draft: true` until it lists at least one of these files in `tested`; the
build enforces this (`src/lib/course.ts`).

Each record states:

- Machine: hardware or VM, OS edition, version and language, and that no
  compiler or MSYS2 was installed before.
- Lesson: id, the commit it was read at, the OS choice.
- Duration from start to `Hello, World!`, and download sizes.
- Every place the screen differed from the text, with a screenshot.
- Every place the text was unclear, and every failure.
- Result: pass, or what must change in the lesson first.
