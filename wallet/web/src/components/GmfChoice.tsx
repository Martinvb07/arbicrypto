"use client";

import type { GmfMode } from "@/lib/api";
import { money } from "@/lib/format";

const UVT_2026 = 52374;

/** Nombres legibles de los medios de pago de Binance P2P. */
export function methodName(m: string): string {
  const known: Record<string, string> = { BreBKeys: "Bre-B (llaves)", BancoPopular: "Banco Popular", BancolombiaSA: "Bancolombia",
    Bancolombia: "Bancolombia", Nequi: "Nequi", Daviplata: "Daviplata", DaviviendaSA: "Davivienda", BankTransfer: "Transferencia bancaria" };
  return known[m] ?? m.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export const GMF_OPTIONS: { id: GmfMode; title: string; hint: string }[] = [
  { id: "exenta", title: "No, mi cuenta es exenta", hint: "La cuenta desde la que pagas está marcada como exenta y no superas el tope." },
  { id: "tope350", title: "Exenta hasta el tope del mes", hint: `Pagas 4x1000 solo de lo que pase de 350 UVT al mes (${money(350 * UVT_2026)} en 2026).` },
  { id: "todas", title: "Sí, en todas mis compras", hint: "Tu cuenta no está marcada como exenta: $4.000 por cada $1.000.000 que pagas." },
  { id: "elegir", title: "Elijo compra por compra", hint: "En Resultados marcas cuáles compras pagaron 4x1000 y cuáles no." },
];

/** Pregunta simple: ¿tu banco te cobra el 4x1000 cuando compras? */
export function GmfChoice({ value, onChange, disabled }: { value: GmfMode | null; onChange: (m: GmfMode) => void; disabled?: boolean }) {
  return (
    <div className="gmf-choice" role="radiogroup" aria-label="¿Tu banco te cobra el 4x1000?">
      {GMF_OPTIONS.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} disabled={disabled}
          className={`gmf-opt ${value === o.id ? "on" : ""}`} onClick={() => onChange(o.id)}>
          <b>{o.title}</b>
          <span>{o.hint}</span>
        </button>
      ))}
    </div>
  );
}
