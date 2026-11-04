import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ExportJob, ExportPreset, Project } from "../src/shared/model.ts";
import { getDuration } from "../src/shared/project.ts";
import { HttpError, publicError } from "./errors.ts";

export interface RenderTask {
  id: string;
  project: Project;
  preset: ExportPreset;
  outputPath: string;
  signal: AbortSignal;
  update(
    update: Pick<ExportJob, "status" | "progress"> &
      Partial<Pick<ExportJob, "frames">>,
  ): void;
}
export type RenderRunner = (task: RenderTask) => Promise<void>;
interface InternalJob {
  state: ExportJob;
  project: Project;
  preset: ExportPreset;
  file: string;
  abort: AbortController;
}

/** One renderer, at most four waiting jobs, and a bounded completed-file history. */
export class ExportQueue {
  private jobs = new Map<string, InternalJob>();
  private waiting: string[] = [];
  private active?: Promise<void>;
  private closed = false;
  readonly directory: string;

  constructor(
    dataDirectory: string,
    private runner: RenderRunner,
    private maxWaiting = 4,
    private maxHistory = 30,
  ) {
    this.directory = join(dataDirectory, "exports");
  }
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  submit(project: Project, preset: ExportPreset): ExportJob {
    if (this.closed) throw new HttpError(503, "Сервер завершает работу.");
    if (this.waiting.length >= this.maxWaiting)
      throw new HttpError(
        429,
        "Очередь заполнена. Дождитесь завершения экспорта.",
      );
    const id = `j_${randomUUID().replaceAll("-", "")}`;
    const state: ExportJob = {
      id,
      status: "queued",
      progress: 0,
      frames: 0,
      totalFrames: Math.ceil(getDuration(project) * project.fps),
    };
    this.jobs.set(id, {
      state,
      project: structuredClone(project),
      preset,
      file: join(this.directory, `${id}.mp4`),
      abort: new AbortController(),
    });
    this.waiting.push(id);
    const initial = { ...state };
    this.drain();
    return initial;
  }

  get(id: string): ExportJob {
    return { ...this.require(id).state };
  }
  project(id: string): Project {
    return structuredClone(this.require(id).project);
  }
  file(id: string): string {
    const job = this.require(id);
    if (job.state.status !== "done")
      throw new HttpError(409, "Видео ещё не готово.");
    return job.file;
  }
  cancel(id: string): ExportJob {
    const job = this.require(id);
    if (["done", "error", "cancelled"].includes(job.state.status))
      return { ...job.state };
    job.abort.abort();
    job.state.status = "cancelled";
    delete job.state.downloadUrl;
    this.waiting = this.waiting.filter((queued) => queued !== id);
    void this.prune();
    return { ...job.state };
  }

  private require(id: string): InternalJob {
    if (!/^j_[a-f0-9]{32}$/.test(id))
      throw new HttpError(404, "Экспорт не найден.");
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, "Экспорт не найден.");
    return job;
  }

  private drain(): void {
    if (this.active || this.closed) return;
    const id = this.waiting.shift();
    if (!id) return;
    const job = this.jobs.get(id)!;
    job.state.status = "rendering";
    // Deferring runner execution ensures active is set before any completion path runs.
    this.active = Promise.resolve()
      .then(async () => {
        try {
          await this.runner({
            id,
            project: job.project,
            preset: job.preset,
            outputPath: job.file,
            signal: job.abort.signal,
            update: (update) => {
              if (job.abort.signal.aborted) return;
              if (update.status !== "rendering" && update.status !== "encoding")
                return;
              job.state.status = update.status;
              if (Number.isFinite(update.progress))
                job.state.progress = Math.max(
                  job.state.progress,
                  Math.min(0.99, update.progress),
                );
              if (Number.isFinite(update.frames))
                job.state.frames = Math.min(
                  job.state.totalFrames!,
                  Math.max(0, Math.floor(update.frames!)),
                );
            },
          });
          if (!job.abort.signal.aborted) {
            const info = await stat(job.file);
            if (!info.isFile() || info.size < 16) throw new Error("No output");
            Object.assign(job.state, {
              status: "done",
              progress: 1,
              frames: job.state.totalFrames,
              downloadUrl: `/api/exports/${id}/file`,
            });
          }
        } catch (error) {
          if (!job.abort.signal.aborted) {
            job.state.status = "error";
            job.state.error = publicError(
              error,
              "Экспорт не завершён. Проверьте Chromium, FFmpeg и проект.",
            );
          }
        } finally {
          if (job.abort.signal.aborted) job.state.status = "cancelled";
          if (job.state.status !== "done")
            await rm(job.file, { force: true }).catch(() => {});
          await this.prune();
        }
      })
      .finally(() => {
        this.active = undefined;
        this.drain();
      });
  }

  private async prune(): Promise<void> {
    const finished = [...this.jobs.entries()].filter(([, job]) =>
      ["done", "error", "cancelled"].includes(job.state.status),
    );
    for (const [id, job] of finished.slice(
      0,
      Math.max(0, finished.length - this.maxHistory),
    )) {
      this.jobs.delete(id);
      await rm(job.file, { force: true }).catch(() => {});
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [id, job] of this.jobs)
      if (!["done", "error", "cancelled"].includes(job.state.status))
        this.cancel(id);
    await this.active;
  }
}
