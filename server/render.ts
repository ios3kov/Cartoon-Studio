/**
 * Frame-at-time capture and backpressured FFmpeg piping adapted from
 * JohnHeibel/ClaudeAnimationBase, render.mjs (MIT).
 * Copyright (c) 2026 John Heibel. See THIRD_PARTY_NOTICES.md for the full notice.
 * This implementation uses Playwright, validated projects, restricted loopback URLs,
 * bounded jobs, cancellation and explicit FFmpeg exit checks.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { chromium, type Browser } from "playwright";
import type { Project } from "../src/shared/model.ts";
import { getDuration } from "../src/shared/project.ts";
import { AUDIO_FORMATS, type AudioStore } from "./audio.ts";
import { HttpError, checkAbort } from "./errors.ts";
import type { RenderRunner, RenderTask } from "./jobs.ts";
import { captureCommand, stopProcess } from "./process.ts";
import { localOrigin } from "./providers.ts";
import {
  captureBrushFrame,
  prepareRenderPage,
  requireBrushBackend,
} from "./renderGuard.ts";

export interface RenderSettings {
  ffmpeg: string;
  chromePath?: string;
  appOrigin(): string;
  softwareGL?: boolean;
}

export async function browserAvailable(chromePath?: string): Promise<boolean> {
  try {
    await access(chromePath || chromium.executablePath(), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function outputDimensions(
  project: Project,
  preset: "draft" | "hd",
): { width: number; height: number } {
  const edge = preset === "draft" ? 640 : 1280;
  const scale = edge / Math.max(project.width, project.height);
  return {
    width: Math.max(2, Math.round((project.width * scale) / 2) * 2),
    height: Math.max(2, Math.round((project.height * scale) / 2) * 2),
  };
}

export async function prepareAudio(
  task: RenderTask,
  audio: AudioStore,
  settings: RenderSettings,
  directory: string,
  signal: AbortSignal,
): Promise<string[]> {
  const duration = getDuration(task.project);
  const files: string[] = [];
  for (const [index, track] of task.project.audio.entries()) {
    checkAbort(signal);
    const source = await audio.get(track.assetId);
    const available = source.duration - track.trimStart;
    if (available <= 0)
      throw new HttpError(400, "Обрезка аудио выходит за длительность файла.");
    const file = join(directory, `audio-${index}.wav`);
    // Materializing the trimmed segment makes every loop repeat that segment, not the untrimmed source.
    await captureCommand(
      settings.ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        AUDIO_FORMATS,
        "-ss",
        String(track.trimStart),
        "-i",
        source.file,
        "-t",
        String(Math.min(available, duration)),
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-c:a",
        "pcm_s16le",
        "-threads",
        "2",
        file,
      ],
      { signal, timeout: 60_000 },
    );
    files.push(file);
  }
  return files;
}

export function encodingArguments(
  project: Project,
  audioFiles: string[],
  output: string,
  preset: "draft" | "hd",
): string[] {
  if (audioFiles.length !== project.audio.length)
    throw new Error("Audio input mismatch");
  const duration = getDuration(project);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-filter_complex_threads",
    "2",
    "-f",
    "image2pipe",
    "-framerate",
    String(project.fps),
    "-c:v",
    "png",
    "-i",
    "pipe:0",
  ];
  for (const [index, file] of audioFiles.entries()) {
    if (project.audio[index].loop) args.push("-stream_loop", "-1");
    args.push("-protocol_whitelist", "file,pipe", "-i", file);
  }
  if (audioFiles.length) {
    const filters = project.audio.map((track, index) => {
      const delay = Math.round(track.start * 1000);
      return `[${index + 1}:a:0]atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${track.volume},adelay=${delay}:all=1[a${index}]`;
    });
    filters.push(
      `${project.audio.map((_, index) => `[a${index}]`).join("")}amix=inputs=${audioFiles.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:latency=1,apad,atrim=duration=${duration}[mixed]`,
    );
    args.push(
      "-filter_complex",
      filters.join(";"),
      "-map",
      "0:v:0",
      "-map",
      "[mixed]",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
    );
  } else args.push("-map", "0:v:0", "-an");
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    preset === "draft" ? "23" : "20",
    "-threads",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-t",
    String(duration),
    "-progress",
    "pipe:3",
    "-f",
    "mp4",
    output,
  );
  return args;
}

function writeFrame(
  child: ChildProcess,
  bytes: Buffer,
  signal: AbortSignal,
): Promise<void> {
  checkAbort(signal);
  const stream = child.stdin;
  if (!stream || stream.destroyed)
    throw new HttpError(500, "FFmpeg остановился до завершения видео.");
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      stream.removeListener("error", fail);
    };
    const fail = () => {
      cleanup();
      reject(new HttpError(500, "FFmpeg остановился до завершения видео."));
    };
    const abort = () => {
      cleanup();
      reject(new HttpError(409, "Экспорт отменён."));
    };
    signal.addEventListener("abort", abort, { once: true });
    stream.once("error", fail);
    // The callback runs only after the chunk has been handled, providing backpressure without accumulating frames.
    stream.write(bytes, (error) => {
      cleanup();
      if (error) fail();
      else resolve();
    });
  });
}

export function createRenderRunner(
  settings: RenderSettings,
  audio: AudioStore,
): RenderRunner {
  return async (task) => {
    const origin = localOrigin(settings.appOrigin());
    const dimensions = outputDimensions(task.project, task.preset);
    const duration = getDuration(task.project);
    const frames = Math.ceil(duration * task.project.fps);
    const signal = AbortSignal.any([
      task.signal,
      AbortSignal.timeout(30 * 60_000),
    ]);
    const directory = await mkdtemp(
      join(dirname(task.outputPath), `${task.id}-`),
    );
    const partial = join(directory, "video.mp4");
    let browser: Browser | undefined;
    let ffmpeg: ChildProcess | undefined;
    let encoding: Promise<void> | undefined;
    const abort = () => {
      if (ffmpeg) stopProcess(ffmpeg);
      void browser?.close().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      checkAbort(signal);
      if (!(await browserAvailable(settings.chromePath)))
        throw new HttpError(
          503,
          "Chromium не найден. Выполните npm run setup:browser или задайте CHROME_PATH.",
        );
      const audioFiles = await prepareAudio(
        task,
        audio,
        settings,
        directory,
        signal,
      );
      browser = await chromium.launch({
        headless: true,
        executablePath: settings.chromePath,
        timeout: 45_000,
        args: [
          "--disable-dev-shm-usage",
          "--disable-renderer-backgrounding",
          "--disable-background-timer-throttling",
          ...(settings.softwareGL
            ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
            : []),
        ],
      });
      checkAbort(signal);
      const context = await browser.newContext({
        viewport: dimensions,
        deviceScaleFactor: 1,
        serviceWorkers: "block",
      });
      await context.route("**/*", (route) => {
        let allowed = false;
        try {
          allowed = new URL(route.request().url()).origin === origin;
        } catch {
          /* deny malformed URL */
        }
        return allowed ? route.continue() : route.abort("blockedbyclient");
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const url = new URL("/render.html", origin);
      url.searchParams.set("width", String(dimensions.width));
      url.searchParams.set("height", String(dimensions.height));
      // Disable the render page's manual demo autoload; prepare only this job's project.
      url.searchParams.set("job", task.id);
      const response = await page.goto(url.href, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      if (!response?.ok())
        throw new HttpError(
          503,
          "Страница рендера недоступна. Запустите приложение или выполните npm run build.",
        );
      await page.waitForFunction(
        () =>
          (window as unknown as { studioRender?: { ready: boolean } })
            .studioRender?.ready === true,
        undefined,
        { timeout: 120_000 },
      );
      const backend = await page.evaluate(prepareRenderPage, {
        project: task.project,
        ...dimensions,
      });
      // Check before starting the encoder. A working Chromium binary does not prove WebGL works.
      requireBrushBackend(backend);
      checkAbort(signal);
      ffmpeg = spawn(
        settings.ffmpeg,
        encodingArguments(task.project, audioFiles, partial, task.preset),
        {
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "ignore", "pipe", "pipe"],
        },
      );
      // Discard bounded stderr rather than exposing paths or media metadata through the public job object.
      let stderrBytes = 0;
      ffmpeg.stderr?.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 512 * 1024) stopProcess(ffmpeg!);
      });
      ffmpeg.stdin?.on("error", () => {});
      let encodingPhase = false;
      let progressRemainder = "";
      const progressPipe = ffmpeg.stdio[3];
      if (progressPipe && "on" in progressPipe)
        progressPipe.on("data", (chunk: Buffer) => {
          progressRemainder = (
            progressRemainder + chunk.toString("utf8")
          ).slice(-8192);
          const lines = progressRemainder.split("\n");
          progressRemainder = lines.pop() ?? "";
          for (const line of lines)
            if (encodingPhase && line.startsWith("out_time_us=")) {
              const seconds = Number(line.slice(12)) / 1_000_000;
              if (Number.isFinite(seconds))
                task.update({
                  status: "encoding",
                  progress: 0.9 + 0.09 * Math.min(1, seconds / duration),
                });
            }
        });
      encoding = new Promise<void>((resolve, reject) => {
        ffmpeg!.once("error", () =>
          reject(
            new HttpError(
              503,
              "Не удалось запустить FFmpeg. Проверьте FFMPEG_PATH.",
            ),
          ),
        );
        ffmpeg!.once("close", (code) =>
          code === 0
            ? resolve()
            : reject(
                new HttpError(
                  500,
                  "FFmpeg не смог создать видео. Проверьте аудио и свободное место.",
                ),
              ),
        );
      });
      // A failed encoder may exit while Chromium is rendering. Keep the rejection handled until awaited below.
      void encoding.catch(() => {});
      for (let frame = 0; frame < frames; frame++) {
        checkAbort(signal);
        const captured = await page.evaluate(
          captureBrushFrame,
          frame / task.project.fps,
        );
        requireBrushBackend(captured.backend);
        const data = captured.data;
        if (
          typeof data !== "string" ||
          !data.startsWith("data:image/png;base64,") ||
          data.length > 12 * 1024 * 1024
        )
          throw new HttpError(500, "Рендер вернул неверный кадр.");
        await writeFrame(
          ffmpeg,
          Buffer.from(data.slice(data.indexOf(",") + 1), "base64"),
          signal,
        );
        task.update({
          status: "rendering",
          progress: (0.88 * (frame + 1)) / frames,
          frames: frame + 1,
        });
      }
      checkAbort(signal);
      encodingPhase = true;
      task.update({ status: "encoding", progress: 0.9, frames });
      ffmpeg.stdin!.end();
      await encoding;
      checkAbort(signal);
      await rename(partial, task.outputPath);
    } catch (error) {
      if (signal.aborted && !task.signal.aborted)
        throw new HttpError(
          504,
          "Экспорт превысил лимит 30 минут. Попробуйте черновое качество.",
        );
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        "Рендер не завершён. Проверьте Chromium и доступность локального приложения.",
      );
    } finally {
      signal.removeEventListener("abort", abort);
      if (ffmpeg && ffmpeg.exitCode === null) stopProcess(ffmpeg);
      await encoding?.catch(() => {});
      await browser?.close().catch(() => {});
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  };
}
