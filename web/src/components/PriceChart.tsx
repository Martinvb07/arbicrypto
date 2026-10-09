"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dateTime, hhmm, money, pct } from "@/lib/format";

/** Verde si comprar y vender gana, rojo si pierde. */
const sign = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : "");

const H = 210;

function niceStep(range: number, n: number) {
  const raw = range / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

/** Precio de compra y venta del USDT en P2P a lo largo del tiempo (dos series, un solo eje). */
type Point = { t: number; buy: number; sell: number };

export function PriceChart({ points, gapSeconds, label = "Precio" }: { points: Point[]; gapSeconds: number; label?: string }) {
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

  const geo = useMemo(() => {
    if (points.length < 2 || !width) return null;
    const narrow = width < 480;
    const m = { l: 64, r: narrow ? 10 : 70, t: 10, b: 24 };
    let lo = Math.min(...points.map((p) => Math.min(p.buy, p.sell)));
    let hi = Math.max(...points.map((p) => Math.max(p.buy, p.sell)));
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    const step = niceStep(hi - lo, 4);
    const y0 = Math.floor(lo / step) * step;
    const y1 = Math.ceil(hi / step) * step;
    const x0 = points[0].t;
    const x1 = points[points.length - 1].t;
    const X = (t: number) => m.l + ((t - x0) / (x1 - x0 || 1)) * (width - m.l - m.r);
    const Y = (v: number) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
    const line = (k: "buy" | "sell") =>
      points.map((p, i) => (i && p.t - points[i - 1].t <= gapSeconds ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p[k]).toFixed(1)).join("");
    const yTicks: number[] = [];
    for (let v = y0; v <= y1 + step / 2; v += step) yTicks.push(v);
    const span = x1 - x0;
    const tStep = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600].find((s) => span / s <= (narrow ? 3 : 6)) ?? 21600;
    const xTicks: number[] = [];
    for (let t = Math.ceil(x0 / tStep) * tStep; t <= x1; t += tStep) xTicks.push(t);
    return { m, X, Y, line, yTicks, xTicks, dec: step < 1 ? 2 : 0, narrow };
  }, [points, width, gapSeconds]);

  const enough = points.length >= 2;
  const last = points[points.length - 1];
  const hp = hover != null ? points[hover] : null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!geo || !box.current) return;
    const mx = e.clientX - box.current.getBoundingClientRect().left;
    let best = 0;
    let dist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(geo.X(p.t) - mx);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <>
      <div ref={box} className="chart">
        {!enough && <div className="empty">Recolectando precios… el gráfico aparece después de 2 revisiones del P2P.</div>}
        {enough && geo && (
          <svg viewBox={`0 0 ${width} ${H}`} role="img" aria-label={`${label}: compra y venta en P2P`}>
            {geo.yTicks.map((v) => (
              <g key={v}>
                <line className="grid" x1={geo.m.l} x2={width - geo.m.r} y1={geo.Y(v)} y2={geo.Y(v)} />
                <text className="tick" x={geo.m.l - 8} y={geo.Y(v)} textAnchor="end" dominantBaseline="middle">
                  {money(v, geo.dec)}
                </text>
              </g>
            ))}
            {geo.xTicks.map((t) => (
              <text key={t} className="tick" x={geo.X(t)} y={H - 6} textAnchor="middle">
                {hhmm(t)}
              </text>
            ))}
            <path className="ln buy" d={geo.line("buy")} />
            <path className="ln sell" d={geo.line("sell")} />
            <circle className="dot-buy" cx={geo.X(last.t)} cy={geo.Y(last.buy)} r={4} />
            <circle className="dot-sell" cx={geo.X(last.t)} cy={geo.Y(last.sell)} r={4} />
            {!geo.narrow && Math.abs(geo.Y(last.buy) - geo.Y(last.sell)) >= 14 && (
              <>
                <text className="end" x={geo.X(last.t) + 9} y={geo.Y(last.buy)} dominantBaseline="middle">
                  {money(last.buy, geo.dec)}
                </text>
                <text className="end" x={geo.X(last.t) + 9} y={geo.Y(last.sell)} dominantBaseline="middle">
                  {money(last.sell, geo.dec)}
                </text>
              </>
            )}
            {hp && (
              <g>
                <line className="cross" x1={geo.X(hp.t)} x2={geo.X(hp.t)} y1={geo.m.t} y2={H - geo.m.b} />
                <circle className="dot-buy" cx={geo.X(hp.t)} cy={geo.Y(hp.buy)} r={4} />
                <circle className="dot-sell" cx={geo.X(hp.t)} cy={geo.Y(hp.sell)} r={4} />
              </g>
            )}
            <rect x={geo.m.l} y={0} width={Math.max(0, width - geo.m.l - geo.m.r)} height={H} fill="transparent"
              onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
        )}
        {hp && geo && (
          <div className="tip" style={{
            left: geo.X(hp.t) + 14 + 170 > width ? geo.X(hp.t) - 184 : geo.X(hp.t) + 14,
            top: Math.max(0, Math.min(geo.Y(hp.buy), geo.Y(hp.sell)) - 20),
          }}>
            <div className="when">{dateTime(hp.t * 1000)}</div>
            <div className="row"><span><i className="key" style={{ ["--c" as string]: "var(--s1)" }} />Compra</span><b>{money(hp.buy)}</b></div>
            <div className="row"><span><i className="key" style={{ ["--c" as string]: "var(--s2)" }} />Venta</span><b>{money(hp.sell)}</b></div>
            <div className="row"><span>Comprar y vender</span><b className={sign(hp.sell / hp.buy - 1)}>{pct(hp.sell / hp.buy - 1)}</b></div>
          </div>
        )}
      </div>
      {enough && <details className="data">
        <summary>Ver datos en tabla</summary>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="t">
            <thead><tr><th>Hora</th><th className="num">Compra</th><th className="num">Venta</th><th className="num">Comprar y vender</th></tr></thead>
            <tbody>
              {points.slice(-12).reverse().map((p) => (
                <tr key={p.t}>
                  <td>{dateTime(p.t * 1000)}</td>
                  <td className="num">{money(p.buy)}</td>
                  <td className="num">{money(p.sell)}</td>
                  <td className={`num ${sign(p.sell / p.buy - 1)}`}>{pct(p.sell / p.buy - 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>}
    </>
  );
}
