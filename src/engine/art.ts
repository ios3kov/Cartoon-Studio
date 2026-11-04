import type { BackdropId, Character, StyleId } from '../shared/model';
import { hash, TAU } from './math';
import { canvas2d, paper, type PaintSurface, Painter, type Point } from './paint';

export const INK = '#403d38';
export interface CharacterArt { atlas: HTMLCanvasElement; character: Character }
export interface ArtCache { key: string; backgrounds: Map<BackdropId, HTMLCanvasElement>; characters: Map<string, CharacterArt> }

function hill(p: PaintSurface, w: number, h: number, ys: number[], color: string, opacity = 220): void {
  const points: Point[] = [[-15, h + 15]];
  for (let i = 0; i <= 50; i += 1) {
    const t = i / 50 * (ys.length - 1), a = Math.floor(t), f = t - a;
    const y = (ys[a] ?? ys[0]!) * (1 - f) + (ys[Math.min(a + 1, ys.length - 1)] ?? ys[0]!) * f;
    points.push([i / 50 * (w + 30) - 15, y * h]);
  }
  points.push([w + 15, h + 15]); p.poly(points, color, opacity);
}

export async function scenery(painter: Painter, backdrop: BackdropId, style: StyleId, seed: number, w: number, h: number): Promise<HTMLCanvasElement> {
  const [result, ctx] = canvas2d(w, h); ctx.drawImage(paper(w, h, seed), 0, 0);
  const unit = Math.min(w, h) / 720;
  const painted = await painter.asset(w, h, style, seed, p => {
    if (backdrop === 'night') {
      p.poly([[0, 0], [w, 0], [w, h], [0, h]], '#2c475b', 242);
      p.ellipse(w * 0.77, h * 0.21, 44 * unit, 44 * unit, '#f5e0ab', 250);
      hill(p, w, h, [0.66, 0.57, 0.61, 0.47, 0.55, 0.69], '#587577');
      hill(p, w, h, [0.82, 0.73, 0.82, 0.78, 0.76], '#355552');
      hill(p, w, h, [0.88, 0.86, 0.9, 0.86, 0.91], '#243f42');
    } else {
      p.ellipse(w * 0.78, h * 0.24, 57 * unit, 57 * unit, '#edc171', 150);
      p.ellipse(w * 0.24, h * 0.26, 82 * unit, 17 * unit, '#d8e2de', 100);
      p.ellipse(w * 0.3, h * 0.24, 47 * unit, 26 * unit, '#d8e2de', 90);
      if (backdrop === 'coast') {
        hill(p, w, h, [0.52, 0.51, 0.51, 0.52], '#8fb8b5', 180);
        hill(p, w, h, [0.69, 0.66, 0.7, 0.65, 0.72], '#83b0ad', 150);
        hill(p, w, h, [0.69, 0.72, 0.79, 0.83, 0.91], '#e6cf9f', 230);
        hill(p, w, h, [0.81, 0.85, 0.89, 0.93], '#eadcbf', 220);
        p.poly([[w * 0.01, h * 0.68], [w * 0.05, h * 0.53], [w * 0.15, h * 0.5], [w * 0.23, h * 0.63], [w * 0.22, h * 0.73]], '#9fa68b', 195);
        for (let i = 0; i < 7; i += 1) {
          const x = w * (0.32 + hash(seed + i) * 0.58), y = h * (0.55 + i * 0.025);
          p.line([[x, y], [x + 30 * unit, y - unit], [x + 72 * unit, y + unit]], '#e6f0e6', 1.7 * unit);
        }
      } else {
        hill(p, w, h, [0.65, 0.58, 0.62, 0.47, 0.55, 0.62, 0.58], '#bdc7a3', 180);
        hill(p, w, h, [0.74, 0.62, 0.64, 0.75, 0.67, 0.71], '#a2b18b', 200);
        hill(p, w, h, [0.83, 0.78, 0.82, 0.78, 0.82], '#d0cc9f', 195);
        p.poly([[w * 0.46, h * 0.71], [w * 0.54, h * 0.71], [w * 0.68, h * 0.81], [w * 0.88, h], [w * 0.43, h], [w * 0.57, h * 0.83]], '#ede0bc', 210);
      }
      if (backdrop === 'forest') {
        for (let i = 0; i < 12; i += 1) {
          const side = i < 6 ? 0 : 1, k = i % 6;
          const x = side ? w - k * w * 0.048 : k * w * 0.048;
          const y = h * (0.59 + hash(seed + i) * 0.15), size = (85 + hash(seed + i + 32) * 60) * unit;
          p.poly([[x - 5 * unit, y + size * 0.8], [x + 5 * unit, y + size * 0.8], [x + 2 * unit, y - size], [x - 3 * unit, y - size]], '#77765b', 220);
          p.ellipse(x, y - size * 0.6, size * 0.47, size, i % 2 ? '#6f8d78' : '#879d72', 190);
          p.line([[x, y + size * 0.72], [x, y - size * 0.7]], '#616b54', 1 * unit);
        }
      }
      if (backdrop === 'city') {
        const colors = ['#d5b49a', '#a6bcb5', '#d0bd8c', '#c79b87'];
        for (let i = 0; i < 7; i += 1) {
          const x = i / 6 * w - w * 0.04, bw = w * 0.12, top = h * (0.38 + hash(i + seed) * 0.15);
          p.poly([[x, h * 0.73], [x, top], [x + bw, top], [x + bw, h * 0.73]], colors[i % 4]!, 215);
          p.poly([[x - unit * 8, top], [x + bw * 0.5, top - 35 * unit], [x + bw + unit * 8, top]], '#957565', 200);
        }
        hill(p, w, h, [0.77, 0.77, 0.77], '#d4cab0', 240);
      }
    }
  });
  ctx.drawImage(painted, 0, 0);
  if (backdrop === 'night') {
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#6d8397';
    ctx.fillRect(0, 0, w, h); ctx.restore();
  }
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = unit;
  if (backdrop === 'night') {
    for (let i = 0; i < 40; i += 1) {
      ctx.fillStyle = '#f1e4c0'; ctx.globalAlpha = 0.35 + hash(i + 13) * 0.5;
      ctx.beginPath(); ctx.arc(hash(seed + i * 7) * w, hash(seed + i * 7 + 2) * h * 0.5, (0.6 + hash(i) * 1.4) * unit, 0, TAU); ctx.fill();
    }
  } else {
    ctx.strokeStyle = '#747b63'; ctx.globalAlpha = 0.45;
    for (let i = 0; i < 37; i += 1) {
      const x = hash(seed + i * 3) * w, y = h * (0.79 + hash(seed + i * 3 + 1) * 0.17);
      if (backdrop === 'coast' && x > w * 0.6) continue;
      ctx.beginPath(); ctx.moveTo(x - 3 * unit, y); ctx.lineTo(x - 6 * unit, y - 9 * unit);
      ctx.moveTo(x, y); ctx.lineTo(x + 3 * unit, y - 13 * unit); ctx.stroke();
      if (i % 4 === 0) { ctx.fillStyle = '#c18b64'; ctx.beginPath(); ctx.arc(x + 3 * unit, y - 13 * unit, 2.2 * unit, 0, TAU); ctx.fill(); }
    }
    if (backdrop === 'city') {
      ctx.globalAlpha = 0.65; ctx.fillStyle = '#5b6c68';
      for (let i = 0; i < 7; i += 1) {
        const x = i / 6 * w - w * 0.04, bw = w * 0.12, top = h * (0.38 + hash(i + seed) * 0.15);
        for (let row = 0; row < 2; row += 1) for (let col = 0; col < 2; col += 1) {
          const wx = x + bw * (0.2 + col * 0.42), wy = top + 20 * unit + row * 33 * unit;
          ctx.fillRect(wx, wy, bw * 0.17, 22 * unit);
          ctx.strokeStyle = '#f0dec0'; ctx.beginPath(); ctx.moveTo(wx + bw * 0.085, wy); ctx.lineTo(wx + bw * 0.085, wy + 22 * unit); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 0.55; ctx.strokeStyle = '#6b7770';
    for (let i = 0; i < 3; i += 1) {
      const x = w * (0.51 + i * 0.035), y = h * (0.25 - i % 2 * 0.025);
      ctx.beginPath(); ctx.moveTo(x - 7 * unit, y); ctx.quadraticCurveTo(x - 3 * unit, y - 5 * unit, x, y);
      ctx.quadraticCurveTo(x + 3 * unit, y - 5 * unit, x + 7 * unit, y); ctx.stroke();
    }
  }
  ctx.restore(); return result;
}

/** Parts atlas: head [0,0,140,150], coat [150,0,140,180], limb swatches below. */
export async function characterArt(painter: Painter, character: Character, style: StyleId, seed: number): Promise<CharacterArt> {
  const atlas = await painter.asset(320, 360, style, seed, p => {
    const c = character;
    // Separate hair shapes avoid pigment showing through the face like facial hair.
    p.poly([[59, 105], [58, 142], [83, 142], [82, 105]], c.skin, 250);
    p.ellipse(70, 76, 36, 45, c.skin, 255);
    p.ellipse(34, 80, 6, 9, c.skin, 255); p.ellipse(106, 80, 6, 9, c.skin, 255);
    if (c.hairStyle === 'long') {
      p.poly([[33, 48], [28, 82], [29, 123], [24, 137], [45, 139], [48, 119], [36, 93], [39, 54]], c.hair, 255);
      p.poly([[103, 48], [112, 80], [112, 125], [118, 135], [97, 140], [91, 116], [103, 93], [100, 54]], c.hair, 255);
    } else if (c.hairStyle === 'bob') {
      p.poly([[33, 47], [28, 75], [29, 111], [45, 119], [42, 102], [35, 88], [39, 54]], c.hair, 255);
      p.poly([[103, 47], [112, 75], [111, 111], [95, 119], [98, 102], [105, 88], [100, 54]], c.hair, 255);
    }
    p.poly([[33, 62], [35, 41], [45, 26], [63, 19], [85, 21], [103, 34], [109, 58], [99, 66], [91, 44], [76, 39], [58, 53], [42, 56]], c.hair, 255);
    if (c.hairStyle === 'short') p.poly([[38, 42], [46, 18], [67, 25], [80, 17], [101, 37], [91, 47]], c.hair, 250);
    // Coat, collar and clean lower hem.
    p.poly([[174, 20], [194, 10], [218, 15], [241, 10], [263, 22], [266, 76], [273, 157], [245, 165], [190, 163], [166, 155], [171, 79]], c.outfit, 250);
    p.poly([[204, 12], [219, 30], [232, 12], [241, 20], [220, 45], [195, 21]], c.accent, 250);
    p.poly([[219, 33], [232, 31], [242, 84], [228, 90]], c.accent, 245);
    p.poly([[173, 93], [196, 96], [194, 123], [175, 121]], c.outfit, 170);
    p.poly([[244, 96], [265, 92], [264, 121], [246, 125]], c.outfit, 170);
    // Rounded sleeve and trouser material, composited as articulated limbs.
    p.poly([[15, 204], [42, 204], [45, 260], [41, 286], [17, 286], [13, 258]], c.outfit, 250);
    p.poly([[76, 204], [101, 204], [102, 290], [77, 290]], c.hairStyle === 'long' ? '#aa835b' : '#4c5b60', 250);
    p.ellipse(145, 234, 14, 20, c.skin, 255);
  }, true);
  const ctx = atlas.getContext('2d')!;
  ctx.strokeStyle = '#403d3860'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(220, 49); ctx.lineTo(220, 153); ctx.moveTo(174, 120); ctx.lineTo(194, 123); ctx.moveTo(246, 125); ctx.lineTo(264, 121); ctx.stroke();
  ctx.fillStyle = character.accent;
  for (let i = 0; i < 3; i += 1) { ctx.beginPath(); ctx.arc(224, 89 + i * 22, 1.9, 0, TAU); ctx.fill(); }
  return { atlas, character };
}
