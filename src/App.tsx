import { useEffect, useRef, useState } from "react";
import type {
  Actor,
  BackdropId,
  Character,
  Project,
  Scene,
  StyleId,
} from "./shared/model";
import {
  createCharacter,
  createScene,
  getDuration,
  makeId,
  PROJECT_LIMITS,
  sampleScene,
} from "./shared/project";
import { readProjectFile, saveProjectArchive } from "./shared/archive";
import { useProject } from "./ui/useProject";
import { download, errorText, filename, formatTime } from "./ui/api";
import { Icon } from "./components/Icon";
import { CanvasStage } from "./components/CanvasStage";
import { SceneThumb } from "./components/SceneThumb";
import { StoryDialog } from "./components/StoryDialog";
import { ExportDialog } from "./components/ExportDialog";
import { AudioPanel } from "./components/AudioPanel";
import { usePlayback } from "./ui/usePlayback";
const backdrops: Record<BackdropId, string> = {
  hills: "Холмы",
  coast: "Море",
  city: "Город",
  forest: "Лес",
  night: "Ночь",
};
const styles: Record<StyleId, string> = {
  watercolor: "Акварель",
  pencil: "Карандаш",
  pastel: "Пастель",
};
const actions = {
  idle: "Стоит",
  walk: "Идёт",
  wave: "Машет",
  jump: "Прыгает",
  ride: "Едет",
};
const moods = {
  happy: "Радуется",
  curious: "Интересуется",
  surprised: "Удивляется",
  calm: "Спокоен",
};
function Range({
  label,
  value,
  min,
  max,
  step = 0.01,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-field">
      <span>
        {label}
        <output>
          {Number(value.toFixed(2))}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
export default function App() {
  const {
    project,
    commit,
    replace,
    undo,
    redo,
    canUndo,
    canRedo,
    saveState,
    warning,
    setWarning,
  } = useProject();
  const [sceneId, setSceneId] = useState(project.scenes[0].id);
  const [actorId, setActorId] = useState("");
  const [tab, setTab] = useState<"scene" | "characters" | "audio">("scene");
  const [dialog, setDialog] = useState<"story" | "export" | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileMenu, setFileMenu] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const duration = getDuration(project);
  const { time, playing, seek, toggle, pause, audioDurations } = usePlayback(
    project,
    setMessage,
  );
  const scene =
    project.scenes.find((item) => item.id === sceneId) || project.scenes[0];
  const sceneIndex = project.scenes.indexOf(scene);
  const actor =
    scene.actors.find((item) => item.id === actorId) || scene.actors[0];
  const character =
    project.characters.find((item) => item.id === actor?.characterId) ||
    project.characters[0];
  const sample = sampleScene(project, time);
  const startAt = (index: number) =>
    project.scenes
      .slice(0, index)
      .reduce((sum, item) => sum + item.duration, 0);
  function safe(edit: (draft: Project) => void, key = "") {
    try {
      commit(edit, key);
    } catch (reason) {
      setMessage(errorText(reason));
    }
  }
  function editScene(patch: Partial<Scene>, key = "") {
    safe(
      (draft) => {
        Object.assign(
          draft.scenes.find((item) => item.id === scene.id)!,
          patch,
        );
      },
      key ? `${scene.id}:${key}` : "",
    );
  }
  function editActor(patch: Partial<Actor>, key = "") {
    if (actor)
      safe(
        (draft) => {
          Object.assign(
            draft.scenes
              .find((item) => item.id === scene.id)!
              .actors.find((item) => item.id === actor.id)!,
            patch,
          );
        },
        key ? `${actor.id}:${key}` : "",
      );
  }
  function editCharacter(patch: Partial<Character>, key = "") {
    safe(
      (draft) => {
        Object.assign(
          draft.characters.find((item) => item.id === character.id)!,
          patch,
        );
      },
      key ? `${character.id}:${key}` : "",
    );
  }
  function selectScene(index: number) {
    pause();
    setSceneId(project.scenes[index].id);
    setActorId("");
    seek(startAt(index));
  }
  function addScene() {
    const next = createScene(project);
    safe((draft) => {
      draft.scenes.push(next);
    });
    setSceneId(next.id);
    pause();
    seek(duration);
  }
  function duplicateScene() {
    const next = structuredClone(scene);
    next.id = makeId("scene");
    next.title = `${scene.title.slice(0, 68)} · копия`;
    next.actors.forEach((item) => {
      item.id = makeId("actor");
    });
    safe((draft) => {
      draft.scenes.splice(sceneIndex + 1, 0, next);
    });
    setSceneId(next.id);
    pause();
    seek(startAt(sceneIndex + 1));
  }
  function removeScene() {
    if (project.scenes.length === 1) return;
    const target = project.scenes[sceneIndex > 0 ? sceneIndex - 1 : 1];
    const nextTime = sceneIndex > 0 ? startAt(sceneIndex - 1) : 0;
    pause();
    safe((draft) => {
      draft.scenes.splice(sceneIndex, 1);
    });
    setSceneId(target.id);
    seek(nextTime);
  }
  function moveScene(direction: number) {
    const next = sceneIndex + direction;
    if (next < 0 || next >= project.scenes.length) return;
    const nextTime =
      direction < 0
        ? startAt(next)
        : startAt(sceneIndex) + project.scenes[next].duration;
    pause();
    safe((draft) => {
      const [item] = draft.scenes.splice(sceneIndex, 1);
      draft.scenes.splice(next, 0, item);
    });
    seek(nextTime);
  }
  async function saveFile(archive: boolean) {
    setFileMenu(false);
    setBusy(true);
    try {
      download(
        archive
          ? await saveProjectArchive(project)
          : new Blob([JSON.stringify(project, null, 2)], {
              type: "application/json",
            }),
        `${filename(project.title)}.${archive ? "cartoon" : "json"}`,
      );
    } catch (reason) {
      setMessage(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const next = await readProjectFile(file);
      pause();
      replace(next);
      setSceneId(next.scenes[0].id);
      seek(0);
      setMessage("Проект открыт.");
    } catch (reason) {
      setMessage(errorText(reason));
    } finally {
      setBusy(false);
      if (importInput.current) importInput.current.value = "";
    }
  }
  useEffect(() => {
    if (playing) setSceneId(sample.scene.id);
  }, [playing, sample.scene.id]);
  useEffect(() => {
    if (playing) return;
    const selected =
      project.scenes.find((item) => item.id === sceneId) ||
      sampleScene(project, time).scene;
    if (selected.id !== sceneId) setSceneId(selected.id);
    const index = project.scenes.indexOf(selected);
    const start = project.scenes
      .slice(0, index)
      .reduce((sum, item) => sum + item.duration, 0);
    const end = start + selected.duration;
    if (
      time < start ||
      (time >= end &&
        !(index === project.scenes.length - 1 && time === duration))
    )
      seek(start);
  }, [project, sceneId, playing, time, duration, seek]);
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 6500);
    return () => clearTimeout(timeout);
  }, [message]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest('input,textarea,select,[contenteditable="true"]') ||
        dialog
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "y"
      ) {
        event.preventDefault();
        redo();
      } else if (event.code === "Space" && target.tagName !== "BUTTON") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [dialog, redo, toggle, undo]);
  return (
    <div className="studio-shell">
      <header className="studio-header">
        <a className="wordmark" href="#studio" aria-label="Cartoon Studio">
          <span className="brand-icon">
            <Icon name="film" size={21} />
          </span>
          <span>
            cartoon<span className="wordmark-light"> studio</span>
          </span>
        </a>
        <div className="project-heading">
          <input
            aria-label="Название проекта"
            value={project.title}
            maxLength={80}
            onChange={(event) => {
              if (event.target.value.trim())
                safe((draft) => {
                  draft.title = event.target.value;
                }, "project-title");
            }}
          />
          <span className={`save-status ${saveState}`} role="status">
            {saveState === "saved"
              ? "Сохранено на устройстве"
              : saveState === "saving"
                ? "Сохраняем…"
                : "Не удалось сохранить"}
          </span>
        </div>
        <div className="header-actions">
          <div className="history-actions">
            <button
              className="icon-button"
              onClick={undo}
              disabled={!canUndo}
              title="Отменить · ⌘Z"
              aria-label="Отменить"
            >
              <Icon name="undo" />
            </button>
            <button
              className="icon-button"
              onClick={redo}
              disabled={!canRedo}
              title="Повторить · ⇧⌘Z"
              aria-label="Повторить"
            >
              <Icon name="redo" />
            </button>
          </div>
          <div className="file-actions">
            <button
              className="button quiet"
              aria-expanded={fileMenu}
              onClick={() => setFileMenu(!fileMenu)}
              disabled={busy}
            >
              <Icon name="folder" />
              <span>Проект</span>
            </button>
            {fileMenu && (
              <>
                <button
                  className="menu-backdrop"
                  aria-label="Закрыть меню проекта"
                  onClick={() => setFileMenu(false)}
                />
                <div className="file-menu">
                  <button
                    onClick={() => {
                      setFileMenu(false);
                      importInput.current?.click();
                    }}
                  >
                    <Icon name="upload" />
                    Открыть проект
                  </button>
                  <button onClick={() => void saveFile(true)}>
                    <Icon name="download" />
                    Сохранить .cartoon
                  </button>
                  <button onClick={() => void saveFile(false)}>
                    <Icon name="download" />
                    Сохранить JSON
                  </button>
                  <p>
                    {project.audio.length
                      ? "Файл .cartoon включает звук. JSON хранит только ссылки на звук."
                      : "Файл .cartoon можно открыть здесь позже."}
                  </p>
                </div>
              </>
            )}
          </div>
          <button
            className="button quiet story-button"
            onClick={() => {
              pause();
              setDialog("story");
            }}
          >
            <Icon name="spark" />
            <span>Новая история</span>
          </button>
          <button
            className="button primary"
            onClick={() => {
              pause();
              setDialog("export");
            }}
          >
            <Icon name="download" />
            <span>Скачать видео</span>
          </button>
        </div>
      </header>
      <input
        ref={importInput}
        aria-label="Открыть файл проекта"
        type="file"
        accept=".cartoon,.json,application/json,application/zip"
        hidden
        onChange={(event) => void importFile(event.target.files?.[0])}
      />
      {(warning || saveState === "error") && (
        <div className="warning-banner" role="alert">
          <span>
            {warning ||
              "Автосохранение недоступно. Сохраните проект через меню «Проект»."}
          </span>
          {warning && (
            <button
              className="icon-button"
              onClick={() => setWarning(null)}
              aria-label="Закрыть предупреждение"
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      )}
      <main id="studio" className="workspace">
        <aside className="scenes-panel" aria-label="Сцены">
          <div className="panel-heading">
            <h2>
              Сцены{" "}
              <span>{project.scenes.length.toString().padStart(2, "0")}</span>
            </h2>
            <button
              className="icon-button"
              onClick={addScene}
              disabled={
                project.scenes.length >= PROJECT_LIMITS.scenes || duration > 114
              }
              aria-label="Добавить сцену"
              title="Добавить сцену"
            >
              <Icon name="plus" />
            </button>
          </div>
          <div className="scene-list">
            {project.scenes.map((item, index) => (
              <button
                key={item.id}
                className={`scene-card ${item.id === scene.id ? "selected" : ""}`}
                aria-current={item.id === scene.id ? "true" : undefined}
                onClick={() => selectScene(index)}
              >
                <div className="scene-preview">
                  <SceneThumb project={project} scene={item} />
                  <span className="scene-number">
                    {(index + 1).toString().padStart(2, "0")}
                  </span>
                  <span className="scene-duration">{item.duration} с</span>
                </div>
                <div className="scene-card-title">{item.title}</div>
                <div className="scene-card-meta">
                  {backdrops[item.backdrop]}
                  <span>{item.actors.length} героя</span>
                </div>
              </button>
            ))}
          </div>
          <button
            className="add-scene"
            onClick={addScene}
            disabled={
              project.scenes.length >= PROJECT_LIMITS.scenes || duration > 114
            }
          >
            <Icon name="plus" size={16} />
            Добавить сцену
          </button>
          <div className="scenes-footer">
            <span className="little-dot" />
            {formatTime(duration)} истории<span>{project.fps} кадров/с</span>
          </div>
        </aside>
        <section className="editor-center" aria-label="Мультфильм">
          <div className="canvas-toolbar">
            <div className="style-picker">
              <span>Рисунок</span>
              <select
                aria-label="Стиль рисунка"
                value={project.style}
                onChange={(event) =>
                  safe((draft) => {
                    draft.style = event.target.value as StyleId;
                  })
                }
              >
                {Object.entries(styles).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="format-picker">
              <select
                aria-label="Формат кадра"
                value={
                  project.width === project.height
                    ? "square"
                    : project.width > project.height
                      ? "wide"
                      : "portrait"
                }
                onChange={(event) =>
                  safe((draft) => {
                    const sizes =
                      event.target.value === "square"
                        ? [1080, 1080]
                        : event.target.value === "portrait"
                          ? [720, 1280]
                          : [1280, 720];
                    [draft.width, draft.height] = sizes;
                  })
                }
              >
                <option value="wide">16:9 · Альбомный</option>
                <option value="portrait">9:16 · Вертикальный</option>
                <option value="square">1:1 · Квадратный</option>
              </select>
              <span className="canvas-dimensions">
                {project.width} × {project.height}
              </span>
            </div>
          </div>
          <div className="stage-area">
            <div className="stage-inner">
              <CanvasStage project={project} time={time} />
            </div>
            <div className="stage-caption">
              <span>
                Сцена {(sample.index + 1).toString().padStart(2, "0")}
              </span>
              <span>{sample.scene.title}</span>
              <span>{styles[project.style]}</span>
            </div>
          </div>
          <div className="transport">
            <div className="transport-left">
              <button
                className="icon-button"
                onClick={() => {
                  pause();
                  seek(0);
                  setSceneId(project.scenes[0].id);
                }}
                aria-label="В начало"
                title="В начало"
              >
                <Icon name="reset" size={17} />
              </button>
              <button
                className="play-button"
                onClick={toggle}
                aria-label={playing ? "Пауза" : "Воспроизвести"}
                title="Пробел"
              >
                <Icon name={playing ? "pause" : "play"} size={17} />
              </button>
              <span className="timecode">
                <strong>{formatTime(time)}</strong>
                <span>/ {formatTime(duration)}</span>
              </span>
            </div>
            <span className="transport-hint">Ваша история оживает</span>
            <label className="fps-select">
              <select
                aria-label="Частота кадров"
                value={project.fps}
                onChange={(event) =>
                  safe((draft) => {
                    draft.fps = Number(event.target.value);
                  })
                }
              >
                <option value="12">12 кадров/с</option>
                <option value="24">24 кадра/с</option>
                <option value="30">30 кадров/с</option>
              </select>
            </label>
          </div>
          <section
            className={`timeline ${project.audio.length ? "has-audio" : ""}`}
            aria-label="Монтаж"
          >
            <div className="timeline-heading">
              <h2>Монтаж</h2>
              <span>Перетащите указатель, чтобы выбрать момент</span>
              <span>
                {project.scenes.length} сцены · {duration} с
              </span>
            </div>
            <div className="timeline-ruler">
              <span>00:00</span>
              <span>{formatTime(duration / 4)}</span>
              <span>{formatTime(duration / 2)}</span>
              <span>{formatTime(duration * 0.75)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <div className="timeline-tracks">
              <div className="scene-track">
                {project.scenes.map((item, index) => (
                  <button
                    key={item.id}
                    style={{ flex: item.duration }}
                    className={`timeline-scene ${scene.id === item.id ? "selected" : ""}`}
                    onClick={() => selectScene(index)}
                    aria-label={`Сцена ${index + 1}: ${item.title}`}
                  >
                    <SceneThumb project={project} scene={item} />
                    <span>
                      {(index + 1).toString().padStart(2, "0")}{" "}
                      <b>{item.title}</b>
                    </span>
                  </button>
                ))}
              </div>
              <div
                className={`audio-track ${project.audio.length ? "filled" : ""}`}
              >
                {project.audio.length ? (
                  project.audio.map((track) => {
                    const available = Math.max(
                      0,
                      (audioDurations[track.assetId] ?? duration) -
                        track.trimStart,
                    );
                    const remaining = Math.max(0, duration - track.start);
                    const length = track.loop
                      ? remaining
                      : Math.min(remaining, available);
                    return (
                      <div className="audio-lane" key={track.id}>
                        <button
                          className="audio-clip"
                          onClick={() => setTab("audio")}
                          style={{
                            left: `${(Math.min(duration, track.start) / duration) * 100}%`,
                            width: `${(length / duration) * 100}%`,
                          }}
                          title={`${track.name} · ${track.start}–${Number((track.start + length).toFixed(1))} с`}
                          aria-label={`Настроить звук ${track.name}`}
                        >
                          <Icon name="music" size={13} />
                          {track.name}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <button
                    className="audio-empty"
                    onClick={() => setTab("audio")}
                  >
                    <Icon name="music" size={14} />
                    Добавьте музыку или голос
                  </button>
                )}
              </div>
              <div
                className="playhead"
                style={{ left: `${(time / duration) * 100}%` }}
                aria-hidden="true"
              >
                <span />
              </div>
            </div>
            <input
              className="timeline-scrubber"
              type="range"
              min="0"
              max={duration}
              step={1 / project.fps}
              value={time}
              aria-label="Позиция воспроизведения"
              onChange={(event) => {
                pause();
                const position = Number(event.target.value);
                seek(position);
                setSceneId(sampleScene(project, position).scene.id);
              }}
            />
          </section>
        </section>
        <aside className="inspector" aria-label="Настройки">
          <div
            className="inspector-tabs"
            role="tablist"
            aria-label="Настройки проекта"
            onKeyDown={(event) => {
              const tabs = ["scene", "characters", "audio"] as const;
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 2
                    : (tabs.indexOf(tab) +
                        (event.key === "ArrowRight" ? 1 : 2)) %
                      3;
              setTab(tabs[next]);
              document.getElementById(`tab-${tabs[next]}`)?.focus();
            }}
          >
            {(
              [
                ["scene", "Сцена", "sliders"],
                ["characters", "Герои", "person"],
                ["audio", "Звук", "music"],
              ] as const
            ).map(([value, label, icon]) => (
              <button
                key={value}
                role="tab"
                tabIndex={tab === value ? 0 : -1}
                aria-selected={tab === value}
                aria-controls={`panel-${value}`}
                id={`tab-${value}`}
                onClick={() => setTab(value)}
              >
                <Icon name={icon} size={16} />
                {label}
              </button>
            ))}
          </div>
          <div
            className="inspector-content"
            id={`panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
          >
            {tab === "scene" && (
              <>
                <div className="inspector-title">
                  <span className="eyebrow">
                    СЦЕНА {(sceneIndex + 1).toString().padStart(2, "0")}
                  </span>
                  <div>
                    <button
                      className="icon-button"
                      title="Поднять сцену"
                      aria-label="Поднять сцену"
                      onClick={() => moveScene(-1)}
                      disabled={!sceneIndex}
                    >
                      <Icon name="up" size={16} />
                    </button>
                    <button
                      className="icon-button"
                      title="Опустить сцену"
                      aria-label="Опустить сцену"
                      onClick={() => moveScene(1)}
                      disabled={sceneIndex === project.scenes.length - 1}
                    >
                      <Icon name="down" size={16} />
                    </button>
                    <button
                      className="icon-button"
                      title="Дублировать сцену"
                      aria-label="Дублировать сцену"
                      onClick={duplicateScene}
                      disabled={
                        duration + scene.duration > 120 ||
                        project.scenes.length >= 24
                      }
                    >
                      <Icon name="copy" size={15} />
                    </button>
                    <button
                      className="icon-button danger"
                      title="Удалить сцену"
                      aria-label="Удалить сцену"
                      onClick={removeScene}
                      disabled={project.scenes.length === 1}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
                <label className="field">
                  Название сцены
                  <input
                    value={scene.title}
                    maxLength={80}
                    onChange={(event) => {
                      if (event.target.value.trim())
                        editScene({ title: event.target.value }, "scene-title");
                    }}
                  />
                </label>
                <Range
                  label="Длительность"
                  value={scene.duration}
                  min={1}
                  max={Math.min(30, 120 - duration + scene.duration)}
                  step={0.5}
                  suffix=" с"
                  onChange={(value) =>
                    editScene({ duration: value }, "duration")
                  }
                />
                <div className="inspector-section">
                  <h3>Место действия</h3>
                  <div className="backdrop-options">
                    {Object.entries(backdrops).map(([value, label]) => (
                      <button
                        key={value}
                        className={scene.backdrop === value ? "selected" : ""}
                        onClick={() =>
                          editScene({ backdrop: value as BackdropId })
                        }
                        aria-pressed={scene.backdrop === value}
                      >
                        <span className={`backdrop-dot ${value}`} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="inspector-section">
                  <h3>Текст в кадре</h3>
                  <label className="field">
                    <span className="sr-only">Подпись сцены</span>
                    <textarea
                      aria-label="Подпись сцены"
                      value={scene.caption}
                      maxLength={200}
                      rows={3}
                      placeholder="О чём эта сцена?"
                      onChange={(event) =>
                        editScene({ caption: event.target.value }, "caption")
                      }
                    />
                    <span className="field-note">
                      {scene.caption.length}/200
                    </span>
                  </label>
                </div>
                <div className="inspector-section">
                  <h3>
                    Камера
                    <button
                      className="text-button"
                      onClick={() =>
                        editScene({ camera: { zoom: 1, panX: 0, panY: 0 } })
                      }
                    >
                      Сбросить
                    </button>
                  </h3>
                  <Range
                    label="Приближение"
                    value={scene.camera.zoom}
                    min={0.6}
                    max={2}
                    suffix="×"
                    onChange={(value) =>
                      editScene(
                        { camera: { ...scene.camera, zoom: value } },
                        "zoom",
                      )
                    }
                  />
                  <Range
                    label="По горизонтали"
                    value={scene.camera.panX}
                    min={-0.5}
                    max={0.5}
                    onChange={(value) =>
                      editScene(
                        { camera: { ...scene.camera, panX: value } },
                        "panX",
                      )
                    }
                  />
                  <Range
                    label="По вертикали"
                    value={scene.camera.panY}
                    min={-0.5}
                    max={0.5}
                    onChange={(value) =>
                      editScene(
                        { camera: { ...scene.camera, panY: value } },
                        "panY",
                      )
                    }
                  />
                </div>
                <label className="field inspector-section">
                  Переход
                  <select
                    value={scene.transition}
                    onChange={(event) =>
                      editScene({
                        transition: event.target.value as Scene["transition"],
                      })
                    }
                  >
                    <option value="cut">Сразу</option>
                    <option value="fade">Плавно</option>
                    <option value="paint">Мазок кисти</option>
                  </select>
                </label>
              </>
            )}
            {tab === "characters" && (
              <>
                <div className="inspector-title">
                  <span className="eyebrow">ГЕРОИ В СЦЕНЕ</span>
                  <button
                    className="icon-button"
                    title="Добавить героя"
                    aria-label="Добавить героя"
                    disabled={scene.actors.length >= 8}
                    onClick={() => {
                      const next: Actor = {
                        id: makeId("actor"),
                        characterId: project.characters[0].id,
                        x: 0.5,
                        endX: 0.5,
                        y: 0.84,
                        scale: 1,
                        flip: false,
                        action: "idle",
                        mood: "happy",
                      };
                      editScene({ actors: [...scene.actors, next] });
                      setActorId(next.id);
                    }}
                  >
                    <Icon name="plus" size={16} />
                  </button>
                </div>
                <div className="actor-list">
                  {scene.actors.map((item) => {
                    const design = project.characters.find(
                      (c) => c.id === item.characterId,
                    )!;
                    return (
                      <button
                        key={item.id}
                        className={actor?.id === item.id ? "selected" : ""}
                        onClick={() => setActorId(item.id)}
                      >
                        <span
                          className="character-avatar"
                          style={{ background: design.outfit }}
                        >
                          <span
                            style={{
                              background: design.skin,
                              boxShadow: `0 -4px 0 ${design.hair}`,
                            }}
                          />
                        </span>
                        <span>{design.name}</span>
                      </button>
                    );
                  })}
                </div>
                {!actor ? (
                  <div className="empty-state">
                    <Icon name="person" size={28} />
                    <p>В этой сцене пока нет героев.</p>
                    <span>Добавьте героя кнопкой «+».</span>
                  </div>
                ) : (
                  <>
                    <label className="field">
                      Персонаж
                      <select
                        value={actor.characterId}
                        onChange={(event) =>
                          editActor({ characterId: event.target.value })
                        }
                      >
                        {project.characters.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="form-row">
                      <label className="field">
                        Действие
                        <select
                          value={actor.action}
                          onChange={(event) =>
                            editActor({
                              action: event.target.value as Actor["action"],
                            })
                          }
                        >
                          {Object.entries(actions).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Настроение
                        <select
                          value={actor.mood}
                          onChange={(event) =>
                            editActor({
                              mood: event.target.value as Actor["mood"],
                            })
                          }
                        >
                          {Object.entries(moods).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="inspector-section">
                      <h3>Положение</h3>
                      <Range
                        label="Начало пути"
                        value={actor.x}
                        min={0}
                        max={1}
                        onChange={(value) => editActor({ x: value }, "actor-x")}
                      />
                      <Range
                        label="Конец пути"
                        value={actor.endX}
                        min={0}
                        max={1}
                        onChange={(value) =>
                          editActor({ endX: value }, "actor-end")
                        }
                      />
                      <Range
                        label="Высота"
                        value={actor.y}
                        min={0.25}
                        max={1}
                        onChange={(value) => editActor({ y: value }, "actor-y")}
                      />
                      <Range
                        label="Размер"
                        value={actor.scale}
                        min={0.4}
                        max={1.8}
                        suffix="×"
                        onChange={(value) =>
                          editActor({ scale: value }, "actor-scale")
                        }
                      />
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={actor.flip}
                          onChange={(event) =>
                            editActor({ flip: event.target.checked })
                          }
                        />
                        Смотреть в другую сторону
                      </label>
                    </div>
                    <div className="inspector-section">
                      <h3>
                        Внешность <span>во всех сценах</span>
                      </h3>
                      <label className="field">
                        Имя
                        <input
                          value={character.name}
                          maxLength={48}
                          onChange={(event) => {
                            if (event.target.value.trim())
                              editCharacter(
                                { name: event.target.value },
                                "character-name",
                              );
                          }}
                        />
                      </label>
                      <label className="field">
                        Причёска
                        <select
                          value={character.hairStyle}
                          onChange={(event) =>
                            editCharacter({
                              hairStyle: event.target
                                .value as Character["hairStyle"],
                            })
                          }
                        >
                          <option value="short">Короткая</option>
                          <option value="bob">Каре</option>
                          <option value="long">Длинная</option>
                        </select>
                      </label>
                      <div className="color-fields">
                        {(
                          [
                            ["skin", "Кожа"],
                            ["hair", "Волосы"],
                            ["outfit", "Одежда"],
                            ["accent", "Детали"],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key}>
                            <input
                              type="color"
                              aria-label={label}
                              value={character[key]}
                              onChange={(event) =>
                                editCharacter(
                                  { [key]: event.target.value },
                                  `color-${key}`,
                                )
                              }
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <button
                      className="button subtle danger full-width"
                      onClick={() =>
                        editScene({
                          actors: scene.actors.filter(
                            (item) => item.id !== actor.id,
                          ),
                        })
                      }
                    >
                      <Icon name="trash" size={15} />
                      Убрать из сцены
                    </button>
                  </>
                )}
                <button
                  className="button subtle full-width new-character"
                  disabled={
                    project.characters.length >= 8 || scene.actors.length >= 8
                  }
                  onClick={() => {
                    const design = createCharacter();
                    const next: Actor = {
                      id: makeId("actor"),
                      characterId: design.id,
                      x: 0.5,
                      endX: 0.5,
                      y: 0.84,
                      scale: 1,
                      flip: false,
                      action: "idle",
                      mood: "happy",
                    };
                    safe((draft) => {
                      draft.characters.push(design);
                      draft.scenes
                        .find((item) => item.id === scene.id)!
                        .actors.push(next);
                    });
                    setActorId(next.id);
                  }}
                >
                  <Icon name="plus" size={16} />
                  Создать персонажа
                </button>
              </>
            )}
            {tab === "audio" && (
              <AudioPanel
                project={project}
                commit={safe}
                onError={setMessage}
              />
            )}
          </div>
        </aside>
      </main>
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button
            className="icon-button"
            onClick={() => setMessage("")}
            aria-label="Закрыть сообщение"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-badge" role="status">
          <span className="spinner" />
          Работаем с проектом…
        </div>
      )}
      {dialog === "story" && (
        <StoryDialog
          project={project}
          onClose={() => setDialog(null)}
          onCreate={(next) => {
            replace(next);
            setSceneId(next.scenes[0].id);
            seek(0);
            setDialog(null);
          }}
        />
      )}
      {dialog === "export" && (
        <ExportDialog project={project} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
