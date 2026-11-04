import {
  ACTION_IDS,
  BACKDROP_IDS,
  MOOD_IDS,
  STYLE_IDS,
  type Actor,
  type AudioTrack,
  type Character,
  type Project,
  type Scene,
  type SceneSample,
} from "./model.ts";

export const PROJECT_LIMITS = Object.freeze({
  scenes: 24,
  characters: 8,
  actors: 8,
  audio: 12,
  seconds: 120,
});

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

type RecordValue = Record<string, unknown>;
function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProjectValidationError(`${label}: нужен объект.`);
  return value as RecordValue;
}
function text(
  value: unknown,
  label: string,
  max: number,
  empty = true,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim())
  ) {
    throw new ProjectValidationError(
      `${label}: допустимо ${empty ? "0" : "1"}–${max} символов.`,
    );
  }
  return value;
}
function number(
  value: unknown,
  label: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw new ProjectValidationError(
      `${label}: допустимо число от ${min} до ${max}.`,
    );
  }
  return value;
}
function choice<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T))
    throw new ProjectValidationError(`${label}: неизвестное значение.`);
  return value as T;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean")
    throw new ProjectValidationError(`${label}: нужно логическое значение.`);
  return value;
}
function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value))
    throw new ProjectValidationError(`${label}: неверный идентификатор.`);
  return value;
}
function color(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value))
    throw new ProjectValidationError(`${label}: нужен цвет #RRGGBB.`);
  return value.toLowerCase();
}
function list(
  value: unknown,
  label: string,
  min: number,
  max: number,
): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new ProjectValidationError(
      `${label}: допустимо от ${min} до ${max}.`,
    );
  return value;
}
function unique(items: { id: string }[], label: string): void {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new ProjectValidationError(`${label}: идентификаторы повторяются.`);
}

/** Rebuild the data model. Unknown properties never reach a renderer or provider. */
export function validateProject(input: unknown): Project {
  const p = object(input, "Проект");
  if (p.version !== 1)
    throw new ProjectValidationError(
      "Эта версия проекта не поддерживается. Нужна версия 1.",
    );
  const characters: Character[] = list(
    p.characters,
    "Персонажи",
    1,
    PROJECT_LIMITS.characters,
  ).map((item, index) => {
    const c = object(item, `Персонаж ${index + 1}`);
    return {
      id: id(c.id, "Персонаж"),
      name: text(c.name, "Имя", 48, false),
      skin: color(c.skin, "Цвет кожи"),
      hair: color(c.hair, "Цвет волос"),
      hairStyle: choice(c.hairStyle, ["short", "bob", "long"], "Причёска"),
      outfit: color(c.outfit, "Цвет одежды"),
      accent: color(c.accent, "Цвет детали"),
    };
  });
  unique(characters, "Персонажи");
  const characterIds = new Set(characters.map((c) => c.id));
  const scenes: Scene[] = list(p.scenes, "Сцены", 1, PROJECT_LIMITS.scenes).map(
    (item, index) => {
      const s = object(item, `Сцена ${index + 1}`);
      const camera = object(s.camera, "Камера");
      const actors: Actor[] = list(
        s.actors,
        "Персонажи в сцене",
        0,
        PROJECT_LIMITS.actors,
      ).map((item) => {
        const a = object(item, "Персонаж в сцене");
        const characterId = id(a.characterId, "Связь персонажа");
        if (!characterIds.has(characterId))
          throw new ProjectValidationError(
            "Сцена ссылается на отсутствующего персонажа.",
          );
        return {
          id: id(a.id, "Персонаж в сцене"),
          characterId,
          x: number(a.x, "Позиция X", 0, 1),
          y: number(a.y, "Позиция Y", 0.25, 1),
          endX: number(a.endX, "Конечная позиция", 0, 1),
          scale: number(a.scale, "Размер персонажа", 0.4, 1.8),
          flip: boolean(a.flip, "Отражение"),
          action: choice(a.action, ACTION_IDS, "Действие"),
          mood: choice(a.mood, MOOD_IDS, "Выражение лица"),
        };
      });
      unique(actors, "Персонажи в сцене");
      return {
        id: id(s.id, "Сцена"),
        title: text(s.title, "Название сцены", 80, false),
        duration: number(s.duration, "Длительность сцены", 1, 30),
        backdrop: choice(s.backdrop, BACKDROP_IDS, "Место"),
        caption: text(s.caption, "Текст сцены", 200),
        camera: {
          zoom: number(camera.zoom, "Масштаб камеры", 0.6, 2),
          panX: number(camera.panX, "Сдвиг камеры X", -0.5, 0.5),
          panY: number(camera.panY, "Сдвиг камеры Y", -0.5, 0.5),
        },
        actors,
        transition: choice(s.transition, ["cut", "fade", "paint"], "Переход"),
      };
    },
  );
  unique(scenes, "Сцены");
  const duration = scenes.reduce((total, scene) => total + scene.duration, 0);
  if (duration > PROJECT_LIMITS.seconds)
    throw new ProjectValidationError(
      `Проект не должен длиться больше ${PROJECT_LIMITS.seconds} секунд.`,
    );
  const audio: AudioTrack[] = list(
    p.audio,
    "Аудиодорожки",
    0,
    PROJECT_LIMITS.audio,
  ).map((item) => {
    const a = object(item, "Аудиодорожка");
    return {
      id: id(a.id, "Аудиодорожка"),
      assetId: id(a.assetId, "Аудиофайл"),
      name: text(a.name, "Имя аудиофайла", 160, false),
      start: number(a.start, "Начало звука", 0, PROJECT_LIMITS.seconds),
      trimStart: number(a.trimStart, "Обрезка звука", 0, 3600),
      volume: number(a.volume, "Громкость", 0, 1),
      loop: boolean(a.loop, "Повтор звука"),
      kind: choice(a.kind, ["music", "voice", "effect"], "Тип звука"),
    };
  });
  unique(audio, "Аудиодорожки");
  const width = number(p.width, "Ширина", 240, 1920, true);
  const height = number(p.height, "Высота", 240, 1920, true);
  if (width % 2 || height % 2 || width * height > 2_073_600)
    throw new ProjectValidationError(
      "Размер кадра должен быть чётным и не превышать 1920 × 1080 пикселей по площади.",
    );
  const fps = number(p.fps, "Частота кадров", 12, 30, true);
  if (![12, 24, 30].includes(fps))
    throw new ProjectValidationError(
      "Выберите 12, 24 или 30 кадров в секунду.",
    );
  return {
    version: 1,
    id: id(p.id, "Проект"),
    title: text(p.title, "Название проекта", 80, false),
    description: text(p.description, "Описание", 2000),
    seed: number(p.seed, "Номер варианта", 0, 2_147_483_647, true),
    width,
    height,
    fps,
    style: choice(p.style, STYLE_IDS, "Стиль"),
    characters,
    scenes,
    audio,
  };
}

