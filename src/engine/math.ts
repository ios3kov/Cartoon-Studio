/**
 * Small, adapted animation helpers from Claude Animation.
 * Source: JohnHeibel/ClaudeAnimationBase, src/core.js,
 * commit 0ac8bf2b31942376cb6b8c4074715595d512acd2. See PROVENANCE.md.
 */
export const TAU = Math.PI * 2;
export const clamp = (x: number, a = 0, b = 1): number => Math.max(a, Math.min(b, x));
export const lerp = (a: number, b: number, x: number): number => a + (b - a) * x;
export const ease = (x: number): number => { const t = clamp(x); return t * t * (3 - 2 * t); };
export const easeOut = (x: number): number => 1 - (1 - clamp(x)) ** 3;
export const hash = (i: number): number => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export const seg = (t: number, a: number, b: number): number => clamp((t - a) / (b - a));
export const onTwos = (t: number): number => Math.floor(t * 12 + 1e-6) / 12;

/** Independent-time anticipation, flight and landing; height uses local art units. */
export function jump(t: number, t0: number, t1: number, height: number): { dy: number; squash: number } {
  if (t < t0 - 0.12) return { dy: 0, squash: 0 };
  if (t < t0) return { dy: 0, squash: 0.12 * ease(seg(t, t0 - 0.12, t0)) };
  if (t < t1) {
    const k = (t - t0) / (t1 - t0);
    return { dy: -height * 4 * k * (1 - k), squash: -0.07 * Math.abs(1 - 2 * k) };
  }
  const a = t - t1;
  return { dy: 0, squash: 0.12 * Math.exp(-8 * a) * Math.cos(20 * a) };
}

/** Adapted five-band paint transition from upstream src/timeline.js: brushWipe. */
export function paintBands(progress: number): Array<{ start: number; end: number }> {
  return [0, 0.14, 0.06, 0.18, 0.1].map(delay => ({
    start: progress < 0.5 ? 0 : ease(((progress - 0.5) * 2 - delay) / (1 - delay)),
    end: progress < 0.5 ? easeOut((progress * 2 - delay) / (1 - delay)) : 1,
  }));
}
