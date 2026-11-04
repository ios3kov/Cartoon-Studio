import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneExportFiles } from "../server/exportFiles.ts";
const id = (n: number) => `j_${n.toString(16).padStart(32, "0")}`;
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "studio-history-"));
  const write = async (n: number) => {
    const file = join(directory, `${id(n)}.mp4`);
    await writeFile(file, "completed video");
    await utimes(file, 1000 + n, 1000 + n);
  };
  return { directory, write, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
test("disk retention includes exports from previous runs and is idempotent", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  for (let n = 1; n <= 4; n++) await f.write(n);
  assert.deepEqual(await pruneExportFiles(f.directory, 2), [id(2), id(1)]);
  assert.deepEqual((await readdir(f.directory)).sort(), [`${id(3)}.mp4`, `${id(4)}.mp4`]);
  assert.deepEqual(await pruneExportFiles(f.directory, 2), []);
  await f.write(5);
  assert.deepEqual(await pruneExportFiles(f.directory, 2), [id(3)]);
});
test("retention never removes unknown files, symlinks, temporary directories or active outputs", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await f.write(1); await f.write(2);
  await writeFile(join(f.directory, "user-video.mp4"), "keep");
  await mkdir(join(f.directory, `${id(3)}-work`));
  await symlink("user-video.mp4", join(f.directory, `${id(4)}.mp4`));
  assert.deepEqual(await pruneExportFiles(f.directory, 0, new Set([id(1)])), [id(2)]);
  assert.equal(await readFile(join(f.directory, "user-video.mp4"), "utf8"), "keep");
  assert.equal((await readdir(f.directory)).length, 4);
});
