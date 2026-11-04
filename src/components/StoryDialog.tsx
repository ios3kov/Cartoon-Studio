import { useEffect, useRef, useState } from 'react';
import type { Health, Project } from '../shared/model';
import { createStoryFromPrompt } from '../shared/project';
import { errorText, request } from '../ui/api';
import { Icon } from './Icon';
import { Modal } from './Modal';
export function StoryDialog({ project, onClose, onCreate }: { project: Project; onClose: () => void; onCreate: (project: Project) => void }) {
 const [prompt, setPrompt] = useState(''); const [mode, setMode] = useState<'local' | 'ai'>('local');
 const [health, setHealth] = useState<Health | null>(null); const [checking, setChecking] = useState(true);
 const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const controller = useRef<AbortController | null>(null);
 useEffect(() => {
  const abort = new AbortController();
  void request<Health>('/api/health', { signal: abort.signal }).then(setHealth).catch(() => {}).finally(() => setChecking(false));
  return () => { abort.abort(); controller.current?.abort(); };
 }, []);
 async function create() {
  if (!prompt.trim() || busy) return; setError(''); setBusy(true);
  try {
   if (mode === 'local') { onCreate(createStoryFromPrompt(prompt, project)); return; }
   controller.current = new AbortController();
   const result = await request<{ project: Project; source: 'ai' }>('/api/storyboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, project }), signal: controller.current.signal });
   onCreate(result.project);
  } catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(errorText(reason)); }
  finally { setBusy(false); }
 }
 return <Modal title="С чего начнётся история?" eyebrow="НОВЫЙ МУЛЬТФИЛЬМ" onClose={onClose}>
  <p className="dialog-intro">Опишите героев, место и маленькое приключение. Внешность героев и рисунок сохранятся.</p>
  <label className="field">Ваша идея<textarea value={prompt} maxLength={1000} onChange={event => setPrompt(event.target.value)} placeholder="Две подруги идут через лес к морю и находят старую лодку…" rows={5} disabled={busy} /><span className="field-note">{prompt.length}/1000</span></label>
  <div className="choice-buttons"><button className={mode === 'local' ? 'selected' : ''} aria-pressed={mode === 'local'} onClick={() => setMode('local')} disabled={busy}>Черновик по шаблону<span>Три сцены · без нейросети</span></button><button className={mode === 'ai' ? 'selected' : ''} aria-pressed={mode === 'ai'} onClick={() => setMode('ai')} disabled={busy || !health?.aiConfigured}>Сценарий с AI<span>{checking ? 'Проверяем подключение…' : health?.aiConfigured ? 'По вашему описанию' : 'Требуется подключение'}</span></button></div>
  <p className="info-note">{mode === 'local' ? 'Шаблон подберёт место и действия. Текст истории вы сможете изменить в сценах.' : 'AI создаст сцены и действия. Проверьте результат перед экспортом.'}</p>
  {!checking && !health?.aiConfigured && <p className="info-note">Для AI укажите ключ и модель в настройках сервера. Инструкция есть в README проекта.</p>}
  <p className="info-note">Новая история заменит текущую. Кнопка «Отменить» вернёт предыдущий проект.</p>
  {error && <p className="inline-error" role="alert">{error}</p>}
  <div className="dialog-actions"><button className="button quiet" onClick={onClose}>Отмена</button><button className="button primary" onClick={() => void create()} disabled={!prompt.trim() || busy}>{busy ? <span className="spinner" /> : <Icon name={mode === 'ai' ? 'spark' : 'arrow'} size={16} />}{busy ? 'Создаём сцены…' : mode === 'ai' ? 'Создать с AI' : 'Создать черновик'}</button></div>
 </Modal>;
}
