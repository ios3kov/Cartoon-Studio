import test from "node:test";
import assert from "node:assert/strict";
import { ProjectStorage, PROJECT_KEY, DRAFT_KEY, type StoragePort, type SaveLock } from "../src/ui/projectStorage.ts";

type Draft = { title: string };
class MemoryStorage implements StoragePort {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
function mutex(): SaveLock {
  let tail = Promise.resolve();
  return (work) => {
    const job = tail.then(work);
    tail = job.catch(() => {});
    return job;
  };
}
function decode(raw: string): Draft {
  const value = JSON.parse(raw);
  if (typeof value?.title !== "string") throw new Error("Invalid draft");
  return value;
}
const fallback = () => ({ title: "Original" });
const create = (shared: StoragePort, tab: StoragePort, lock?: SaveLock) =>
  new ProjectStorage(shared, tab, lock, decode, fallback);

test("clean tabs adopt remote saves and never write a stale project on exit", async () => {
  const shared = new MemoryStorage(), lock = mutex();
  shared.setItem(PROJECT_KEY, JSON.stringify(fallback()));
  const a = create(shared, new MemoryStorage(), lock);
  const b = create(shared, new MemoryStorage(), lock);
  a.stage({ title: "New" });
  await a.flush();
  b.remember();
  assert.equal(decode(shared.getItem(PROJECT_KEY)!).title, "New");
  assert.equal(b.refresh().project.title, "New");
  await b.flush();
  assert.equal(decode(shared.getItem(PROJECT_KEY)!).title, "New");
});

test("simultaneous saves serialize; conflicting edits remain recoverable after reload", async () => {
  const shared = new MemoryStorage(), sessionA = new MemoryStorage(), sessionB = new MemoryStorage(), lock = mutex();
  shared.setItem(PROJECT_KEY, JSON.stringify(fallback()));
  const a = create(shared, sessionA, lock), b = create(shared, sessionB, lock);
  a.stage({ title: "First" });
  b.stage({ title: "Second" });
  await Promise.all([a.flush(), b.flush()]);
  assert.equal(decode(shared.getItem(PROJECT_KEY)!).title, "First");
  assert.equal(b.snapshot().status, "error");
  assert.match(b.snapshot().warning!, /другой вкладке/);
  const reloaded = create(shared, sessionB, lock);
  assert.equal(reloaded.snapshot().project.title, "Second");
  assert.equal(reloaded.snapshot().status, "error");
  await reloaded.flush();
  assert.equal(decode(shared.getItem(PROJECT_KEY)!).title, "First");
  assert.ok(sessionB.getItem(DRAFT_KEY));
});

test("pending edits survive a reload before the save debounce", async () => {
  const shared = new MemoryStorage(), tab = new MemoryStorage(), lock = mutex();
  shared.setItem(PROJECT_KEY, JSON.stringify(fallback()));
  create(shared, tab, lock).stage({ title: "Before reload" });
  assert.equal(decode(shared.getItem(PROJECT_KEY)!).title, "Original");
  const reloaded = create(shared, tab, lock);
  assert.equal(reloaded.snapshot().project.title, "Before reload");
  assert.equal((await reloaded.flush()).status, "saved");
  assert.equal(decode(shared.getItem(PROJECT_KEY)!).title, "Before reload");
  assert.equal(tab.getItem(DRAFT_KEY), null);
});

test("a queued save uses the newest edit once it obtains the lock", async () => {
  const shared = new MemoryStorage(), lock = mutex();
  const store = create(shared, new MemoryStorage(), lock);
  store.stage({ title: "Old pending edit" });
  const pending = store.flush();
  store.stage({ title: "Newest pending edit" });
  await pending;
  assert.equal(decode(shared.getItem(PROJECT_KEY)!).title, "Newest pending edit");
});

test("missing Web Locks cannot silently fall back to an unsafe shared write", async () => {
  const shared = new MemoryStorage(), tab = new MemoryStorage();
  shared.setItem(PROJECT_KEY, JSON.stringify(fallback()));
  const store = create(shared, tab);
  store.stage({ title: "Local only" });
  assert.equal((await store.flush()).status, "error");
  assert.equal(decode(shared.getItem(PROJECT_KEY)!).title, "Original");
  assert.ok(tab.getItem(DRAFT_KEY));
});

test("storage failures preserve pending edits and report failure", async () => {
  const shared = new MemoryStorage(), tab = new MemoryStorage();
  shared.setItem(PROJECT_KEY, JSON.stringify(fallback()));
  const store = create(shared, tab, mutex());
  store.stage({ title: "Recover me" });
  shared.setItem = () => { throw new Error("Quota exceeded"); };
  assert.equal((await store.flush()).status, "error");
  assert.equal(store.snapshot().project.title, "Recover me");
  assert.ok(tab.getItem(DRAFT_KEY));
});

test("remote deletion or invalid data never causes an idle tab to overwrite storage", async () => {
  const shared = new MemoryStorage(), lock = mutex();
  shared.setItem(PROJECT_KEY, JSON.stringify(fallback()));
  const store = create(shared, new MemoryStorage(), lock);
  shared.removeItem(PROJECT_KEY);
  await store.flush();
  store.remember();
  assert.equal(shared.getItem(PROJECT_KEY), null);
  shared.setItem(PROJECT_KEY, "bad json");
  assert.equal(store.refresh().status, "error");
  assert.equal(store.snapshot().project.title, "Original");
  assert.equal(shared.getItem(PROJECT_KEY), "bad json");
});
