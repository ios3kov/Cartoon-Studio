import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { cloneProject, createDefaultProject, createStoryFromPrompt, getDuration, sampleScene, validateProject } from '../src/shared/project.ts';
import { inspectProjectArchive } from '../src/shared/archive.ts';

test('default project is a valid original 18-second story', () => {
  const project = createDefaultProject();
  assert.deepEqual(validateProject(project), project);
  assert.equal(getDuration(project), 18);
  assert.equal(project.characters.length, 2);
  assert.equal(new Set(project.scenes.map(scene => scene.backdrop)).size, 3);
});

test('scene sampling assigns exact boundaries to the next shot and clamps endpoints', () => {
  const project = createDefaultProject();
  assert.equal(sampleScene(project, -1).localTime, 0);
  assert.equal(sampleScene(project, 5.999).index, 0);
  assert.equal(sampleScene(project, 6).index, 1);
  assert.equal(sampleScene(project, 12).index, 2);
  assert.equal(sampleScene(project, 19).progress, 1);
  assert.equal(sampleScene(project, NaN).index, 0);
});

test('validation rejects broken references, excessive duration, and non-finite values', () => {
  const project = createDefaultProject();
  project.scenes[0].actors[0].characterId = 'missing';
  assert.throws(() => validateProject(project), /отсутствующего/);
  project.scenes[0].actors[0].characterId = project.characters[0].id;
  project.scenes[0].duration = Infinity;
  assert.throws(() => validateProject(project), /Длительность/);
  project.scenes[0].duration = 30;
  project.scenes.push(...Array.from({length: 4}, (_, i) => ({...structuredClone(project.scenes[0]), id: `long_${i}`})));
  assert.throws(() => validateProject(project), /120/);
});

test('unknown executable properties are removed from imported data', () => {
  const input = { ...createDefaultProject(), script: 'fetch("http://evil.invalid")', __proto__: { executable: true } };
  const output = validateProject(input);
  assert.equal('script' in output, false);
  assert.equal('executable' in output, false);
  assert.throws(() => validateProject({ ...input, version: 2 }), /версия/);
});

test('cloning protects history and local draft preserves character identity', () => {
  const base = createDefaultProject();
  const copy = cloneProject(base);
  copy.characters[0].name = 'Аня';
  assert.equal(base.characters[0].name, 'Мира');
  const draft = createStoryFromPrompt('Друзья ищут звёзды ночью', copy);
  assert.equal(draft.characters[0].name, 'Аня');
  assert.equal(draft.scenes[2].backdrop, 'night');
  assert.equal(draft.seed, createStoryFromPrompt('Друзья ищут звёзды ночью').seed);
  assert.notEqual(draft.id, base.id);
  assert.equal(draft.audio.length, 0);
  assert.deepEqual(validateProject(draft), draft);
});

test('portable archive requires complete audio and refuses arbitrary paths', () => {
  const project = createDefaultProject();
  const files = { 'project.json': strToU8(JSON.stringify(project)), 'manifest.json': strToU8('{"version":1,"audio":[]}') };
  assert.deepEqual(inspectProjectArchive(zipSync(files)).project, project);
  assert.throws(() => inspectProjectArchive(zipSync({...files, '../escape.txt': strToU8('unsafe')})), /неизвестные/);
  project.audio.push({id:'track',assetId:'sound',name:'Звук',start:0,trimStart:0,volume:1,loop:false,kind:'music'});
  assert.throws(() => inspectProjectArchive(zipSync({...files,'project.json':strToU8(JSON.stringify(project))})), /неполный/);
});

test('archive limits do not trust forged ZIP uncompressed sizes', () => {
  const oversized = { ...createDefaultProject(), padding: 'x'.repeat(1024 * 1024) };
  const archive = zipSync({
    'project.json': strToU8(JSON.stringify(oversized)),
    'manifest.json': strToU8('{"version":1,"audio":[]}'),
  }, { level: 0 });
  const bytes = Buffer.from(archive);
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central >= 0);
  bytes.writeUInt32LE(10, 22);
  bytes.writeUInt32LE(10, central + 24);
  assert.throws(() => inspectProjectArchive(bytes), /слишком большой/);
});
