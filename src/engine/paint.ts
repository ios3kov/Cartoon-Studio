import * as brush from "p5.brush/standalone";
import type { RenderStatus, StyleId } from "../shared/model";
import { hash, TAU } from "./math";

export type Point = readonly [number, number];
export interface PaintSurface {
  poly(points: readonly Point[], color: string, opacity?: number): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    color: string,
    opacity?: number,
  ): void;
  line(points: readonly Point[], color: string, weight?: number): void;
}
export function canvas2d(
  width: number,
  height: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable.");
  return [canvas, context];
}

let sharedCanvas: HTMLCanvasElement | undefined;
let sharedGL: WebGL2RenderingContext | undefined;
let users = 0;
let queue = Promise.resolve();
let unavailable: string | undefined;
const SIZE = 1536;

/** p5.brush has a global active target. All preparation is serialized here. */
export class Painter {
  private released = false;
  private current: RenderStatus = { backend: "p5.brush" };
  constructor() {
    users += 1;
  }
  status(): RenderStatus {
    return { ...this.current };
  }

  asset(
    width: number,
    height: number,
    style: StyleId,
    seed: number,
    draw: (paint: PaintSurface) => void,
    solidUnderpaint = false,
  ): Promise<HTMLCanvasElement> {
    let result: HTMLCanvasElement;
    const task = queue.then(() => {
      if (this.released) throw new Error("Renderer was disposed.");
      const [output, context] = canvas2d(width, height);
      const [mask, maskContext] = canvas2d(width, height);
      const [underpaint, underContext] = canvas2d(width, height);
      maskContext.fillStyle = "#000";
      maskContext.strokeStyle = "#000";
      try {
        if (unavailable) throw new Error(unavailable);
        if (!sharedCanvas) {
          sharedCanvas = document.createElement("canvas");
          sharedCanvas.width = SIZE;
          sharedCanvas.height = SIZE;
          sharedGL =
            sharedCanvas.getContext("webgl2", {
              preserveDrawingBuffer: true,
              premultipliedAlpha: true,
            }) ?? undefined;
          if (!sharedGL || !sharedGL.getExtension("EXT_color_buffer_float")) {
            unavailable =
              "WebGL2 / EXT_color_buffer_float недоступны. Используется Canvas 2D.";
            throw new Error(unavailable);
          }
        }
        brush.load(sharedCanvas);
        brush.clear();
        brush.seed(seed);
        brush.noiseSeed(seed);
        brush.noFill();
        brush.noWash();
        brush.noStroke();
        brush.noHatch();
        brush.noMass();
        brush.push();
        brush.translate(-SIZE / 2, -SIZE / 2);
        brush.fillBleed(style === "watercolor" ? 0.08 : 0.015, "in");
        brush.fillTexture(
          style === "watercolor" ? 0.26 : 0.13,
          0.14,
          false,
          0.08,
        );
        const paint: PaintSurface = {
          poly(points, color, opacity = 215) {
            maskContext.beginPath();
            points.forEach(([x, y], i) =>
              i ? maskContext.lineTo(x, y) : maskContext.moveTo(x, y),
            );
            maskContext.closePath();
            maskContext.fill();
            if (solidUnderpaint) {
              const rgb = color
                .match(/[a-f0-9]{2}/gi)
                ?.map((channel) => parseInt(channel, 16)) ?? [120, 120, 120];
              underContext.fillStyle = `rgb(${rgb.map((channel) => Math.round(channel * 0.78 + 246 * 0.22)).join(",")})`;
              underContext.beginPath();
              points.forEach(([x, y], i) =>
                i ? underContext.lineTo(x, y) : underContext.moveTo(x, y),
              );
              underContext.closePath();
              underContext.fill();
            }
            brush.noStroke();
            brush.noWash();
            brush.noHatch();
            brush.noMass();
            brush.fill(
              color,
              style === "pencil" ? Math.min(opacity, 145) : opacity,
            );
            if (style === "pencil") {
              brush.hatchStyle("HB", color, 0.55);
              brush.hatch(5, -0.7, { rand: 0.08, continuous: false });
            }
            if (style === "pastel")
              brush.mass("pastel", color, {
                precision: 0.5,
                strength: 0.2,
                gradient: 0.12,
                outline: false,
                style: "scribble",
                length: 35,
                follow: 0.15,
              });
            brush.polygon(points.map((p) => [p[0], p[1]]));
            brush.noFill();
            brush.noHatch();
            brush.noMass();
          },
          ellipse(x, y, rx, ry, color, opacity) {
            this.poly(
              Array.from(
                { length: 40 },
                (_, i) =>
                  [
                    x + Math.cos((i / 40) * TAU) * rx,
                    y + Math.sin((i / 40) * TAU) * ry,
                  ] as Point,
              ),
              color,
              opacity,
            );
          },
          line(points, color, weight = 1) {
            maskContext.lineWidth = Math.max(3, weight * 5);
            maskContext.lineCap = "round";
            maskContext.lineJoin = "round";
            maskContext.beginPath();
            points.forEach(([x, y], i) =>
              i ? maskContext.lineTo(x, y) : maskContext.moveTo(x, y),
            );
            maskContext.stroke();
            brush.noFill();
            brush.noWash();
            brush.noHatch();
            brush.noMass();
            brush.set(style === "pastel" ? "crayon" : "HB", color, weight);
            brush.spline(
              points.map((p) => [p[0], p[1], 0.8]),
              0.3,
            );
            brush.noStroke();
          },
        };
        try {
          draw(paint);
        } finally {
          brush.pop();
          brush.render();
        }
        context.drawImage(
          sharedCanvas,
          0,
          0,
          width,
          height,
          0,
          0,
          width,
          height,
        );
        // Spectral pigment mixing paints tiny near-white pixels outside its shape.
        // Clip once while caching; animated parts retain a genuinely transparent surround.
        context.globalCompositeOperation = "destination-in";
        context.drawImage(mask, 0, 0);
        context.globalCompositeOperation = "source-over";
        if (solidUnderpaint) {
          underContext.globalCompositeOperation = "multiply";
          underContext.globalAlpha = 0.7;
          underContext.drawImage(output, 0, 0);
          underContext.globalAlpha = 1;
          underContext.globalCompositeOperation = "destination-in";
          underContext.drawImage(mask, 0, 0);
          context.clearRect(0, 0, width, height);
          context.drawImage(underpaint, 0, 0);
        }
      } catch (error) {
        this.current = {
          backend: "canvas2d",
          message:
            error instanceof Error
              ? error.message
              : "Резервный рисунок Canvas 2D.",
        };
        context.clearRect(0, 0, width, height);
        draw(fallbackSurface(context, style));
      }
      result = output;
    });
    queue = task.catch(() => undefined);
    return task.then(() => result);
  }

