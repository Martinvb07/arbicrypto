"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { api, type Kind, type Movement } from "@/lib/api";
import { cashValue, date, dateTime, GASTO_LABEL, hourMin, KIND_LABEL, money, qty, signedMoney } from "@/lib/format";
import { methodName } from "../GmfChoice";
import { ImportModal } from "../ImportModal";
import { MoveModal } from "../MoveModal";
import { Select, type SelectOption } from "../Select";
import { Asset, Badge, Coin, Empty, Icon, Modal, Note, Pager, Skeleton } from "../ui";
import { useWallet } from "../wallet";

export const KIND_BADGE: Record<Kind, string> = {
  compra: "info", venta: "brand", permuta: "", ingreso: "good", airdrop: "good", comision: "bad",
  gasto: "bad", aporte: "", retiro: "",
};
const PAGE = 50;
const SOURCE: Record<Movement["source"], string> = { manual: "A mano", binance: "Binance", csv: "Archivo" };

const KIND_FLOW: Record<Kind, string> = {
  compra: "Pesos → cripto", venta: "Cripto → pesos", permuta: "Cripto → otra cripto", ingreso: "Pago recibido en cripto",
  airdrop: "Cripto recibida gratis", comision: "Comisión pagada en cripto", gasto: "Gasto del negocio", aporte: "Metiste plata", retiro: "Sacaste plata",
};
const KIND_DOT: Record<string, string> = { info: "var(--accent)", brand: "var(--brand)", good: "var(--up)", bad: "var(--down)", "": "var(--muted)" };
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
type Sort = "new" | "old" | "high" | "low";
const SORT_LABEL: Record<Sort, string> = { new: "Más recientes", old: "Más antiguos", high: "Mayor valor", low: "Menor valor" };
const ALL = "todos";

