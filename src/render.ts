import { createStudioRenderer } from './engine';
import { createDefaultProject, validateProject } from './shared/project';
import type { Project, RenderStatus } from './shared/model';

interface RenderBridge {
  ready: boolean;
  load(project: Project): Promise<void>;
  render(time: number): void;
  canvas(): HTMLCanvasElement;
  status(): RenderStatus;
}
declare global { interface Window { studioRender: RenderBridge } }

const canvas = document.querySelector<HTMLCanvasElement>('#studio-canvas');
if (!canvas) throw new Error('Render canvas is missing.');
const target = canvas, query = new URLSearchParams(location.search);
const dimension = (key: string, fallback: number) => {
  const n = Number(query.get(key)); return Number.isFinite(n) && n >= 64 && n <= 4096 ? Math.round(n) : fallback;
};
target.width = dimension('width', 1280); target.height = dimension('height', 720);
const renderer = createStudioRenderer(target);
let project = createDefaultProject(), loadSequence = 0;
window.studioRender = {
  ready: true,
  async load(input) {
    const ticket = ++loadSequence, validated = validateProject(input);
    await renderer.prepare(validated);
    if (ticket === loadSequence) { project = validated; renderer.render(project, 0); }
  },
  render(time) { renderer.render(project, time); },
  canvas: () => target,
  status: () => renderer.status(),
};

// The server explicitly calls load(). A manual render page still has a preview.
if (!query.has('job')) void window.studioRender.load(project);
window.addEventListener('pagehide', () => renderer.dispose(), { once: true });
