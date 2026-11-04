# Third-party sources and notices

## p5.brush

- Repository: https://github.com/acamposuribe/p5.brush
- Package version: 3.0.0 (exact version in package-lock.json).
- Reviewed source revision: d56350a647d0b098a9e79d397447a8094f6c45a4.
- Integration: standalone WebGL paint textures used by src/engine.
- The project imports the library rather than copying its repository history.

```text
MIT License

Copyright (c) 2023-2026 Alejandro Campos Uribe

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```

## ClaudeAnimationBase

- Repository: https://github.com/JohnHeibel/ClaudeAnimationBase
- Source revision: 0ac8bf2b31942376cb6b8c4074715595d512acd2.
- Adapted source: core motion/time helpers and frame-at-time export mechanics.
- Integration notes: src/engine/PROVENANCE.md and server/render.ts.
- Original characters, editor and validated project format are new code.

```text
MIT License

Copyright (c) 2026 John Heibel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```

## Other dependencies

React, Vite, TypeScript, Playwright, tsx and fflate are installed through npm.
Their package distributions retain their respective license notices.
The exact dependency graph is recorded in package-lock.json.
FFmpeg and Chromium are separate runtime prerequisites, not vendored binaries.
