import type { Project, RenderStatus } from "../src/shared/model.ts";
import { HttpError } from "./errors.ts";

export const BRUSH_REQUIRED_MESSAGE =
  "Экспорт остановлен: p5.brush недоступен. Упрощённый рисунок Canvas2D не сохраняется. Проверьте WebGL2 и повторите экспорт.";

interface RenderPage {
  load(project: Project): Promise<void>;
  render(time: number): void;
  canvas(): HTMLCanvasElement;
  status?(): RenderStatus | null;
}
export interface CapturedFrame {
  backend: unknown;
  data: string | null;
}

/** Fail closed. Do not publish fallback frames or trust a missing/unknown backend. */
export function requireBrushBackend(backend: unknown): void {
  if (backend !== "p5.brush") throw new HttpError(503, BRUSH_REQUIRED_MESSAGE);
}

/** Serialized by Playwright: keep all runtime dependencies inside this function. */
export async function prepareRenderPage(input: {
  project: Project;
  width: number;
  height: number;
}): Promise<unknown> {
  const api = (window as unknown as { studioRender: RenderPage }).studioRender;
  const canvas = api.canvas();
  canvas.width = input.width;
  canvas.height = input.height;
  await api.load(input.project);
  if (canvas.width !== input.width || canvas.height !== input.height)
    throw new Error("Renderer changed output dimensions");
  // Read AFTER load: Painter can fall back while preparing any scene or character.
  try {
    return typeof api.status === "function" ? api.status()?.backend ?? null : null;
  } catch {
    return null;
  }
}

/** Serialized by Playwright. Reject degradation before drawing and before accepting PNG bytes. */
export function captureBrushFrame(time: number): CapturedFrame {
  const api = (window as unknown as { studioRender: RenderPage }).studioRender;
  let data: string | null = null;
  // No nested helpers: tsx may inject closure-bound naming helpers into nested functions.
  // These callbacks must also work after Playwright serializes them into a fresh page.
  for (let phase = 0; phase < 3; phase++) {
    let backend: unknown = null;
    try {
      backend = typeof api.status === "function" ? api.status()?.backend ?? null : null;
    } catch {
      // A throwing/missing status report cannot prove that brush assets are usable.
    }
    if (backend !== "p5.brush") return { backend, data: null };
    if (phase === 0) api.render(time);
    if (phase === 1) data = api.canvas().toDataURL("image/png");
  }
  return { backend: "p5.brush", data };
}
