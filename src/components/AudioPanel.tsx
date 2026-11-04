import { useEffect, useRef, useState } from "react";
import type { AudioAsset, AudioTrack, Health, Project } from "../shared/model";
import { getDuration, makeId } from "../shared/project";
import { errorText, formatTime, request } from "../ui/api";
import { Icon } from "./Icon";
export function AudioPanel({
  project,
  commit,
  onError,
}: {
  project: Project;
  commit: (edit: (draft: Project) => void, key?: string) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [speech, setSpeech] = useState("");
  const [durations, setDurations] = useState<Record<string, number>>({});
  const duration = getDuration(project);
  useEffect(() => {
    let active = true;
    void request<Health>("/api/health")
      .then((result) => {
        if (active) setHealth(result);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  function edit(id: string, patch: Partial<AudioTrack>, key = "") {
    commit((draft) => {
      Object.assign(draft.audio.find((track) => track.id === id)!, patch);
    }, key);
  }
  function add(asset: AudioAsset, kind: AudioTrack["kind"] = "music") {
    commit((draft) => {
      draft.audio.push({
        id: makeId("audio"),
        assetId: asset.id,
        name: asset.name.slice(0, 160),
        start: 0,
        trimStart: 0,
        volume: kind === "music" ? 0.5 : 1,
        loop: kind === "music",
        kind,
      });
    });
    setDurations((current) => ({ ...current, [asset.id]: asset.duration }));
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      onError("Выберите аудиофайл меньше 30 МБ.");
      return;
    }
    setBusy(true);
    try {
      const asset = await request<AudioAsset>("/api/audio", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "audio/mpeg",
          "X-Filename": encodeURIComponent(file.name),
        },
        body: file,
      });
      add(asset);
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function narrate() {
    if (!speech.trim()) return;
    setBusy(true);
    try {
      const asset = await request<AudioAsset>("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: speech }),
      });
      add(asset, "voice");
      setSpeech("");
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="inspector-title">
        <span className="eyebrow">МУЗЫКА И ГОЛОС</span>
        <span className="eyebrow">{project.audio.length}/12</span>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      <button
        className="audio-upload"
        disabled={busy || project.audio.length >= 12}
        onClick={() => input.current?.click()}
      >
        {busy ? <span className="spinner" /> : <Icon name="upload" size={21} />}
        {busy ? "Добавляем звук…" : "Загрузить аудиофайл"}
        <span>MP3, WAV, M4A · до 30 МБ</span>
      </button>
      {!project.audio.length && (
        <p className="audio-track-note">
          Добавьте музыку, голос или звуки. Дорожки будут звучать вместе с
          мультфильмом.
        </p>
      )}
      {project.audio.map((track) => (
        <section className="audio-item" key={track.id}>
          <div className="audio-item-header">
            <Icon
              name={track.kind === "music" ? "music" : "volume"}
              size={15}
            />
            <strong title={track.name}>{track.name}</strong>
            <button
              className="icon-button danger"
              aria-label={`Удалить звук ${track.name}`}
              title="Удалить звук"
              onClick={() =>
                commit((draft) => {
                  draft.audio = draft.audio.filter(
                    (item) => item.id !== track.id,
                  );
                })
              }
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
          <audio
            controls
            preload="metadata"
            src={`/api/audio/${encodeURIComponent(track.assetId)}`}
            onLoadedMetadata={(event) => {
              const length = event.currentTarget.duration;
              if (Number.isFinite(length))
                setDurations((current) => ({
                  ...current,
                  [track.assetId]: length,
                }));
            }}
            aria-label={`Прослушать ${track.name}`}
          />
          <label className="field">
            Тип звука
            <select
              value={track.kind}
              onChange={(event) =>
                edit(track.id, {
                  kind: event.target.value as AudioTrack["kind"],
                })
              }
            >
              <option value="music">Музыка</option>
              <option value="voice">Голос</option>
              <option value="effect">Звуковой эффект</option>
            </select>
          </label>
          <div className="form-row">
            <label className="field">
              Начало в видео, с
              <input
                type="number"
                min={0}
                max={duration}
                step={0.1}
                value={track.start}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value))
                    edit(
                      track.id,
                      { start: Math.max(0, Math.min(duration, value)) },
                      `audio-start-${track.id}`,
                    );
                }}
              />
            </label>
            <label className="field">
              Обрезать начало, с
              <input
                type="number"
                min={0}
                max={
                  durations[track.assetId]
                    ? Math.max(0, durations[track.assetId] - 0.1)
                    : 3600
                }
                step={0.1}
                value={track.trimStart}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  const limit = durations[track.assetId]
                    ? Math.max(0, durations[track.assetId] - 0.1)
                    : 3600;
                  if (Number.isFinite(value))
                    edit(
                      track.id,
                      { trimStart: Math.max(0, Math.min(limit, value)) },
                      `audio-trim-${track.id}`,
                    );
                }}
              />
            </label>
          </div>
          <label className="range-field">
            <span>
              Громкость<output>{Math.round(track.volume * 100)}%</output>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={track.volume}
              onChange={(event) =>
                edit(
                  track.id,
                  { volume: Number(event.target.value) },
                  `audio-volume-${track.id}`,
                )
              }
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={track.loop}
              onChange={(event) =>
                edit(track.id, { loop: event.target.checked })
              }
            />
            Повторять до конца видео
          </label>
          {durations[track.assetId] && (
            <p className="audio-kind">
              Исходная запись: {formatTime(durations[track.assetId])}
            </p>
          )}
        </section>
      ))}
      <div className="inspector-section">
        <h3>Голос рассказчика</h3>
        {health?.ttsConfigured ? (
          <>
            <label className="field">
              <span className="sr-only">Текст озвучки</span>
              <textarea
                aria-label="Текст озвучки"
                value={speech}
                maxLength={2000}
                placeholder="Что скажет рассказчик?"
                onChange={(event) => setSpeech(event.target.value)}
                rows={4}
              />
            </label>
            <button
              className="button subtle full-width"
              disabled={busy || !speech.trim() || project.audio.length >= 12}
              onClick={() => void narrate()}
            >
              <Icon name="volume" size={16} />
              Озвучить текст
            </button>
          </>
        ) : (
          <p className="audio-track-note">
            Загрузите запись голоса. Для синтеза речи подключите сервис озвучки
            на сервере.
          </p>
        )}
      </div>
    </>
  );
}
