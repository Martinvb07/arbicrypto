"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { dateTime, money, perUsd } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { HourBest, PastOpp } from "@/lib/types";
import { HourChart, hourLabel, type HourStat } from "../HourChart";
import { Icon, Segmented, Skeleton, Usd } from "../ui";

const RANGES = [[1, "24 h"], [7, "7 días"], [30, "30 días"]] as const;

function duration(sec: number) {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1).replace(".", ",")} h`;
}

/** Agrupa por hora del día (hora local): promedio y mejor de la ganancia por dólar, y oportunidades. */
function byHour(hours: HourBest[], opps: PastOpp[], kind: "p2p" | "spot"): HourStat[] {
  const acc = Array.from({ length: 24 }, (_, hour) => ({ hour, sum: 0, n: 0, best: null as number | null, opps: 0 }));
  for (const h of hours) {
    if (h.kind !== kind) continue;
    const a = acc[new Date(h.hour * 1000).getHours()];
    a.sum += h.best;
    a.n += 1;
    a.best = a.best == null ? h.best : Math.max(a.best, h.best);
  }
  for (const o of opps) if (o.kind === kind) acc[new Date(o.start_t * 1000).getHours()].opps += 1;
  return acc.map((a) => ({ hour: a.hour, avg: a.n ? a.sum / a.n : null, best: a.best, days: a.n, opps: a.opps }));
}

export function History() {
  const { state } = useLive();
  const [days, setDays] = useState(7);
  const [kind, setKind] = useState<"p2p" | "spot">("p2p");
  const [data, setData] = useState<{ opps: PastOpp[]; hours: HourBest[] } | null>(null);

  const load = useCallback(() => {
    api.stats(days).then(setData).catch(() => setData({ opps: [], hours: [] }));
  }, [days]);
  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  const hourStats = useMemo(() => (data ? byHour(data.hours, data.opps, kind) : []), [data, kind]);
  if (!state || !data) return <Skeleton rows={8} />;

  const opps = data.opps;
  const total = opps.reduce((a, o) => a + Math.max(1, o.end_t - o.start_t), 0);
  const best = opps.length ? Math.max(...opps.map((o) => o.best_per_usd)) : null;
  const ranked = hourStats.filter((h) => h.avg != null).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0));
  const bestHour = ranked[0];

  return (
    <div className="stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2 style={{ fontSize: 20 }}>Historial</h2>
        <Segmented label="Periodo" value={days} onChange={setDays} options={RANGES} />
      </div>

      <div className="kpis">
        <div className={`kpi ${opps.length ? "kpi-good" : ""}`}><small>Oportunidades</small><b>{opps.length}</b><span>{opps.filter((o) => o.kind === "p2p").length} P2P · {opps.filter((o) => o.kind === "spot").length} Spot</span></div>
        <div className="kpi"><small>Tiempo con oportunidad</small><b>{opps.length ? duration(total) : "—"}</b><span>suma de todas</span></div>
        <div className="kpi"><small>Duración promedio</small><b>{opps.length ? duration(total / opps.length) : "—"}</b><span>cuánto alcanzas a actuar</span></div>
        <div className="kpi"><small>Mejor ganancia</small><Usd v={best} /><span>por dólar</span></div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>¿A qué hora se acerca más a ganar?</h2>
          <Segmented label="Mercado" value={kind} onChange={setKind} options={[["p2p", "P2P"], ["spot", "Spot"]] as const} />
        </div>
        <HourChart data={hourStats} />
        {bestHour && (ranked.length < 12 ? (
          <p className="note"><Icon name="clock" size={14} /> Aún hay pocos datos ({ranked.length} de 24 horas). Deja el panel prendido unos días para ver a qué hora conviene operar.</p>
        ) : (
          <p className="note"><Icon name="clock" size={14} /> Mejor hora: <b style={{ color: "var(--text)" }}>{hourLabel(bestHour.hour)}</b> con {perUsd(bestHour.avg)} por dólar en promedio. Barras hacia arriba = hubo ganancia.</p>
        ))}
      </div>

      <div className="card">
        <div className="card-head"><h2>Oportunidades registradas</h2></div>
        {!opps.length ? (
          <p className="muted">Ninguna en este periodo. El historial se llena solo mientras el panel está prendido.</p>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Fecha</th><th>Ruta</th><th className="hide-sm">Mercado</th><th className="num">Mejor por dólar</th><th className="num">Duró</th><th className="num hide-sm">Ganancia</th></tr></thead>
              <tbody>
                {opps.map((o) => (
                  <tr key={o.id}>
                    <td className="dim">{dateTime(o.start_t * 1000)}</td>
                    <td>{o.label}</td>
                    <td className="hide-sm dim">{o.kind === "spot" ? "Spot" : "P2P"}</td>
                    <td className="num"><Usd v={o.best_per_usd} /></td>
                    <td className="num">{o.open ? <span className="badge good">Activa</span> : duration(Math.max(1, o.end_t - o.start_t))}</td>
                    <td className="num hide-sm">{money(o.best_gain, 0)} <span className="dim small">con {money(o.capital, 0)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
