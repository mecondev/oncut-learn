# Setup test: hello-world on Windows 11 with MSYS2, 2026-10-17

- Lesson: `cpp.setup.hello-world`, read as a PDF of the page with Windows
  chosen, built from commit `b486ee6`.
- Machine: a separate disk with a clean Windows 11 Pro 25H2, OS build
  26200.9445, real hardware. Installed in English, with Greek added later as
  the display language of the test user, so some system text was mixed
  (Explorer showed **Προβολή › Εμφάνιση** and then **File name extensions**;
  `cmd` and PowerShell errors were in English). Keyboards: English (US) and
  Greek. No MSYS2 and no compiler before the test.
- Duration from the start to `Hello, World!`: 10 to 15 minutes.

## Result

Not yet passed: the lesson reached `Hello, World!`, but several steps need
changes, listed below. The changed steps are to be tested again before the
lesson is published.

## Observations, step by step

| Step | What happened | Change |
| --- | --- | --- |
| Which terminal | `cmd`: `'ls' is not recognized as an internal or external command`; `'g++' is not recognized ...`. PowerShell: `ls` works; `g++ : The term 'g++' is not recognized ...`. The tester read "Terminal" and "PowerShell" as two different things. | Say that the Terminal app opens PowerShell by default. |
| Lesson intro | "βλέπεις τι τυπώνει" read as printing on a printer. | Explain once that a program "prints" to the screen. |
| File extensions | Found under **Προβολή › Εμφάνιση**, as written. | None. |
| MSYS2 installer | No UAC prompt; Next on every screen was clear; "Run MSYS2 now" is checked by default and opens the UCRT64 terminal. File name, size and screens were not recorded. | None; record them in the next test. |
| `pacman -S mingw-w64-ucrt-x86_64-gcc` | Total download size 175.50 MiB (the lesson said about 70 MB); one to two minutes. | Size and time corrected. |
| `g++ --version` | `g++.exe (Rev4, Built by MSYS2 project) 16.2.0`. Copied from the PDF, `--version` became `+-version` and failed. | Code font without ligatures (see below). |
| Opening the terminal again | Found under Recent in Start; the tester wanted a shortcut. | Pin **MSYS2 UCRT64** to the taskbar. |
| `notepad hello.cpp` | Notepad asked whether to create the missing file. The terminal accepted no commands while Notepad stayed open, so `ls` after saving could not be typed. | Explain that the terminal waits; save and close Notepad, or use a second terminal. |
| Typing the code | Copied from the PDF: the blank line after `#include` was lost and `::` `<<` became `+:` `+<`. | Code font without ligatures: JetBrains Mono drew `--` `::` `<<` as single glyphs, which a PDF copy turned into other characters. The lesson now asks to type the code. |
| Compile | No messages. The tester wanted each flag explained, how they differ, and what happens without them. | Each part of the command explained, with the default name `a.exe`. |
| Run | The tester reported `./hello` as wrong and ran `./hello.exe`, which printed `Hello, World!`. In MSYS2 `./hello` runs `hello.exe` (checked on another machine). | Note that both work; ask what `./hello` printed. |
| Greek keyboard | With the Greek layout, the key at Q typed an ordinary `;` (U+003B) and the program compiled. The key right of L is a dead key for accents. The Greek question mark (U+037E) came only from copying the exercise code. | The exercise rests on a wrong premise; to be rewritten. |
| Exercise code (U+037E) | g++ 16.2.0 printed `warning: ... is not in NFC [-Wnormalized=]` and `error: unable to find string literal operator 'operator""\U0000037e'`, not `extended character` as the lesson quotes. | gcc message check changed; CI gains an MSYS2 g++ job, the version students get. |
| First run of a new program | Windows Security showed a notification, "Part of this app has been blocked: Some features of C:\msys64\usr\bin\bash.exe". | To be understood before the next test. |
| Quiz | Every right answer was the first choice. | Choices are shown in a fixed, seeded order. |
