import type { Actor, Character, Project, RenderStatus, Scene, StudioRenderer, MoodId } from '../shared/model';
import { getDuration, sampleScene } from '../shared/project';
import { characterArt, scenery, INK, type ArtCache, type CharacterArt } from './art';
import { Painter, canvas2d } from './paint';
import { clamp, ease, hash, jump, lerp, onTwos, paintBands, TAU } from './math';

function designKey(project: Project): string {
  return JSON.stringify([project.style, project.seed, project.width / project.height,
    project.characters.map(c => [c.id, c.skin, c.hair, c.hairStyle, c.outfit, c.accent]),
    [...new Set(project.scenes.map(s => s.backdrop))].sort()]);
}

/** Texture generation is expensive; animation only composites prepared parts. */
export function createStudioRenderer(canvas: HTMLCanvasElement): StudioRenderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  const context = ctx;
  const painter = new Painter();
  let cache: ArtCache | undefined, disposed = false, generation = 0;
  let preparingKey = '', preparing: Promise<RenderStatus> | undefined;
  const sceneBuffer = canvas2d(canvas.width || 1280, canvas.height || 720)[0];

  return {
    status: () => painter.status(),
    prepare(project) {
      if (disposed) return Promise.reject(new Error('Renderer was disposed.'));
      const key = designKey(project);
      if (cache?.key === key) { generation += 1; preparingKey = ''; return Promise.resolve(painter.status()); }
      if (preparing && preparingKey === key) return preparing;
      preparingKey = key;
      const ticket = ++generation;
      const stableProject = structuredClone(project);
      preparing = (async () => {
        const ratio = stableProject.width / stableProject.height;
        const width = ratio >= 1 ? 1280 : Math.round(1280 * ratio);
        const height = ratio >= 1 ? Math.round(1280 / ratio) : 1280;
        const next: ArtCache = { key, backgrounds: new Map(), characters: new Map() };
        for (const backdrop of new Set(stableProject.scenes.map(s => s.backdrop))) {
          if (disposed || ticket !== generation) return painter.status();
          next.backgrounds.set(backdrop, await scenery(painter, backdrop, stableProject.style, stableProject.seed, width, height));
        }
        for (let i = 0; i < stableProject.characters.length; i += 1) {
          if (disposed || ticket !== generation) return painter.status();
          const character = stableProject.characters[i]!;
          next.characters.set(character.id, await characterArt(painter, character, stableProject.style, stableProject.seed + i * 131));
        }
        if (!disposed && ticket === generation) { cache = next; preparingKey = ''; }
        return painter.status();
      })();
      return preparing;
    },
    render(project, time) {
      if (disposed) return;
      const t = clamp(Number.isFinite(time) ? time : 0, 0, getDuration(project));
      const sample = sampleScene(project, t), w = canvas.width, h = canvas.height;
      if (!w || !h) return;
      context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1;
      context.fillStyle = '#f6f0e5'; context.fillRect(0, 0, w, h);
      drawScene(context, project, sample.scene, sample.localTime, w, h, cache);
      if (sample.index > 0 && sample.localTime < 0.7 && sample.scene.transition !== 'cut') {
        const previous = project.scenes[sample.index - 1]!;
        if (sample.scene.transition === 'fade') {
          if (sceneBuffer.width !== w || sceneBuffer.height !== h) { sceneBuffer.width = w; sceneBuffer.height = h; }
          const previousCtx = sceneBuffer.getContext('2d')!;
          drawScene(previousCtx, project, previous, previous.duration, w, h, cache);
          context.save(); context.globalAlpha = 1 - ease(sample.localTime / 0.7); context.drawImage(sceneBuffer, 0, 0); context.restore();
        } else {
          const p = sample.localTime / 0.7;
          if (p < 0.5) drawScene(context, project, previous, previous.duration, w, h, cache);
          context.fillStyle = '#e6c27d';
          paintBands(p).forEach((band, i) => {
            if (band.end <= band.start) return;
            context.beginPath();
            context.moveTo(band.start * (w + 50) - 25, i / 5 * h - 10);
            context.lineTo(band.end * (w + 50) - 25, i / 5 * h - 10);
            for (let j = 0; j <= 8; j += 1) context.lineTo(band.end * (w + 50) - 25 + hash(i * 23 + j) * 14, (i + j / 8) / 5 * h + 10);
            context.lineTo(band.start * (w + 50) - 25, (i + 1) / 5 * h + 10); context.closePath(); context.fill();
          });
        }
      }
    },
    dispose() { disposed = true; generation += 1; cache = undefined; preparing = undefined; painter.dispose(); sceneBuffer.width = 1; sceneBuffer.height = 1; },
  };
}

