import test from "node:test";
import assert from "node:assert/strict";
import { ProjectStorage, PROJECT_KEY, EXIT_PREFIX, type StoragePort, type SaveLock } from "../src/ui/projectStorage.ts";
class MemoryStorage implements StoragePort {
  data = new Map<string, string>();
  keys() { return [...this.data.keys()]; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
function mutex(): SaveLock {
  let tail = Promise.resolve();
  return (work) => { const job = tail.then(work); tail = job.catch(() => {}); return job; };
}
const fallback = () => ({ title: "Original" });
function decode(raw: string): { title: string } {
  const value = JSON.parse(raw);
  if (typeof value?.title !== "string") throw new Error("Invalid draft");
  return value;
}
const create = (shared: StoragePort, tab: StoragePort, lock: SaveLock) =>
  new ProjectStorage(shared, tab, lock, decode, fallback);

test("closing before debounce restores the last edit in a new tab and removes its consumed exit journal", async () => {
  const shared = new MemoryStorage(), lock = mutex();
  shared.setItem(PROJECT_KEY, JSON.stringify(fallback()));
  const closing = create(shared, new MemoryStorage(), lock);
  closing.stage({ title: "Last edit before closing" });
  closing.remember(true);
  assert.equal(decode(shared.getItem(PROJECT_KEY)!).title, "Original");
  const reopened = create(shared, new MemoryStorage(), lock);
  assert.equal(reopened.snapshot().project.title, "Last edit before closing");
  await reopened.flush();
  assert.equal(decode(shared.getItem(PROJECT_KEY)!).title, "Last edit before closing");
  assert.equal(shared.keys().filter((key) => key.startsWith(EXIT_PREFIX)).length, 0);
});

test("a conflicting exit journal never replaces a newer shared revision in a fresh tab", async () => {
  const shared = new MemoryStorage(), lock = mutex();
  shared.setItem(PROJECT_KEY, JSON.stringify(fallback()));
  const a = create(shared, new MemoryStorage(), lock), b = create(shared, new MemoryStorage(), lock);
  a.stage({ title: "Winner" }); b.stage({ title: "Conflicting copy" });
  await a.flush();
  b.remember(true);
  const fresh = create(shared, new MemoryStorage(), lock);
  assert.equal(fresh.snapshot().project.title, "Winner");
  await fresh.flush();
  assert.equal(decode(shared.getItem(PROJECT_KEY)!).title, "Winner");
  assert.equal(shared.keys().filter((key) => key.startsWith(EXIT_PREFIX)).length, 1);
});
