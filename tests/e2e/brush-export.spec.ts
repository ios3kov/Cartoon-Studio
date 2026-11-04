import { test, expect, type APIRequestContext } from "@playwright/test";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStudioServer, type StudioServer } from "../../server/index.ts";
import { BRUSH_REQUIRED_MESSAGE } from "../../server/renderGuard.ts";
import { createDefaultProject } from "../../src/shared/project.ts";
import type { ExportJob } from "../../src/shared/model.ts";

// Isolated production server and built assets. No failure switch ships in the application.
async function fixture(options: { prelude?: string; renderDocument?: string }) {
  const root = await mkdtemp(join(tmpdir(), "studio-brush-guard-"));
  let app: StudioServer | undefined;
  try {
    const dist = join(root, "dist");
    await cp(resolve("dist"), dist, { recursive: true });
    if (options.prelude) {
      for (const name of ["index.html", "render.html"]) {
        const file = join(dist, name);
        const html = await readFile(file, "utf8");
        if (!html.includes("<head>")) throw new Error("Missing document head");
        await writeFile(file, html.replace("<head>", `<head><script>${options.prelude}</script>`));
      }
    }
    if (options.renderDocument)
      await writeFile(join(dist, "render.html"), options.renderDocument);
    app = await createStudioServer({
      port: 0,
      production: true,
      appOrigin: null,
      dataDirectory: join(root, "data"),
      distDirectory: dist,
      env: {
        STUDIO_SOFTWARE_GL: "1",
        CHROME_PATH: process.env.CHROME_PATH,
        FFMPEG_PATH: process.env.FFMPEG_PATH,
        FFPROBE_PATH: process.env.FFPROBE_PATH,
      },
    });
    return {
      app,
      close: async () => {
        try { await app!.close(); }
        finally { await rm(root, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    await app?.close();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function expectRejectedExport(
  request: APIRequestContext,
  app: StudioServer,
  expectedFrames = 0,
): Promise<void> {
  const project = createDefaultProject();
  project.scenes = [project.scenes[0]];
  project.scenes[0].duration = 1;
  project.fps = 12;
  const response = await request.post(`${app.origin}/api/exports`, {
    headers: { Origin: app.origin },
    data: { project, preset: "draft" },
  });
  expect(response.status(), await response.text()).toBe(202);
  const submitted = (await response.json()) as ExportJob;
  let job = submitted;
  await expect.poll(async () => {
    job = (await (await request.get(`${app.origin}/api/exports/${submitted.id}`)).json()) as ExportJob;
    return job.status;
  }, { timeout: 90_000 }).toBe("error");
  expect(job.error).toBe(BRUSH_REQUIRED_MESSAGE);
  expect(job.downloadUrl).toBeUndefined();
  expect(job.frames).toBe(expectedFrames);
  expect((await request.get(`${app.origin}/api/exports/${job.id}/file`)).status()).toBe(409);
  // Includes partial render directories, not just the final MP4 name.
  await expect.poll(() => readdir(app.jobs.directory)).toEqual([]);
}

test("real WebGL2 fallback stays visible in preview and cannot be exported", async ({ page, request }) => {
  const f = await fixture({ prelude: `
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
      return kind === "webgl2" ? null : Reflect.apply(original, this, [kind, ...args]);
    };
  ` });
  try {
    await page.goto(f.app.origin);
    await expect(page.getByText("Упрощённый рисунок", { exact: true })).toBeVisible();
    await page.getByLabel("Название проекта", { exact: true }).fill("Сохраняем проект, но не упрощённое видео");
    await expect(page.getByText("Сохранено на устройстве", { exact: true })).toBeVisible();
    await expectRejectedExport(request, f.app);
  } finally {
    await page.goto("about:blank");
    await f.close();
  }
});

test("missing float color buffer support cannot produce a fallback MP4", async ({ request }) => {
  const f = await fixture({ prelude: `
    const original = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function(name) {
      return name === "EXT_color_buffer_float" ? null : original.call(this, name);
    };
  ` });
  try { await expectRejectedExport(request, f.app); }
  finally { await f.close(); }
});

test("a graphics exception inside Painter cannot produce a fallback MP4", async ({ request }) => {
  const f = await fixture({ prelude: `
    WebGL2RenderingContext.prototype.drawArrays = function() { throw new Error("Injected paint failure"); };
    WebGL2RenderingContext.prototype.drawElements = function() { throw new Error("Injected paint failure"); };
  ` });
  try { await expectRejectedExport(request, f.app); }
  finally { await f.close(); }
});

// These two fixtures simulate incompatible/intercepted bridges. They do not prove paint quality;
// the real-renderer tests above and in render.spec.ts retain that responsibility.
function bridgeDocument(midExport: boolean): string {
  return `<!doctype html><html><body><canvas id="c"></canvas><script>
    const canvas = document.getElementById("c");
    let frames = 0;
    let backend = "p5.brush";
    window.studioRender = {
      ready: true,
      load: async function() {},
      canvas: function() { return canvas; },
      render: function() {
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#123456";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (++frames === 2) backend = "canvas2d";
      }
    };
    ${midExport ? 'window.studioRender.status = function() { return { backend }; };' : ''}
  </script></body></html>`;
}

test("a bridge without backend reporting fails before the first export frame", async ({ request }) => {
  const f = await fixture({ renderDocument: bridgeDocument(false) });
  try { await expectRejectedExport(request, f.app); }
  finally { await f.close(); }
});

test("backend degradation after one accepted frame removes the partial export", async ({ request }) => {
  const f = await fixture({ renderDocument: bridgeDocument(true) });
  try { await expectRejectedExport(request, f.app, 1); }
  finally { await f.close(); }
});