/** Mes en hora de Colombia: { y: 2026, m: 0..11 } */
function monthOf(t: number) {
  const d = new Date((t - 5 * 3600) * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}
const monthKey = (t: number) => { const { y, m } = monthOf(t); return `${y}-${m}`; };
const assetsOf = (m: Movement) => [m.out_asset, m.in_asset].filter((a): a is string => !!a && a !== "COP");
const dot = (kind: Kind) => <span className="kind-dot" style={{ background: KIND_DOT[KIND_BADGE[kind]] }} />;

export function Movements() {
  const { year, version, toast, refresh } = useWallet();
  const [scope, setScope] = useState<"year" | "all">("year");
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [lock, setLock] = useState(0);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<Kind | typeof ALL>(ALL);
  const [asset, setAsset] = useState(ALL);
  const [source, setSource] = useState<Movement["source"] | typeof ALL>(ALL);
  const [month, setMonth] = useState(ALL);
  const [sort, setSort] = useState<Sort>("new");
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

  useEffect(() => setPage(0), [year, scope, kind, asset, source, month, sort, q]);
  useEffect(() => setMonth(ALL), [year, scope]);

  const all = rows ?? [];
  const count = (pred: (m: Movement) => boolean) => all.reduce((n, m) => n + (pred(m) ? 1 : 0), 0);

  const kindOptions = useMemo<SelectOption[]>(() => [
    { value: ALL, label: "Todos los tipos", hint: all.length, icon: <Icon name="list" size={16} /> },
    ...(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k], search: KIND_LABEL[k], icon: dot(k), hint: count((m) => m.kind === k) || "—" })),
  ], [rows]);

  const assetOptions = useMemo<SelectOption[]>(() => {
    const n = new Map<string, number>();
    for (const m of all) for (const a of assetsOf(m)) n.set(a, (n.get(a) ?? 0) + 1);
    return [
      { value: ALL, label: "Todas las criptos", icon: <Icon name="wallet" size={16} /> },
      ...[...n].sort((a, b) => b[1] - a[1]).map(([a, c]) => ({ value: a, label: a, search: a, icon: <Coin asset={a} size={18} />, hint: c })),
    ];
  }, [rows]);

  const monthOptions = useMemo<SelectOption[]>(() => {
    const n = new Map<string, number>();
    for (const m of all) n.set(monthKey(m.t), (n.get(monthKey(m.t)) ?? 0) + 1);
    const keys = [...n.keys()].sort((a, b) => { const [ya, ma] = a.split("-").map(Number); const [yb, mb] = b.split("-").map(Number); return yb - ya || mb - ma; });
    return [
      { value: ALL, label: scope === "year" ? `Todo ${year}` : "Todas las fechas", icon: <Icon name="calendar" size={16} /> },
      ...keys.map((k) => { const [y, m] = k.split("-").map(Number); return { value: k, label: `${MONTHS[m]} ${y}`, search: `${MONTHS[m]} ${y}`, hint: n.get(k) }; }),
    ];
  }, [rows, scope, year]);

  const sourceOptions: SelectOption[] = [
    { value: ALL, label: "Todos los orígenes", icon: <Icon name="link" size={16} /> },
    ...(Object.keys(SOURCE) as Movement["source"][]).map((k) => ({ value: k, label: SOURCE[k], hint: count((m) => m.source === k) || "—" })),
  ];
  const sortOptions: SelectOption[] = (Object.keys(SORT_LABEL) as Sort[]).map((k) => ({ value: k, label: SORT_LABEL[k] }));

  const shown = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const list = all.filter((m) =>
      (kind === ALL || m.kind === kind) &&
      (asset === ALL || assetsOf(m).includes(asset)) &&
      (source === ALL || m.source === source) &&
      (month === ALL || monthKey(m.t) === month) &&
      (!needle || [m.out_asset, m.in_asset, m.platform, m.counterpart, m.note, m.ref].some((v) => v && v.toUpperCase().includes(needle))));
    if (sort === "old") list.reverse();
    else if (sort === "high") list.sort((a, b) => cashValue(b) - cashValue(a));
    else if (sort === "low") list.sort((a, b) => cashValue(a) - cashValue(b));
    return list;
  }, [rows, kind, asset, source, month, sort, q]);

  const totals = useMemo(() => {
    const t = { buy: 0, nBuy: 0, sell: 0, nSell: 0, income: 0, nIncome: 0, costs: 0, gmf: 0 };
    for (const m of shown) {
      if (m.kind === "compra") { t.buy += cashValue(m); t.nBuy++; }
      if (m.kind === "venta") { t.sell += cashValue(m); t.nSell++; }
      if (m.kind === "ingreso" || m.kind === "airdrop") { t.income += m.cop_value; t.nIncome++; }
      t.costs += (m.fee_cop || 0) + (m.kind === "comision" ? m.cop_value : 0);
      t.gmf += m.gmf_cop || 0;
    }
    return t;
  }, [shown]);

  const groups = useMemo(() => {
    const g = new Map<string, number>();
    for (const m of shown) g.set(monthKey(m.t), (g.get(monthKey(m.t)) ?? 0) + 1);
    return g;
  }, [shown]);

  const chips: { label: string; clear: () => void }[] = [
    ...(kind !== ALL ? [{ label: KIND_LABEL[kind], clear: () => setKind(ALL) }] : []),
    ...(asset !== ALL ? [{ label: asset, clear: () => setAsset(ALL) }] : []),
    ...(month !== ALL ? [{ label: String(monthOptions.find((o) => o.value === month)?.label ?? ""), clear: () => setMonth(ALL) }] : []),
    ...(source !== ALL ? [{ label: SOURCE[source], clear: () => setSource(ALL) }] : []),
    ...(q.trim() ? [{ label: `“${q.trim()}”`, clear: () => setQ("") }] : []),
  ];
  const clearAll = () => { setKind(ALL); setAsset(ALL); setSource(ALL); setMonth(ALL); setQ(""); };

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
  const byDate = sort === "new" || sort === "old";

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

      {rows && !error && rows.length > 0 && (
        <div className="kpis">
          <div className="kpi">
            <small>Compraste</small>
            <b className="num">{money(totals.buy)}</b>
            <span>{totals.nBuy} compra{totals.nBuy === 1 ? "" : "s"} · pesos que salieron</span>
          </div>
          <div className="kpi">
            <small>Vendiste</small>
            <b className="num">{money(totals.sell)}</b>
            <span>{totals.nSell} venta{totals.nSell === 1 ? "" : "s"} · pesos que entraron</span>
          </div>
          <div className="kpi">
            <small>Ingresos en cripto</small>
            <b className="num">{money(totals.income)}</b>
            <span>{totals.nIncome ? `${totals.nIncome} ingreso${totals.nIncome === 1 ? "" : "s"} y airdrops` : "Staking, Earn, airdrops"}</span>
          </div>
          <div className="kpi">
            <small>Comisiones y 4x1000</small>
            <b className="num">{money(totals.costs + totals.gmf)}</b>
            <span>Binance {money(totals.costs)} · 4x1000 {money(totals.gmf)}</span>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head mv-head">
          <div className="actions">
            <div className="seg">
              <button className={scope === "year" ? "on" : ""} onClick={() => setScope("year")}>Año {year}</button>
              <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>Todo el historial</button>
            </div>
            <label className="search-field">
              <Icon name="search" size={15} />
              <input type="search" placeholder="Buscar cripto, plataforma, nota…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
            </label>
          </div>
          <div className="actions">
            <span className="sub">{shown.length === all.length ? `${all.length} movimiento${all.length === 1 ? "" : "s"}` : `${shown.length} de ${all.length}`}</span>
            <a className="btn btn-sm" href={`/api/export/movimientos.csv?year=${year}`} download><Icon name="download" size={15} /> CSV {year}</a>
          </div>
        </div>

        <div className="mv-filters">
          <div className="filter-sel"><small>Tipo</small><Select label="Tipo" value={kind} options={kindOptions} searchable={false} onChange={(v) => setKind(v as Kind | typeof ALL)} /></div>
          <div className="filter-sel"><small>Cripto</small><Select label="Cripto" value={asset} options={assetOptions} onChange={setAsset} /></div>
          <div className="filter-sel"><small>Periodo</small><Select label="Periodo" value={month} options={monthOptions} onChange={setMonth} /></div>
          <div className="filter-sel"><small>Origen</small><Select label="Origen" value={source} options={sourceOptions} searchable={false} onChange={(v) => setSource(v as Movement["source"] | typeof ALL)} /></div>
          <div className="filter-sel"><small>Ordenar</small><Select label="Ordenar" value={sort} options={sortOptions} searchable={false} onChange={(v) => setSort(v as Sort)} /></div>
        </div>

        {chips.length > 0 && (
          <div className="filter-chips">
            <span className="muted"><Icon name="filter" size={13} /> Filtrando por</span>
            {chips.map((c) => (
              <button key={c.label} onClick={c.clear} title="Quitar filtro">{c.label} <Icon name="x" size={12} /></button>
            ))}
            <button className="clear" onClick={clearAll}>Limpiar todo</button>
          </div>
        )}

        {error ? <div className="card-body"><Note kind="bad">{error}</Note></div>
          : !rows ? <div className="card-body"><Skeleton rows={3} /></div>
          : !shown.length ? (
            <Empty icon={rows.length ? "search" : "list"} title={rows.length ? "Nada coincide con los filtros" : scope === "year" ? `Sin movimientos en ${year}` : "Sin movimientos"}>
              {rows.length ? <div className="actions"><button className="btn btn-sm" onClick={clearAll}>Limpiar filtros</button></div>
                : "Conecta tu Binance en Resumen o agrega uno a mano."}
            </Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="t mv-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Sale</th>
                      <th>Entra</th>
                      <th className="r" title="Lo que salió (−) o entró (+) a tu cuenta de banco por este movimiento">Plata en tu banco</th>
                      <th className="r hide-sm">4x1000</th>
                      <th className="hide-sm">Plataforma</th>
                      <th className="r"><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {slice.map((m, i) => {
                      const key = monthKey(m.t);
                      const head = byDate && (i === 0 || monthKey(slice[i - 1].t) !== key);
                      const { y, m: mo } = monthOf(m.t);
                      return (
                        <Fragment key={m.id}>
                          {head && (
                            <tr className="group-row">
                              <td colSpan={8}>{MONTHS[mo]} {y} <span>· {groups.get(key)} movimiento{groups.get(key) === 1 ? "" : "s"}</span></td>
                            </tr>
                          )}
                          <tr>
                            <td className="nowrap">{date(m.t)}<span className="cell-sub">{hourMin(m.t)}</span></td>
                            <td>
                              <Badge kind={KIND_BADGE[m.kind]}>{KIND_LABEL[m.kind]}</Badge>
                              {!!m.tercero && <span className="third-tag" title="Oculta en Resultados: no suma ni resta"><Icon name="x" size={11} /> oculta</span>}
                              <span className="cell-sub">{explain(m)}</span>
                            </td>
                            <td>{side(m.out_asset, m.out_qty, "out")}</td>
                            <td>{side(m.in_asset, m.in_qty, "in")}</td>
                            <td className="r"><b className={`num ${bank(m) > 0 ? "up" : ""}`}>{!m.cop_value ? <span className="warn" title="Edítalo y usa Calcular">Sin valor</span> : TOUCHES_BANK.has(m.kind) ? signedMoney(bank(m)) : <span className="muted" title="No movió plata de tu banco">{money(m.cop_value)}</span>}</b>
                              {m.kind === "compra" && m.gmf_cop > 0 && <span className="cell-sub">{money(cashValue(m))} + 4x1000</span>}
                              {m.fee_cop > 0 && <span className="cell-sub">Binance cobró {m.fee_qty ? `${qty(m.fee_qty)} ${m.fee_asset} ` : ""}({money(m.fee_cop)}){m.kind === "compra" ? ", ya va en el precio" : ""}</span>}
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
                        </Fragment>
                      );
                    })}
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

const TOUCHES_BANK = new Set<Kind>(["compra", "venta", "gasto", "aporte", "retiro"]);

/** Plata que de verdad salió (−) o entró (+) a tu banco: la compra con su 4x1000; la venta, lo que te llegó. */
function bank(m: Movement): number {
  const v = cashValue(m);
  if (m.kind === "compra") return -(v + (m.gmf_cop || 0));
  if (m.kind === "venta" || m.kind === "aporte") return v;
  if (m.kind === "gasto" || m.kind === "retiro") return -(v + (m.gmf_cop || 0));
  return 0;
}

/** Qué pasó, en una frase. */
function explain(m: Movement): string {
  const c = (a: string | null, q: number | null) => `${qty(q)} ${a}`;
  switch (m.kind) {
    case "compra": return `Pagaste ${money(cashValue(m))} y te llegaron ${c(m.in_asset, m.in_qty)}`;
    case "venta": return `Entregaste ${c(m.out_asset, m.out_qty)} y te llegaron ${money(cashValue(m))}`;
    case "permuta": return `Cambiaste ${c(m.out_asset, m.out_qty)} por ${c(m.in_asset, m.in_qty)} (valían ${money(m.cop_value)})`;
    case "ingreso": return `Te pagaron ${c(m.in_asset, m.in_qty)} (valían ${money(m.cop_value)})`;
    case "airdrop": return `Te regalaron ${c(m.in_asset, m.in_qty)} (valían ${money(m.cop_value)})`;
    case "comision": return `Binance cobró ${c(m.out_asset, m.out_qty)}`;
    default: return KIND_FLOW[m.kind];
  }
}

/** Lo que sale (−) o entra (+): cripto con su ícono, pesos con la bandera. */
function side(asset: string | null, q: number | null, dir: "in" | "out") {
  if (!asset) return <span className="muted">—</span>;
  const sign = dir === "in" ? "+" : "−";
  if (asset === "COP") return <span className={`asset flow-${dir}`}><Coin asset="COP" size={20} /><span className="num">{sign}{money(q)}</span></span>;
  return <span className={`flow-${dir}`}><Asset asset={asset} qty={`${sign}${qty(q)}`} /></span>;
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
