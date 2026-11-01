/** Original SVG artwork: club crests and player portraits are drawn from the data, so nothing here imitates a real badge or person. */
import { useId } from 'react';
import type { Appearance, Crest as CrestData } from '../engine/types';

const SHAPES = [
  'M4 4 H36 V26 C36 36 28 43 20 46 C12 43 4 36 4 26 Z',
  'M20 3 C30.5 3 38 10.5 38 21 C38 31.5 30.5 39 20 45 C9.5 39 2 31.5 2 21 C2 10.5 9.5 3 20 3 Z',
  'M4 4 H36 V34 L20 46 L4 34 Z',
  'M20 2 L37 12 V34 L20 46 L3 34 V12 Z',
];

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function Crest({ crest, size = 32, title }: { crest: CrestData; size?: number; title?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const path = SHAPES[crest.shape % SHAPES.length];
  const base = crest.primary;
  const ink = luminance(base) > 0.6 ? '#0f1211' : '#ffffff';
  return (
    <svg width={size} height={(size * 48) / 40} viewBox="0 0 40 48" role="img" aria-label={title ?? 'Club crest'} className="shrink-0">
      <defs><clipPath id={`c${id}`}><path d={path} /></clipPath></defs>
      <g clipPath={`url(#c${id})`}>
        <rect width="40" height="48" fill={base} />
        {crest.pattern === 1 && [8, 20, 32].map((x) => <rect key={x} x={x - 3.5} y="0" width="7" height="48" fill={crest.secondary} />)}
        {crest.pattern === 2 && <rect x="0" y="17" width="40" height="13" fill={crest.secondary} />}
        {crest.pattern === 3 && <path d="M0 48 L40 0 V16 L0 48 Z" fill={crest.secondary} />}
      </g>
      <path d={path} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="1.6" />
      <path d={path} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.6" />
      <text x="20" y="28" textAnchor="middle" fontSize={crest.initials.length > 2 ? 11 : 14} fontWeight="800" fill={ink} stroke={ink === '#ffffff' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)'} strokeWidth="0.35" fontFamily="system-ui, sans-serif">
        {crest.initials}
      </text>
    </svg>
  );
}

const SKINS = ['#f6d7bd', '#e8b895', '#c98f66', '#a6693f', '#7a4a2a', '#4a2c1a'];
const HAIRS = ['#16110d', '#3b2616', '#6b4423', '#b8893f', '#cfcfcf', '#a63a1f'];

export function Portrait({ look, kit = '#10b981', size = 64, title }: { look: Appearance; kit?: string; size?: number; title?: string }) {
  const skin = SKINS[look.skin % SKINS.length];
  const hair = HAIRS[look.hair % HAIRS.length];
  const style = look.style % 6;
  const shade = 'rgba(0,0,0,0.16)';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title ?? 'Player portrait'} className="shrink-0 rounded-lg bg-ink-700">
      <rect width="64" height="64" fill="#222926" />
      <path d="M6 64 C8 50 18 45 32 45 C46 45 56 50 58 64 Z" fill={kit} />
      <path d="M26 45 L32 52 L38 45" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.4" />
      <rect x="27" y="36" width="10" height="11" rx="3" fill={skin} />
      <rect x="27" y="40" width="10" height="3" fill={shade} />
      {style === 3 && <path d="M18 26 C16 40 18 46 22 48 L24 30 Z M46 26 C48 40 46 46 42 48 L40 30 Z" fill={hair} />}
      {style === 4 && <ellipse cx="32" cy="22" rx="16.5" ry="15" fill={hair} />}
      <ellipse cx="32" cy="28" rx="11.5" ry="13.5" fill={skin} />
      <ellipse cx="20.6" cy="29" rx="2" ry="3" fill={skin} />
      <ellipse cx="43.4" cy="29" rx="2" ry="3" fill={skin} />
      {style === 0 && <path d="M20 25 C19 13 28 10 33 10 C42 10 46 17 44 25 C41 20 36 18 32 18 C27 18 23 20 20 25 Z" fill={hair} />}
      {style === 1 && <path d="M20.5 24 C20 15 26 12.5 32 12.5 C38 12.5 44 15 43.5 24 C41 19 37 17.5 32 17.5 C27 17.5 23 19 20.5 24 Z" fill={hair} opacity="0.85" />}
      {style === 2 && (
        <g fill={hair}>
          <circle cx="23" cy="17" r="5" /><circle cx="29" cy="13" r="5" /><circle cx="36" cy="13" r="5" /><circle cx="42" cy="17" r="5" /><circle cx="32" cy="17" r="5" />
        </g>
      )}
      {style === 3 && <path d="M20 26 C19 12 28 9.5 33 9.5 C43 9.5 46 17 44 26 C41 19 36 17 32 17 C27 17 23 19 20 26 Z" fill={hair} />}
      {style === 4 && <path d="M21 23 C22 17 27 15.5 32 15.5 C37 15.5 42 17 43 23 C40 20 36 19 32 19 C28 19 24 20 21 23 Z" fill={hair} />}
      {style === 5 && <path d="M21.5 25 C21 20 23 17.5 25 17 C24 21 24 23 24 25 Z M42.5 25 C43 20 41 17.5 39 17 C40 21 40 23 40 25 Z" fill={hair} opacity="0.8" />}
      <circle cx="27.3" cy="28.5" r="1.25" fill="#1b1b1b" />
      <circle cx="36.7" cy="28.5" r="1.25" fill="#1b1b1b" />
      <path d="M28 35.5 C30.5 37 33.5 37 36 35.5" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function KitDot({ crest, size = 12 }: { crest: CrestData; size?: number }) {
  return <span className="inline-block rounded-full border border-black/40" style={{ width: size, height: size, background: `linear-gradient(135deg, ${crest.primary} 55%, ${crest.secondary} 55%)` }} aria-hidden />;
}
