# Vendored from oncut-design

Generated or copied from the private `mecondev/oncut-design`, the canonical
design system of the oncut products. Do not edit these files here: change
`tokens/` in that repository and regenerate.

Pinned: oncut-design **1.2.0**, commit `5a86d79`, generated 2026-10-17.

| File | From | Command, run in the oncut-design checkout |
| --- | --- | --- |
| `tokens.css` | `tokens/` (core, no extension) | `python gen/gen_css.py --out <oncut-learn>/src/styles/design/tokens.css --schemes dark light` |
| `fonts/*.woff2`, `fonts/*-OFL.txt` | `fonts/`, subset to Latin, Greek and Cyrillic | `python gen/gen_font_subset.py --out <oncut-learn>/src/styles/design/fonts --format woff2` (fontTools 4.65.0, brotli 1.2.0) |
| `../../assets/brand/oncut-logo-on-{dark,light}.png` | `brand/` | copied |

Repeat each command with `--check` to see whether the vendored copy has
drifted. The oncut-design repository is private, so CI cannot run that check;
regenerate by hand when oncut-design releases a new version, and update the
pin above.

Licenses: Inter and JetBrains Mono are under the SIL Open Font License 1.1,
whose text travels with the fonts (`fonts/*-OFL.txt`). The oncut logo is not
under any open license (see the repository README).
