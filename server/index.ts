import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, realpath, stat } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import type { Health, Project } from "../src/shared/model.ts";
import { validateProject } from "../src/shared/project.ts";
import {
  AUDIO_LIMIT,
  AudioStore,
  createAudioProbe,
  type AudioProbe,
} from "./audio.ts";
import { HttpError, publicError } from "./errors.ts";
import { ExportQueue, type RenderRunner } from "./jobs.ts";
import {
  Providers,
  localOrigin,
  providerSettings,
  type FetchFunction,
} from "./providers.ts";
import { commandAvailable } from "./process.ts";
import { browserAvailable, createRenderRunner } from "./render.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const JSON_LIMIT = 1024 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

export interface ServerOptions {
  port?: number;
  /** null explicitly makes the renderer use this server, ignoring APP_ORIGIN (used by the CLI). */
  appOrigin?: string | null;
  production?: boolean;
  dataDirectory?: string;
  distDirectory?: string;
  env?: NodeJS.ProcessEnv;
  runner?: RenderRunner;
  audioProbe?: AudioProbe;
  fetcher?: FetchFunction;
  healthProbe?: () => Promise<{ ffmpeg: boolean; browser: boolean }>;
  maxWaiting?: number;
}
export interface StudioServer {
  server: Server;
  origin: string;
  jobs: ExportQueue;
  audio: AudioStore;
  close(): Promise<void>;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent || response.destroyed) return;
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": bytes.length,
    "Cache-Control": "no-store",
  });
  response.end(bytes);
}

export function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<Buffer> {
  if (
    request.headers["content-encoding"] &&
    request.headers["content-encoding"] !== "identity"
  )
    throw new HttpError(415, "Сжатые запросы не поддерживаются.");
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit)
    throw new HttpError(413, "Запрос слишком большой.");
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let settled = false;
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        chunks.length = 0;
        reject(error);
      }
    };
    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) fail(new HttpError(413, "Запрос слишком большой."));
      else chunks.push(chunk);
    });
    request.once("aborted", () =>
      fail(new HttpError(400, "Загрузка прервана.")),
    );
    request.once("error", () =>
      fail(new HttpError(400, "Не удалось прочитать запрос.")),
    );
    request.once("end", () => {
      if (!settled) {
        settled = true;
        resolveBody(Buffer.concat(chunks));
      }
    });
  });
}

async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  if (
    request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new HttpError(415, "Нужен запрос application/json.");
  const bytes = await readBody(request, JSON_LIMIT);
  try {
    const input = JSON.parse(bytes.toString("utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Expected object");
    return input;
  } catch {
    throw new HttpError(400, "Не удалось прочитать JSON.");
  }
}

function projectInput(input: unknown): Project {
  try {
    return validateProject(input);
  } catch {
    throw new HttpError(
      400,
      "Проект не прошёл проверку. Проверьте сцены, персонажей и длительность.",
    );
  }
}

async function sendFile(
  request: IncomingMessage,
  response: ServerResponse,
  file: string,
  mime: string,
  download?: string,
): Promise<void> {
  let info;
  try {
    info = await stat(file);
  } catch {
    throw new HttpError(404, "Файл не найден.");
  }
  if (!info.isFile()) throw new HttpError(404, "Файл не найден.");
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  const headers: Record<string, string | number> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  if (download)
    headers["Content-Disposition"] = `attachment; filename="${download}"`;
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!match || (!match[1] && !match[2]))
      throw new HttpError(416, "Неверный диапазон файла.");
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (suffix <= 0) throw new HttpError(416, "Неверный диапазон файла.");
      start = Math.max(0, info.size - suffix);
    } else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= info.size
    ) {
      response.setHeader("Content-Range", `bytes */${info.size}`);
      throw new HttpError(416, "Неверный диапазон файла.");
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
  }
  headers["Content-Length"] = Math.max(0, end - start + 1);
  response.writeHead(status, headers);
  if (request.method === "HEAD" || !info.size) {
    response.end();
    return;
  }
  await pipeline(createReadStream(file, { start, end }), response).catch(() => {
    response.destroy();
  });
}

async function staticFile(directory: string, path: string): Promise<string> {
  let filename = resolve(directory, `.${path === "/" ? "/index.html" : path}`);
  let actual: string;
  try {
    actual = await realpath(filename);
  } catch {
    throw new HttpError(404, "Страница не найдена. Выполните npm run build.");
  }
  const root = await realpath(directory);
  const difference = relative(root, actual);
  if (
    difference.startsWith(`..${sep}`) ||
    difference === ".." ||
    isAbsolute(difference)
  )
    throw new HttpError(403, "Недоступный путь.");
  return actual;
}

