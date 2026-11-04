import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createDefaultProject } from "../../src/shared/project.ts";
import type {
  ExportJob,
  Project,
  RenderStatus,
} from "../../src/shared/model.ts";

interface RenderAPI {
  ready: boolean;
  load(project: Project): Promise<void>;
  render(time: number): void;
  canvas(): HTMLCanvasElement;
  status(): RenderStatus;
}

async function load(
  page: Page,
  project: Project,
  width = 640,
  height = 360,
): Promise<RenderStatus> {
  await page.goto("/render.html");
  await page.waitForFunction(
    () =>
      (window as unknown as { studioRender?: RenderAPI }).studioRender?.ready,
  );
  return page.evaluate(
    async ({ project, width, height }) => {
      const api = (window as unknown as { studioRender: RenderAPI })
        .studioRender;
      api.canvas().width = width;
      api.canvas().height = height;
      await api.load(project);
      return api.status();
    },
    { project, width, height },
  );
}

async function frame(page: Page, time: number): Promise<string> {
  return page.evaluate((t) => {
    const api = (window as unknown as { studioRender: RenderAPI }).studioRender;
    api.render(t);
    return api.canvas().toDataURL("image/png");
  }, time);
}

function wave(): Buffer {
  const rate = 8000,
    samples = Math.round(rate * 1.2);
  const data = Buffer.alloc(44 + samples * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(
      Math.round(Math.sin((i / rate) * Math.PI * 2 * 330) * 4000),
      44 + i * 2,
    );
  return data;
}

test("real brush frames are deterministic, animated, and respond to text and appearance", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const project = createDefaultProject();
  expect((await load(page, project)).backend).toBe("p5.brush");
  const first = await frame(page, 1);
  const moved = await frame(page, 4);
  const firstAgain = await frame(page, 1);
  expect(firstAgain).toBe(first);
  expect(moved).not.toBe(first);
  const original = Buffer.from(first.split(",")[1], "base64");
  expect(original.length).toBeGreaterThan(8000);
  await writeFile(info.outputPath("watercolor.png"), original);
  await info.attach("Watercolor frame", {
    body: original,
    contentType: "image/png",
  });
  project.scenes[0].caption = "Новая подпись меняет итоговый кадр";
  project.characters[0].outfit = "#2555cc";
  await page.evaluate(async (project) => {
    await (window as unknown as { studioRender: RenderAPI }).studioRender.load(
      project,
    );
  }, project);
  expect(await frame(page, 1)).not.toBe(first);
  expect(errors).toEqual([]);
});

test("all three styles use distinct painterly output", async ({
  page,
}, info) => {
  const project = createDefaultProject();
  const frames = new Set<string>();
  for (const style of ["watercolor", "pencil", "pastel"] as const) {
    project.style = style;
    expect((await load(page, project)).backend).toBe("p5.brush");
    const data = await frame(page, 14);
    frames.add(data);
    await writeFile(
      info.outputPath(`${style}.png`),
      Buffer.from(data.split(",")[1], "base64"),
    );
  }
  expect(frames.size).toBe(3);
});

// Four expensive WebGL preparations previously shared one 180-second test budget.
// Keep the style comparison and portrait assertions, but give these independent behaviors separate tests.
// The normal per-test timeout stays unchanged; no assertion, renderer or output quality is weakened.
test("portrait frame preserves dimensions with the pastel painterly renderer", async ({
  page,
}, info) => {
  const project = createDefaultProject();
  project.style = "pastel";
  project.width = 720;
  project.height = 1280;
  expect((await load(page, project, 360, 640)).backend).toBe("p5.brush");
  const portrait = Buffer.from((await frame(page, 8)).split(",")[1], "base64");
  expect(portrait.readUInt32BE(16)).toBe(360);
  expect(portrait.readUInt32BE(20)).toBe(640);
  await writeFile(info.outputPath("portrait.png"), portrait);
  await info.attach("Portrait frame", {
    body: portrait,
    contentType: "image/png",
  });
});

test("exports the complete demo as H264 MP4 with AAC audio and supports real cancellation", async ({
  request,
}, info) => {
  const headers = { Origin: "http://127.0.0.1:4173" };
  const health = await (await request.get("/api/health")).json();
  expect(health.ffmpeg).toBe(true);
  expect(health.browser).toBe(true);
  const upload = await request.post("/api/audio", {
    headers: {
      ...headers,
      "Content-Type": "audio/wav",
      "X-Filename": "test-tone.wav",
    },
    data: wave(),
  });
  expect(upload.status()).toBe(201);
  const asset = await upload.json();
  const project = createDefaultProject();
  project.audio = [
    {
      id: "test_track",
      assetId: asset.id,
      name: "Test tone",
      start: 0.4,
      trimStart: 0.1,
      volume: 0.2,
      loop: true,
      kind: "music",
    },
  ];
  const submitted = await request.post("/api/exports", {
    headers,
    data: { project, preset: "draft" },
  });
  expect(submitted.status(), await submitted.text()).toBe(202);
  let job = (await submitted.json()) as ExportJob;
  const deadline = Date.now() + 150_000;
  while (
    !["done", "error", "cancelled"].includes(job.status) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    job = (await (
      await request.get(`/api/exports/${job.id}`)
    ).json()) as ExportJob;
  }
  expect(job.status, job.error).toBe("done");
  expect(job.progress).toBe(1);
  expect(job.frames).toBe(432);
  const download = await request.get(job.downloadUrl!);
  expect(download.ok()).toBe(true);
  const file = info.outputPath("seaside-demo.mp4");
  await writeFile(file, await download.body());
  const probe = JSON.parse(
    execFileSync(
      process.env.FFPROBE_PATH || "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      { encoding: "utf8" },
    ),
  );
  const video = probe.streams.find(
    (stream: { codec_type: string }) => stream.codec_type === "video",
  );
  const audio = probe.streams.find(
    (stream: { codec_type: string }) => stream.codec_type === "audio",
  );
  expect(video.codec_name).toBe("h264");
  expect(video.width).toBe(640);
  expect(video.height).toBe(360);
  expect(audio.codec_name).toBe("aac");
  expect(Number(probe.format.duration)).toBeCloseTo(18, 1);
  await info.attach("Complete demo with synthetic test audio", {
    path: file,
    contentType: "video/mp4",
  });
  const next = (await (
    await request.post("/api/exports", {
      headers,
      data: { project, preset: "hd" },
    })
  ).json()) as ExportJob;
  const cancelled = (await (
    await request.delete(`/api/exports/${next.id}`, { headers })
  ).json()) as ExportJob;
  expect(cancelled.status).toBe("cancelled");
  expect((await request.get(`/api/exports/${next.id}/file`)).status()).not.toBe(
    200,
  );
});