export function makeId(prefix = "id"): string {
  const safe = prefix.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 20) || "id";
  return `${safe}_${globalThis.crypto.randomUUID()}`;
}
export function cloneProject(project: Project): Project {
  return structuredClone(project);
}
export function getDuration(project: Project): number {
  return project.scenes.reduce((sum, scene) => sum + scene.duration, 0);
}
export function sampleScene(project: Project, time: number): SceneSample {
  const duration = getDuration(project);
  const safeTime = Math.max(
    0,
    Math.min(duration, Number.isFinite(time) ? time : 0),
  );
  let start = 0;
  for (let index = 0; index < project.scenes.length; index++) {
    const scene = project.scenes[index];
    if (
      safeTime < start + scene.duration ||
      index === project.scenes.length - 1
    ) {
      const localTime = Math.min(scene.duration, Math.max(0, safeTime - start));
      return {
        scene,
        index,
        localTime,
        progress: localTime / scene.duration,
        start,
        duration: scene.duration,
      };
    }
    start += scene.duration;
  }
  throw new ProjectValidationError("В проекте нет сцен.");
}
export function createCharacter(): Character {
  return {
    id: makeId("character"),
    name: "Новый герой",
    skin: "#d9a582",
    hair: "#373035",
    hairStyle: "bob",
    outfit: "#b85b42",
    accent: "#e4bc5b",
  };
}
export function createScene(project: Project): Scene {
  return {
    id: makeId("scene"),
    title: `Сцена ${project.scenes.length + 1}`,
    duration: 6,
    backdrop: "hills",
    caption: "",
    camera: { zoom: 1, panX: 0, panY: 0 },
    transition: "fade",
    actors: project.characters.slice(0, 2).map((c, i) => ({
      id: makeId("actor"),
      characterId: c.id,
      x: 0.38 + i * 0.23,
      endX: 0.38 + i * 0.23,
      y: 0.84,
      scale: 1,
      flip: false,
      action: "idle",
      mood: "happy",
    })),
  };
}

