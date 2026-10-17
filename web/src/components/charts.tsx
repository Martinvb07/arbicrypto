"use client";

import { useId, useMemo, useRef, useState, type ReactNode } from "react";

/** Gráficas livianas en SVG para Inicio: área con cursor, mini-gráfica, barras de ganancia/pérdida y dona. */

const W = 600;

function extent(vs: number[]) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vs) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (hi - lo < 1e-9) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.12;
  return [lo - pad, hi + pad];
}

/** Mini-gráfica sin ejes para las tarjetas (verde si subió, rojo si bajó). */
export function Sparkline({ values, tone, height = 44 }: { values: number[]; tone: "up" | "down" | "flat"; height?: number }) {
  const id = useId().replace(/:/g, "");
  if (values.length < 2) return <div className="spark spark-empty" style={{ height }} />;
  const [lo, hi] = extent(values);
  const h = 100;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, h - ((v - lo) / (hi - lo)) * h] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  return (
    <svg className={`spark ${tone}`} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={`sg${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".28" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${W},${h}L0,${h}Z`} fill={`url(#sg${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Área con eje de valores a la derecha, cursor y tooltip al pasar el mouse. */
export function AreaChart({ points, fmt, fmtT, tone = "brand", height = 220, empty }: {
  points: { t: number; v: number }[];
  fmt: (v: number) => string;
  fmtT: (t: number) => string;
  tone?: "brand" | "up" | "down";
  height?: number;
  empty?: ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const box = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const H = 240, top = 10, bottom = 26, right = 0; // el eje de valores va en HTML, en una columna fija a la derecha
  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const [lo, hi] = extent(points.map((p) => p.v));
    const t0 = points[0].t, t1 = points[points.length - 1].t;
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (W - right);
    const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
    const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * (k + 0.5)) / 4);
    return { x, y, line, ticks, base: H - bottom };
  }, [points]);
  if (!geo) return <div className="chart-empty" style={{ height }}>{empty ?? "Todavía no hay datos suficientes"}</div>;
  const move = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0, d = Infinity;
    points.forEach((p, i) => {
      const dd = Math.abs(geo.x(p.t) - px);
      if (dd < d) { d = dd; best = i; }
    });
    setHover(best);
  };
  const hp = hover != null ? points[hover] : null;
  return (
    <div className={`area-chart ${tone}`} style={{ height }}>
      <svg ref={box} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerMove={move} onPointerLeave={() => setHover(null)}
        role="img" aria-label={`Gráfica de ${fmtT(points[0].t)} a ${fmtT(points[points.length - 1].t)}`}>
        <defs>
          <linearGradient id={`ag${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".32" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo.ticks.map((v) => (
          <line key={v} className="grid" x1="0" x2={W - right} y1={geo.y(v)} y2={geo.y(v)} vectorEffect="non-scaling-stroke" />
        ))}
        <path d={`${geo.line}L${geo.x(points[points.length - 1].t)},${geo.base}L0,${geo.base}Z`} fill={`url(#ag${id})`} />
        <path className="line" d={geo.line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hp && (
          <>
            <line className="cross" x1={geo.x(hp.t)} x2={geo.x(hp.t)} y1={top} y2={geo.base} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {/* textos en HTML para que no se deformen con el ancho */}
      <div className="area-y">{geo.ticks.map((v) => <span key={v} style={{ top: `${(geo.y(v) / H) * 100}%` }}>{fmt(v)}</span>)}</div>
      <div className="area-x"><span>{fmtT(points[0].t)}</span><span>{fmtT(points[points.length - 1].t)}</span></div>
      {hp && (
        <>
          <span className="area-dot" style={{ left: `calc(${geo.x(hp.t) / W} * (100% - 72px))`, top: `calc(${geo.y(hp.v) / H} * (100% - 26px))` }} />
          <div className="area-tip" style={{ left: `calc(${Math.min(0.8, Math.max(0.15, geo.x(hp.t) / W))} * (100% - 72px))` }}>
            <b>{fmt(hp.v)}</b>
            <small>{fmtT(hp.t)}</small>
          </div>
        </>
      )}
    </div>
  );
}

/** Barras de ganancia (arriba, verde) y pérdida (abajo, rojo) por día, con tooltip. */
export function GainBars({ items, fmt, height = 170 }: { items: { k: string; label: string; v: number; n: number }[]; fmt: (v: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...items.map((i) => Math.abs(i.v)));
  const hasNeg = items.some((i) => i.v < -0.5);
  const zero = hasNeg ? 50 : 100;
  return (
    <div className="gbars" style={{ height }} onPointerLeave={() => setHover(null)}>
      <div className="gbars-zero" style={{ top: `${zero}%` }} />
      {items.map((it, i) => {
        const h = (Math.abs(it.v) / max) * (hasNeg ? 50 : 100);
        return (
          <div key={it.k} className={`gbar ${hover === i ? "on" : ""}`} onPointerEnter={() => setHover(i)}>
            {Math.abs(it.v) >= 0.5 && (
              <span className={`gbar-fill ${it.v >= 0 ? "up" : "down"}`}
                style={it.v >= 0 ? { bottom: `${100 - zero}%`, height: `${h}%` } : { top: `${zero}%`, height: `${h}%` }} />
            )}
          </div>
        );
      })}
      {hover != null && items[hover] && (
        <div className="gbars-tip" style={{ left: `${Math.min(84, Math.max(16, ((hover + 0.5) / items.length) * 100))}%` }}>
          <small>{items[hover].label}</small>
          <b className={items[hover].v > 0.5 ? "up" : items[hover].v < -0.5 ? "down" : ""}>{fmt(items[hover].v)}</b>
          <small>{items[hover].n ? `${items[hover].n} venta${items[hover].n === 1 ? "" : "s"}` : "sin ventas"}</small>
        </div>
      )}
    </div>
  );
}

/** Dona de cómo está repartido tu capital, con leyenda y el valor del pedazo bajo el mouse en el centro. */
export function Donut({ items, center, fmt }: { items: { label: string; v: number; color: string; icon?: ReactNode }[]; center: ReactNode; fmt: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = items.reduce((a, i) => a + i.v, 0) || 1;
  const R = 52, C = 2 * Math.PI * R, gap = items.length > 1 ? 2.5 : 0;
  let acc = 0;
  return (
    <div className="donut">
      <div className="donut-ring">
        <svg viewBox="0 0 140 140" role="img" aria-label="Cómo está repartido tu capital">
          <circle cx="70" cy="70" r={R} fill="none" className="donut-track" strokeWidth="16" />
          {items.map((it, i) => {
            const len = (it.v / total) * C;
            const seg = (
              <circle key={it.label} cx="70" cy="70" r={R} fill="none" stroke={it.color} strokeWidth={hover === i ? 19 : 16}
                strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)"
                className="donut-seg" style={{ opacity: hover == null || hover === i ? 1 : 0.35 }}
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
            );
            acc += len;
            return seg;
          })}
        </svg>
        <div className="donut-center">
          {hover != null ? <><small>{items[hover].label}</small><b>{fmt(items[hover].v)}</b><small>{Math.round((items[hover].v / total) * 100)} %</small></> : center}
        </div>
      </div>
      <ul className="donut-legend">
        {items.map((it, i) => (
          <li key={it.label} className={hover === i ? "on" : ""} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <i style={{ background: it.color }} />
            {it.icon}
            <span>{it.label}</span>
            <b>{Math.round((it.v / total) * 100)} %</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