function drawScene(ctx: CanvasRenderingContext2D, project: Project, scene: Scene, time: number, w: number, h: number, cache?: ArtCache): void {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  ctx.fillStyle = '#f6f0e5'; ctx.fillRect(0, 0, w, h);
  const zoom = scene.camera.zoom;
  ctx.translate(w / 2 + scene.camera.panX * w, h / 2 + scene.camera.panY * h);
  ctx.scale(zoom, zoom); ctx.translate(-w / 2, -h / 2);
  const background = cache?.backgrounds.get(scene.backdrop);
  if (background) ctx.drawImage(background, 0, 0, w, h);
  const u = Math.min(w, h) / 720;
  for (const actor of [...scene.actors].sort((a, b) => a.y - b.y)) {
    const character = project.characters.find(c => c.id === actor.characterId);
    if (!character) continue;
    const art = cache?.characters.get(character.id);
    const moving = actor.action === 'walk' || actor.action === 'ride';
    const progress = clamp(time / scene.duration);
    const x = (moving ? lerp(actor.x, actor.endX, ease(progress)) : actor.x) * w;
    ctx.save(); ctx.translate(x, actor.y * h); ctx.scale(u * actor.scale, u * actor.scale);
    if (actor.flip) ctx.scale(-1, 1);
    drawActor(ctx, actor, character, art, time); ctx.restore();
  }
  ctx.restore(); caption(ctx, scene.caption, w, h, scene.backdrop === 'night');
}

type XY = readonly [number, number];
function segment(ctx: CanvasRenderingContext2D, a: XY, b: XY, width: number, color: string, art: CharacterArt | undefined, sleeve: boolean): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  ctx.save(); ctx.translate(a[0], a[1]); ctx.rotate(Math.atan2(dy, dx) - Math.PI / 2);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, length); ctx.stroke();
  if (art) ctx.drawImage(art.atlas, sleeve ? 14 : 76, 205, sleeve ? 30 : 26, 80, -width / 2, -2, width, length + 4);
  ctx.restore();
}

function shoe(ctx: CanvasRenderingContext2D, x: number, y: number, angle = 0): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.fillStyle = '#414949';
  ctx.beginPath(); ctx.moveTo(-10, -8); ctx.quadraticCurveTo(2, -11, 8, -5); ctx.quadraticCurveTo(22, -4, 23, 3); ctx.lineTo(-11, 3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#e9d7b7'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-9, 3); ctx.lineTo(21, 3); ctx.stroke(); ctx.restore();
}

function drawActor(ctx: CanvasRenderingContext2D, actor: Actor, character: Character, art: CharacterArt | undefined, time: number): void {
  const stepped = onTwos(time), phase = stepped * TAU * 1.25;
  const stride = actor.action === 'walk' ? Math.sin(phase) : 0;
  const ride = actor.action === 'ride';
  const flight = actor.action === 'jump' ? jump(stepped % 2.4, 0.5, 1.25, 62) : { dy: 0, squash: 0 };
  const bob = actor.action === 'walk' ? -Math.abs(Math.cos(phase)) * 4 : Math.sin(stepped * 2.3) * 1.3;
  ctx.save(); ctx.fillStyle = '#4b55401b'; ctx.beginPath(); ctx.ellipse(0, 4, ride ? 111 : 50 - Math.abs(flight.dy) * 0.16, 7, 0, 0, TAU); ctx.fill(); ctx.restore();
  if (ride) bicycle(ctx, stepped, character.accent);
  ctx.save(); ctx.translate(0, flight.dy + bob); ctx.scale(1 + flight.squash * 0.3, 1 - flight.squash);
  const pants = character.hairStyle === 'long' ? '#aa835b' : '#4c5b60';
  const leg = (side: number) => {
    const hip: XY = [side * 17 - (ride ? 18 : 0), ride ? -117 : -95];
    const s = stride * side;
    const foot: XY = ride ? [Math.cos(phase + (side < 0 ? Math.PI : 0)) * 21, -48 + Math.sin(phase + (side < 0 ? Math.PI : 0)) * 21] : [side * 17 + s * 29, -Math.max(0, -s) * 17];
    const knee: XY = ride ? [hip[0] + 39, -82] : [hip[0] + s * 14 + Math.max(0, -s) * 13, -49 - Math.max(0, -s) * 8];
    segment(ctx, hip, knee, 20, pants, art, false); segment(ctx, knee, foot, 17, pants, art, false);
    shoe(ctx, foot[0], foot[1], ride ? -0.15 : s * 0.07);
  };
  leg(-1); leg(1);
  if (ride) ctx.translate(-18, -23);
  // The far arm sits behind the coat; the near arm overlaps naturally.
  const arm = (side: number) => {
    const shoulder: XY = [side * 37, -179];
    let elbow: XY = [side * (45 + Math.abs(stride) * 3), -132 + stride * side * 10];
    let hand: XY = [side * 47 - stride * side * 17, -96 + Math.abs(stride) * 8];
    if (actor.action === 'wave' && side > 0) { elbow = [64, -202]; hand = [69 + Math.sin(stepped * 8) * 11, -246]; }
    if (actor.action === 'jump') { elbow = [side * 66, -193]; hand = [side * 75, -223]; }
    if (ride) { elbow = [side > 0 ? 65 : 25, -160]; hand = [75, -94]; }
    segment(ctx, shoulder, elbow, 21, character.outfit, art, true);
    segment(ctx, elbow, hand, 16, character.outfit, art, true);
    ctx.fillStyle = character.skin; ctx.beginPath(); ctx.ellipse(hand[0], hand[1] + (actor.action === 'wave' ? -2 : 2), 8, 10, 0, 0, TAU); ctx.fill();
    if (actor.action === 'wave' && side > 0) { ctx.strokeStyle = character.skin; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(hand[0] - 6, hand[1]); ctx.lineTo(hand[0] - 11, hand[1] - 6); ctx.stroke(); }
  };
  arm(-1);
  if (art) ctx.drawImage(art.atlas, 150, 0, 140, 180, -49, -200, 98, 126);
  else { ctx.fillStyle = character.outfit; ctx.fillRect(-36, -191, 72, 112); }
  // Small travel satchel and shoulder strap.
  ctx.strokeStyle = character.accent; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-28, -190); ctx.lineTo(37, -117); ctx.stroke();
  ctx.fillStyle = character.accent; ctx.beginPath(); ctx.roundRect(24, -130, 26, 30, 5); ctx.fill();
  ctx.strokeStyle = '#69544860'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(28, -120); ctx.lineTo(46, -120); ctx.stroke();
  arm(1);
  ctx.save(); ctx.translate(0, -192); ctx.rotate(actor.mood === 'curious' ? -0.07 : Math.sin(stepped * 1.8) * 0.015);
  if (art) ctx.drawImage(art.atlas, 0, 0, 140, 150, -49, -84, 98, 105);
  else { ctx.fillStyle = character.skin; ctx.beginPath(); ctx.ellipse(0, -30, 27, 34, 0, 0, TAU); ctx.fill(); }
  face(ctx, actor.mood, stepped); ctx.restore(); ctx.restore();
}

