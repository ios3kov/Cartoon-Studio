import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Project, RenderStatus, StudioRenderer } from '../shared/model';
import { createStudioRenderer } from '../engine/index';
import { errorText } from '../ui/api';
export function CanvasStage({ project, time }: { project: Project; time: number }) {
  const canvas = useRef<HTMLCanvasElement>(null); const renderer = useRef<StudioRenderer | null>(null);
  const state = useRef({ project, time }); state.current = { project, time };
  const [status, setStatus] = useState<RenderStatus | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!canvas.current) return;
    try { renderer.current = createStudioRenderer(canvas.current); }
    catch (reason) { setError(errorText(reason)); setLoading(false); }
    return () => { renderer.current?.dispose(); renderer.current = null; };
  }, []);
  useEffect(() => {
    const instance = renderer.current; if (!instance) return; let active = true;
    setLoading(true); setError('');
    instance.prepare(project).then(result => { if (active) { setStatus(result); instance.render(state.current.project, state.current.time); } }).catch(reason => { if (active) setError(errorText(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [project]);
  useEffect(() => { try { renderer.current?.render(project, time); } catch (reason) { setError(errorText(reason)); } }, [project, time]);
  return <div className="canvas-wrap" style={{ aspectRatio: `${project.width}/${project.height}`, '--canvas-ratio': project.width / project.height } as CSSProperties}>
    <canvas ref={canvas} width={project.width} height={project.height} aria-label="Предпросмотр мультфильма" />
    {loading && <div className="canvas-status" role="status"><span className="spinner" />Готовим рисунок</div>}
    {error && <div className="canvas-error" role="alert">{error}</div>}
    {!loading && !error && status?.backend === 'canvas2d' && <div className="canvas-status fallback" title={status.message}>Упрощённый рисунок</div>}
  </div>;
}
