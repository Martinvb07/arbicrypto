"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ImportModal } from "./ImportModal";
import { date } from "@/lib/format";
import { Coin, Icon, Note } from "./ui";
import { useWallet } from "./wallet";

/** Página de Binance donde se crean las API Keys. */
export const BINANCE_API_URL = "https://www.binance.com/es/my/settings/api-management";

function ago(t: number | null | undefined, now: number): string {
  if (!t) return "nunca";
  const m = Math.max(0, Math.round((now - t) / 60));
  if (m < 1) return "hace un momento";
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

/** Conexión con Binance: es la misma del panel (Mi Binance). La wallet no guarda llaves; sincroniza sola cada 30 min. */
export function BinanceCard({ compact, alertsOnly }: { compact?: boolean; alertsOnly?: boolean }) {
  const { binance, setBinance, toast } = useWallet();
  const [upload, setUpload] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [hideOld, setHideOld] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 30000);
    try { setHideOld(localStorage.getItem("acw-hide-old-p2p") === "1"); } catch { /* sin almacenamiento */ }
    return () => clearInterval(t);
  }, []);

  const dismissOld = () => {
    setHideOld(true);
    try { localStorage.setItem("acw-hide-old-p2p", "1"); } catch { /* sin almacenamiento */ }
  };

  if (!binance) return null;
  const job = binance.job;
  const running = job.state === "running";

  async function syncNow() {
    try {
      setBinance(await api.binanceSync());
    } catch (err) {
      toast("No se pudo sincronizar", (err as Error).message, "bad");
    }
  }

  if (!binance.connected) {
    if (alertsOnly) return null;
    return (
      <div className="card card-pad binance-card">
        <div className="binance-head">
          <span className="binance-logo" aria-hidden="true"><Coin asset="BNB" size={28} /></span>
          <div style={{ flex: 1 }}>
            <h2>Conecta tu Binance en el panel</h2>
            <p className="muted">
              La wallet usa la misma conexión que el panel (<b>Mi Binance</b>): la conectas una vez allá y tu wallet se llena sola
              con tu historial. Sin Binance conectado, la wallet queda vacía.
            </p>
          </div>
          <a className="btn btn-primary" href={binance.panel_url}>
            <Icon name="link" size={16} /> Ir a Mi Binance
          </a>
        </div>
      </div>
    );
  }

  const error_ = !running && (job.state === "error" ? job.step : binance.last_error);
  const oldP2P = !binance.has_old_p2p && !hideOld && !!binance.p2p_api_from;
  if (alertsOnly) {
    if (!error_ && !(!running && binance.notes?.length) && !oldP2P) return null;
    return (
      <div className="stack">
        {error_ && (
          <Note kind="bad">
            <b>Binance no se pudo actualizar:</b> {error_}{" "}
            <a className="link" href={BINANCE_API_URL} target="_blank" rel="noopener noreferrer">Revisar mis API en Binance</a>
          </Note>
        )}
        {!running && !!binance.notes?.length && <Note kind="warn">Algunas partes no se pudieron leer y se reintentan solas: {binance.notes.join(" · ")}</Note>}
        {oldP2P && (
          <Note kind="warn">
            <b>¿Hiciste P2P antes del {date(binance.p2p_api_from!)}?</b> Binance no los entrega por API. Descárgalos en Binance
            (<b>P2P → Órdenes → Exportar</b>) y súbelos una vez.
            <div className="actions" style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={() => setUpload(true)}><Icon name="upload" size={14} /> Subir archivo de Binance</button>
              <button className="btn btn-sm btn-ghost" onClick={dismissOld}>No hice P2P antes</button>
            </div>
          </Note>
        )}
        {upload && <ImportModal onClose={() => setUpload(false)} />}
      </div>
    );
  }

  return (
    <div className={`card ${compact ? "binance-line" : "card-pad"}`}>
      <div className="binance-row">
        <span className={`dot ${running ? "busy" : error_ ? "bad" : "good"}`} aria-hidden="true" />
        <div className="binance-text">
          <b>{running ? "Sincronizando con Binance…" : error_ ? "Binance: no se pudo sincronizar" : "Binance conectado"}</b>
          <span className="muted">
            {running ? job.step : `Conectada desde el panel (llave ${binance.hint}) · última actualización ${ago(binance.last_ok, now)} · se actualiza sola cada 30 min`}
          </span>
        </div>
        <div className="actions">
          <button className="btn btn-sm" onClick={syncNow} disabled={running}>
            {running ? <span className="spinner" /> : <Icon name="refresh" size={14} />} Actualizar
          </button>
          {!compact && <a className="btn btn-sm btn-ghost" href={binance.panel_url}>Administrar en el panel</a>}
        </div>
      </div>
      {error_ && (
        <div className={compact ? "binance-extra" : ""} style={compact ? undefined : { marginTop: 12 }}>
          <Note kind="bad">
            {error_}{" "}
            <a className="link" href={BINANCE_API_URL} target="_blank" rel="noopener noreferrer">Revisar mis API en Binance</a>
            {" · "}
            <a className="link" href={binance.panel_url}>Cambiar la llave en el panel</a>
          </Note>
        </div>
      )}
      {!running && !!binance.notes?.length && (
        <div className={compact ? "binance-extra" : ""} style={compact ? undefined : { marginTop: 12 }}>
          <Note kind="warn">Algunas partes no se pudieron leer y se reintentan solas: {binance.notes.join(" · ")}</Note>
        </div>
      )}
      {!binance.has_old_p2p && !hideOld && binance.p2p_api_from && (
        <div className={compact ? "binance-extra" : ""} style={compact ? undefined : { marginTop: 12 }}>
          <Note kind="warn">
            <b>¿Hiciste P2P antes del {date(binance.p2p_api_from)}?</b> Binance no los entrega por API. Descárgalos en Binance
            (<b>P2P → Órdenes → Exportar</b>) y súbelos una vez.
            <div className="actions" style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={() => setUpload(true)}><Icon name="upload" size={14} /> Subir archivo de Binance</button>
              <button className="btn btn-sm btn-ghost" onClick={dismissOld}>No hice P2P antes</button>
            </div>
          </Note>
        </div>
      )}
      {upload && <ImportModal onClose={() => setUpload(false)} />}
    </div>
  );
}