export function createDefaultProject(): Project {
  const project: Project = {
    version: 1,
    id: makeId("project"),
    title: "Туда, где море",
    description:
      "Мира и Лея выходят из города, пересекают холмы и встречают закат у моря.",
    seed: 7291,
    width: 1280,
    height: 720,
    fps: 24,
    style: "watercolor",
    characters: [
      {
        id: "mira",
        name: "Мира",
        skin: "#d5a17e",
        hair: "#3d3030",
        hairStyle: "bob",
        outfit: "#b8583f",
        accent: "#e0b751",
      },
      {
        id: "lea",
        name: "Лея",
        skin: "#f0c8a1",
        hair: "#87573c",
        hairStyle: "long",
        outfit: "#536e79",
        accent: "#c69976",
      },
    ],
    scenes: [],
    audio: [],
  };
  const scene = (
    title: string,
    backdrop: Scene["backdrop"],
    caption: string,
    actions: [Actor["action"], Actor["action"]],
  ): Scene => {
    const next = createScene(project);
    next.title = title;
    next.backdrop = backdrop;
    next.caption = caption;
    next.actors.forEach((actor, i) => {
      actor.action = actions[i];
    });
    project.scenes.push(next);
    return next;
  };
  const first = scene(
    "Навстречу ветру",
    "hills",
    "Иногда всё начинается с маленького шага.",
    ["walk", "walk"],
  );
  first.transition = "cut";
  first.actors[0].x = 0.2;
  first.actors[0].endX = 0.49;
  first.actors[1].x = 0.39;
  first.actors[1].endX = 0.68;
  const second = scene(
    "Свет среди деревьев",
    "forest",
    "Главное — идти вместе.",
    ["wave", "jump"],
  );
  second.camera.zoom = 1.05;
  second.actors[1].mood = "surprised";
  scene("Туда, где море", "coast", "И однажды дорога приводит к морю.", [
    "wave",
    "idle",
  ]);
  return project;
}

function hashString(input: string): number {
  let value = 2166136261;
  for (const c of input) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
  return (value >>> 0) % 2_147_483_648;
}

/** Offline storyboard template. This intentionally makes no AI claim or network request. */
export function createStoryFromPrompt(prompt: string, base?: Project): Project {
  const clean = prompt.trim().slice(0, 1000);
  const project = createDefaultProject();
  if (!clean) return project;
  const seed = hashString(clean);
  const lower = clean.toLocaleLowerCase("ru");
  const destination: Scene["backdrop"] = /ноч|зв[её]зд|космос|лун/.test(lower)
    ? "night"
    : /город|дом|улиц/.test(lower)
      ? "city"
      : /лес|дерев|птиц/.test(lower)
        ? "forest"
        : /гор|холм|пол/.test(lower)
          ? "hills"
          : "coast";
  const settings = base ? validateProject(base) : null;
  if (settings) {
    project.characters = structuredClone(settings.characters);
    project.style = settings.style;
    project.width = settings.width;
    project.height = settings.height;
    project.fps = settings.fps;
  }
  project.title =
    clean.length <= 60 ? clean : `${clean.slice(0, 57).trimEnd()}…`;
  project.description = clean;
  project.seed = seed;
  project.scenes = [];
  const locations: Scene["backdrop"][] = [
    destination === "city" ? "hills" : "city",
    destination === "forest" ? "hills" : "forest",
    destination,
  ];
  const captions = [
    "У каждой истории есть начало.",
    "По пути всегда случается что-то неожиданное.",
    "Вместе мы нашли своё маленькое чудо.",
  ];
  const titles = ["Первый шаг", "Неожиданная встреча", "Маленькое чудо"];
  for (let i = 0; i < 3; i++) {
    const next = createScene(project);
    next.title = titles[i];
    next.caption = captions[i];
    next.backdrop = locations[i];
    next.transition = i ? (seed % 2 ? "paint" : "fade") : "cut";
    next.actors.forEach((actor, j) => {
      actor.action =
        i === 0 ? "walk" : i === 1 ? (j ? "jump" : "wave") : "wave";
      actor.mood = i === 1 ? "surprised" : "happy";
      if (i === 0) {
        actor.x -= 0.12;
        actor.endX += 0.12;
      }
    });
    project.scenes.push(next);
  }
  return validateProject(project);
}
