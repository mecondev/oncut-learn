"""Unit tests for validate.py. Run: python -m unittest discover tools/validate"""

from __future__ import annotations

import contextlib
import io
import json
import shutil
import tempfile
import unittest
from collections.abc import Mapping
from pathlib import Path

import validate

HELLO = '#include <iostream>\n\nint main() {\n    std::cout << "Hello\\n";\n    return 0;\n}\n'


def base_data(**overrides: object) -> dict:
    data: dict[str, object] = {
        "id": "cpp.test.lesson.hello",
        "files": ["main.cpp"],
        "standard": "c++17",
        "expect": "run",
        "stdout": "Hello\n",
        "compilers": ["gcc", "clang", "msvc"],
        "platforms": ["windows", "linux", "macos"],
    }
    data.update(overrides)
    return data


class TempSnippet:
    """A snippet folder in a temporary directory."""

    def __init__(self, data: dict, files: Mapping[str, str | bytes] | None = None):
        self.root = Path(tempfile.mkdtemp(prefix="oncut-test-"))
        self.dir = self.root / "courses" / "c" / "snippets" / "s"
        self.dir.mkdir(parents=True)
        for name, content in (files if files is not None else {"main.cpp": HELLO}).items():
            path = self.dir / name
            if isinstance(content, bytes):
                path.write_bytes(content)
            else:
                path.write_text(content, encoding="utf-8", newline="\n")
        (self.dir / "snippet.json").write_text(json.dumps(data), encoding="utf-8")

    def snippet(self) -> validate.Snippet:
        path = self.dir / "snippet.json"
        return validate.Snippet(path, json.loads(path.read_text(encoding="utf-8")))

    def cleanup(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)


class SchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TempSnippet(base_data())
        self.addCleanup(self.tmp.cleanup)

    def errors(self, **overrides: object) -> list[str]:
        return validate.check_schema(base_data(**overrides), self.tmp.dir)

    def test_valid(self) -> None:
        self.assertEqual(self.errors(), [])

    def test_missing_key(self) -> None:
        data = base_data()
        del data["standard"]
        self.assertIn("missing key 'standard'", validate.check_schema(data, self.tmp.dir))

    def test_unknown_key(self) -> None:
        self.assertIn("unknown key 'stdot'", self.errors(stdot="x"))

    def test_bad_enums(self) -> None:
        errors = self.errors(expect="maybe", standard="c++98", compilers=["icc"])
        self.assertTrue(any("expect" in e for e in errors))
        self.assertTrue(any("standard" in e for e in errors))
        self.assertIn("unknown compiler 'icc'", errors)

    def test_bad_id(self) -> None:
        self.assertTrue(any("id 'Hello'" in e for e in self.errors(id="Hello")))

    def test_missing_file(self) -> None:
        self.assertIn("file 'other.cpp' does not exist", self.errors(files=["other.cpp"]))

    def test_path_in_file_name(self) -> None:
        self.assertTrue(any("plain file name" in e for e in self.errors(files=["../main.cpp"])))

    def test_run_needs_stdout(self) -> None:
        data = base_data()
        del data["stdout"]
        self.assertTrue(any("needs 'stdout'" in e for e in validate.check_schema(data, self.tmp.dir)))

    def test_compile_fail_needs_intentional_error(self) -> None:
        data = base_data(expect="compile-fail")
        del data["stdout"]
        errors = validate.check_schema(data, self.tmp.dir)
        self.assertIn("expect 'compile-fail' needs intentional_error: true", errors)
        data["intentional_error"] = True
        self.assertEqual(validate.check_schema(data, self.tmp.dir), [])

    def test_stdout_only_for_run(self) -> None:
        errors = self.errors(expect="compile-only")
        self.assertIn("stdout and cases are only for expect 'run'", errors)

    def test_stdout_and_cases_exclusive(self) -> None:
        # A top-level stdout next to cases would be shown but never run.
        errors = self.errors(stdout="WRONG\n", cases=[{"stdout": "A\n"}])
        self.assertIn("use either 'stdout' or a non-empty 'cases', not both", errors)
        self.assertEqual(self.errors(stdout="Hello\n", cases=[]), [])

    def test_case_checks(self) -> None:
        errors = self.errors(cases=[{"stdin": "1"}, {"stdout": "x", "args": [1]}])
        self.assertIn("case 0: missing key 'stdout'", errors)
        self.assertIn("case 1: args must be strings", errors)


