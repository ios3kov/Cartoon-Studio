import type { Project } from "../src/shared/model.ts";
import {
  createDefaultProject,
  validateProject,
} from "../src/shared/project.ts";
import { AUDIO_LIMIT } from "./audio.ts";
import { HttpError } from "./errors.ts";

interface Provider {
  url: string;
  key: string;
  model: string;
}
export interface ProviderSettings {
  ai?: Provider;
  tts?: Provider;
}
export type FetchFunction = typeof fetch;
export const VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
];

export function isLoopback(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"
  );
}

export function localOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_ORIGIN должен быть локальным HTTP-адресом.");
  }
  if (
    !isLoopback(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("APP_ORIGIN должен быть локальным HTTP-адресом без пути.");
  return url.origin;
}

function provider(
  base: string | undefined,
  key: string,
  model: string,
): Provider {
  let url: URL;
  try {
    url = new URL(base || "https://api.openai.com/v1");
  } catch {
    throw new Error("Неверный URL сервиса генерации.");
  }
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopback(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !model.trim() ||
    model.length > 200 ||
    /[\r\n]/.test(key + model)
  ) {
    throw new Error("Неверная конфигурация сервиса генерации.");
  }
  return { url: url.href.replace(/\/+$/, ""), key, model };
}

export function providerSettings(env: NodeJS.ProcessEnv): ProviderSettings {
  const ai =
    env.AI_API_KEY && env.AI_MODEL
      ? provider(env.AI_BASE_URL, env.AI_API_KEY, env.AI_MODEL)
      : undefined;
  // Reusing an AI key for speech requires an explicit administrator choice.
  const speechKey =
    env.TTS_API_KEY ||
    (env.TTS_USE_AI_KEY === "1" ? env.AI_API_KEY : undefined);
  const speechBase =
    env.TTS_BASE_URL ||
    (env.TTS_USE_AI_KEY === "1" ? env.AI_BASE_URL : undefined);
  const tts =
    speechKey && env.TTS_MODEL
      ? provider(speechBase, speechKey, env.TTS_MODEL)
      : undefined;
  return { ai, tts };
}

async function boundedResponse(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel();
    throw new HttpError(502, "Ответ сервиса слишком большой.");
  }
  if (!response.body) throw new HttpError(502, "Сервис вернул пустой ответ.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit)
        throw new HttpError(502, "Ответ сервиса слишком большой.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export class Providers {
  private busy = new Set<"ai" | "tts">();
  constructor(
    readonly settings: ProviderSettings,
    private fetcher: FetchFunction = fetch,
    private timeout = 60_000,
  ) {}

  private async call(
    kind: "ai" | "tts",
    endpoint: string,
    body: object,
    limit: number,
  ): Promise<Buffer> {
    const configured = this.settings[kind];
    if (!configured)
      throw new HttpError(
        503,
        kind === "ai"
          ? "ИИ не настроен. Укажите AI_API_KEY и AI_MODEL или создайте локальный черновик."
          : "Озвучка не настроена. Укажите TTS_API_KEY и TTS_MODEL или загрузите запись голоса.",
      );
    if (this.busy.has(kind))
      throw new HttpError(429, "Дождитесь завершения текущей генерации.");
    this.busy.add(kind);
    const signal = AbortSignal.timeout(this.timeout);
    try {
      const response = await this.fetcher(`${configured.url}/${endpoint}`, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${configured.key}`,
        },
        body: JSON.stringify({ ...body, model: configured.model }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new HttpError(
          502,
          "Сервис отклонил запрос. Проверьте настройки и доступный баланс.",
        );
      }
      return await boundedResponse(response, limit, signal);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        signal.aborted ? 504 : 502,
        signal.aborted
          ? "Сервис не ответил за минуту."
          : "Не удалось получить ответ сервиса.",
      );
    } finally {
      this.busy.delete(kind);
    }
  }

  async storyboard(input: {
    prompt?: unknown;
    project?: unknown;
  }): Promise<Project> {
    if (
      typeof input.prompt !== "string" ||
      !input.prompt.trim() ||
      input.prompt.length > 4000
    )
      throw new HttpError(400, "Опишите историю: от 1 до 4000 символов.");
    let base: Project;
    try {
      base =
        input.project === undefined
          ? createDefaultProject()
          : validateProject(input.project);
    } catch {
      throw new HttpError(400, "Исходный проект повреждён.");
    }
    const system = [
      "You create original, coherent short cartoons. Return a JSON object with a single project field.",
      "Use the exact version 1 project shape supplied below. Return data only, never executable code.",
      "Use Russian titles and captions. Keep the project id, dimensions, fps, existing character ids and audio.",
      "Maximum 24 scenes, 120 seconds total, 1–30 seconds per scene, 8 characters, 8 actors per scene.",
      "style: watercolor|pencil|pastel. backdrop: hills|coast|city|forest|night. transition: cut|fade|paint.",
      "action: idle|walk|wave|jump|ride. mood: happy|curious|surprised|calm. hairStyle: short|bob|long.",
      "Colours are #RRGGBB. Actor characterId references a character; actor and scene ids must be unique.",
      "Actor x,y,endX are normalized coordinates; scale: 0.4–1.8. Camera zoom: 1–1.6, panX,panY: -0.3–0.3.",
      "Preserve audio exactly. Do not include HTML, scripts, URLs or additional fields.",
    ].join("\n");
    const bytes = await this.call(
      "ai",
      "chat/completions",
      {
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              prompt: input.prompt.trim(),
              project: base,
            }),
          },
        ],
      },
      512 * 1024,
    );
    try {
      const payload = JSON.parse(bytes.toString("utf8"));
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length > 256 * 1024)
        throw new Error("Invalid completion");
      const parsed = JSON.parse(content);
      const result = validateProject(parsed.project ?? parsed);
      // The provider cannot invent local audio IDs or alter imported recordings.
      result.audio = base.audio;
      return validateProject(result);
    } catch {
      throw new HttpError(
        502,
        "ИИ вернул некорректный проект. Попробуйте уточнить описание.",
      );
    }
  }

  async speech(input: { text?: unknown; voice?: unknown }): Promise<Buffer> {
    if (
      typeof input.text !== "string" ||
      !input.text.trim() ||
      input.text.length > 4096
    )
      throw new HttpError(
        400,
        "Текст озвучки должен содержать от 1 до 4096 символов.",
      );
    const voice = input.voice ?? "alloy";
    if (typeof voice !== "string" || !VOICES.includes(voice))
      throw new HttpError(400, "Выбран неподдерживаемый голос.");
    // OpenAI-compatible Speech API: https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
    return this.call(
      "tts",
      "audio/speech",
      { input: input.text.trim(), voice, response_format: "mp3" },
      AUDIO_LIMIT,
    );
  }
}
