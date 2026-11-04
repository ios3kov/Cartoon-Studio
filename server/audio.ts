import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AudioAsset, Project } from "../src/shared/model.ts";
import { HttpError } from "./errors.ts";
import { captureCommand } from "./process.ts";

export const AUDIO_LIMIT = 30 * 1024 * 1024;
export const ID_PATTERN = /^(?:a|j)_[a-f0-9]{32}$/;
// Excludes playlists, concat and network-oriented demuxers. Inputs remain local files with generated names.
export const AUDIO_FORMATS = "mp3,wav,aac,ogg,flac,mov,matroska,webm,aiff,au";
export type AudioProbe = (
  file: string,
  signal?: AbortSignal,
) => Promise<{ duration: number; mime: string }>;
export interface StoredAudio extends AudioAsset {
  file: string;
  mime: string;
}

export function createAudioProbe(ffprobePath: string): AudioProbe {
  return async (file, signal) => {
    let metadata: {
      streams?: { codec_type?: string }[];
      format?: { duration?: string; format_name?: string };
    };
    try {
      metadata = JSON.parse(
        await captureCommand(
          ffprobePath,
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            AUDIO_FORMATS,
            "-show_entries",
            "format=duration,format_name:stream=codec_type",
            "-of",
            "json",
            "-i",
            file,
          ],
          { signal },
        ),
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 503) throw error;
      throw new HttpError(415, "Файл не содержит поддерживаемого аудио.");
    }
    const duration = Number(metadata.format?.duration);
    if (
      !metadata.streams?.some((stream) => stream.codec_type === "audio") ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 3600
    ) {
      throw new HttpError(
        415,
        "Нужно аудио длительностью от одной доли секунды до часа.",
      );
    }
    const format = metadata.format?.format_name ?? "";
    const mime = format.includes("mp3")
      ? "audio/mpeg"
      : format.includes("wav")
        ? "audio/wav"
        : format.includes("ogg")
          ? "audio/ogg"
          : format.includes("flac")
            ? "audio/flac"
            : format.includes("mov")
              ? "audio/mp4"
              : format.includes("matroska") || format.includes("webm")
                ? "audio/webm"
                : format.includes("aac")
                  ? "audio/aac"
                  : "application/octet-stream";
    return { duration, mime };
  };
}

export function safeFilename(input: string): string {
  return (
    (input.split(/[\\/]/).at(-1) ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 160) || "Аудио"
  );
}

export class AudioStore {
  readonly directory: string;
  constructor(
    dataDirectory: string,
    private probe: AudioProbe,
  ) {
    this.directory = join(dataDirectory, "audio");
  }
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async add(
    bytes: Buffer,
    name: string,
    signal?: AbortSignal,
  ): Promise<AudioAsset> {
    if (!bytes.length) throw new HttpError(400, "Аудиофайл пуст.");
    if (bytes.length > AUDIO_LIMIT)
      throw new HttpError(413, "Максимальный размер аудио — 30 МиБ.");
    const id = `a_${randomUUID().replaceAll("-", "")}`;
    const file = join(this.directory, `${id}.media`);
    const metadataFile = join(this.directory, `${id}.json`);
    try {
      await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
      const { duration, mime } = await this.probe(file, signal);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 3600)
        throw new HttpError(415, "Неверная длительность аудио.");
      const asset: AudioAsset = {
        id,
        name: safeFilename(name),
        duration,
        url: `/api/audio/${id}`,
      };
      await writeFile(
        `${metadataFile}.tmp`,
        JSON.stringify({ ...asset, mime }),
        { flag: "wx", mode: 0o600 },
      );
      await rename(`${metadataFile}.tmp`, metadataFile);
      return asset;
    } catch (error) {
      await Promise.all([
        rm(file, { force: true }),
        rm(metadataFile, { force: true }),
        rm(`${metadataFile}.tmp`, { force: true }),
      ]);
      throw error;
    }
  }

  async get(id: string): Promise<StoredAudio> {
    if (!/^a_[a-f0-9]{32}$/.test(id))
      throw new HttpError(404, "Аудиофайл не найден.");
    try {
      const bytes = await readFile(join(this.directory, `${id}.json`));
      if (bytes.length > 4096) throw new Error("Invalid metadata");
      const metadata = JSON.parse(bytes.toString("utf8"));
      if (
        metadata.id !== id ||
        typeof metadata.name !== "string" ||
        typeof metadata.mime !== "string" ||
        !/^(?:audio\/[a-z0-9.+-]+|application\/octet-stream)$/.test(
          metadata.mime,
        ) ||
        !Number.isFinite(metadata.duration) ||
        metadata.duration <= 0 ||
        metadata.duration > 3600
      )
        throw new Error("Invalid metadata");
      const file = join(this.directory, `${id}.media`);
      const info = await stat(file);
      if (!info.isFile() || info.size > AUDIO_LIMIT)
        throw new Error("Invalid media");
      return {
        id,
        name: safeFilename(metadata.name),
        duration: metadata.duration,
        url: `/api/audio/${id}`,
        mime: metadata.mime,
        file,
      };
    } catch {
      throw new HttpError(404, "Аудиофайл не найден. Импортируйте его заново.");
    }
  }

  async validateTracks(project: Project): Promise<void> {
    for (const track of project.audio) {
      const asset = await this.get(track.assetId);
      if (track.trimStart >= asset.duration)
        throw new HttpError(
          400,
          `Обрезка аудио «${asset.name}» выходит за длительность файла.`,
        );
    }
  }
}
