"use client";

import { useState } from "react";
import { api, type GmfMode } from "@/lib/api";
import { money, signedMoney, tone } from "@/lib/format";
import { GmfChoice, methodName } from "./GmfChoice";
import { useWallet } from "./wallet";

/** Pregunta única: ¿tu banco te cobra el 4x1000? Desaparece cuando se responde. */
export function GmfQuestion({ operations, gmf, onSettings }: { operations: number; gmf: number; onSettings: () => void }) {
  const { me, setMe, refresh, toast } = useWallet();
  const [saving, setSaving] = useState(false);
  if (me.profile.gmf_asked || gmf <= 0) return null;

  async function answer(mode: GmfMode) {
    setSaving(true);
    try {
      const r = await api.saveProfile({ ...me.profile, gmf_mode: mode, gmf_exempt: mode === "exenta" });
      setMe({ ...me, profile: r.profile });
      toast("Listo", "Recalculé todo con eso", "good");
      refresh();
    } catch (e) {
      toast("No se pudo guardar", (e as Error).message, "bad");
    }
    setSaving(false);
  }

  return (
    <div className="card card-pad gmf-ask">
      <h2>¿Tu banco te cobra el 4x1000 cuando compras?</h2>
      <p className="muted">
        Tus operaciones van en <b className={tone(operations)}>{signedMoney(operations)}</b>. Por ahora le resto <b>{money(gmf)}</b> de 4x1000,
        pero si tu cuenta es exenta no lo pagaste. Míralo en tu extracto y elige.
        {!!me.pay_methods && me.pay_methods.length > 1 && <> Si cada cuenta es distinta ({me.pay_methods.map((m) => methodName(m.method)).join(", ")}), ajústalo por cuenta en <button className="link" onClick={onSettings}>Ajustes</button>.</>}
      </p>
      <GmfChoice value={null} onChange={answer} disabled={saving} />
    </div>
  );
}
