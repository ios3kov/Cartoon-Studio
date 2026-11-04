# Verification

Candidate: Cartoon Studio 0.1.0. Date: 2026-11-04.
This file records actual checks, including environment limitations.
The complete renderer and editor are integrated. Final browser export checks are running.

| Check | Result | Evidence |
| --- | --- | --- |
| Shared project and archive tests | PASS | Seven tests, including forged ZIP sizes |
| Server tests | PASS | Twelve tests, including actual H.264/AAC and audio timing |
| Dependency audit | PASS | Zero reported vulnerabilities; fflate 0.8.3 |
| Full TypeScript check | PASS | Complete application compiles |
| Production build | PASS | Both editor and render page bundled |
| Browser runtime | PASS | Chromium Headless Shell 134, WebGL2 and EXT_color_buffer_float available |
| Editor browser flows | In progress | Editing, undo, reorder, autosave and narrow layout passed |
| Frame determinism and style rendering | PASS (renderer smoke) | Three p5.brush styles, byte-identical repeat frame, portrait and explicit fallback |
| Actual full-demo MP4 | In progress | Full browser-to-FFmpeg integration running |
| Desktop and narrow layout review | PASS | 1440 × 1000 and 390 × 844 inspected |
| GitHub publication and CI | In progress | Repository initialized; complete candidate being published |

## Environment

Node.js 24.22.1; Linux; FFmpeg and FFprobe installed.
Dependencies use exact versions and a lockfile.
The environment blocked full Chromium's profile socket and denied elevation.
The standard Chromium Headless Shell runs successfully in the original sandbox.
No sandbox policy was changed.

Local browser override used for verification:

```bash
CHROME_PATH=/root/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell
STUDIO_SOFTWARE_GL=1
```

These paths are environment-specific, not application defaults.
No paid AI or speech generation requests were made.
Provider tests use controlled responses and never require credentials.