function face(ctx: CanvasRenderingContext2D, mood: MoodId, time: number): void {
  ctx.save(); ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  const blink = time % 4.7 > 4.5;
  for (const side of [-1, 1]) {
    const x = side * 12 + 1, y = -33;
    if (blink || mood === 'calm') { ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.quadraticCurveTo(x, y + 3, x + 3, y); ctx.stroke(); }
    else { ctx.beginPath(); ctx.ellipse(x, y, mood === 'surprised' ? 2.9 : 2.1, mood === 'surprised' ? 4.2 : 3, 0, 0, TAU); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(x - 4, y - 10 - (mood === 'curious' && side > 0 ? 3 : 0)); ctx.quadraticCurveTo(x, y - 12, x + 4, y - 10); ctx.stroke();
  }
  ctx.strokeStyle = '#925f4d'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(2, -29); ctx.lineTo(0, -22); ctx.lineTo(4, -21); ctx.stroke();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (mood === 'surprised') ctx.ellipse(2, -12, 4, 5, 0, 0, TAU);
  else if (mood === 'happy') { ctx.moveTo(-6, -14); ctx.quadraticCurveTo(2, -5, 10, -14); }
  else { ctx.moveTo(-3, -11); ctx.quadraticCurveTo(2, -8, 7, -11); }
  ctx.stroke(); ctx.fillStyle = '#c37a6630';
  for (const x of [-18, 19]) { ctx.beginPath(); ctx.ellipse(x, -22, 5.5, 3, 0, 0, TAU); ctx.fill(); }
  ctx.restore();
}

function bicycle(ctx: CanvasRenderingContext2D, time: number, accent: string): void {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const x of [-70, 76]) {
    ctx.strokeStyle = '#3e5254'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, -35, 35, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#6f807f70'; ctx.lineWidth = 1;
    for (let i = 0; i < 6; i += 1) { const a = i * TAU / 6 + time * 4; ctx.beginPath(); ctx.moveTo(x, -35); ctx.lineTo(x + Math.cos(a) * 31, -35 + Math.sin(a) * 31); ctx.stroke(); }
  }
  ctx.strokeStyle = accent; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-70, -35); ctx.lineTo(-27, -91); ctx.lineTo(0, -48); ctx.closePath(); ctx.moveTo(-27, -91); ctx.lineTo(52, -91); ctx.lineTo(0, -48); ctx.moveTo(52, -91); ctx.lineTo(76, -35); ctx.moveTo(52, -91); ctx.lineTo(46, -115); ctx.stroke();
  ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-39, -96); ctx.lineTo(-15, -96); ctx.moveTo(43, -116); ctx.lineTo(58, -116); ctx.stroke(); ctx.restore();
}

function caption(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, dark: boolean): void {
  if (!text.trim()) return;
  ctx.save(); const size = Math.max(14, Math.min(w, h) * 0.037);
  ctx.font = `500 ${size}px Georgia, 'Times New Roman', serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines: string[] = []; let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && ctx.measureText(`${line} ${word}`).width > w * 0.78) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  const lineHeight = size * 1.45, centerY = h * 0.105;
  ctx.fillStyle = dark ? '#f5e9d1' : '#474840';
  lines.slice(0, 4).forEach((item, i) => ctx.fillText(item, w / 2, centerY + (i - (Math.min(lines.length, 4) - 1) / 2) * lineHeight)); ctx.restore();
}