export async function createStudioServer(
  options: ServerOptions = {},
): Promise<StudioServer> {
  const env = options.env ?? process.env;
  const port =
    options.port ?? Number(env.PORT || (options.production ? 4173 : 4174));
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT должен быть целым числом от 0 до 65535.");
  const configuredOrigin =
    options.appOrigin === null
      ? undefined
      : (options.appOrigin ?? env.APP_ORIGIN);
  const appOrigin = configuredOrigin
    ? localOrigin(configuredOrigin)
    : undefined;
  const dataDirectory = resolve(
    options.dataDirectory ||
      env.STUDIO_DATA_DIR ||
      join(ROOT, ".cartoon-studio"),
  );
  const distDirectory = resolve(options.distDirectory || join(ROOT, "dist"));
  await mkdir(dataDirectory, { recursive: true });
  const ffmpegPath = env.FFMPEG_PATH || "ffmpeg";
  const ffprobePath = env.FFPROBE_PATH || "ffprobe";
  const providers = new Providers(providerSettings(env), options.fetcher);
  const audio = new AudioStore(
    dataDirectory,
    options.audioProbe ?? createAudioProbe(ffprobePath),
  );
  await audio.initialize();
  let origin = "";
  const jobs = new ExportQueue(
    dataDirectory,
    options.runner ??
      createRenderRunner(
        {
          ffmpeg: ffmpegPath,
          chromePath: env.CHROME_PATH,
          appOrigin: () => appOrigin || origin,
          softwareGL: env.STUDIO_SOFTWARE_GL === "1",
        },
        audio,
      ),
    options.maxWaiting,
  );
  await jobs.initialize();
  let uploads = 0;
  let cachedHealth: { value: Health; expires: number } | undefined;
  async function health(): Promise<Health> {
    if (cachedHealth && cachedHealth.expires > Date.now())
      return cachedHealth.value;
    const tools = options.healthProbe
      ? await options.healthProbe()
      : await (async () => {
          const [ffmpeg, ffprobe, browser] = await Promise.all([
            commandAvailable(ffmpegPath),
            commandAvailable(ffprobePath),
            browserAvailable(env.CHROME_PATH),
          ]);
          return { ffmpeg: ffmpeg && ffprobe, browser };
        })();
    const value: Health = {
      status: "ok",
      ...tools,
      aiConfigured: !!providers.settings.ai,
      ttsConfigured: !!providers.settings.tts,
    };
    cachedHealth = { value, expires: Date.now() + 10_000 };
    return value;
  }

  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    try {
      const localhostOrigin = `http://localhost:${(server.address() as { port: number }).port}`;
      const allowed = new Set([
        origin,
        localhostOrigin,
        ...(appOrigin ? [appOrigin] : []),
      ]);
      const allowedHosts = new Set(
        [...allowed].map((address) => new URL(address).host),
      );
      // localhost is an equivalent entry point, but never accept arbitrary DNS names or forwarded hosts.
      allowedHosts.add(
        `localhost:${(server.address() as { port: number }).port}`,
      );
      const headerOrigin = request.headers.origin;
      if (!allowedHosts.has(request.headers.host ?? ""))
        throw new HttpError(
          403,
          "Сервер доступен только через локальный адрес приложения.",
        );
      if (headerOrigin && !allowed.has(headerOrigin))
        throw new HttpError(
          403,
          "Недопустимый Origin. Откройте локальное приложение.",
        );
      const method = request.method || "GET";
      if (
        !["GET", "HEAD"].includes(method) &&
        (!headerOrigin || !allowed.has(headerOrigin))
      )
        throw new HttpError(
          403,
          "Для изменения данных нужен Origin локального приложения.",
        );
      if (!["GET", "HEAD", "POST", "DELETE"].includes(method))
        throw new HttpError(405, "Метод не поддерживается.");
      const rawPath = (request.url || "/").split("?")[0];
      if (!rawPath.startsWith("/"))
        throw new HttpError(400, "Неверный адрес запроса.");
      let path: string;
      try {
        path = decodeURIComponent(rawPath);
      } catch {
        throw new HttpError(400, "Неверный адрес запроса.");
      }
      if (
        path.includes("\\") ||
        path.includes("\0") ||
        path.split("/").some((part) => part === ".." || part === ".")
      )
        throw new HttpError(400, "Недоступный путь.");

      if (path === "/api/health" && method === "GET") {
        json(response, 200, await health());
        return;
      }
      if (path === "/api/audio" && method === "POST") {
        if (
          !/^audio\/[a-z0-9.+-]+(?:;|$)/i.test(
            request.headers["content-type"] ?? "",
          )
        )
          throw new HttpError(415, "Загрузите аудиофайл с типом audio/*.");
        if (uploads >= 2)
          throw new HttpError(429, "Дождитесь завершения загрузки аудио.");
        let name = "Аудио";
        try {
          name = decodeURIComponent(
            String(request.headers["x-filename"] || name),
          );
        } catch {
          throw new HttpError(400, "Неверное имя аудиофайла.");
        }
        uploads++;
        try {
          json(
            response,
            201,
            await audio.add(await readBody(request, AUDIO_LIMIT), name),
          );
        } finally {
          uploads--;
        }
        return;
      }
      const audioMatch = /^\/api\/audio\/(a_[a-f0-9]{32})$/.exec(path);
      if (audioMatch && ["GET", "HEAD"].includes(method)) {
        const asset = await audio.get(audioMatch[1]);
        await sendFile(request, response, asset.file, asset.mime);
        return;
      }
      if (path === "/api/exports" && method === "POST") {
        const body = await readJson(request);
        if (body.preset !== "draft" && body.preset !== "hd")
          throw new HttpError(400, "Выберите качество draft или hd.");
        const project = projectInput(body.project);
        await audio.validateTracks(project);
        const available = await health();
        if (!available.ffmpeg || !available.browser)
          throw new HttpError(
            503,
            !available.ffmpeg
              ? "Не найдены FFmpeg или ffprobe. Установите FFmpeg и проверьте пути."
              : "Не найден Chromium. Выполните npm run setup:browser или задайте CHROME_PATH.",
          );
        json(response, 202, jobs.submit(project, body.preset));
        return;
      }
      const jobMatch = /^\/api\/exports\/(j_[a-f0-9]{32})(\/file)?$/.exec(path);
      if (jobMatch) {
        if (jobMatch[2] && ["GET", "HEAD"].includes(method)) {
          await sendFile(
            request,
            response,
            jobs.file(jobMatch[1]),
            "video/mp4",
            "cartoon.mp4",
          );
          return;
        }
        if (!jobMatch[2] && method === "GET") {
          json(response, 200, jobs.get(jobMatch[1]));
          return;
        }
        if (!jobMatch[2] && method === "DELETE") {
          json(response, 200, jobs.cancel(jobMatch[1]));
          return;
        }
      }
      const renderMatch = /^\/api\/render\/(j_[a-f0-9]{32})$/.exec(path);
      if (renderMatch && method === "GET") {
        json(response, 200, jobs.project(renderMatch[1]));
        return;
      }
      if (path === "/api/storyboard" && method === "POST") {
        const project = await providers.storyboard(await readJson(request));
        await audio.validateTracks(project);
        json(response, 200, { project, source: "ai" });
        return;
      }
      if (path === "/api/speech" && method === "POST") {
        const body = await readJson(request);
        const speech = await providers.speech(body);
        json(response, 201, await audio.add(speech, "Озвучка.mp3"));
        return;
      }
      if (path.startsWith("/api/"))
        throw new HttpError(404, "Запрос не найден.");
      if (!["GET", "HEAD"].includes(method))
        throw new HttpError(405, "Метод не поддерживается.");
      if (!options.production)
        throw new HttpError(
          404,
          "В режиме разработки откройте Vite на порту 5173.",
        );
      const file = await staticFile(distDirectory, path);
      await sendFile(
        request,
        response,
        file,
        MIME[extname(file)] || "application/octet-stream",
      );
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 413) response.setHeader("Connection", "close");
      json(response, status, { error: publicError(error) });
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolveListen();
    });
  });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let closePromise: Promise<void> | undefined;
  return {
    server,
    origin,
    jobs,
    audio,
    close: () =>
      (closePromise ??= (async () => {
        await jobs.close();
        await new Promise<void>((resolveClose) => {
          server.close(() => resolveClose());
          server.closeAllConnections();
        });
      })()),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const app = await createStudioServer({
      production: process.argv.includes("--production"),
    });
    console.log(`Cartoon Studio: ${app.origin}`);
    const shutdown = () => {
      void app.close().then(() => {
        process.exitCode = 0;
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Сервер не запущен.",
    );
    process.exitCode = 1;
  }
}
