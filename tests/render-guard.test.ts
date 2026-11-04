import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import type { Project } from "../src/shared/model.ts";
import { HttpError } from "../server/errors.ts";
import {
  BRUSH_REQUIRED_MESSAGE,
  captureBrushFrame,
  prepareRenderPage,
  requireBrushBackend,
} from "../server/renderGuard.ts";

// Execute the exact callbacks as serialized browser functions, without module closures.
function pageFixture(initial: unknown = "p5.brush") {
  let backend = initial;
  let draws = 0;
  let reads = 0;
  let onLoad = () => {};
  let onRender = () => {};
  let onRead = () => {};
  const canvas = {
    width: 0,
    height: 0,
    toDataURL: (mime: string) => {
      assert.equal(mime, "image/png");
      reads++;
      onRead();
      return "data:image/png;base64,cGFpbnRlZA==";
    },
  };
  const api = {
    load: async (_project: Project) => { onLoad(); },
    render: (_time: number) => { draws++; onRender(); },
    canvas: () => canvas,
    status: (() => ({ backend })) as (() => unknown) | undefined,
  };
  const scope = { window: { studioRender: api } };
  return {
    api, canvas,
    setBackend: (value: unknown) => { backend = value; },
    onLoad: (work: () => void) => { onLoad = work; },
    onRender: (work: () => void) => { onRender = work; },
    onRead: (work: () => void) => { onRead = work; },
    counts: () => ({ draws, reads }),
    prepare: () => runInNewContext(`(${prepareRenderPage.toString()})`, scope)({
      project: { id: "guard-test" }, width: 640, height: 360,
    }) as Promise<unknown>,
    frame: () => runInNewContext(`(${captureBrushFrame.toString()})`, scope)(0.25) as ReturnType<typeof captureBrushFrame>,
  };
}

test("export guard accepts only the exact p5.brush backend", () => {
  assert.doesNotThrow(() => requireBrushBackend("p5.brush"));
  for (const backend of ["canvas2d", null, undefined, "", "webgl2", {}, true]) {
    assert.throws(() => requireBrushBackend(backend), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 503);
      assert.equal(error.message, BRUSH_REQUIRED_MESSAGE);
      return true;
    });
  }
});

test("preparation checks the real backend after load, not its optimistic initial status", async () => {
  const page = pageFixture();
  page.onLoad(() => page.setBackend("canvas2d"));
  const backend = await page.prepare();
  assert.equal(backend, "canvas2d");
  assert.throws(() => requireBrushBackend(backend), HttpError);
  assert.deepEqual(page.counts(), { draws: 0, reads: 0 });
});

test("successful preparation preserves output dimensions", async () => {
  const page = pageFixture();
  assert.equal(await page.prepare(), "p5.brush");
  assert.equal(page.canvas.width, 640);
  assert.equal(page.canvas.height, 360);
});

test("a render page cannot silently change export dimensions during load", async () => {
  const page = pageFixture();
  page.onLoad(() => { page.canvas.width = 1; });
  await assert.rejects(page.prepare(), /Renderer changed output dimensions/);
});

test("missing or broken status reports fail preparation closed", async () => {
  const page = pageFixture();
  page.api.status = undefined;
  assert.equal(await page.prepare(), null);
  page.api.status = () => { throw new Error("private renderer error"); };
  assert.equal(await page.prepare(), null);
});

test("successful frame capture returns PNG data with its checked backend", () => {
  const page = pageFixture();
  const frame = page.frame();
  assert.equal(frame.backend, "p5.brush");
  assert.equal(frame.data, "data:image/png;base64,cGFpbnRlZA==");
  assert.deepEqual(page.counts(), { draws: 1, reads: 1 });
});

test("fallback before a frame prevents both drawing and PNG capture", () => {
  const page = pageFixture("canvas2d");
  assert.equal(page.frame().data, null);
  assert.deepEqual(page.counts(), { draws: 0, reads: 0 });
});

test("fallback during drawing prevents PNG capture", () => {
  const page = pageFixture();
  page.onRender(() => page.setBackend("canvas2d"));
  const frame = page.frame();
  assert.equal(frame.backend, "canvas2d");
  assert.equal(frame.data, null);
  assert.deepEqual(page.counts(), { draws: 1, reads: 0 });
});

test("fallback during readback discards the resulting PNG", () => {
  const page = pageFixture();
  page.onRead(() => page.setBackend("canvas2d"));
  assert.equal(page.frame().data, null);
  assert.deepEqual(page.counts(), { draws: 1, reads: 1 });
});

test("missing or broken status during frame capture never returns image data", () => {
  const page = pageFixture();
  page.api.status = undefined;
  assert.equal(page.frame().data, null);
  page.api.status = () => { throw new Error("private renderer error"); };
  assert.equal(page.frame().data, null);
  assert.deepEqual(page.counts(), { draws: 0, reads: 0 });
});
