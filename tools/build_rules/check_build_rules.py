"""Check that every content rule fails `npm run build`, and that a valid
change still builds.

Usage, from the repository root, after `npm ci`:
    python tools/build_rules/check_build_rules.py

Each case edits files under courses/ or docs/setup-tests/, runs a full build
and restores the files. It refuses to run if those folders have uncommitted
changes, so nothing of yours is overwritten. The Markdown rules themselves
are unit-tested in src/markdown/remark-lesson.test.ts; the build cases here
cover the cross-file checks in src/lib/course.ts, the setup-test gate, and
that a Markdown error still fails the whole build.

Standard library only. Exit code 1 if any case behaves wrongly.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "courses/cpp/modules/00-setup"
LESSON = MODULE / "lessons/hello-world.md"
QUIZ = MODULE / "quizzes/hello-world.json"
COURSE = ROOT / "courses/cpp/course.json"
ID_MAP = ROOT / "courses/cpp/id-map.json"
SECOND = MODULE / "lessons/zz-second.md"
RECORD = ROOT / "docs/setup-tests/2000-01-01-check-build-rules.md"
WATCHED = ("courses", "docs/setup-tests")
FENCE = "`" * 3

KEPT = {path: path.read_text(encoding="utf-8") for path in (LESSON, QUIZ, COURSE, ID_MAP)}
CREATED = (SECOND, RECORD)


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def restore() -> None:
    for path, text in KEPT.items():
        write(path, text)
    for path in CREATED:
        path.unlink(missing_ok=True)


def lesson(old: str, new: str) -> Callable[[], None]:
    def apply() -> None:
        assert old in KEPT[LESSON], f"lesson has no {old!r}"
        write(LESSON, KEPT[LESSON].replace(old, new, 1))

    return apply


def append(text: str) -> Callable[[], None]:
    return lambda: write(LESSON, KEPT[LESSON] + text)


def json_edit(path: Path, change: Callable[[dict], None]) -> Callable[[], None]:
    def apply() -> None:
        data = json.loads(KEPT[path])
        change(data)
        write(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    return apply


def second_lesson(order: int) -> Callable[[], None]:
    def apply() -> None:
        text = KEPT[LESSON].replace("id: cpp.setup.hello-world", "id: cpp.setup.zz-second", 1)
        text = text.replace("slug: hello-world", "slug: zz-second", 1).replace("quiz: hello-world\n", "", 1)
        write(SECOND, text.replace("order: 50", f"order: {order}", 1))

    return apply


def duplicate_question(quiz: dict) -> None:
    quiz["questions"][1]["id"] = quiz["questions"][0]["id"]


def published_with_record() -> None:
    write(RECORD, "# Placeholder written by check_build_rules.py\n")
    text = KEPT[LESSON].replace("draft: true", "draft: false", 1)
    write(LESSON, text.replace("verified: ", f"tested: [{RECORD.name}]\nverified: ", 1))


# (name, setup, expected message or None when the build must pass)
CASES: list[tuple[str, Callable[[], None], str | None]] = [
    ("unchanged content builds", lambda: None, None),
    ("Markdown error fails the build (M7)", append(f"\n{FENCE}cpp\nint main() {{}}\n{FENCE}\n"),
     "Code in a lesson comes only from ::snippet"),
    ("missing quiz", lesson("quiz: hello-world", "quiz: nope"), 'quiz "nope" not found'),
    ("missing prerequisite", lesson("prerequisites: []", "prerequisites: [cpp.setup.terminal]"),
     'prerequisite "cpp.setup.terminal" is not a lesson'),
    ("duplicate lesson id", lambda: write(SECOND, KEPT[LESSON].replace("slug: hello-world", "slug: zz-second", 1)),
     'duplicate lesson id "cpp.setup.hello-world"'),
    ("duplicate question id", json_edit(QUIZ, duplicate_question), "duplicate question id"),
    ("duplicate objective id", lesson("id: compile", "id: source-file"), 'duplicate objective id "source-file"'),
    ("reserved course slug", json_edit(COURSE, lambda c: c.update(slug="progress")), 'slug "progress" is a path'),
    ("module listed twice", json_edit(COURSE, lambda c: c["modules"].append(c["modules"][0])),
     "is listed more than once"),
    ("duplicate lesson order", second_lesson(50), "more than one lesson has order 50"),
    ("second lesson, own order, builds", second_lesson(60), None),
    ("id map key that is not an id", json_edit(ID_MAP, lambda m: m.update({"</script>": "cpp.setup.hello-world"})),
     "is not a lesson id"),
    ("id map to a missing lesson", json_edit(ID_MAP, lambda m: m.update({"cpp.setup.old": "cpp.setup.nope"})),
     'maps to "cpp.setup.nope"'),
    ("published setup lesson without a test record (M6)", lesson("draft: true", "draft: false"),
     'no "tested" record'),
    ("tested record that does not exist", lesson("verified: ", "tested: [2000-01-01-missing.md]\nverified: "),
     'tested "2000-01-01-missing.md" not found'),
    ("published setup lesson with a record builds", published_with_record, None),
]


def dirty() -> list[str]:
    out = subprocess.run(
        ["git", "status", "--porcelain", "--", *WATCHED], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return [line for line in out.stdout.splitlines() if line.strip()]


def build() -> tuple[int, str]:
    npm = shutil.which("npm.cmd") or shutil.which("npm") or "npm"
    proc = subprocess.run(
        [npm, "run", "build"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    return proc.returncode, proc.stdout + proc.stderr


def main() -> int:
    changes = dirty()
    if changes:
        print("error: commit or stash these first, the cases overwrite them:", *changes, sep="\n  ", file=sys.stderr)
        return 2
    wrong = 0
    try:
        for name, setup, expected in CASES:
            restore()
            setup()
            code, output = build()
            if expected is None:
                ok = code == 0
                detail = "builds" if ok else "build failed: " + next(
                    (line.strip() for line in output.splitlines() if "[courses]" in line or "Error" in line), "?"
                )
            else:
                ok = code != 0 and expected in output
                detail = f"fails with {expected!r}" if ok else (
                    f"exit {code}, message {'found' if expected in output else 'missing'}"
                )
            wrong += not ok
            print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")
    finally:
        restore()
    print(f"{len(CASES) - wrong} of {len(CASES)} cases behave as expected")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
