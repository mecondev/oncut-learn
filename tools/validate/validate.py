"""Compile and run every course snippet with a real compiler.

Usage:
    python tools/validate/validate.py --compiler gcc|clang|msvc [--only <id>]

Finds every snippet.json under the courses directories, checks its schema and
files, then compiles (and, for expect "run", runs) it with the chosen compiler.
Prints one summary line per snippet and exits non-zero on any failure.

Standard library only, Python 3.12 or later.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RUN_TIMEOUT_S = 5
COMPILE_TIMEOUT_S = 120

COMPILERS = ("gcc", "clang", "msvc")
PLATFORMS = ("windows", "linux", "macos")
EXPECTS = ("run", "compile-only", "compile-fail")
STANDARDS = ("c++14", "c++17", "c++20", "c++23")
SOURCE_SUFFIXES = (".cpp", ".cc", ".cxx")
HEADER_SUFFIXES = (".h", ".hpp")
ID_PATTERN = re.compile(r"^[a-z0-9]+(\.[a-z0-9-]+)+$")

DEFAULT_EXECUTABLE = {"gcc": "g++", "clang": "clang++", "msvc": "cl"}

# MSVC has no /std:c++23 yet; c++latest is the closest switch.
MSVC_STANDARD = {
    "c++14": "c++14",
    "c++17": "c++17",
    "c++20": "c++20",
    "c++23": "c++latest",
}

REQUIRED_KEYS: dict[str, type] = {
    "id": str,
    "files": list,
    "standard": str,
    "expect": str,
    "compilers": list,
    "platforms": list,
}
OPTIONAL_KEYS: dict[str, type] = {
    "stdout": str,
    "cases": list,
    "intentional_error": bool,
    "error_contains": dict,
    "ascii_only": bool,
    "needs_human_review": bool,
    "sanitize": bool,
}
CASE_KEYS: dict[str, type] = {"name": str, "stdin": str, "args": list, "stdout": str, "exit_code": int}


@dataclass
class Snippet:
    path: Path  # the snippet.json file
    data: dict

    @property
    def id(self) -> str:
        return self.data["id"]

    @property
    def dir(self) -> Path:
        return self.path.parent

    @property
    def files(self) -> list[Path]:
        return [self.dir / name for name in self.data["files"]]

    @property
    def sources(self) -> list[Path]:
        return [p for p in self.files if p.suffix in SOURCE_SUFFIXES]


@dataclass
class Result:
    snippet_id: str
    status: str  # PASS, FAIL, SKIP
    detail: str
    log: list[str] = field(default_factory=list)


# ── Discovery and schema ─────────────────────────────────────────────────────


def discover(courses_dirs: list[Path]) -> list[Path]:
    found: list[Path] = []
    for base in courses_dirs:
        found.extend(sorted(base.rglob("snippet.json")))
    return found


def check_schema(data: object, snippet_dir: Path) -> list[str]:
    """Return a list of problems with one snippet.json; empty means valid."""
    if not isinstance(data, dict):
        return ["snippet.json must contain an object"]
    errors: list[str] = []

    for key, kind in REQUIRED_KEYS.items():
        if key not in data:
            errors.append(f"missing key '{key}'")
        elif not isinstance(data[key], kind):
            errors.append(f"'{key}' must be {kind.__name__}")
    for key, kind in OPTIONAL_KEYS.items():
        if key in data and not isinstance(data[key], kind):
            errors.append(f"'{key}' must be {kind.__name__}")
    for key in data:
        if key not in REQUIRED_KEYS and key not in OPTIONAL_KEYS:
            errors.append(f"unknown key '{key}'")
    if errors:
        return errors

    if not ID_PATTERN.match(data["id"]):
        errors.append(f"id '{data['id']}' must look like course.module.lesson.name")
    if data["standard"] not in STANDARDS:
        errors.append(f"standard must be one of {', '.join(STANDARDS)}")
    if data["expect"] not in EXPECTS:
        errors.append(f"expect must be one of {', '.join(EXPECTS)}")
    for name in data["compilers"]:
        if name not in COMPILERS:
            errors.append(f"unknown compiler '{name}'")
    for name in data["platforms"]:
        if name not in PLATFORMS:
            errors.append(f"unknown platform '{name}'")
    if not data["compilers"]:
        errors.append("compilers must not be empty")

    if not data["files"]:
        errors.append("files must not be empty")
    for name in data["files"]:
        if not isinstance(name, str) or "/" in name or "\\" in name:
            errors.append(f"file '{name}' must be a plain file name in the snippet folder")
            continue
        path = snippet_dir / name
        if path.suffix not in SOURCE_SUFFIXES + HEADER_SUFFIXES:
            errors.append(f"file '{name}' has an unsupported extension")
        if not path.is_file():
            errors.append(f"file '{name}' does not exist")
    if not any(str(n).endswith(SOURCE_SUFFIXES) for n in data["files"]):
        errors.append("files must include at least one source file")

    intentional = data.get("intentional_error", False)
    if data["expect"] == "compile-fail" and not intentional:
        errors.append("expect 'compile-fail' needs intentional_error: true")
    if data["expect"] != "compile-fail" and intentional:
        errors.append("intentional_error: true needs expect 'compile-fail'")
    if "error_contains" in data:
        if data["expect"] != "compile-fail":
            errors.append("error_contains is only for expect 'compile-fail'")
        for name, text in data["error_contains"].items():
            if name not in COMPILERS or not isinstance(text, str):
                errors.append(f"error_contains entry '{name}' must map a compiler to a string")

    # Same rule as src/markdown/snippets.ts: one run with "stdout", or a
    # non-empty "cases" list, never both. Otherwise ::output could show a
    # top-level stdout that no case verifies.
    if data["expect"] == "run":
        cases = data.get("cases", [])
        if not cases and "stdout" not in data:
            errors.append("expect 'run' needs 'stdout' or at least one case")
        if cases and "stdout" in data:
            errors.append("use either 'stdout' or a non-empty 'cases', not both")
        for i, case in enumerate(cases):
            errors.extend(f"case {i}: {e}" for e in check_case(case))
    elif data.get("cases") or "stdout" in data:
        errors.append("stdout and cases are only for expect 'run'")

    return errors


def check_case(case: object) -> list[str]:
    if not isinstance(case, dict):
        return ["must be an object"]
    errors = []
    for key, value in case.items():
        if key not in CASE_KEYS:
            errors.append(f"unknown key '{key}'")
        elif not isinstance(value, CASE_KEYS[key]):
            errors.append(f"'{key}' must be {CASE_KEYS[key].__name__}")
    if "stdout" not in case:
        errors.append("missing key 'stdout'")
    if "args" in case and not all(isinstance(a, str) for a in case["args"]):
        errors.append("args must be strings")
    return errors


def load_snippets(paths: list[Path]) -> tuple[list[Snippet], list[Result]]:
    """Parse and check every snippet.json; return valid snippets and failures."""
    snippets: list[Snippet] = []
    failures: list[Result] = []
    seen: dict[str, Path] = {}
    for path in paths:
        label = str(path.relative_to(REPO_ROOT)) if path.is_relative_to(REPO_ROOT) else str(path)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            failures.append(Result(label, "FAIL", f"cannot read snippet.json: {exc}"))
            continue
        errors = check_schema(data, path.parent)
        if errors:
            sid = data.get("id", label) if isinstance(data, dict) else label
            failures.append(Result(str(sid), "FAIL", "invalid snippet.json", errors))
            continue
        if data["id"] in seen:
            failures.append(
                Result(data["id"], "FAIL", f"duplicate id, also in {seen[data['id']]}")
            )
            continue
        seen[data["id"]] = path
        snippets.append(Snippet(path, data))
    return snippets, failures


def non_ascii(path: Path) -> list[str]:
    """Return one message per line that holds a non-ASCII byte."""
    problems = []
    for lineno, line in enumerate(path.read_bytes().split(b"\n"), start=1):
        for col, byte in enumerate(line, start=1):
            if byte > 0x7F:
                problems.append(f"{path.name}:{lineno}:{col}: non-ASCII byte 0x{byte:02X}")
                break
    return problems


# ── Compiling and running ────────────────────────────────────────────────────


def compile_command(
    compiler: str,
    executable: str,
    snippet: Snippet,
    out_dir: Path,
    link: bool,
) -> list[str]:
    standard = snippet.data["standard"]
    # Absolute paths: the compiler runs in out_dir, so object files never land
    # in the snippet folder.
    sources = [str(p.resolve()) for p in snippet.sources]
    exe = out_dir / ("prog.exe" if os.name == "nt" else "prog")
    if compiler == "msvc":
        cmd = [
            executable,
            "/nologo",
            "/W4",
            "/WX",
            "/EHsc",
            f"/std:{MSVC_STANDARD[standard]}",
            "/utf-8",
            f"/Fo{out_dir}{os.sep}",
        ]
        if link:
            cmd += sources + [f"/Fe{exe}"]
        else:
            cmd += ["/c"] + sources
        return cmd
    cmd = [executable, f"-std={standard}", "-Wall", "-Wextra", "-pedantic", "-Werror"]
    if snippet.data.get("sanitize"):
        cmd += ["-fsanitize=address,undefined", "-fno-omit-frame-pointer", "-g"]
    if link:
        cmd += sources + ["-o", str(exe)]
    else:
        cmd += ["-c"] + sources
    return cmd


def normalize_output(text: str) -> str:
    """Windows writes text-mode newlines as CRLF; compare as LF."""
    return text.replace("\r\n", "\n")


def first_lines(text: str, limit: int = 8) -> list[str]:
    lines = [line for line in text.splitlines() if line.strip()]
    return lines[:limit]


def run_cases(snippet: Snippet, exe: Path, cwd: Path) -> tuple[bool, list[str]]:
    cases = snippet.data.get("cases") or [{"stdout": snippet.data["stdout"]}]
    log: list[str] = []
    ok = True
    for i, case in enumerate(cases):
        name = case.get("name", f"case {i}")
        try:
            proc = subprocess.run(
                [str(exe), *case.get("args", [])],
                input=case.get("stdin", "").encode("utf-8"),
                capture_output=True,
                timeout=RUN_TIMEOUT_S,
                cwd=cwd,
            )
        except subprocess.TimeoutExpired:
            ok = False
            log.append(f"{name}: timed out after {RUN_TIMEOUT_S} s")
            continue
        stdout = normalize_output(proc.stdout.decode("utf-8", errors="replace"))
        want_exit = case.get("exit_code", 0)
        if proc.returncode != want_exit:
            ok = False
            log.append(f"{name}: exit code {proc.returncode}, expected {want_exit}")
            log.extend(first_lines(proc.stderr.decode("utf-8", errors="replace")))
        if stdout != case["stdout"]:
            ok = False
            log.append(f"{name}: stdout {stdout!r}, expected {case['stdout']!r}")
    return ok, log


def validate_snippet(snippet: Snippet, compiler: str, executable: str) -> Result:
    data = snippet.data
    if compiler not in data["compilers"]:
        return Result(snippet.id, "SKIP", f"not for {compiler}")

    if data.get("ascii_only", True):
        problems = [msg for path in snippet.files for msg in non_ascii(path)]
        if problems:
            return Result(snippet.id, "FAIL", "non-ASCII characters", problems)

    expect = data["expect"]
    with tempfile.TemporaryDirectory(prefix="oncut-snippet-") as tmp:
        out_dir = Path(tmp)
        cmd = compile_command(compiler, executable, snippet, out_dir, link=expect == "run")
        try:
            proc = subprocess.run(
                cmd, capture_output=True, timeout=COMPILE_TIMEOUT_S, cwd=out_dir
            )
        except subprocess.TimeoutExpired:
            return Result(snippet.id, "FAIL", f"compiler timed out after {COMPILE_TIMEOUT_S} s")
        output = (proc.stdout + proc.stderr).decode("utf-8", errors="replace")

        if expect == "compile-fail":
            if proc.returncode == 0:
                return Result(snippet.id, "FAIL", "compiled, but must fail")
            wanted = data.get("error_contains", {}).get(compiler)
            if wanted and wanted not in output:
                return Result(
                    snippet.id,
                    "FAIL",
                    f"failed as expected, but without '{wanted}'",
                    first_lines(output),
                )
            return Result(snippet.id, "PASS", "compile-fail")

        if proc.returncode != 0:
            return Result(snippet.id, "FAIL", "does not compile", first_lines(output))
        if expect == "compile-only":
            return Result(snippet.id, "PASS", "compile-only")

        exe = out_dir / ("prog.exe" if os.name == "nt" else "prog")
        ok, log = run_cases(snippet, exe, out_dir)
        count = len(data.get("cases") or [None])
        noun = "case" if count == 1 else "cases"
        if not ok:
            return Result(snippet.id, "FAIL", "wrong output", log)
        return Result(snippet.id, "PASS", f"run, {count} {noun}")


# ── Command line ─────────────────────────────────────────────────────────────


def compiler_version(compiler: str, executable: str) -> str:
    try:
        if compiler == "msvc":
            proc = subprocess.run([executable], capture_output=True, timeout=30)
            text = (proc.stderr + proc.stdout).decode("utf-8", errors="replace")
        else:
            proc = subprocess.run([executable, "--version"], capture_output=True, timeout=30)
            text = proc.stdout.decode("utf-8", errors="replace")
    except (OSError, subprocess.TimeoutExpired):
        return "unknown version"
    lines = first_lines(text, 1)
    return lines[0].strip() if lines else "unknown version"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compile and run every course snippet.")
    parser.add_argument("--compiler", required=True, choices=COMPILERS)
    parser.add_argument("--only", metavar="ID", help="validate one snippet id")
    parser.add_argument(
        "--courses",
        metavar="DIR",
        action="append",
        type=Path,
        help="courses directory to search (repeatable; default: ./courses)",
    )
    parser.add_argument("--cxx", metavar="PATH", help="compiler executable to use")
    args = parser.parse_args(argv)

    executable = args.cxx or DEFAULT_EXECUTABLE[args.compiler]
    if shutil.which(executable) is None:
        hint = " (run inside a Developer PowerShell for VS)" if args.compiler == "msvc" else ""
        print(f"error: compiler '{executable}' not found on PATH{hint}", file=sys.stderr)
        return 2

    courses_dirs = args.courses or [REPO_ROOT / "courses"]
    snippets, results = load_snippets(discover(courses_dirs))
    if args.only:
        snippets = [s for s in snippets if s.id == args.only]
        results = [r for r in results if r.snippet_id == args.only]
        if not snippets and not results:
            print(f"error: no snippet with id '{args.only}'", file=sys.stderr)
            return 2

    print(f"{args.compiler}: {compiler_version(args.compiler, executable)}")
    results.extend(validate_snippet(s, args.compiler, executable) for s in snippets)

    width = max((len(r.snippet_id) for r in results), default=0)
    for r in results:
        print(f"{r.status:<4}  {r.snippet_id:<{width}}  {r.detail}")
        for line in r.log:
            print(f"      {line}")

    counts = {s: sum(r.status == s for r in results) for s in ("PASS", "FAIL", "SKIP")}
    print(f"{counts['PASS']} passed, {counts['FAIL']} failed, {counts['SKIP']} skipped")
    # A compiler cannot judge everything (style, whether the example teaches
    # what the lesson says); such snippets stay listed until a person clears
    # the flag. Not a failure.
    review = [s.id for s in snippets if s.data.get("needs_human_review")]
    if review:
        print(f"{len(review)} need human review: {', '.join(review)}")
    return 1 if counts["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