class LoadTests(unittest.TestCase):
    def test_duplicate_ids(self) -> None:
        a = TempSnippet(base_data())
        b = TempSnippet(base_data())
        self.addCleanup(a.cleanup)
        self.addCleanup(b.cleanup)
        paths = validate.discover([a.root, b.root])
        snippets, failures = validate.load_snippets(paths)
        self.assertEqual(len(snippets), 1)
        self.assertEqual(len(failures), 1)
        self.assertIn("duplicate id", failures[0].detail)

    def test_invalid_json(self) -> None:
        tmp = TempSnippet(base_data())
        self.addCleanup(tmp.cleanup)
        (tmp.dir / "snippet.json").write_text("{", encoding="utf-8")
        snippets, failures = validate.load_snippets(validate.discover([tmp.root]))
        self.assertEqual(snippets, [])
        self.assertIn("cannot read", failures[0].detail)


class AsciiTests(unittest.TestCase):
    def test_greek_question_mark(self) -> None:
        source = "int main() { return 0\u037e }\n".encode("utf-8")
        tmp = TempSnippet(base_data(), {"main.cpp": source})
        self.addCleanup(tmp.cleanup)
        problems = validate.non_ascii(tmp.dir / "main.cpp")
        self.assertEqual(len(problems), 1)
        self.assertTrue(problems[0].startswith("main.cpp:1:22:"))

    def test_snippet_for_other_compiler_is_skipped(self) -> None:
        tmp = TempSnippet(base_data(compilers=["gcc"]))
        self.addCleanup(tmp.cleanup)
        result = validate.validate_snippet(tmp.snippet(), "clang", "clang++")
        self.assertEqual(result.status, "SKIP")


class CommandTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TempSnippet(base_data(standard="c++23"))
        self.addCleanup(self.tmp.cleanup)
        self.out = Path("out")

    def test_gcc_flags(self) -> None:
        cmd = validate.compile_command("gcc", "g++", self.tmp.snippet(), self.out, link=True)
        self.assertEqual(cmd[:6], ["g++", "-std=c++23", "-Wall", "-Wextra", "-pedantic", "-Werror"])
        self.assertIn("-o", cmd)

    def test_msvc_flags(self) -> None:
        cmd = validate.compile_command("msvc", "cl", self.tmp.snippet(), self.out, link=False)
        for flag in ("/nologo", "/W4", "/WX", "/EHsc", "/std:c++latest", "/utf-8", "/c"):
            self.assertIn(flag, cmd)

    def test_sanitize(self) -> None:
        tmp = TempSnippet(base_data(sanitize=True))
        self.addCleanup(tmp.cleanup)
        cmd = validate.compile_command("clang", "clang++", tmp.snippet(), self.out, link=True)
        self.assertIn("-fsanitize=address,undefined", cmd)
        cmd = validate.compile_command("msvc", "cl", tmp.snippet(), self.out, link=True)
        self.assertFalse(any("sanitize" in part for part in cmd))

    def test_normalize_output(self) -> None:
        self.assertEqual(validate.normalize_output("a\r\nb\n"), "a\nb\n")


def find_compiler() -> tuple[str, str] | None:
    for compiler in ("gcc", "clang"):
        executable = validate.DEFAULT_EXECUTABLE[compiler]
        if shutil.which(executable):
            return compiler, executable
    return None


FOUND = find_compiler()


def log(result: validate.Result) -> str:
    """The compiler or linker output, shown when an assertion fails."""
    return "\n".join([result.detail, *result.log])


