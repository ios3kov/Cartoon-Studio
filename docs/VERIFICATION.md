# Verification

Cartoon Studio 0.1.0 · reliability fixes · 2026-11-04.

## Evidence policy

A successful run applies only to its exact commit. Do not infer that the current branch is green from an older run.
Use [GitHub Actions](https://github.com/ios3kov/Cartoon-Studio/actions/workflows/verify.yml) and the checks on the candidate commit.

## Baseline history

- `cc5f18a`: implementation workflow passed, including six browser tests.
- `800cee0`: 19 Node tests and the build passed, but only seven of eight browser tests passed.
- [Failed baseline run](https://github.com/ios3kov/Cartoon-Studio/actions/runs/41837412821): the narrow-layout screenshot exceeded its 15-second action budget.
- The MP4, audio, determinism and rendering checks passed in that failed run. This does not make the full run successful.

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

### Screenshot stability

Editor captures await renderer readiness, fonts and two presentation frames.
Capture alone has a bounded 60-second budget, with CSS animations disabled.
Interaction assertions retain their 15-second budget. No test is skipped, retried automatically or wrapped to ignore failures.

## Checks

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run setup:browser
STUDIO_SOFTWARE_GL=1 npm run test:e2e
```

The expected suite now contains 31 Node tests and 11 browser tests.
New coverage includes simultaneous saves, stale-tab exit, reload recovery, missing locks, storage failures, old-file retention and a restarted queue.
Two browser tests run the actual editor in two pages and exercise the browser's real cross-tab lock.
A further browser test closes a tab before the debounce and checks recovery in a new tab.
Only their expensive rendering device is replaced; the existing painterly rendering tests still use real WebGL.

Local targeted run: eleven isolated storage/filesystem tests passed under Node 22.16.0.
The changed storage module passed a strict TypeScript check; changed TypeScript files passed syntax transpilation.
The container could not resolve GitHub or install the complete project; local browser navigation was blocked by environment policy.
Full build, integration and browser validation run in GitHub Actions.
Do not treat the local targeted checks as a substitute for a successful full workflow.

GitHub uploads `test-results/` and `playwright-report/` as `studio-verification` artifacts.
The export checks produce and inspect actual H.264/AAC MP4 files with FFmpeg and ffprobe.
No paid AI or speech calls are required or made by the tests.
A physical phone, Safari and Firefox have not been verified.
