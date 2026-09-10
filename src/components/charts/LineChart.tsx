import { useEffect, useMemo, useRef, useState } from 'react';

export interface Series {
  key: string;
  label: string;
  color: string;
  points: Array<{ x: number; y: number }>;
}

const SURFACE = 'var(--color-panel)';
const GRID = '#3a3835';
const AXIS_TEXT = '#8b8987';

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => span / s <= count + 0.5) ?? pow * 10;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(Math.round(v));
  return ticks;
}

const fmtMonth = (t: number) => new Date(t).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
const fmtDay = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

/**
 * Multi-series line chart with a hover crosshair. Lines are 2px, the grid is a
 * recessive hairline, series ends carry a dot and a direct label.
 */
export function LineChart({ series, height = 220, yFormat = (v: number) => String(Math.round(v)), xFormat: xFormatProp }: {
  series: Series[];
  height?: number;
  yFormat?: (v: number) => string;
  xFormat?: (x: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visible = series.filter((s) => s.points.length > 0);
  const pad = { l: 44, r: visible.length > 1 ? 86 : 56, t: 12, b: 26 };
  const all = visible.flatMap((s) => s.points);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const yMinRaw = Math.min(...ys);
  const yMaxRaw = Math.max(...ys);
  const yPad = Math.max(10, (yMaxRaw - yMinRaw) * 0.08);
  const y0 = yMinRaw - yPad;
  const y1 = yMaxRaw + yPad;
  const W = width;
  const H = height;
  const sx = (x: number) => pad.l + ((x - x0) / Math.max(1, x1 - x0)) * (W - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y - y0) / Math.max(1, y1 - y0)) * (H - pad.t - pad.b);

  const xFormat = xFormatProp ?? (x1 - x0 < 200 * 86400000 ? fmtDay : fmtMonth);
  const yTicks = useMemo(() => niceTicks(y0, y1), [y0, y1]);
  const xTicks = useMemo(() => {
    const n = Math.max(2, Math.min(6, Math.floor(W / 110)));
    return Array.from({ length: n }, (_, i) => x0 + ((x1 - x0) * i) / (n - 1));
  }, [x0, x1, W]);

  if (!visible.length) return <div ref={ref} className="flex items-center justify-center text-sm text-ink-4" style={{ height }}>Sem dados ainda.</div>;

  const nearest = (s: Series, x: number) => {
    let best = s.points[0]!;
    for (const p of s.points) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    return best;
  };
  const hoverPoints = hoverX !== null ? visible.map((s) => ({ s, p: nearest(s, hoverX) })) : [];

  return (
    <div ref={ref} className="relative w-full">
      {visible.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-4 text-[13px] text-ink-2">
          {visible.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="h-[3px] w-4 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg
        width={W}
        height={H}
        className="block"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - rect.left;
          setHoverX(x0 + ((px - pad.l) / Math.max(1, W - pad.l - pad.r)) * (x1 - x0));
        }}
        onPointerLeave={() => setHoverX(null)}
        role="img"
        aria-label={visible.map((s) => `${s.label}: ${yFormat(s.points[s.points.length - 1]!.y)}`).join(', ')}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 8} y={sy(t) + 4} textAnchor="end" fontSize={11} fill={AXIS_TEXT} style={{ fontVariantNumeric: 'tabular-nums' }}>{yFormat(t)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={sx(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} fontSize={11} fill={AXIS_TEXT}>{xFormat(t)}</text>
        ))}
        {visible.map((s) => (
          <polyline
            key={s.key}
            points={s.points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {visible.map((s) => {
          const last = s.points[s.points.length - 1]!;
          return (
            <g key={`end-${s.key}`}>
              <circle cx={sx(last.x)} cy={sy(last.y)} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />
              <text x={sx(last.x) + 8} y={sy(last.y) + 4} fontSize={12} fontWeight={700} fill="#fff">{yFormat(last.y)}</text>
              {visible.length > 1 && <text x={sx(last.x) + 8} y={sy(last.y) + 17} fontSize={10.5} fill={AXIS_TEXT}>{s.label}</text>}
            </g>
          );
        })}
        {hoverX !== null && hoverPoints.length > 0 && (
          <g pointerEvents="none">
            <line x1={sx(hoverPoints[0]!.p.x)} x2={sx(hoverPoints[0]!.p.x)} y1={pad.t} y2={H - pad.b} stroke="#6f6d6a" strokeWidth={1} />
            {hoverPoints.map(({ s, p }) => (
              <circle key={s.key} cx={sx(p.x)} cy={sy(p.y)} r={4.5} fill={s.color} stroke={SURFACE} strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hoverX !== null && hoverPoints.length > 0 && (
        <div
          className="pointer-events-none absolute top-6 z-10 rounded-md bg-black/85 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ left: Math.min(W - 150, Math.max(0, sx(hoverPoints[0]!.p.x) + 10)) }}
        >
          <div className="mb-0.5 text-ink-3">{new Date(hoverPoints[0]!.p.x).toLocaleDateString('pt-BR')}</div>
          {hoverPoints.map(({ s, p }) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="text-ink-2">{s.label}</span>
              <span className="ml-auto pl-3 font-bold tabular-nums">{yFormat(p.y)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Keeps the last value of each day, so thousands of games stay a readable line. */
export function dailyLast(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const byDay = new Map<string, { x: number; y: number }>();
  for (const p of points) byDay.set(new Date(p.x).toISOString().slice(0, 10), p);
  return [...byDay.values()].sort((a, b) => a.x - b.x);
}
