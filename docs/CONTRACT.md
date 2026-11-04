# Cartoon Studio implementation contract

User authorization: build one repository at https://github.com/ios3kov/Cartoon-Studio. Publishing source is authorized. Production deployment is not requested.

## Product

A usable local desktop-first cartoon studio. Russian UI. Warm paper/charcoal/terracotta visual language, clear dense editing controls. Original human characters, not a reskin of Clawd. Default demo: two travelers, Mira and Lea, three scenes on the way to the coast, 18 seconds. These are fictional designs, not likenesses of user photographs.

## Ownership

- Root: package/config, shared project model and validation, sample project/generator, integration, tests, documentation, GitHub publishing.
- Animation worker: src/engine/**, src/render.ts, render.html, src/types/p5-brush.d.ts. Own and adapt attributed math/timeline helpers from upstream. No edits to shared/model.ts.
- UI worker: src/App.tsx, src/main.tsx, src/styles.css, src/components/**, src/ui/**, index.html. No package or engine edits.
- Server worker: server/**, scripts/render.ts, server tests in tests/server.test.ts. No package or shared edits.

## Shared API

Types: src/shared/model.ts. Root implements src/shared/project.ts exports: createDefaultProject(), createScene(project), createCharacter(), validateProject(input): Project (throws ProjectValidationError), getDuration(project), sampleScene(project,time): SceneSample, cloneProject(project), makeId(prefix?), createStoryFromPrompt(prompt,base?): Project. Validation reconstructs known fields, enforces bounded input and actor-character references. Type-only imports may use .ts paths.

Renderer exports createStudioRenderer(canvas: HTMLCanvasElement): StudioRenderer from src/engine/index.ts. prepare(project) creates cached painterly assets using p5.brush 3 standalone. render(project,time) is deterministic and inexpensive enough for scrubbing. Cached backgrounds/character parts are encouraged; actual brush library must visibly participate. Supports 16:9 and 9:16; canvas pixel dimensions determine output. Human characters, actions, expressions, captions, backdrop, style, camera and transitions must respond to project data. Clear fallback status if WebGL unavailable. dispose releases resources and references.

Renderer page /render.html exports window.studioRender = { ready: true, load(project): Promise<void>, render(time): void, canvas(): HTMLCanvasElement }; no arbitrary code ingestion. render.html may fetch a server export project via /api/render/:id when query job=id exists. Server and UI use this same engine.

HTTP uses same-origin /api and JSON except audio upload:

- GET /api/health -> Health.
- POST /api/audio, binary body, Content-Type audio/*, X-Filename encoded -> AudioAsset. Max 30 MiB; inspect duration with ffprobe; store under generated ID. GET /api/audio/:id -> stream file.
- POST /api/exports {project,preset:'draft'|'hd'} -> ExportJob. draft long edge 640, hd long edge 1280, preserve aspect; FPS from project (12/24/30). Actual MP4 H.264 with optional mixed uploaded audio.
- GET /api/exports/:id -> ExportJob (progress 0..1); DELETE cancels; GET /api/exports/:id/file downloads ready MP4.
- GET /api/render/:id -> validated Project used for an export.
- POST /api/storyboard {prompt,project?} -> {project,source:'ai'} if AI_API_KEY and AI_MODEL configured. OpenAI-compatible base URL from server environment only. Provider output is schema-validated JSON, never executed code. Unconfigured returns 503 with readable message. Offline quick story draft uses createStoryFromPrompt and must never be labeled AI.
- POST /api/speech {text,voice?} -> AudioAsset if TTS credentials configured; otherwise 503. TTS optional; uploaded recorded speech is fully supported regardless.

Errors: HTTP appropriate code and {error:string}; no credentials or provider payload in errors. All writes validate Origin for local application; host binds 127.0.0.1. Local app, not a multi-user server. Jobs limited and cancellable. No arbitrary paths, commands or provider URLs accepted from browser. Export internal project endpoint restricted by opaque job id, no filesystem paths returned.

Dev: Vite at 127.0.0.1:5173 proxies /api to API 127.0.0.1:4174. API env PORT=4174 APP_ORIGIN=http://127.0.0.1:5173. Production: npm start serves dist at 127.0.0.1:4173. Server uses APP_ORIGIN for renderer page only after validating it is loopback. Chromium via playwright (CHROME_PATH override allowed from environment). FFMPEG_PATH/FFPROBE_PATH from environment. Local tool detection reported by health.

## UI requirements

Scene list with select/add/duplicate/delete/reorder; editable titles/durations/backdrops/captions/transitions. Play/pause, scrub, current time and project duration. Character design editor (names/colors/hair) and per-scene action/mood/position/scale. Original two-character demo visible on first load. Style selector. Undo/redo. Local autosave with explicit save errors. JSON import/export and project archive including uploaded audio (archive helper root can supply). Import must validate before replacing the project. Portrait/landscape presets.

Audio: upload, start, trim, volume, loop, remove, playback synced to timeline. Export dialog health prerequisite state, real progress/cancel/download. New story dialog: local draft available; AI generation explicitly configured/unconfigured. No inactive decorative controls or fake success.

## Initial acceptance

R1 one cohesive repository with upstream provenance and MIT notices.
R2 actual p5.brush rendering + original human characters and three editable scenes.
R3 project validation, autosave, portable import/export, undo/redo.
R4 deterministic frame rendering, playback/scrubbing, actual text and character changes.
R5 real MP4 render, cancellation and audio mix; no false completion if prerequisites missing.
R6 optional AI/TTS have real adapters, safe inputs and truthful unavailable states; no credentials committed.
R7 typecheck, node tests, build and browser editing/export checks; desktop and narrow layout inspected.

No full automatic photo-to-character conversion, 3D, production hosting or multi-user authentication in this first version. Do not claim those.
