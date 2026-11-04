import type { Project, Scene } from '../shared/model';
export function SceneThumb({ project, scene }: { project: Project; scene: Scene }) {
 const backgrounds = { hills: '#d8dfcb', coast: '#d7e6e7', city: '#dedcd8', forest: '#cbd6c0', night: '#424c65' };
 return <svg viewBox="0 0 160 90" className="scene-thumb" aria-hidden="true">
  <rect width="160" height="90" fill={backgrounds[scene.backdrop]} />
  <circle cx="124" cy="22" r="12" fill={scene.backdrop === 'night' ? '#ece4b8' : '#efe3b9'} />
  {scene.backdrop === 'city' ? <path d="M0 58V34h20v24h8V23h23v35h15V39h18v19h15V30h20v28h18V42h23v48H0Z" fill="#aeb9b3" /> : <path d="M0 60Q40 21 86 59T160 48V90H0Z" fill={scene.backdrop === 'coast' ? '#88b3b7' : scene.backdrop === 'night' ? '#687782' : '#97ad89'} />}
  <path d="M0 78Q45 59 90 78T160 70V90H0Z" fill={scene.backdrop === 'coast' ? '#e8d8b7' : '#c3c7a3'} />
  {scene.actors.map(actor => { const c = project.characters.find(char => char.id === actor.characterId); if (!c) return null;
   return <g key={actor.id} transform={`translate(${actor.x * 138 + 10} ${actor.y * 90}) scale(${actor.scale * .65})`}><path d="m-5-12-2 13m12-13 2 13" stroke="#4b4848" strokeWidth="4" strokeLinecap="round" /><path d="M-9-31q9-5 18 0l2 21h-22Z" fill={c.outfit} /><path d="m-9-27-7 12m25-12 7 12" stroke={c.skin} strokeWidth="4" strokeLinecap="round" /><circle cy="-40" r="9" fill={c.skin} /><path d="M-10-39q-2-16 12-13 10 1 8 15-2-9-12-9Z" fill={c.hair} /></g>;
  })}
 </svg>;
}
