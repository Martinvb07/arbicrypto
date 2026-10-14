"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Kind, type Movement } from "@/lib/api";
import { cashValue, dateTime, GASTO_LABEL, KIND_LABEL, money, qty } from "@/lib/format";
import { methodName } from "../GmfChoice";
import { ImportModal } from "../ImportModal";
import { MoveModal } from "../MoveModal";
import { Asset, Badge, Empty, Icon, Modal, Note, Pager, Segmented, Select, Skeleton } from "../ui";
import { useWallet } from "../wallet";

export const KIND_BADGE: Record<Kind, string> = {
  compra: "info", venta: "brand", permuta: "", ingreso: "good", airdrop: "good", comision: "bad",
  gasto: "bad", aporte: "", retiro: "",
};
const PAGE = 50;
const SOURCE: Record<Movement["source"], string> = { manual: "A mano", binance: "Binance", csv: "Archivo" };

export function Movements() {
  const { year, version, toast, refresh } = useWallet();
  const [scope, setScope] = useState<"year" | "all">("year");
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [lock, setLock] = useState(0);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<Kind | "todos">("todos");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState<"" | "add" | "import" | "clean">("");
  const [editing, setEditing] = useState<Movement | null>(null);

  useEffect(() => {
    let alive = true;
    setError("");
    api.movements(scope === "year" ? year : null).then(
      (r) => { if (alive) { setRows(r.movements.slice().reverse()); setLock(r.lock_until || 0); } },
      (e: Error) => alive && setError(e.message),
    );
    return () => { alive = false; };
  }, [year, scope, version]);

  useEffect(() => setPage(0), [year, scope, kind, q]);

  const shown = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return (rows ?? []).filter((m) =>
      (kind === "todos" || m.kind === kind) &&
      (!needle || [m.out_asset, m.in_asset, m.platform, m.counterpart, m.note].some((v) => v && v.toUpperCase().includes(needle))));
  }, [rows, kind, q]);

  async function remove(m: Movement) {
    if (!confirm(`¿Borrar este movimiento (${KIND_LABEL[m.kind].toLowerCase()} del ${dateTime(m.t)})?`)) return;
    try {
      await api.deleteMovements([m.id]);
      toast("Movimiento borrado");
      refresh();
    } catch (e) {
      toast("No se pudo borrar", (e as Error).message, "bad");
    }
  }

  const pages = Math.ceil(shown.length / PAGE);
  const slice = shown.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Movimientos</h1>
          <p>Compras, ventas, permutas e ingresos en cripto. El costo se calcula con todo tu historial, no solo el del año.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setModal("import")}><Icon name="upload" size={16} /> Subir archivo</button>
          <button className="btn btn-primary" onClick={() => setModal("add")}><Icon name="plus" size={16} /> Agregar</button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="actions">
            <Segmented value={scope} onChange={setScope} label="Periodo" options={[["year", `Año ${year}`], ["all", "Todos"]] as const} />
            <Select compact label="Tipo" value={kind} onChange={(v) => setKind(v as Kind | "todos")}
              options={[{ value: "todos", label: "Todos los tipos" }, ...(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))]} />
            <input type="search" placeholder="Buscar cripto, plataforma…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 210, height: 34 }} aria-label="Buscar" />
          </div>
          <div className="actions">
            <span className="sub">{shown.length} movimiento{shown.length === 1 ? "" : "s"}</span>
            <a className="btn btn-sm" href={`/api/export/movimientos.csv?year=${year}`} download><Icon name="download" size={15} /> CSV {year}</a>
          </div>
        </div>

        {error ? <div className="card-body"><Note kind="bad">{error}</Note></div>
          : !rows ? <div className="card-body"><Skeleton rows={3} /></div>
          : !shown.length ? (
            <Empty icon="list" title={rows.length ? "Nada coincide con el filtro" : scope === "year" ? `Sin movimientos en ${year}` : "Sin movimientos"}>
              {!rows.length && "Conecta tu Binance en Resumen o agrega uno a mano."}
            </Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Entregaste</th>
                      <th>Recibiste</th>
                      <th className="r">Valor en pesos</th>
                      <th className="r hide-sm">4x1000</th>
                      <th className="hide-sm">Plataforma</th>
                      <th className="r"><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {slice.map((m) => (
                      <tr key={m.id}>
                        <td className="nowrap">{dateTime(m.t)}</td>
                        <td><Badge kind={KIND_BADGE[m.kind]}>{KIND_LABEL[m.kind]}</Badge></td>
                        <td>{side(m.out_asset, m.out_qty)}</td>
                        <td>{side(m.in_asset, m.in_qty)}</td>
                        <td className="r">{m.cop_value ? money(cashValue(m)) : <span className="warn" title="Edítalo y usa Calcular">Sin valor</span>}
                          {m.fee_cop > 0 && <span className="cell-sub">{m.kind === "compra" ? "incluye " : ""}comisión Binance {money(m.fee_cop)}</span>}
                        </td>
                        <td className="r hide-sm">{m.gmf_cop ? money(m.gmf_cop) : <span className="muted">—</span>}</td>
                        <td className="hide-sm">
                          {m.platform || (m.category ? GASTO_LABEL[m.category] : <span className="muted">—</span>)}
                          <span className="cell-sub">{SOURCE[m.source]}{m.pay_method && ` · ${methodName(m.pay_method)}`}{m.counterpart && ` · ${m.counterpart}`}</span>
                          {m.note && ["gasto", "aporte", "retiro"].includes(m.kind) && <span className="cell-sub">{m.note}</span>}
                        </td>
                        <td>
                          <div className="row-actions">
                            {m.t <= lock ? (
                              <span className="lock-ic" title="Periodo cerrado: reábrelo en Cierres para cambiarlo"><Icon name="lock" size={14} /></span>
                            ) : (
                              <>
                                <button className="btn btn-sm btn-icon btn-ghost" title="Editar" aria-label="Editar" onClick={() => setEditing(m)}><Icon name="edit" size={15} /></button>
                                <button className="btn btn-sm btn-icon btn-ghost" title="Borrar" aria-label="Borrar" onClick={() => remove(m)}><Icon name="trash" size={15} /></button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pages={pages} onPage={setPage} />
            </>
          )}
      </div>

      <div className="actions" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-sm btn-ghost muted" onClick={() => setModal("clean")}><Icon name="trash" size={14} /> Borrar importaciones</button>
      </div>

      {modal === "add" && <MoveModal onClose={() => setModal("")} />}
      {modal === "import" && <ImportModal onClose={() => setModal("")} />}
      {modal === "clean" && <CleanModal onClose={() => setModal("")} />}
      {editing && <MoveModal move={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function side(asset: string | null, q: number | null) {
  if (!asset) return <span className="muted">—</span>;
  if (asset === "COP") return <span className="num">{money(q)}</span>;
  return <Asset asset={asset} qty={qty(q)} />;
}

function CleanModal({ onClose }: { onClose: () => void }) {
  const { toast, refresh } = useWallet();
  const run = async (source: "binance" | "csv" | "manual", label: string) => {
    if (!confirm(`¿Borrar TODOS los movimientos ${label}, de todos los años? No se puede deshacer.`)) return;
    try {
      const r = await api.deleteSource(source);
      toast(`${r.deleted} movimientos borrados`);
      refresh();
      onClose();
    } catch (e) {
      toast("No se pudo borrar", (e as Error).message, "bad");
    }
  };
  return (
    <Modal title="Borrar importaciones" onClose={onClose}>
      <p className="muted" style={{ marginBottom: 14 }}>Útil si importaste algo mal y quieres empezar de nuevo. Afecta todos los años.</p>
      <div className="stack">
        <button className="btn btn-danger" onClick={() => run("binance", "importados de Binance")}>Borrar todo lo importado de Binance</button>
        <button className="btn btn-danger" onClick={() => run("csv", "importados de archivos")}>Borrar todo lo importado de archivos CSV</button>
        <button className="btn btn-danger" onClick={() => run("manual", "agregados a mano")}>Borrar todo lo agregado a mano</button>
      </div>
    </Modal>
  );
}
