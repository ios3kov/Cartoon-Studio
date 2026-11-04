# Verification

Cartoon Studio 0.1.0 · 2026-11-04.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript | PASS | Complete application, server, CLI and tests compile |
| Production build | PASS | Editor and render page bundled successfully |
| Dependency audit | PASS | Zero reported vulnerabilities; exact versions and lockfile |
| Project and archive tests | PASS | 7 tests, including references, scene boundaries and forged ZIP sizes |
| Server and codec tests | PASS | 12 tests; HTTP boundaries, queue, cancellation, providers, real FFmpeg |
| Editor browser tests | PASS | Editing, history, reorder, playback, autosave, desktop and narrow layout |
| Portable project | PASS | Archive includes audio; import restores new asset IDs; invalid import preserves project |
| Export dialog | PASS | Actual 1-second MP4 created and downloaded through the UI |
| Painterly rendering | PASS | All three styles use p5.brush; text and appearance change the pixels |
| Frame determinism | PASS | Rendering another time and returning produces identical PNG bytes |
| Portrait rendering | PASS | 360 × 640 dimensions survive project loading |
| Complete demo export | PASS | 18 seconds, 432 frames, 640 × 360, H.264 video and AAC audio |
| Actual export cancellation | PASS | Cancelled job cannot download a completed file |
| Immediate reload regression | PASS | Last edit survives real reload before the 450 ms debounce |
| Short audio trim regression | PASS | Initial 0.1-second trim and manual seek reach the media player correctly |
| Explicit WebGL fallback | PASS | Renderer smoke test reports Canvas2D when WebGL2 is unavailable |
| GitHub source publication | PASS | Complete repository published to ios3kov/Cartoon-Studio/main |
| GitHub Actions | PASS | Published implementation `cc5f18a`: build, Node tests, six main browser tests and uploaded artifacts |

**19 Node tests and 8 browser tests passed. No tests were skipped.**

The six main browser tests passed in approximately five minutes on software WebGL.
The two regression tests then passed against the rebuilt final application.

## Commands

```bash
npm run build
npm test
CHROME_PATH=/path/to/headless_shell STUDIO_SOFTWARE_GL=1 npm run test:e2e
```

After the focused fixes, the regression file was rerun separately:

```bash
npm run build
npm test
CHROME_PATH=/path/to/headless_shell STUDIO_SOFTWARE_GL=1 npm run test:e2e -- tests/e2e/regressions.spec.ts --output=test-results/regressions
```

The normal `npm run test:e2e` command includes all eight tests.

## Inspected output

Desktop viewport: 1440 × 1000. Narrow viewport: 390 × 844.
The editor had no horizontal page overflow or JavaScript errors in these checks.
The screenshot in `docs/preview.webp` comes from the actual editor.

The full-demo test checks the MP4 with ffprobe.
A separate codec test measures silence before the audio start and audible output after repeated trimmed segments.
Screenshots and test videos are written to `test-results/`.
GitHub Actions uploads that directory and its HTML report as `studio-verification`.

[Successful implementation run](https://github.com/ios3kov/Cartoon-Studio/actions/runs/41836398651) · [Latest workflow status](https://github.com/ios3kov/Cartoon-Studio/actions/workflows/verify.yml)

The final commit adds the two regression tests, readable formatting and this report.
Its workflow status appears at the latest-workflow link.

## Independent review

A separate reviewer inspected the editor, hooks, renderer and project archive.
Two confirmed integration findings were corrected: leaving before autosave and a short audio trim in preview.
The regression tests exercise the actual application and hooks.
The audio regression replaces only the media device; separate tests exercise real FFmpeg audio.
An earlier archive review found forged ZIP size metadata; validation now checks both declared and actual sizes.
A history-grouping concern was withdrawn after checking the current callers, which include object IDs.

## Environment and limits

Local runtime: Node.js 24.22.1, Playwright 1.62.1, Chromium Headless Shell 134, Linux, software WebGL.
WebGL2 and EXT_color_buffer_float were available.
The environment blocked full Chromium's profile socket and denied elevation.
The standard Headless Shell ran in the original sandbox without policy changes.

Local browser override:

```text
/root/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell
```

That path is a test-environment override, not an application default.
The GitHub workflow installed the package-matched Chromium successfully.

No paid AI or speech requests were made.
Provider tests use controlled responses and validate configuration, inputs, outputs and errors.
External provider availability, billing and model compatibility require the user's configuration.
A physical phone, Safari and Firefox were not tested.