  dispose(): void {
    if (this.released) return;
    this.released = true;
    users -= 1;
    if (users === 0) {
      sharedGL?.getExtension("WEBGL_lose_context")?.loseContext();
      sharedCanvas = undefined;
      sharedGL = undefined;
      unavailable = undefined;
    }
  }
}

function fallbackSurface(
  context: CanvasRenderingContext2D,
  style: StyleId,
): PaintSurface {
  return {
    poly(points, color, opacity = 215) {
      context.save();
      context.globalAlpha = opacity / 255;
      context.fillStyle = color;
      context.beginPath();
      points.forEach(([x, y], i) =>
        i ? context.lineTo(x, y) : context.moveTo(x, y),
      );
      context.closePath();
      context.fill();
      context.restore();
    },
    ellipse(x, y, rx, ry, color, opacity = 215) {
      context.save();
      context.globalAlpha = opacity / 255;
      context.fillStyle = color;
      context.beginPath();
      context.ellipse(x, y, rx, ry, 0, 0, TAU);
      context.fill();
      context.restore();
    },
    line(points, color, weight = 1) {
      context.strokeStyle = color;
      context.lineWidth = weight * (style === "pastel" ? 1.7 : 1);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      points.forEach(([x, y], i) =>
        i ? context.lineTo(x, y) : context.moveTo(x, y),
      );
      context.stroke();
    },
  };
}

export function paper(
  width: number,
  height: number,
  seed: number,
): HTMLCanvasElement {
  const [canvas, ctx] = canvas2d(width, height);
  ctx.fillStyle = "#f6f0e5";
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < (width * height) / 150; i += 1) {
    const x = hash(seed + i * 3) * width,
      y = hash(seed + i * 3 + 1) * height;
    ctx.fillStyle = `rgba(100,75,48,${0.015 + hash(i + 8) * 0.025})`;
    ctx.fillRect(x, y, 0.7 + hash(i + 9), 0.7);
  }
  return canvas;
}