@unittest.skipIf(FOUND is None, "no gcc or clang on PATH")
class CompilerTests(unittest.TestCase):
    def run_snippet(self, data: dict, files: dict[str, str] | None = None) -> validate.Result:
        assert FOUND is not None
        tmp = TempSnippet(data, files)
        self.addCleanup(tmp.cleanup)
        return validate.validate_snippet(tmp.snippet(), *FOUND)

    def test_run_pass(self) -> None:
        result = self.run_snippet(base_data())
        self.assertEqual(result.status, "PASS", log(result))

    def test_wrong_output(self) -> None:
        result = self.run_snippet(base_data(stdout="Bye\n"))
        self.assertEqual(result.detail, "wrong output", log(result))

    def test_cases_with_stdin(self) -> None:
        source = (
            "#include <iostream>\n\nint main() {\n    int n = 0;\n    std::cin >> n;\n"
            "    std::cout << n * 2 << '\\n';\n    return 0;\n}\n"
        )
        data = base_data(cases=[{"stdin": "2", "stdout": "4\n"}, {"stdin": "5", "stdout": "10\n"}])
        del data["stdout"]
        result = self.run_snippet(data, {"main.cpp": source})
        self.assertEqual((result.status, result.detail), ("PASS", "run, 2 cases"))

    def test_warning_is_an_error(self) -> None:
        source = "int main() {\n    int unused = 0;\n    return 0;\n}\n"
        data = base_data(expect="compile-only")
        del data["stdout"]
        self.assertEqual(self.run_snippet(data, {"main.cpp": source}).status, "FAIL")

    def test_compile_fail(self) -> None:
        source = "int main() {\n    return 0\n}\n"
        data = base_data(expect="compile-fail", intentional_error=True)
        del data["stdout"]
        self.assertEqual(self.run_snippet(data, {"main.cpp": source}).status, "PASS")
        assert FOUND is not None
        data["error_contains"] = {FOUND[0]: "no such text in any diagnostic"}
        self.assertEqual(self.run_snippet(data, {"main.cpp": source}).status, "FAIL")
        # A list passes when any one text appears (wording differs by version).
        data["error_contains"] = {FOUND[0]: ["no such text", "error"]}
        self.assertEqual(self.run_snippet(data, {"main.cpp": source}).status, "PASS")
        data["error_contains"] = {FOUND[0]: ["no such text", "nor this"]}
        self.assertEqual(self.run_snippet(data, {"main.cpp": source}).status, "FAIL")

    def test_error_contains_schema(self) -> None:
        tmp = TempSnippet(base_data())
        self.addCleanup(tmp.cleanup)
        data = base_data(expect="compile-fail", intentional_error=True)
        del data["stdout"]
        for bad in ([], [1], ""):
            data["error_contains"] = {"gcc": bad}
            self.assertTrue(validate.check_schema(data, tmp.dir), repr(bad))
        data["error_contains"] = {"gcc": ["a", "b"], "clang": "c"}
        self.assertEqual(validate.check_schema(data, tmp.dir), [])

    def test_compile_fail_that_compiles(self) -> None:
        data = base_data(expect="compile-fail", intentional_error=True)
        del data["stdout"]
        self.assertEqual(self.run_snippet(data).detail, "compiled, but must fail")

    def test_ascii_only(self) -> None:
        # The snippet must name the compiler in use, or it is skipped
        # before the ASCII check runs.
        assert FOUND is not None
        source = "// café\n" + HELLO
        data = base_data(compilers=[FOUND[0]])
        result = self.run_snippet(data, {"main.cpp": source})
        self.assertEqual((result.status, result.detail), ("FAIL", "non-ASCII characters"), log(result))
        result = self.run_snippet({**data, "ascii_only": False}, {"main.cpp": source})
        self.assertEqual(result.status, "PASS", log(result))

    def test_snippet_folder_unchanged(self) -> None:
        # Compile-only used to leave main.o next to main.cpp.
        assert FOUND is not None
        for expect in ("compile-only", "run"):
            data = base_data(expect=expect)
            if expect != "run":
                del data["stdout"]
            tmp = TempSnippet(data)
            self.addCleanup(tmp.cleanup)
            before = sorted(p.name for p in tmp.dir.iterdir())
            result = validate.validate_snippet(tmp.snippet(), *FOUND)
            self.assertEqual(result.status, "PASS", log(result))
            self.assertEqual(sorted(p.name for p in tmp.dir.iterdir()), before, expect)

    def test_needs_human_review_is_listed(self) -> None:
        assert FOUND is not None
        tmp = TempSnippet(base_data(compilers=[FOUND[0]], needs_human_review=True))
        self.addCleanup(tmp.cleanup)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = validate.main(["--compiler", FOUND[0], "--cxx", FOUND[1], "--courses", str(tmp.root)])
        self.assertEqual(code, 0, out.getvalue())
        self.assertIn("1 need human review: cpp.test.lesson.hello", out.getvalue())

    def test_timeout(self) -> None:
        source = "int main() {\n    for (;;) {\n    }\n}\n"
        self.assertEqual(self.run_snippet(base_data(), {"main.cpp": source}).status, "FAIL")


if __name__ == "__main__":
    unittest.main()
