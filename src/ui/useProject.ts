import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../shared/model';
import { cloneProject, createDefaultProject, validateProject } from '../shared/project';
const KEY = 'cartoon-studio-project-v1';
function initialProject(): { project: Project; warning: string | null } {
  try {
    const saved = localStorage.getItem(KEY);
    return { project: saved ? validateProject(JSON.parse(saved)) : createDefaultProject(), warning: null };
  } catch {
    let recovery = false;
    try { const broken = localStorage.getItem(KEY); if (broken) { localStorage.setItem(`${KEY}-recovery-${Date.now()}`, broken); recovery = true; } } catch { /* Storage may be unavailable. */ }
    return { project: createDefaultProject(), warning: recovery ? 'Сохранённый проект повреждён. Его копия сохранена на устройстве. Открыт пример.' : 'Не удалось открыть сохранённый проект. Открыт пример.' };
  }
}
export function useProject() {
  const initial = useRef<ReturnType<typeof initialProject> | null>(null);
  if (!initial.current) initial.current = initialProject();
  const [project, setProject] = useState(initial.current.project);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saved');
  const [warning, setWarning] = useState<string | null>(initial.current.warning);
  const history = useRef<{ past: Project[]; future: Project[]; key: string; at: number }>({ past: [], future: [], key: '', at: 0 });
  const current = useRef(project);
  const [, refresh] = useState(0);
  const commit = useCallback((edit: (draft: Project) => void, key = '') => {
    const next = cloneProject(current.current); edit(next);
    const valid = validateProject(next);
    if (JSON.stringify(valid) === JSON.stringify(current.current)) return;
    const h = history.current; const now = performance.now();
    if (!key || h.key !== key || now - h.at > 650) h.past = [...h.past.slice(-49), current.current];
    h.key = key; h.at = now; h.future = [];
    current.current = valid; setProject(valid); refresh(value => value + 1);
  }, []);
  const replace = useCallback((next: Project) => {
    const valid = validateProject(next); const h = history.current;
    h.past = [...h.past.slice(-49), current.current]; h.future = []; h.key = '';
    current.current = valid; setProject(valid); refresh(value => value + 1);
  }, []);
  const undo = useCallback(() => {
    const h = history.current; const next = h.past.pop(); if (!next) return;
    h.future.push(current.current); h.key = ''; current.current = next; setProject(next); refresh(value => value + 1);
  }, []);
  const redo = useCallback(() => {
    const h = history.current; const next = h.future.pop(); if (!next) return;
    h.past.push(current.current); h.key = ''; current.current = next; setProject(next); refresh(value => value + 1);
  }, []);
  useEffect(() => {
    // Browsers can leave before the debounce fires. Keep the last valid edit on exit.
    const flush = () => {
      try { localStorage.setItem(KEY, JSON.stringify(current.current)); }
      catch { setSaveState('error'); }
    };
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(() => {
    setSaveState('saving');
    const timeout = window.setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(project)); setSaveState('saved'); }
      catch { setSaveState('error'); }
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [project]);
  return { project, commit, replace, undo, redo, canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0, saveState, warning, setWarning };
}
