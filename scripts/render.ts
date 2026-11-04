#!/usr/bin/env node
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  createStudioServer,
  JSON_LIMIT,
  type StudioServer,
} from "../server/index.ts";
import { localOrigin } from "../server/providers.ts";
import { validateProject } from "../src/shared/project.ts";
import type { ExportJob } from "../src/shared/model.ts";

const usage = `Usage: npm run render -- --project project.json --out movie.mp4 --preset draft|hd

Build first: npm run build. The command starts an isolated local server on a free port.
Optional: --server http://127.0.0.1:4173 uses an existing production server.
Optional: --data-dir /path/to/data uses audio assets stored in that directory.
Audio IDs must exist in the server's data directory (.cartoon-studio by default).
CHROME_PATH, FFMPEG_PATH, FFPROBE_PATH and STUDIO_SOFTWARE_GL=1 are supported.
Ctrl+C cancels the job and removes a partially downloaded output.`;

function argumentsOf(values: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index++) {
    const token = values[index];
    if (token === "--help" || token === "-h") {
      parsed.set("help", "1");
      continue;
    }
    const match = /^--(project|out|preset|server|data-dir)(?:=(.*))?$/.exec(
      token,
    );
    if (!match) throw new Error(`Unknown argument: ${token}`);
    const value = match[2] ?? values[++index];
    if (!value || value.startsWith("--") || parsed.has(match[1]))
      throw new Error(`Missing or repeated argument: --${match[1]}`);
    parsed.set(match[1], value);
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = argumentsOf(process.argv.slice(2));
  if (args.has("help")) {
    console.log(usage);
    return;
  }
  if (!args.has("project") || !args.has("out")) throw new Error(usage);
  const preset = args.get("preset") || "draft";
  if (preset !== "draft" && preset !== "hd")
    throw new Error("Preset must be draft or hd.");
  const projectPath = resolve(args.get("project")!);
  const info = await stat(projectPath);
  if (!info.isFile() || info.size > JSON_LIMIT)
    throw new Error("Project must be a JSON file smaller than 1 MiB.");
  const project = validateProject(
    JSON.parse(await readFile(projectPath, "utf8")),
  );
  const output = resolve(args.get("out")!);
  if (!output.toLowerCase().endsWith(".mp4"))
    throw new Error("--out must end in .mp4.");
  const partial = `${output}.${process.pid}.partial`;
  let app: StudioServer | undefined;
  let jobId: string | undefined;
  let origin = "";
  const interrupted = new AbortController();
  const interrupt = () => interrupted.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    if (args.has("server")) origin = localOrigin(args.get("server")!);
    else {
      app = await createStudioServer({
        production: true,
        port: 0,
        appOrigin: null,
        dataDirectory: args.get("data-dir"),
      });
      origin = app.origin;
    }
    const request = async (
      path: string,
      init?: RequestInit,
    ): Promise<Response> => {
      const response = await fetch(`${origin}${path}`, {
        ...init,
        signal: AbortSignal.any([
          interrupted.signal,
          AbortSignal.timeout(15_000),
        ]),
        headers: {
          Origin: origin,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(error.error || `HTTP ${response.status}`);
      }
      return response;
    };
    let job = (await (
      await request("/api/exports", {
        method: "POST",
        body: JSON.stringify({ project, preset }),
      })
    ).json()) as ExportJob;
    jobId = job.id;
    let previous = "";
    for (;;) {
      const label = `${job.status}: ${Math.round(job.progress * 100)}% (${job.frames ?? 0}/${job.totalFrames ?? "?"})`;
      if (label !== previous) {
        console.log(label);
        previous = label;
      }
      if (job.status === "error")
        throw new Error(job.error || "Export failed.");
      if (job.status === "cancelled") throw new Error("Export cancelled.");
      if (job.status === "done") break;
      await delay(400, undefined, { signal: interrupted.signal });
      job = (await (
        await request(`/api/exports/${jobId}`)
      ).json()) as ExportJob;
    }
    const video = await request(`/api/exports/${jobId}/file`);
    if (!video.body) throw new Error("The server returned no video.");
    await mkdir(dirname(output), { recursive: true });
    await pipeline(
      Readable.fromWeb(video.body as never),
      createWriteStream(partial, { flags: "wx" }),
      { signal: interrupted.signal },
    );
    await rename(partial, output);
    console.log(`Saved: ${output}`);
  } finally {
    if (jobId && interrupted.signal.aborted) {
      await fetch(`${origin}/api/exports/${jobId}`, {
        method: "DELETE",
        headers: { Origin: origin },
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await rm(partial, { force: true });
    await app?.close();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error && error.name === "AbortError"
      ? "Export cancelled."
      : error instanceof Error
        ? error.message
        : "Export failed.",
  );
  process.exitCode = 1;
});
