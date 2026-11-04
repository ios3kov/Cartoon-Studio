import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "../shared/model";
import { getDuration } from "../shared/project";
interface Player {
  audio: HTMLAudioElement;
  assetId: string;
  pending: boolean;
  failed: boolean;
}
export function usePlayback(
  project: Project,
  onError: (message: string) => void,
) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioDurations, setAudioDurations] = useState<Record<string, number>>(
    {},
  );
  const current = useRef({ project, time: 0, playing: false });
  current.current.project = project;
  const players = useRef(new Map<string, Player>());
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  const sync = useCallback((force = false) => {
    const state = current.current;
    for (const track of state.project.audio) {
      const player = players.current.get(track.id);
      if (!player || player.failed) continue;
      const audio = player.audio;
      audio.volume = Math.min(1, track.volume);
      const length = Number.isFinite(audio.duration)
        ? Math.max(0, audio.duration - track.trimStart)
        : Infinity;
      const elapsed = state.time - track.start;
      const active =
        state.playing &&
        elapsed >= 0 &&
        length > 0 &&
        (track.loop || elapsed < length);
      if (!active) {
        audio.pause();
        continue;
      }
      if (audio.readyState === 0) continue;
      const position =
        track.trimStart +
        (track.loop && Number.isFinite(length) ? elapsed % length : elapsed);
      if (
        force ||
        audio.paused ||
        audio.currentTime < track.trimStart ||
        Math.abs(audio.currentTime - position) > 0.18
      ) {
        try {
          audio.currentTime = position;
        } catch {
          /* Metadata is still arriving. */
        }
      }
      if (audio.paused && !player.pending) {
        player.pending = true;
        void audio
          .play()
          .catch((error) => {
            if (error instanceof DOMException && error.name === "AbortError")
              return;
            if (!player.failed)
              errorHandler.current(
                "Браузер не смог воспроизвести звук. Проверьте аудиофайл.",
              );
            player.failed = true;
          })
          .finally(() => {
            player.pending = false;
          });
      }
    }
  }, []);
  useEffect(() => {
    const tracks = new Set(project.audio.map((track) => track.id));
    for (const [id, player] of players.current) {
      const track = project.audio.find((item) => item.id === id);
      if (!tracks.has(id) || track?.assetId !== player.assetId) {
        player.audio.pause();
        player.audio.removeAttribute("src");
        player.audio.load();
        players.current.delete(id);
      }
    }
    for (const track of project.audio) {
      if (players.current.has(track.id)) continue;
      const audio = new Audio(
        `/api/audio/${encodeURIComponent(track.assetId)}`,
      );
      audio.preload = "auto";
      const player: Player = {
        audio,
        assetId: track.assetId,
        pending: false,
        failed: false,
      };
      audio.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(audio.duration))
          setAudioDurations((values) => ({
            ...values,
            [track.assetId]: audio.duration,
          }));
      });
      audio.addEventListener("error", () => {
        if (!player.failed)
          errorHandler.current(
            `Звук «${track.name}» недоступен. Загрузите файл заново.`,
          );
        player.failed = true;
      });
      players.current.set(track.id, player);
    }
    const duration = getDuration(project);
    if (current.current.time > duration) {
      current.current.time = duration;
      setTime(duration);
    }
    sync(true);
  }, [project, sync]);
  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const state = current.current;
      if (state.playing) {
        const duration = getDuration(state.project);
        state.time = Math.min(duration, state.time + (now - previous) / 1000);
        if (state.time >= duration) {
          state.playing = false;
          setPlaying(false);
        }
        setTime(state.time);
        sync();
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      for (const player of players.current.values()) {
        player.audio.pause();
        player.audio.removeAttribute("src");
        player.audio.load();
      }
      players.current.clear();
    };
  }, [sync]);
  const seek = useCallback(
    (value: number) => {
      const next = Math.max(
        0,
        Math.min(getDuration(current.current.project), value),
      );
      current.current.time = next;
      setTime(next);
      sync(true);
    },
    [sync],
  );
  const pause = useCallback(() => {
    current.current.playing = false;
    setPlaying(false);
    sync();
  }, [sync]);
  const toggle = useCallback(() => {
    const state = current.current;
    if (!state.playing && state.time >= getDuration(state.project)) {
      state.time = 0;
      setTime(0);
    }
    state.playing = !state.playing;
    setPlaying(state.playing);
    sync(true);
  }, [sync]);
  return { time, playing, seek, pause, toggle, audioDurations };
}
