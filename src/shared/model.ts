export const STYLE_IDS = ["watercolor", "pencil", "pastel"] as const;
export const BACKDROP_IDS = [
  "hills",
  "coast",
  "city",
  "forest",
  "night",
] as const;
export const ACTION_IDS = ["idle", "walk", "wave", "jump", "ride"] as const;
export const MOOD_IDS = ["happy", "curious", "surprised", "calm"] as const;
export type StyleId = (typeof STYLE_IDS)[number];
export type BackdropId = (typeof BACKDROP_IDS)[number];
export type ActionId = (typeof ACTION_IDS)[number];
export type MoodId = (typeof MOOD_IDS)[number];
export type HairStyle = "short" | "bob" | "long";
export type Transition = "cut" | "fade" | "paint";

export interface Character {
  id: string;
  name: string;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  outfit: string;
  accent: string;
}
export interface Actor {
  id: string;
  characterId: string;
  /** Normalized stage coordinates; y is the actor's ground contact. */
  x: number;
  y: number;
  endX: number;
  scale: number;
  flip: boolean;
  action: ActionId;
  mood: MoodId;
}
export interface Scene {
  id: string;
  title: string;
  duration: number;
  backdrop: BackdropId;
  caption: string;
  camera: { zoom: number; panX: number; panY: number };
  actors: Actor[];
  transition: Transition;
}
export interface AudioTrack {
  id: string;
  assetId: string;
  name: string;
  start: number;
  trimStart: number;
  volume: number;
  loop: boolean;
  kind: "music" | "voice" | "effect";
}
export interface Project {
  version: 1;
  id: string;
  title: string;
  description: string;
  seed: number;
  width: number;
  height: number;
  fps: number;
  style: StyleId;
  characters: Character[];
  scenes: Scene[];
  audio: AudioTrack[];
}
export interface SceneSample {
  scene: Scene;
  index: number;
  localTime: number;
  progress: number;
  start: number;
  duration: number;
}
export interface RenderStatus {
  backend: "p5.brush" | "canvas2d";
  message?: string;
}
export interface StudioRenderer {
  render(project: Project, time: number): void;
  /** Prepare costly paint textures once; per-frame motion uses the cached paint. */
  prepare(project: Project): Promise<RenderStatus>;
  dispose(): void;
  status(): RenderStatus;
}
export type ExportPreset = "draft" | "hd";
export interface ExportJob {
  id: string;
  status: "queued" | "rendering" | "encoding" | "done" | "error" | "cancelled";
  progress: number;
  error?: string;
  downloadUrl?: string;
  frames?: number;
  totalFrames?: number;
}
export interface AudioAsset {
  id: string;
  name: string;
  duration: number;
  url: string;
}
export interface Health {
  status: "ok";
  ffmpeg: boolean;
  browser: boolean;
  aiConfigured: boolean;
  ttsConfigured: boolean;
}
