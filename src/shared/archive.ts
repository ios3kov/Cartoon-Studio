import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { AudioAsset, Project } from './model.ts';
import { cloneProject, validateProject } from './project.ts';

const MIB = 1024 * 1024;
const MAX_ARCHIVE = 128 * MIB;
const MAX_AUDIO = 30 * MIB;
const MAX_JSON = MIB;
interface ManifestEntry { assetId: string; path: string; name: string; mime: string }

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as {error?: string} | null;
  return new Error(body?.error || fallback);
}

/** A portable .cartoon file contains the validated project and every referenced audio asset. */
export async function saveProjectArchive(input: Project): Promise<Blob> {
  const project = validateProject(input);
  const files: Zippable = { 'project.json': strToU8(JSON.stringify(project, null, 2)) };
  const entries: ManifestEntry[] = [];
  let size = 0;
  for (const assetId of new Set(project.audio.map(track => track.assetId))) {
    const track = project.audio.find(track => track.assetId === assetId)!;
    const response = await fetch(`/api/audio/${encodeURIComponent(assetId)}`);
    if (!response.ok) throw await responseError(response, `Не удалось сохранить звук «${track.name}».`);
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_AUDIO) throw new Error('Аудиофайл превышает 30 МБ.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    size += bytes.length;
    if (bytes.length > MAX_AUDIO || size > MAX_ARCHIVE - 2 * MAX_JSON) throw new Error('Проект со звуком превышает 128 МБ.');
    const path = `audio/${assetId}.bin`;
    files[path] = [bytes, { level: 0 }];
    const mime = response.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
    entries.push({ assetId, path, name: track.name, mime: mime.startsWith('audio/') ? mime : 'audio/mpeg' });
  }
  files['manifest.json'] = strToU8(JSON.stringify({ version: 1, audio: entries }));
  const data = zipSync(files, { level: 6 });
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

/** Inspect declared sizes before decompression; reject unknown and unsafe archive paths. */
export function inspectProjectArchive(bytes: Uint8Array): { project: Project; entries: ManifestEntry[]; files: Record<string, Uint8Array> } {
  if (bytes.length > MAX_ARCHIVE) throw new Error('Файл проекта превышает 128 МБ.');
  let expanded = 0;
  let count = 0;
  const seen = new Set<string>();
  const files = unzipSync(bytes, { filter: file => {
    count++;
    const allowed = file.name === 'project.json' || file.name === 'manifest.json' || /^audio\/[a-zA-Z0-9_-]{1,80}\.bin$/.test(file.name);
    if (!allowed || seen.has(file.name) || count > 14) throw new Error('Архив содержит неизвестные или повторяющиеся файлы.');
    seen.add(file.name);
    expanded += file.originalSize;
    const limit = file.name.startsWith('audio/') ? MAX_AUDIO : MAX_JSON;
    if (file.originalSize > limit || file.size > limit || expanded > MAX_ARCHIVE) throw new Error('Распакованный проект слишком большой.');
    return true;
  } });
  let actualSize = 0;
  for (const [name, data] of Object.entries(files)) {
    actualSize += data.byteLength;
    const limit = name.startsWith('audio/') ? MAX_AUDIO : MAX_JSON;
    if (data.byteLength > limit || actualSize > MAX_ARCHIVE) throw new Error('Распакованный проект слишком большой.');
  }
  if (!files['project.json'] || !files['manifest.json']) throw new Error('В архиве отсутствует проект или список аудиофайлов.');
  const project = validateProject(JSON.parse(strFromU8(files['project.json'])));
  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as {version?: unknown; audio?: unknown};
  if (manifest.version !== 1 || !Array.isArray(manifest.audio) || manifest.audio.length > 12) throw new Error('Неверный список аудиофайлов.');
  const ids = new Set<string>();
  const entries: ManifestEntry[] = manifest.audio.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Неверный аудиофайл в архиве.');
    const entry = item as Record<string, unknown>;
    if (typeof entry.assetId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.assetId)
      || entry.path !== `audio/${entry.assetId}.bin` || typeof entry.name !== 'string'
      || !entry.name.trim() || entry.name.length > 160 || typeof entry.mime !== 'string'
      || !/^audio\/[a-zA-Z0-9.+-]{1,60}$/.test(entry.mime)
      || ids.has(entry.assetId) || !files[entry.path as string]) throw new Error('Неверный аудиофайл в архиве.');
    ids.add(entry.assetId);
    return { assetId: entry.assetId, path: entry.path as string, name: entry.name, mime: entry.mime };
  });
  const needed = new Set(project.audio.map(track => track.assetId));
  if (needed.size !== ids.size || [...needed].some(assetId => !ids.has(assetId))) throw new Error('Архив содержит неполный набор аудиофайлов.');
  if (Object.keys(files).length !== entries.length + 2) throw new Error('В архиве есть лишние аудиофайлы.');
  return { project, entries, files };
}

export async function readProjectFile(file: File): Promise<Project> {
  if (file.size > MAX_ARCHIVE) throw new Error('Файл проекта превышает 128 МБ.');
  if (file.name.toLowerCase().endsWith('.json') || file.type === 'application/json') {
    if (file.size > MAX_JSON) throw new Error('JSON проекта превышает 1 МБ.');
    return validateProject(JSON.parse(await file.text()));
  }
  const { project, entries, files } = inspectProjectArchive(new Uint8Array(await file.arrayBuffer()));
  const restored = cloneProject(project);
  const assetMap = new Map<string, string>();
  // Validate the complete archive before uploading anything or replacing the current project.
  for (const entry of entries) {
    const response = await fetch('/api/audio', {
      method: 'POST', headers: { 'Content-Type': entry.mime, 'X-Filename': encodeURIComponent(entry.name) },
      body: new Blob([files[entry.path] as Uint8Array<ArrayBuffer>], { type: entry.mime }),
    });
    if (!response.ok) throw await responseError(response, `Не удалось восстановить звук «${entry.name}».`);
    const asset = await response.json() as AudioAsset;
    assetMap.set(entry.assetId, asset.id);
  }
  restored.audio.forEach(track => { track.assetId = assetMap.get(track.assetId)!; });
  return validateProject(restored);
}
