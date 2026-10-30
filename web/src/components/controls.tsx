"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Ad, State } from "@/lib/types";
import { Icon } from "./ui";

const GMF = 0.004;

/** Nota de costos que va debajo de cada tabla. */
export function costsNote(s: State) {
  return s.settings.gmf > 0 ? "Ya descuenta comisiones, redondeo de Binance, colchón por movimiento de precio y el 4x1000 de lo que pagas (0,4 % de tu capital)." : "Ya descuenta comisiones, redondeo de Binance y colchón por movimiento de precio · sin 4x1000.";
}

export function CostsNote({ s, extra }: { s: State; extra?: string }) {
  return <p className="note"><Icon name="check" size={14} /> {costsNote(s)}{extra ? ` ${extra}` : ""}</p>;
}

/** Interruptor del 4x1000: cada usuario decide si su cuenta paga 4x1000 (solo cambia sus propios cálculos). */
export function GmfToggle() {
  const { state, saveSettings } = useLive();
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const on = state.settings.gmf > 0;
  const flip = async () => {
    setBusy(true);
    await saveSettings({ gmf: on ? 0 : GMF });
    setBusy(false);
  };
  return (
    <label className={`toggle ${on ? "on" : ""}`} title="Incluir o quitar el 4x1000 de tus cálculos (si tu cuenta está exenta, apágalo)">
      <input type="checkbox" checked={on} disabled={busy} onChange={() => void flip()} />
      <span className="toggle-track" aria-hidden="true" />
      4x1000
    </label>
  );
}

/** Capital por operación, editable en línea (Enter o al salir del campo). */
export function CapitalField() {
  const { state, saveSettings, toast } = useLive();
  const [value, setValue] = useState("");
  useEffect(() => {
    if (state) setValue(String(state.settings.capital));
  }, [state?.settings.capital]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!state) return null;
  const commit = async () => {
    const n = Number(value);
    if (!n || n === state.settings.capital) return setValue(String(state.settings.capital));
    if (await saveSettings({ capital: n })) toast("Tu capital", `Ahora tus rutas se calculan con ${money(n, 0)}.`, "good", 2500);
  };
  return (
    <label className="inline-field" title="Cuánto usas tú por operación (cada usuario tiene el suyo)">
      Capital
      <input type="number" min={10000} step={50000} value={value} onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      <span>COP</span>
    </label>
  );
}

/** Condiciones del anunciante sobre tu cuenta (días de registro): si no anotaste cuándo la creaste, se avisa. */
export function RegDays({ ad }: { ad: Ad }) {
  const { state } = useLive();
  if (!ad.reg_days) return null;
  return (
    <span className="muted">
      {" "}· pide cuenta con {ad.reg_days} días de registro
      {!state?.settings.binance_since && " (anota en Mis medios de pago cuándo creaste tu cuenta y el panel descarta los que no cumples)"}
    </span>
  );
}

/** "No puedo con este": Binance no te deja tomar su anuncio (días de registro, órdenes, restricciones de tu cuenta...).
 *  Ese anunciante deja de salir en tus rutas, ventas y avisos; solo para ti. Se deshace en Mis medios de pago. */
export function BlockAd({ ad }: { ad: Ad }) {
  const { state, saveSettings, toast } = useLive();
  const [busy, setBusy] = useState(false);
  if (!state || !ad.user) return null;
  const list = state.settings.blocked ?? [];
  if (list.some((b) => b.user === ad.user)) return null;
  const block = async () => {
    setBusy(true);
    const ok = await saveSettings({ blocked: [...list, { user: ad.user!, nick: ad.nick }] });
    setBusy(false);
    if (ok) toast("Anunciante descartado", `${ad.nick} ya no sale en tus rutas ni avisos. Puedes volver a usarlo en Mis medios de pago.`, "good", 3500);
  };
  return (
    <button type="button" className="btn btn-sm" onClick={() => void block()} disabled={busy}
      title="Si Binance no te deja tomar su anuncio (por ejemplo, tu cuenta tiene menos días de los que pide), descártalo y se usa el siguiente">
      <Icon name="x" size={14} /> No puedo con {ad.nick}
    </button>
  );
}
