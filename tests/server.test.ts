import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { createDefaultProject } from '../src/shared/project.ts';
import type { ExportJob, Project } from '../src/shared/model.ts';
import { createStudioServer, JSON_LIMIT, type ServerOptions, type StudioServer } from '../server/index.ts';
import { AudioStore, createAudioProbe } from '../server/audio.ts';
import { ExportQueue, type RenderTask } from '../server/jobs.ts';
import { HttpError } from '../server/errors.ts';
import { localOrigin, providerSettings, Providers, type FetchFunction } from '../server/providers.ts';
import { browserAvailable, encodingArguments, outputDimensions, prepareAudio } from '../server/render.ts';
import { captureCommand, commandAvailable } from '../server/process.ts';

async function fixture(options: ServerOptions = {}): Promise<{ app: StudioServer; directory: string; close(): Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'cartoon-server-test-'));
  const app = await createStudioServer({
    port: 0, appOrigin: null, dataDirectory: directory, env: {},
    healthProbe: async () => ({ ffmpeg: true, browser: true }),
    audioProbe: async () => ({ duration: 5, mime: 'audio/mpeg' }),
    runner: async task => { await writeFile(task.outputPath, Buffer.alloc(64, 1)); },
    ...options,
  });
  return { app, directory, close: async () => { await app.close(); await rm(directory, { recursive: true, force: true }); } };
}
function api(app: StudioServer, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<Response> {
  return fetch(`${app.origin}${path}`, {
    method, headers: { Origin: app.origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) { if (await check()) return; await delay(10); }
  throw new Error('Timed out waiting for test condition');
}
function project(): Project {
  const value = createDefaultProject();
  value.scenes = value.scenes.slice(0, 1);
  value.scenes[0].duration = 1;
  value.fps = 12;
  return value;
}

test('server binds loopback; health reports configured prerequisites, not placeholder success', async () => {
  const f = await fixture({ healthProbe: async () => ({ ffmpeg: false, browser: false }) });
  try {
    assert.match(f.app.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await api(f.app, '/api/health');
    assert.deepEqual(await response.json(), { status: 'ok', ffmpeg: false, browser: false, aiConfigured: false, ttsConfigured: false });
    const exportResponse = await api(f.app, '/api/exports', { project: project(), preset: 'draft' });
    assert.equal(exportResponse.status, 503);
    assert.match((await exportResponse.json()).error, /FFmpeg/);
    assert.equal(await browserAvailable('/missing/chromium-not-installed'), false);
  } finally { await f.close(); }
});

test('writes require an exact local Origin and unexpected Host values are rejected', async () => {
  const f = await fixture();
  try {
    const body = JSON.stringify({ project: project(), preset: 'draft' });
    for (const origin of [undefined, 'https://outside.example', 'null', `${f.app.origin}.outside.example`]) {
      const response = await fetch(`${f.app.origin}/api/exports`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body });
      assert.equal(response.status, 403);
    }
    const hostileHost = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${f.app.origin}/api/health`, { headers: { Host: 'outside.example' } }, response => {
        response.resume(); resolve(response.statusCode!);
      });
      request.once('error', reject);
      request.end();
    });
    assert.equal(hostileHost, 403);
    const valid = await api(f.app, '/api/exports', { project: project(), preset: 'draft' });
    assert.equal(valid.status, 202);
  } finally { await f.close(); }
});

test('malformed JSON, non-object bodies, oversized input and invalid projects fail before rendering', async () => {
  let renders = 0;
  const f = await fixture({ runner: async () => { renders++; } });
  try {
    for (const body of ['{', 'null', '[]']) {
      const response = await fetch(`${f.app.origin}/api/exports`, { method: 'POST', headers: { Origin: f.app.origin, 'Content-Type': 'application/json' }, body });
      assert.equal(response.status, 400);
    }
    const huge = await fetch(`${f.app.origin}/api/exports`, { method: 'POST', headers: { Origin: f.app.origin, 'Content-Type': 'application/json' }, body: ' '.repeat(JSON_LIMIT + 1) });
    assert.equal(huge.status, 413);
    assert.equal((await api(f.app, '/api/exports', { project: { ...project(), fps: 1000 }, preset: 'draft' })).status, 400);
    assert.equal((await api(f.app, '/api/exports', { project: project(), preset: '--output=/etc/passwd' })).status, 400);
    assert.equal((await api(f.app, '/api/exports', { project: project(), preset: 'draft', path: '/etc/passwd' })).status, 202);
    await until(() => renders === 1);
  } finally { await f.close(); }
});

test('encoded traversal, unknown asset IDs and range overflows cannot read arbitrary files', async () => {
  const f = await fixture({ production: true });
  try {
    const status = await new Promise<number>(resolve => {
      const request = httpRequest(`${f.app.origin}/`, { path: '/%2e%2e%2fpackage.json' }, response => { response.resume(); resolve(response.statusCode!); });
      request.end();
    });
    assert.equal(status, 400);
    assert.equal((await api(f.app, '/api/audio/file:///etc/passwd')).status, 404);
    assert.equal((await api(f.app, `/api/audio/a_${'f'.repeat(32)}`)).status, 404);
    const upload = await fetch(`${f.app.origin}/api/audio`, { method: 'POST', headers: { Origin: f.app.origin, 'Content-Type': 'audio/mpeg', 'X-Filename': encodeURIComponent('../../recording.mp3') }, body: Buffer.from('audio bytes') });
    assert.equal(upload.status, 201);
    const asset = await upload.json();
    assert.equal(asset.name, 'recording.mp3');
    assert.match(asset.id, /^a_[a-f0-9]{32}$/);
    assert.equal(Object.hasOwn(asset, 'file'), false);
    const partial = await fetch(`${f.app.origin}${asset.url}`, { headers: { Range: 'bytes=0-4' } });
    assert.equal(partial.status, 206);
    assert.equal(await partial.text(), 'audio');
    const invalid = await fetch(`${f.app.origin}${asset.url}`, { headers: { Range: 'bytes=99999-' } });
    assert.equal(invalid.status, 416);
    assert.equal((await fetch(`${f.app.origin}/api/audio`, { method: 'POST', headers: { Origin: f.app.origin, 'Content-Type': 'text/html' }, body: 'text' })).status, 415);
    const missing = project();
    missing.audio.push({ id: 't1', assetId: 'http_evil', name: 'track', start: 0, trimStart: 0, volume: 1, loop: false, kind: 'voice' });
    assert.equal((await api(f.app, '/api/exports', { project: missing, preset: 'draft' })).status, 404);
  } finally { await f.close(); }
});

test('audio assets keep IDs and metadata across AudioStore instances; invalid audio is removed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cartoon-audio-test-'));
  try {
    const first = new AudioStore(directory, async () => ({ duration: 2.5, mime: 'audio/wav' }));
    await first.initialize();
    const asset = await first.add(Buffer.from('sample'), 'voice.wav');
    const second = new AudioStore(directory, async () => { throw new Error('Should not probe existing audio'); });
    await second.initialize();
    const saved = await second.get(asset.id);
    assert.equal(saved.id, asset.id);
    assert.equal(saved.duration, 2.5);
    assert.equal(await readFile(saved.file, 'utf8'), 'sample');
    const invalid = new AudioStore(directory, async () => { throw new HttpError(415, 'Bad audio'); });
    await assert.rejects(invalid.add(Buffer.from('broken'), 'bad.mp3'), /Bad audio/);
    await assert.rejects(first.get('../outside'), /не найден/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('queue runs one job, bounds waiting jobs, cancels queued and active jobs without false completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cartoon-queue-test-'));
  const started: string[] = [];
  let active = 0;
  let maxActive = 0;
  const queue = new ExportQueue(directory, async task => {
    started.push(task.id); active++; maxActive = Math.max(maxActive, active);
    try {
      await new Promise<void>(resolve => {
        if (task.signal.aborted) resolve();
        else task.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      // Even a runner which resolves after cancellation must never mark the job done.
      await writeFile(task.outputPath, Buffer.alloc(32));
      task.update({ status: 'encoding', progress: 1 });
    } finally { active--; }
  }, 1);
  await queue.initialize();
  try {
    const first = queue.submit(project(), 'draft');
    await until(() => started.length === 1);
    const second = queue.submit(project(), 'hd');
    assert.throws(() => queue.submit(project(), 'draft'), /Очередь заполнена/);
    assert.equal(queue.cancel(second.id).status, 'cancelled');
    assert.equal(queue.cancel(first.id).status, 'cancelled');
    await until(() => active === 0);
    assert.equal(queue.get(first.id).status, 'cancelled');
    assert.equal(started.length, 1);
    assert.equal(maxActive, 1);
    assert.throws(() => queue.file(first.id), /не готово/);
  } finally { await queue.close(); await rm(directory, { recursive: true, force: true }); }
});

test('jobs report sanitized failures, snapshot validated projects and only expose finished files', async () => {
  let attempt = 0;
  const f = await fixture({ runner: async task => {
    if (++attempt === 1) throw new Error('SECRET provider payload /private/path');
    task.update({ status: 'encoding', progress: 2, frames: 999999 });
    await writeFile(task.outputPath, Buffer.alloc(32, 7));
  } });
  try {
    const first = await (await api(f.app, '/api/exports', { project: { ...project(), injectedScript: 'evil()' }, preset: 'draft' })).json() as ExportJob;
    await until(() => f.app.jobs.get(first.id).status === 'error');
    const failed = await (await api(f.app, `/api/exports/${first.id}`)).json();
    assert.equal(failed.status, 'error');
    assert.doesNotMatch(JSON.stringify(failed), /SECRET|private|payload/);
    assert.equal((await api(f.app, `/api/exports/${first.id}/file`)).status, 409);
    const snapshot = await (await api(f.app, `/api/render/${first.id}`)).json();
    assert.equal(Object.hasOwn(snapshot, 'injectedScript'), false);
    const second = await (await api(f.app, '/api/exports', { project: project(), preset: 'hd' })).json() as ExportJob;
    await until(() => f.app.jobs.get(second.id).status === 'done');
    const done = f.app.jobs.get(second.id);
    assert.equal(done.progress, 1);
    assert.equal(done.frames, done.totalFrames);
    const file = await api(f.app, done.downloadUrl!);
    assert.equal(file.headers.get('content-type'), 'video/mp4');
    assert.equal((await file.arrayBuffer()).byteLength, 32);
  } finally { await f.close(); }
});

test('unconfigured AI and TTS are truthful 503s, never invoke a provider', async () => {
  let calls = 0;
  const f = await fixture({ fetcher: (async () => { calls++; throw new Error('Unexpected paid call'); }) as FetchFunction });
  try {
    assert.equal((await api(f.app, '/api/storyboard', { prompt: 'Путешествие' })).status, 503);
    assert.equal((await api(f.app, '/api/speech', { text: 'Привет' })).status, 503);
    assert.equal(calls, 0);
    assert.equal(providerSettings({ AI_API_KEY: 'fake', AI_MODEL: 'fake-model', TTS_MODEL: 'speech-model' }).tts, undefined);
    assert.ok(providerSettings({ AI_API_KEY: 'fake', AI_MODEL: 'fake-model', TTS_MODEL: 'speech-model', TTS_USE_AI_KEY: '1' }).tts);
  } finally { await f.close(); }
});

test('storyboard accepts only validated JSON data, bounds responses and hides provider errors', async () => {
  const settings = providerSettings({ AI_BASE_URL: 'https://provider.example/v1', AI_API_KEY: 'test-only-not-a-secret', AI_MODEL: 'test-model' });
  const validProject = project();
  let mode = 'valid';
  let calls = 0;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(String(url), 'https://provider.example/v1/chat/completions');
    assert.equal(init?.redirect, 'error');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'test-model');
    if (mode === 'failure') return new Response('PRIVATE API KEY', { status: 401 });
    if (mode === 'huge') return new Response('x'.repeat(512 * 1024 + 1));
    if (mode === 'code') return new Response(JSON.stringify({ choices: [{ message: { content: '(()=>evil())()' } }] }));
    if (mode === 'invalid') return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ project: { ...validProject, scenes: [] } }) } }] }));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ project: { ...validProject, javascript: 'evil()' } }) } }] }));
  }) as FetchFunction;
  const providers = new Providers(settings, fakeFetch);
  const result = await providers.storyboard({ prompt: 'История', project: validProject });
  assert.equal(Object.hasOwn(result, 'javascript'), false);
  assert.equal(result.scenes[0].title, validProject.scenes[0].title);
  for (mode of ['code', 'invalid', 'huge', 'failure']) {
    await assert.rejects(providers.storyboard({ prompt: 'История' }), error => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /PRIVATE|API KEY|test-only/);
      return true;
    });
  }
  const before = calls;
  await assert.rejects(providers.storyboard({ prompt: 'x'.repeat(4001) }), /4000/);
  assert.equal(calls, before);
});

test('speech adapter uses the configured endpoint and validates voices without paid test calls', async () => {
  let calls = 0;
  const settings = providerSettings({ TTS_API_KEY: 'test-only', TTS_MODEL: 'configured-speech-model', TTS_BASE_URL: 'http://127.0.0.1:5000/v1' });
  const providers = new Providers(settings, (async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(String(url), 'http://127.0.0.1:5000/v1/audio/speech');
    assert.deepEqual(JSON.parse(String(init?.body)), { input: 'Привет', voice: 'alloy', response_format: 'mp3', model: 'configured-speech-model' });
    return new Response('fake audio');
  }) as FetchFunction);
  assert.equal((await providers.speech({ text: 'Привет' })).toString(), 'fake audio');
  await assert.rejects(providers.speech({ text: 'Привет', voice: '../../shell' }), /голос/);
  assert.equal(calls, 1);
});

test('renderer origins and encoding parameters remain constrained to local data', () => {
  for (const url of ['https://outside.example', 'file:///tmp/page', 'http://127.0.0.1:1234/evil', 'http://user:pass@127.0.0.1:1234', 'http://127.0.0.1:1234?redirect=evil']) assert.throws(() => localOrigin(url));
  assert.equal(localOrigin('http://127.0.0.1:4173/'), 'http://127.0.0.1:4173');
  const p = project();
  assert.deepEqual(outputDimensions(p, 'draft'), { width: 640, height: 360 });
  p.width = 720; p.height = 1280;
  assert.deepEqual(outputDimensions(p, 'hd'), { width: 720, height: 1280 });
  p.audio = [{ id: 'track', assetId: 'audio', name: 'music', start: .25, trimStart: .5, volume: .75, loop: true, kind: 'music' }];
  const args = encodingArguments(p, ['/generated/trimmed.wav'], '/generated/movie.mp4', 'draft');
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'));
  assert.ok(args.includes('-stream_loop'));
  assert.match(args[args.indexOf('-filter_complex') + 1], /adelay=250:all=1/);
  assert.match(args[args.indexOf('-filter_complex') + 1], /volume=0.75/);
  assert.throws(() => encodingArguments(p, [], '/out.mp4', 'draft'), /mismatch/);
});

test('real FFmpeg exports H.264/AAC with trimmed, delayed, looping audio', async t => {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  if (!await commandAvailable(ffmpeg) || !await commandAvailable(ffprobe)) {
    t.skip('FFmpeg/ffprobe are not installed; real codec verification needs these optional tools.');
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'cartoon-codecs-test-'));
  try {
    const rate = 48_000;
    const samples = Math.floor(rate * .3);
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 880) * 8000), 44 + i * 2);
    const store = new AudioStore(directory, createAudioProbe(ffprobe));
    await store.initialize();
    const asset = await store.add(wav, 'test-tone.wav');
    assert.ok(Math.abs(asset.duration - .3) < .01);
    await assert.rejects(store.add(Buffer.from('<html>not audio</html>'), 'invalid.mp3'), /аудио/);
    const p = project();
    p.audio = [{ id: 'tone', assetId: asset.id, name: 'tone', start: .25, trimStart: .1, volume: .75, loop: true, kind: 'music' }];
    const outputPath = join(directory, 'result.mp4');
    const task: RenderTask = { id: 'test', project: p, preset: 'draft', outputPath, signal: new AbortController().signal, update: () => {} };
    const audioFiles = await prepareAudio(task, store, { ffmpeg, appOrigin: () => 'http://127.0.0.1' }, directory, task.signal);
    const framePath = join(directory, 'frame.png');
    await captureCommand(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=64x36', '-frames:v', '1', '-threads', '1', framePath]);
    const frame = await readFile(framePath);
    const encoder = spawn(ffmpeg, encodingArguments(p, audioFiles, outputPath, 'draft'), { stdio: ['pipe', 'ignore', 'pipe', 'pipe'] });
    const progress = encoder.stdio[3];
    if (progress && 'on' in progress) progress.on('data', () => {});
    let log = '';
    encoder.stderr!.on('data', chunk => { log += chunk.toString(); });
    const finished = new Promise<void>((resolve, reject) => {
      encoder.once('error', reject);
      encoder.once('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg ${code}: ${log}`)));
    });
    encoder.stdin!.on('error', () => {});
    for (let i = 0; i < p.fps; i++) encoder.stdin!.write(frame);
    encoder.stdin!.end();
    await finished;
    const metadata = JSON.parse(await captureCommand(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', outputPath]));
    assert.ok(metadata.streams.some((stream: { codec_name: string }) => stream.codec_name === 'h264'));
    assert.ok(metadata.streams.some((stream: { codec_name: string }) => stream.codec_name === 'aac'));
    assert.ok(Math.abs(Number(metadata.format.duration) - 1) < .1);
    const decoder = spawn(ffmpeg, ['-v', 'error', '-i', outputPath, '-map', '0:a:0', '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const parts: Buffer[] = [];
    decoder.stdout.on('data', chunk => parts.push(chunk));
    await new Promise<void>((resolve, reject) => { decoder.once('error', reject); decoder.once('close', code => code === 0 ? resolve() : reject(new Error('Audio decode failed'))); });
    const pcm = Buffer.concat(parts);
    const rms = (start: number, end: number) => {
      let energy = 0; let count = 0;
      for (let i = Math.floor(start * rate); i < Math.floor(end * rate) && i * 4 + 4 <= pcm.length; i++) {
        const value = pcm.readFloatLE(i * 4); energy += value * value; count++;
      }
      return Math.sqrt(energy / count);
    };
    assert.ok(rms(.05, .15) < .001, 'Track must start after its configured delay.');
    assert.ok(rms(.4, .5) > .03, 'Trimmed audio must be audible.');
    assert.ok(rms(.85, .95) > .03, 'The trimmed segment must repeat until the timeline ends.');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
