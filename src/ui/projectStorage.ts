/** Shared saves are serialized; pending edits belong to one tab, never to the shared key. */
export const PROJECT_KEY = "cartoon-studio-project-v1";
export const DRAFT_KEY = `${PROJECT_KEY}-pending`;
export const EXIT_PREFIX = `${PROJECT_KEY}-exit-`;
export type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem"> & { keys?(): string[] };
export type SaveLock = (work: () => void) => Promise<void>;
export interface StorageSnapshot<T> {
  project: T;
  dirty: boolean;
  status: "saving" | "saved" | "error";
  warning: string | null;
}
const CONFLICT =
  "Проект изменён в другой вкладке. Общая копия не перезаписана. Сохраните этот вариант через «Проект → Сохранить .cartoon».";

export class ProjectStorage<T> {
  private exitKey = `${EXIT_PREFIX}${crypto.randomUUID()}`;
  private recoveredKey: string | undefined;
  private base: string | null = null;
  private raw: string;
  private value: T;
  private dirty = false;
  private status: StorageSnapshot<T>["status"] = "saved";
  private warning: string | null = null;
  private shared: StoragePort;
  private tab: StoragePort;
  private lock: SaveLock | undefined;
  private decode: (raw: string) => T;

  constructor(
    shared: StoragePort,
    tab: StoragePort,
    lock: SaveLock | undefined,
    decode: (raw: string) => T,
    fallback: () => T,
  ) {
    this.shared = shared;
    this.tab = tab;
    this.lock = lock;
    this.decode = decode;
    this.value = fallback();
    this.raw = JSON.stringify(this.value);
    try {
      this.base = shared.getItem(PROJECT_KEY);
      if (this.base !== null) {
        try {
          this.value = decode(this.base);
          this.raw = this.base;
        } catch {
          shared.setItem(`${PROJECT_KEY}-recovery-${crypto.randomUUID()}`, this.base);
          this.warning = "Сохранённый проект повреждён. Его копия сохранена отдельно. Открыт пример.";
        }
      } else this.dirty = true;
      let pending = tab.getItem(DRAFT_KEY);
      // A closed tab loses sessionStorage. Recover an exit journal only against the same shared revision.
      if (!pending) {
        let newest = -Infinity;
        for (const key of shared.keys?.() ?? []) {
          if (!key.startsWith(EXIT_PREFIX)) continue;
          try {
            const candidate = JSON.parse(shared.getItem(key) ?? "null");
            if (!candidate || candidate.base !== this.base || typeof candidate.raw !== "string" ||
                !Number.isFinite(candidate.at) || candidate.at <= newest) continue;
            decode(candidate.raw);
            newest = candidate.at;
            pending = JSON.stringify({ ...candidate, recoveryKey: key });
          } catch { /* An invalid recovery record cannot replace the valid shared project. */ }
        }
      }
      if (pending) {
        const draft: unknown = JSON.parse(pending);
        if (!draft || typeof draft !== "object" || !("base" in draft) || !("raw" in draft) ||
            (draft.base !== null && typeof draft.base !== "string") || typeof draft.raw !== "string")
          throw new Error("Invalid pending project");
        const value = decode(draft.raw);
        if ("recoveryKey" in draft && typeof draft.recoveryKey === "string" && draft.recoveryKey.startsWith(EXIT_PREFIX))
          this.recoveredKey = draft.recoveryKey;
        if (draft.raw === this.base) tab.removeItem(DRAFT_KEY);
        else {
          const latest = this.base;
          this.base = draft.base;
          this.raw = draft.raw;
          this.value = value;
          this.dirty = true;
          if (this.base !== latest) this.conflict();
        }
      }
      if (this.dirty && this.status !== "error") this.status = "saving";
    } catch {
      this.status = "error";
      this.warning = "Не удалось прочитать сохранение. Не закрывайте вкладку без сохранения файла проекта.";
    }
  }

  snapshot(): StorageSnapshot<T> {
    return { project: this.value, dirty: this.dirty, status: this.status, warning: this.warning };
  }

  stage(project: T): StorageSnapshot<T> {
    this.value = project;
    this.raw = JSON.stringify(project);
    this.dirty = this.raw !== this.base;
    this.status = this.dirty ? "saving" : "saved";
    this.remember();
    return this.snapshot();
  }

  /** Synchronous, tab-local recovery survives reload even before the shared save debounce. */
  remember(exiting = false): void {
    try {
      // Unique keys cannot overwrite another tab. Never modify the canonical key during exit.
      if (exiting && this.dirty)
        this.shared.setItem(this.exitKey, JSON.stringify({ base: this.base, raw: this.raw, at: Date.now() }));
      if (this.dirty) this.tab.setItem(DRAFT_KEY, JSON.stringify({ base: this.base, raw: this.raw, recoveryKey: this.exitKey }));
      else this.tab.removeItem(DRAFT_KEY);
    } catch {
      this.status = "error";
      this.warning = "Не удалось сохранить черновик вкладки. Сохраните файл проекта перед закрытием.";
    }
  }

  private conflict(): void {
    this.status = "error";
    this.warning = CONFLICT;
    this.remember();
  }

  /** Read the current value, not event.newValue: storage events can arrive out of order. */
  refresh(): StorageSnapshot<T> {
    try {
      const latest = this.shared.getItem(PROJECT_KEY);
      if (latest === this.base) return this.snapshot();
      if (this.dirty && latest !== this.raw) {
        this.conflict();
        return this.snapshot();
      }
      if (latest === null) {
        this.base = null;
        this.warning = "Общее сохранение удалено в другой вкладке. Сохраните файл проекта.";
        this.status = "error";
        return this.snapshot();
      }
      this.value = this.decode(latest);
      this.raw = this.base = latest;
      this.dirty = false;
      this.status = "saved";
      this.warning = null;
      this.remember();
    } catch {
      this.status = "error";
      this.warning = "Не удалось прочитать изменения другой вкладки. Текущий проект оставлен без изменений.";
    }
    return this.snapshot();
  }

  async flush(): Promise<StorageSnapshot<T>> {
    if (!this.dirty) return this.refresh();
    if (!this.lock) {
      this.status = "error";
      this.warning = "Браузер не поддерживает безопасное автосохранение между вкладками. Используйте сохранение файла проекта.";
      this.remember();
      return this.snapshot();
    }
    try {
      await this.lock(() => {
        // Use the latest local edit once the lock is acquired; never a queued stale snapshot.
        if (!this.dirty) return;
        const latest = this.shared.getItem(PROJECT_KEY);
        if (latest !== this.base && latest !== this.raw) {
          this.conflict();
          return;
        }
        this.shared.setItem(PROJECT_KEY, this.raw);
        this.base = this.raw;
        this.dirty = false;
        this.status = "saved";
        this.warning = null;
        this.remember();
        // Only remove journals consumed by this save; unrelated and conflicting recovery records stay intact.
        for (const key of [this.exitKey, this.recoveredKey]) {
          if (!key) continue;
          try {
            const journal = JSON.parse(this.shared.getItem(key) ?? "null");
            if (journal?.raw === this.raw) this.shared.removeItem(key);
          } catch { /* Journal cleanup does not invalidate a successful shared save. */ }
        }
      });
      if (!this.dirty) return this.refresh();
    } catch {
      this.status = "error";
      this.warning = "Автосохранение недоступно. Сохраните файл проекта перед закрытием.";
    }
    return this.snapshot();
  }
}
