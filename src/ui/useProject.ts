import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "../shared/model";
import { cloneProject, createDefaultProject, validateProject } from "../shared/project";
import { ProjectStorage, PROJECT_KEY, type StoragePort, type StorageSnapshot } from "./projectStorage";

// Access storage lazily: even reading window.localStorage can throw in restricted browsers.
function storagePort(kind: "localStorage" | "sessionStorage"): StoragePort {
  return {
    getItem: (key) => window[kind].getItem(key),
    setItem: (key, value) => window[kind].setItem(key, value),
    removeItem: (key) => window[kind].removeItem(key),
  };
}
export function useProject() {
  const persistence = useRef<ProjectStorage<Project> | null>(null);
  if (!persistence.current)
    persistence.current = new ProjectStorage(
      storagePort("localStorage"), storagePort("sessionStorage"),
      navigator.locks ? (work) => navigator.locks.request(PROJECT_KEY, work) : undefined,
      (raw) => validateProject(JSON.parse(raw)), createDefaultProject,
    );
  const store = persistence.current;
  const initial = store.snapshot();
  const [project, setProject] = useState(initial.project);
  const [saveState, setSaveState] = useState(initial.status);
  const [warning, setWarning] = useState(initial.warning);
  const history = useRef<{
    past: Project[]; future: Project[]; key: string; at: number;
  }>({ past: [], future: [], key: "", at: 0 });
  const current = useRef(project);
  const [, refresh] = useState(0);
  const applyStorage = useCallback((snapshot: StorageSnapshot<Project>) => {
    // Remote snapshots invalidate undo/redo: an undo must not restore another tab's stale project.
    if (snapshot.project !== current.current) {
      history.current = { past: [], future: [], key: "", at: 0 };
      current.current = snapshot.project;
      setProject(snapshot.project);
    }
    setSaveState(snapshot.status);
    setWarning(snapshot.warning);
  }, []);
  const publish = useCallback((next: Project) => {
    current.current = next;
    const snapshot = store.stage(next); // Journal synchronously, before React or any debounce.
    setProject(next);
    setSaveState(snapshot.status);
    setWarning(snapshot.warning);
    refresh((value) => value + 1);
  }, [store]);
  const commit = useCallback((edit: (draft: Project) => void, key = "") => {
    const next = cloneProject(current.current);
    edit(next);
    const valid = validateProject(next);
    if (JSON.stringify(valid) === JSON.stringify(current.current)) return;
    const h = history.current;
    const now = performance.now();
    if (!key || h.key !== key || now - h.at > 650)
      h.past = [...h.past.slice(-49), current.current];
    h.key = key;
    h.at = now;
    h.future = [];
    publish(valid);
  }, [publish]);
  const replace = useCallback((next: Project) => {
    const valid = validateProject(next);
    const h = history.current;
    h.past = [...h.past.slice(-49), current.current];
    h.future = [];
    h.key = "";
    publish(valid);
  }, [publish]);
  const undo = useCallback(() => {
    const h = history.current;
    const next = h.past.pop();
    if (!next) return;
    h.future.push(current.current);
    h.key = "";
    publish(next);
  }, [publish]);
  const redo = useCallback(() => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(current.current);
    h.key = "";
    publish(next);
  }, [publish]);
  useEffect(() => {
    let active = true;
    // A recovered tab-local draft should not wait for another editing event.
    void store.flush().then((snapshot) => { if (active) applyStorage(snapshot); });
    const synchronize = () => applyStorage(store.refresh());
    const changed = (event: StorageEvent) => {
      if ((event.key === PROJECT_KEY || event.key === null) && event.storageArea === window.localStorage)
        synchronize();
    };
    // Never write the shared project from unload handlers. Async locks are not reliable during page exit.
    const remember = () => store.remember();
    const visibility = () => {
      if (document.visibilityState === "hidden") remember();
      else synchronize();
    };
    window.addEventListener("storage", changed);
    window.addEventListener("focus", synchronize);
    window.addEventListener("pagehide", remember);
    window.addEventListener("beforeunload", remember);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      remember();
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", synchronize);
      window.removeEventListener("pagehide", remember);
      window.removeEventListener("beforeunload", remember);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [store, applyStorage]);
  useEffect(() => {
    if (!store.snapshot().dirty) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      void store.flush().then((snapshot) => { if (active) applyStorage(snapshot); });
    }, 450);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [project, store, applyStorage]);
  return {
    project, commit, replace, undo, redo,
    canUndo: history.current.past.length > 0,
    canRedo: history.current.future.length > 0,
    saveState, warning, setWarning,
  };
}
