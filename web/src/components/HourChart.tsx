"use client";

import { useEffect, useRef, useState } from "react";
import { perUsd } from "@/lib/format";

export interface HourStat {
  hour: number; // 0-23, hora local
  avg: number | null; // promedio de la mejor ganancia por dólar vista en esa hora
  best: number | null;
  days: number;
  opps: number;
}

const H = 220;
const M = { l: 58, r: 8, t: 14, b: 26 };

function niceStep(range: number, n: number) {
  const raw = range / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

/** Barra con el extremo de datos redondeado y el lado de la línea cero recto. */
function barPath(x: number, w: number, y0: number, y1: number, r: number) {
  const up = y1 < y0;
  const h = Math.abs(y1 - y0);
  const rr = Math.min(r, h, w / 2);
  if (up) {
    return `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 + rr}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 - rr}V${y0}Z`;
}

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "a. m." : "p. m."}`;

/** Promedio por hora del día de la mejor ganancia por dólar (barras divergentes alrededor de cero). */
export function HourChart({ data }: { data: HourStat[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = data.map((d) => d.avg).filter((v): v is number => v != null);
  if (!values.length) {
    return <div ref={box} className="chart" style={{ height: H }}><div className="empty">Todavía no hay datos: se llenan solos mientras el panel está prendido.</div></div>;
  }
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (hi - lo < 1e-9) hi = lo + 1;
  const step = niceStep(hi - lo, 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const plotW = Math.max(0, width - M.l - M.r);
  const slot = plotW / 24;
  const barW = Math.min(24, slot * 0.62);
  const Y = (v: number) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  const h = hover != null ? data[hover] : null;

  return (
    <div ref={box} className="chart" style={{ height: H }}>
      {width > 0 && (
        <svg viewBox={`0 0 ${width} ${H}`} role="img" aria-label="Mejor ganancia por dólar según la hora del día">
          {ticks.map((v) => (
            <g key={v}>
              <line className="grid" x1={M.l} x2={width - M.r} y1={Y(v)} y2={Y(v)} />
              <text className="tick" x={M.l - 8} y={Y(v)} textAnchor="end" dominantBaseline="middle">{perUsd(v)}</text>
            </g>
          ))}
          <line className="zero" x1={M.l} x2={width - M.r} y1={Y(0)} y2={Y(0)} />
          {data.map((d, i) => {
            const x = M.l + i * slot + (slot - barW) / 2;
            return (
              <g key={d.hour}>
                {d.avg != null && Math.abs(Y(d.avg) - Y(0)) > 0.5 && (
                  <path className={`bar ${d.avg >= 0 ? "pos" : "neg"} ${hover === i ? "on" : ""}`} d={barPath(x, barW, Y(0), Y(d.avg), 4)} />
                )}
                {d.hour % 3 === 0 && (
                  <text className="tick" x={M.l + i * slot + slot / 2} y={H - 6} textAnchor="middle">{d.hour}h</text>
                )}
                <rect x={M.l + i * slot} y={0} width={slot} height={H - M.b} fill="transparent"
                  onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onPointerLeave={() => setHover(null)} />
              </g>
            );
          })}
        </svg>
      )}
      {h && hover != null && (
        <div className="tip" style={{ left: Math.min(M.l + hover * slot + slot, width - 190), top: 8 }}>
          <div className="when">{hourLabel(h.hour)} a {hourLabel((h.hour + 1) % 24)}</div>
          <div className="row"><span>Promedio</span><b className={h.avg != null && h.avg > 0 ? "up" : "down"}>{perUsd(h.avg)}</b></div>
          <div className="row"><span>Mejor momento</span><b>{perUsd(h.best)}</b></div>
          <div className="row"><span>Oportunidades</span><b>{h.opps}</b></div>
          <div className="row"><span>Días con datos</span><b>{h.days}</b></div>
        </div>
      )}
    </div>
  );
}

export { hourLabel };
