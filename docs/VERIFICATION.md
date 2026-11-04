# Verification

Cartoon Studio 0.1.0 · strict brush export · 2026-11-04.

## Evidence policy

A successful run applies only to its exact commit. Do not infer that the current branch is green from an older run.
Use [GitHub Actions](https://github.com/ios3kov/Cartoon-Studio/actions/workflows/verify.yml) and the checks on the candidate commit.

## Baseline and candidate history

- `cc5f18a`: implementation workflow passed, including six browser tests.
- `800cee0`: 19 Node tests and the build passed, but only seven of eight browser tests passed.
- [Failed baseline run](https://github.com/ios3kov/Cartoon-Studio/actions/runs/41837412821): the narrow-layout screenshot exceeded its 15-second action budget.
- The MP4, audio, determinism and rendering checks passed in that failed run. This does not make the full run successful.
- `b6095eb`: 31 Node tests, type checking and the build passed. Ten of eleven browser tests passed, including the repaired mobile capture, reload/close recovery, both real multi-tab tests and MP4 export.
- [Candidate run](https://github.com/ios3kov/Cartoon-Studio/actions/runs/41855375610) hit the old combined style/portrait test's 180-second total budget while capturing the final portrait. That run is a failure, not a release pass.
- The following test-only correction separates the portrait check from the three-style comparison. The same real renderer, image comparisons, dimensions and normal per-test limits remain in use.

- `78ff096`: [complete reliability workflow passed](https://github.com/ios3kov/Cartoon-Studio/actions/runs/41857681920); merged into `main` as `9f07b5e`.
- The brush-export guard below is a new candidate. That earlier green run does not verify these new changes.

## Reliability changes

### Multi-tab persistence

Shared writes use an exclusive Web Lock and compare the revision read by the editor with the current stored project.
Clean tabs accept external edits and clear their stale undo history.
Conflicting edits remain in the editing tab; they never silently overwrite the shared project.
The editor explains the conflict and offers the existing `.cartoon` save command.
A synchronous per-tab `sessionStorage` journal preserves edits across reloads before the 450 ms save debounce.
Unload handlers never write the shared project key. They write a separate UUID-named exit journal to localStorage.
A newly opened tab recovers the latest valid exit journal only when its base matches the current shared project.
This protects an ordinary last edit when the tab closes before the save timer fires.
Consumed exit journals are removed after a successful shared save.
Without Web Locks, shared autosave fails visibly instead of performing unsafe writes.

Save conflicting versions to `.cartoon` before closing their tabs.
Conflicting exit journals never replace a newer shared revision automatically.
An OS kill without exit events and browser storage removal are not covered by exit recovery; keep file backups.
Reload old application tabs after upgrading; earlier versions do not participate in this locking protocol.

### Export retention

Startup and completed jobs scan the exports directory, retaining the newest 30 recognized completed MP4 files.
Files left by earlier runs count toward that limit. In-process cleanup operations are serialized.
Unknown files, symlinks, temporary directories and active outputs are not deleted.
Job IDs and download links still belong to the current process; this change does not restore the previous job queue.
Use one server process per data directory. Audio retention and crash-temp cleanup are separate work.

### Browser test stability

Editor captures await renderer readiness, fonts and two presentation frames.
Capture alone has a bounded 60-second budget, with CSS animations disabled.
Interaction assertions retain their 15-second budget.
The portrait rendering check is separate from the three-style comparison so four WebGL preparations do not share one 180-second budget.
Each test still has its normal 180-second limit.
No test is skipped, retried automatically or wrapped to ignore failures.

### No silent brush fallback in MP4 export

The server checks the render page's backend after loading the requested project, before starting video encoding.
It checks again before drawing each frame, after drawing, and after PNG readback.
Only the exact `p5.brush` backend is accepted. Canvas2D fallback, absent status and throwing status all fail closed.
The job reports an actionable error, exposes no download link, and removes partial video files through existing cleanup.
Both draft and HD exports use this same guarded path. There is no force-fallback export setting.
The job URL also suppresses the render page's unrelated manual-demo autoload.

Canvas2D remains the normal compositor for brush-painted assets and small procedural details.
The editor's clearly labelled fallback preview remains usable, including saving the project file.
This change does not replace the drawing engine or ban normal Canvas2D compositing.
Backend reporting is a compatibility check, not a security attestation against code deliberately forging `p5.brush` status.
No installed external browser extension was inspected or modified.

Ten new isolated tests execute the exact serialized browser callbacks and check every failure boundary.
Five browser tests run an isolated production server with real Chromium and the normal export queue.
They cover absent WebGL2, missing float-buffer support, an injected graphics exception inside Painter,
a bridge without status, and degradation after one accepted frame.
Only the last two use a simulated bridge; normal painterly and successful H.264/AAC export tests remain unchanged.

## Checks

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run setup:browser
STUDIO_SOFTWARE_GL=1 npm run test:e2e
```

The expected suite now contains 41 Node tests and 17 browser tests.
New coverage includes simultaneous saves, stale-tab exit, reload recovery, missing locks, storage failures, old-file retention and a restarted queue.
Two browser tests run the actual editor in two pages and exercise the browser's real cross-tab lock.
A further browser test closes a tab before the debounce and checks recovery in a new tab.
Only their expensive rendering device is replaced; the existing painterly rendering tests still use real WebGL.

Earlier reliability-fix local run: eleven isolated storage/filesystem tests passed under Node 22.16.0.
A further 250 simulated eight-tab conflict rounds preserved both the winning save and every pending draft.
The changed storage module passed a strict TypeScript check; changed TypeScript files passed syntax transpilation.
The container could not resolve GitHub or install the complete project; local browser navigation was blocked by environment policy.
For the brush-export change, ten isolated guard tests passed under Node 22.16.0 with experimental TypeScript transformation.
Full build, integration and browser validation run in GitHub Actions.
Do not treat the local targeted checks as a substitute for a successful full workflow.

GitHub uploads `test-results/` and `playwright-report/` as `studio-verification` artifacts.
The export checks produce and inspect actual H.264/AAC MP4 files with FFmpeg and ffprobe.
No paid AI or speech calls are required or made by the tests.
A physical phone, Safari and Firefox have not been verified.
