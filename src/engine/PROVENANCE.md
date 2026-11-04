# Renderer provenance

The scenery, characters, anatomy, colour palettes and composition in this directory
are original work for Cartoon Studio. No Clawd character or character artwork is used.

`math.ts` adapts small universal helpers from the supplied Claude Animation
repository at commit `0ac8bf2b31942376cb6b8c4074715595d512acd2`:

- `src/core.js`: clamp, lerp, ease, easeOut, hash, seg, onTwos and jump.
- `src/timeline.js`: the five-band timing of brushWipe, exposed as pure paintBands.

The adaptation adds TypeScript types, avoids global mutable timeline state,
changes the jump deformation, and returns geometry instead of drawing into
an upstream global context. The renderer actively uses these helpers.
No upstream scene registry, runtime evaluation or character code is copied.

The supplied upstream checkout is `claude-animation-base-upstream`.
Source: https://github.com/JohnHeibel/ClaudeAnimationBase/tree/0ac8bf2b31942376cb6b8c4074715595d512acd2

Painted assets use the installed `p5.brush/standalone` package, pinned to 3.0.0.
Its upstream repository is https://github.com/acamposuribe/p5.brush.
The library's own licence is distributed with that package.
