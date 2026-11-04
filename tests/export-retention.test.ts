import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { ExportQueue } from "../server/jobs.ts";
import { createDefaultProject } from "../src/shared/project.ts";

test("a restarted export queue counts old files when pruning new completed jobs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "studio-restart-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "exports");
  await mkdir(directory);
  for (let i = 1; i <= 4; i++) {
    const file = join(directory, `j_${String(i).repeat(32)}.mp4`);
    await writeFile(file, Buffer.alloc(32));
    await utimes(file, 1000 + i, 1000 + i);
  }
  const runner = async (task: { outputPath: string }) => { await writeFile(task.outputPath, Buffer.alloc(32)); };
  const first = new ExportQueue(root, runner, 4, 2);
  await first.initialize();
  assert.equal((await readdir(directory)).length, 2);
  await first.close();
  const restarted = new ExportQueue(root, runner, 4, 2);
  t.after(() => restarted.close());
  await restarted.initialize();
  const job = restarted.submit(createDefaultProject(), "draft");
  for (let i = 0; i < 100 && restarted.get(job.id).status !== "done"; i++) await setTimeout(10);
  assert.equal(restarted.get(job.id).status, "done");
  await restarted.close();
  const files = (await readdir(directory)).sort();
  assert.equal(files.length, 2);
  assert.ok(files.includes(`${job.id}.mp4`));
  assert.ok(files.includes(`j_${"4".repeat(32)}.mp4`));
  assert.equal(restarted.file(job.id), join(directory, `${job.id}.mp4`));
});
