"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { State } from "@/lib/types";
import { Icon } from "./ui";

const GMF = 0.004;

/** Nota de costos que va debajo de cada tabla. */
export function costsNote(s: State) {
  return s.settings.gmf > 0 ? "Ya descuenta comisiones, redondeo de Binance, colchón por movimiento de precio y 4x1000 sobre la ganancia." : "Ya descuenta comisiones, redondeo de Binance y colchón por movimiento de precio · sin 4x1000.";
}

export function CostsNote({ s, extra }: { s: State; extra?: string }) {
  return <p className="note"><Icon name="check" size={14} /> {costsNote(s)}{extra ? ` ${extra}` : ""}</p>;
}

/** Interruptor del 4x1000: se prende o apaga desde las mismas tablas (solo el administrador lo cambia). */
export function GmfToggle() {
  const { state, saveSettings } = useLive();
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const on = state.settings.gmf > 0;
  const admin = state.user.role === "admin";
  const flip = async () => {
    setBusy(true);
    await saveSettings({ gmf: on ? 0 : GMF });
    setBusy(false);
  };
  return (
    <label className={`toggle ${on ? "on" : ""}`} title={admin ? "Incluir o quitar el 4x1000 de todos los cálculos" : "Lo cambia el administrador"}>
      <input type="checkbox" checked={on} disabled={!admin || busy} onChange={() => void flip()} />
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
