import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExportJob, ExportPreset, Health, Project } from '../shared/model';
import { getDuration } from '../shared/project';
import { errorText, formatTime, request } from '../ui/api';
import { Modal } from './Modal';
import { Icon } from './Icon';
export function ExportDialog({ project, onClose }: { project: Project; onClose: () => void }) {
 const [health, setHealth] = useState<Health | null>(null); const [checking, setChecking] = useState(true); const [error, setError] = useState('');
 const [preset, setPreset] = useState<ExportPreset>('hd'); const [job, setJob] = useState<ExportJob | null>(null); const [busy, setBusy] = useState(false);
 const mounted = useRef(true); const lastJob = useRef<ExportJob | null>(null); lastJob.current = job;
 const active = job && ['queued', 'rendering', 'encoding'].includes(job.status);
 const check = useCallback(async () => { setChecking(true); setError(''); try { setHealth(await request<Health>('/api/health')); } catch (reason) { setError(errorText(reason)); } finally { setChecking(false); } }, []);
 useEffect(() => { mounted.current = true; void check(); return () => { mounted.current = false; const current = lastJob.current; if (current && ['queued', 'rendering', 'encoding'].includes(current.status)) void request(`/api/exports/${current.id}`, { method: 'DELETE' }).catch(() => {}); }; }, [check]);
 useEffect(() => {
  if (!active || !job) return; let abort = false; let timer = 0;
  const poll = async () => { try { const next = await request<ExportJob>(`/api/exports/${job.id}`); if (abort) return; setJob(next); if (['queued', 'rendering', 'encoding'].includes(next.status)) timer = window.setTimeout(() => void poll(), 700); } catch (reason) { if (!abort) { setError(errorText(reason)); timer = window.setTimeout(() => void poll(), 1800); } } };
  timer = window.setTimeout(() => void poll(), 500);
  return () => { abort = true; clearTimeout(timer); };
 }, [active, job?.id]);
 async function start() {
  setBusy(true); setError('');
  try {
   const next = await request<ExportJob>('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, preset }) });
   if (mounted.current) setJob(next); else void request(`/api/exports/${next.id}`, { method: 'DELETE' }).catch(() => {});
  } catch (reason) { if (mounted.current) setError(errorText(reason)); } finally { if (mounted.current) setBusy(false); }
 }
 async function cancel() { if (!job) return; setBusy(true); try { setJob(await request<ExportJob>(`/api/exports/${job.id}`, { method: 'DELETE' })); setError(''); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); } }
 const width = Math.round((project.width / Math.max(project.width, project.height) * (preset === 'hd' ? 1280 : 640)) / 2) * 2;
 const height = Math.round((project.height / Math.max(project.width, project.height) * (preset === 'hd' ? 1280 : 640)) / 2) * 2;
 const status = { queued: 'Подготовка', rendering: 'Рисуем кадры', encoding: 'Собираем видео и звук', done: 'Видео готово', error: 'Не удалось создать видео', cancelled: 'Экспорт отменён' };
 const ready = health?.ffmpeg && health?.browser;
 return <Modal title={job?.status === 'done' ? 'История готова.' : 'Сохранить мультфильм'} eyebrow="ЭКСПОРТ В MP4" onClose={onClose}>
  {job?.status === 'done' ? <><div className="success-mark"><Icon name="check" size={23} /></div><p className="dialog-intro">«{project.title}» можно скачать и отправить друзьям.</p></> : <p className="dialog-intro">Сохраним рисунок, движения, текст и звук в одном видео.</p>}
  {!job && <><div className="choice-buttons"><button className={preset === 'hd' ? 'selected' : ''} aria-pressed={preset === 'hd'} onClick={() => setPreset('hd')} disabled={busy}>Хорошее качество<span>1280 px · для готовой истории</span></button><button className={preset === 'draft' ? 'selected' : ''} aria-pressed={preset === 'draft'} onClick={() => setPreset('draft')} disabled={busy}>Быстрая проверка<span>640 px · меньше ожидания</span></button></div></>}
  <div className="export-summary"><div>{width} × {height}<span>Размер кадра</span></div><div>{formatTime(getDuration(project))}<span>Длительность</span></div><div>{project.fps}<span>Кадров в секунду</span></div></div>
  {!job && <>{checking ? <p className="status-row"><span className="spinner" />Проверяем готовность студии…</p> : ready ? <p className="status-row"><Icon name="check" size={15} />Студия готова к экспорту</p> : <p className="inline-error" role="alert">{!health ? 'Сервер недоступен. Запустите студию вместе с сервером.' : !health.browser ? 'Браузер для экспорта не установлен. Выполните настройку из README.' : 'FFmpeg не найден. Установите его по инструкции в README.'}</p>}</>}
  {job && <div aria-live="polite"><p className="progress-label"><span>{status[job.status]}</span><span>{Math.round(job.progress * 100)}%</span></p><div className="export-progress"><div style={{ width: `${Math.max(0, Math.min(100, job.progress * 100))}%` }} /></div>{job.frames != null && job.totalFrames != null && active && <p className="info-note">Кадр {job.frames} из {job.totalFrames}</p>}{active && <p className="info-note">Окно можно закрыть, чтобы отменить экспорт.</p>}{job.error && <p className="inline-error" role="alert">{job.error}</p>}</div>}
  {error && <p className="inline-error" role="alert">{error}</p>}
  <div className="dialog-actions">
   {active ? <button className="button subtle" disabled={busy} onClick={() => void cancel()}><Icon name="close" size={16} />{busy ? 'Отменяем…' : 'Отменить экспорт'}</button> : job?.status === 'done' && job.downloadUrl ? <><button className="button quiet" onClick={onClose}>Готово</button><a className="button primary" href={job.downloadUrl} download><Icon name="download" size={16} />Скачать MP4</a></> : job ? <><button className="button quiet" onClick={onClose}>Закрыть</button><button className="button primary" onClick={() => { setJob(null); setError(''); void check(); }}>Попробовать снова</button></> : <><button className="button quiet" onClick={onClose}>Отмена</button>{!checking && !ready ? <button className="button subtle" onClick={() => void check()}>Проверить снова</button> : <button className="button primary" disabled={checking || !ready || busy} onClick={() => void start()}>{busy ? <span className="spinner" /> : <Icon name="film" size={16} />}{busy ? 'Запускаем…' : 'Создать видео'}</button>}</>}
  </div>
 </Modal>;
}
