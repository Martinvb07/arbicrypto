"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type AccountKind, type BankAccount, type BankCategory, type BanksSummary, type StatementPreview } from "@/lib/api";
import { date, dateTime, money, num, signedMoney, tone } from "@/lib/format";
import { methodName } from "../GmfChoice";
import { INSTITUTIONS, institutionOf, type Institution } from "@/lib/banks";
import { Select, type SelectOption } from "../Select";
import { BankLogo, Badge, Empty, Field, Icon, Modal, Note, Pager, Skeleton } from "../ui";
import { useWallet } from "../wallet";

const KIND_LABEL: Record<AccountKind, string> = { ahorros: "Cuenta de ahorros", corriente: "Cuenta corriente", billetera: "Billetera digital", tarjeta: "Tarjeta de crédito" };
const KIND_ICON: Record<AccountKind, string> = { ahorros: "bank", corriente: "bank", billetera: "wallet", tarjeta: "file" };
const KIND_HINT: Record<AccountKind, string> = { ahorros: "La más común", corriente: "Con chequera", billetera: "Nequi, Daviplata, Movii…", tarjeta: "Compras y avances" };
const CAT_BADGE: Partial<Record<BankCategory, string>> = { binance_p2p: "brand", gmf: "bad", traslado: "", salario: "good", ingreso: "good", rendimientos: "good", otro: "warn" };
const PAGE = 50;
/** " · Nequi" si el nombre de la cuenta no dice ya de qué entidad es */
const instSuffix = (name: string) => {
  const i = institutionOf(name);
  return i && !name.toLowerCase().includes(i.name.toLowerCase().split(" ")[0]) ? ` · ${i.name}` : "";
};
/** "12 compras · 3 ventas" */
const orders = (p: { buys: number; sells: number }) =>
  [p.buys && `${p.buys} compra${p.buys > 1 ? "s" : ""}`, p.sells && `${p.sells} venta${p.sells > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
const fmtDay = (d: string | null) => (d ? date(Date.parse(d + "T12:00:00-05:00") / 1000) : "—");

/** Cuentas y extractos: tu plata fuera de Binance, organizada para el año. */
export function Banks() {
  const { year, version, toast, refresh } = useWallet();
  const [data, setData] = useState<BanksSummary | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"" | "upload" | "account">("");
  const [delSel, setDelSel] = useState<Set<number>>(new Set());
  const [confirmDel, setConfirmDel] = useState<number[] | null>(null);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [uploadFor, setUploadFor] = useState<number | null>(null);
  const [acc, setAcc] = useState<number | "all">("all");
  const [cat, setCat] = useState<BankCategory | "all">("all");
  const [q, setQ] = useState("");
  const [similar, setSimilar] = useState(true);
  const [page, setPage] = useState(0);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    api.bancos(year).then((d) => alive && setData(d), (e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [year, version, tick]);
  useEffect(() => setPage(0), [acc, cat, q, year]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.transactions ?? []).slice().reverse().filter((t) =>
      (acc === "all" || t.account_id === acc) && (cat === "all" || t.category === cat) && (!needle || t.description.toLowerCase().includes(needle)));
  }, [data, acc, cat, q]);

  async function setCategory(id: number, category: BankCategory) {
    try {
      await api.bancoTx(id, { category, similar });
      toast("Listo", similar ? "Se aplicó también a los parecidos" : undefined, "good");
      load();
    } catch (e) {
      toast("No se pudo cambiar", (e as Error).message, "bad");
    }
  }

  async function useForDeclaration() {
    if (!data) return;
    try {
      const r = await api.report(year);
      await api.saveYearExtra(year, { ...r.extra, other_patrimony: Math.round(data.dian.bank_balances_end),
        other_deposits: Math.round(data.dian.deposits_other), gmf_cert: Math.round(data.dian.gmf_real) || r.extra.gmf_cert });
      toast("Listo", "Tu declaración ya usa estos valores", "good");
      refresh();
    } catch (e) {
      toast("No se pudo guardar", (e as Error).message, "bad");
    }
  }

  async function deleteFiles(ids: number[]) {
    let ok = 0;
    for (const id of ids) {
      try {
        await api.archivoBorrar(id);
        ok++;
      } catch { /* sigue con los demás */ }
    }
    toast(ok === 1 ? "Extracto borrado" : `${ok} extractos borrados`, ok < ids.length ? `${ids.length - ok} no se pudieron borrar` : "Con sus movimientos del banco",
      ok < ids.length ? "bad" : "good");
    setDelSel(new Set());
    setConfirmDel(null);
    load();
    refresh();
  }

  if (error) return <Note kind="bad">{error}</Note>;
  if (!data) return <Skeleton rows={5} />;
  const names = data.category_names;
  const hasFiles = data.files.length > 0;
  const accName = (id: number) => data.accounts.find((a) => a.id === id)?.name ?? "—";
  const totalIn = data.accounts.reduce((a, x) => a + x.in, 0);
  const totalOut = data.accounts.reduce((a, x) => a + x.out, 0);
  const balances = data.accounts.filter((a) => a.last_balance != null);
  const pending = data.transactions.filter((t) => t.category === "otro").length;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Cuentas y extractos</h1>
          <p>Sube los extractos de tus bancos y billeteras: la app los ordena, los clasifica y los cruza con Binance.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => { setEditing(null); setModal("account"); }}><Icon name="plus" size={16} /> Nueva cuenta</button>
          <button className="btn btn-primary" disabled={!data.accounts.length} onClick={() => { setUploadFor(null); setModal("upload"); }}><Icon name="upload" size={16} /> Subir extracto</button>
        </div>
      </div>

      {!data.accounts.length ? (
        <div className="card card-pad">
          <div className="inst-strip" aria-hidden="true">
            {["Bancolombia", "Nequi", "Davivienda", "Daviplata", "Banco de Bogotá", "BBVA", "Nu Colombia", "Banco Popular", "Lulo Bank", "Scotiabank Colpatria"].map((n) => <BankLogo key={n} name={n} size={34} />)}
          </div>
          <h2 style={{ marginBottom: 10 }}>Organiza todas tus cuentas en 3 pasos</h2>
          <ol className="steps big">
            <li><b>Crea tus cuentas</b>: Nequi, Bancolombia, Banco Popular, Daviplata… Dile a cada una qué medio de pago de Binance usa (por ejemplo Nequi o Bre-B).</li>
            <li><b>Sube el extracto</b> de cada una, en PDF, Excel o CSV. Si el PDF tiene clave, casi siempre es tu cédula.</li>
            <li><b>Revisa lo que quede sin clasificar</b>. La app reconoce sola los pagos de Binance P2P, el 4x1000, los traslados entre tus cuentas, la nómina y las compras.</li>
          </ol>
          <div className="form-actions"><button className="btn btn-primary" onClick={() => { setEditing(null); setModal("account"); }}><Icon name="plus" size={16} /> Crear mi primera cuenta</button></div>
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi accent"><small>Saldo en tus cuentas</small><b>{balances.length ? money(balances.reduce((a, x) => a + (x.last_balance ?? 0), 0)) : "—"}</b><span>{balances.length ? "Según el último extracto de cada una" : "Sube un extracto para verlo"}</span></div>
            <div className="kpi"><small>Entró en {year}</small><b className="up">{money(totalIn)}</b><span>Incluye traslados entre tus cuentas</span></div>
            <div className="kpi"><small>Salió en {year}</small><b className="down">{money(totalOut)}</b><span>{num(data.transactions.length)} movimientos</span></div>
            <div className="kpi"><small>4x1000 que te cobraron</small><b>{money(data.dian.gmf_real)}</b><span>Según tus extractos</span></div>
          </div>

          {/* ---------- cuentas ---------- */}
          <div className="acc-grid">
            {data.accounts.map((a) => (
              <div key={a.id} className="card acc-card">
                <div className="acc-top">
                  <BankLogo name={a.name} kind={a.kind} size={40} />
                  <div>
                    <b>{a.name}</b>
                    <small>{KIND_LABEL[a.kind]}{instSuffix(a.name)}</small>
                  </div>
                  <button className="btn btn-sm btn-icon btn-ghost" title="Editar cuenta" onClick={() => { setEditing(a); setModal("account"); }}><Icon name="edit" size={15} /></button>
                </div>
                <div className="acc-bal">
                  <span>{a.last_balance != null ? money(a.last_balance) : "Sin extracto"}</span>
                  <small>{a.last_day ? `Saldo al ${fmtDay(a.last_day)}` : "Sube el primero"}</small>
                </div>
                {a.pay_methods.length > 0 && (
                  <div className="acc-pms">
                    <span>Binance P2P</span>
                    {a.pay_methods.map((m) => <span key={m} className="pm-chip">{methodName(m)}</span>)}
                  </div>
                )}
                <div className="acc-stats">
                  <span>Entró <b className="up">{money(a.in)}</b></span>
                  <span>Salió <b className="down">{money(a.out)}</b></span>
                  <span>4x1000 <b>{money(a.gmf)}</b></span>
                </div>
                <div className="acc-foot">
                  <small>{a.files ? `${a.files} extracto${a.files > 1 ? "s" : ""} · ${fmtDay(a.day_from)} a ${fmtDay(a.day_to)}` : "Aún sin extractos"}</small>
                  <button className="btn btn-sm" onClick={() => { setUploadFor(a.id); setModal("upload"); }}><Icon name="upload" size={14} /> Subir</button>
                </div>
              </div>
            ))}
          </div>

          {hasFiles && (
            <div className="grid-2">
              {/* ---------- categorías ---------- */}
              <div className="card">
                <div className="card-head"><div><h2>En qué se movió tu plata</h2><span className="sub">{year} · toca una para ver sus movimientos</span></div></div>
                <div className="table-wrap">
                  <table className="t">
                    <thead><tr><th>Categoría</th><th className="r">Entró</th><th className="r">Salió</th><th className="r hide-sm">Movs.</th></tr></thead>
                    <tbody>
                      {data.categories.map((c) => (
                        <tr key={c.category} className="clickable" onClick={() => setCat(cat === c.category ? "all" : c.category)}>
                          <td><Badge kind={CAT_BADGE[c.category] ?? "info"}>{c.name}</Badge>{cat === c.category && <span className="cell-sub">Filtrando abajo</span>}</td>
                          <td className="r">{c.in ? money(c.in) : <span className="muted">—</span>}</td>
                          <td className="r">{c.out ? money(c.out) : <span className="muted">—</span>}</td>
                          <td className="r hide-sm">{c.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ---------- para la declaración ---------- */}
              <div className="card card-pad">
                <h2 style={{ marginBottom: 8 }}>Para tu declaración {year}</h2>
                <div className="lines">
                  <div className="line"><span>Saldo en bancos al 31 de diciembre<span className="cell-sub">Va en tu patrimonio (casilla 29)</span></span><span className="num">{money(data.dian.bank_balances_end)}</span></div>
                  <div className="line"><span>Consignaciones aparte de Binance<span className="cell-sub">Sin traslados entre tus cuentas · tope para declarar</span></span><span className="num">{money(data.dian.deposits_other)}</span></div>
                  <div className="line"><span>Salario e ingresos laborales<span className="cell-sub">Tu empleador te da el certificado de ingresos</span></span><span className="num">{money(data.dian.salary)}</span></div>
                  <div className="line"><span>Intereses y otros ingresos</span><span className="num">{money(data.dian.other_income)}</span></div>
                  <div className="line"><span>Compras, consumos y pagos de tarjeta<span className="cell-sub">Tope de compras y consumos</span></span><span className="num">{money(data.dian.consumption)}</span></div>
                  <div className="line"><span>4x1000 que te cobraron<span className="cell-sub">Se descuenta la mitad</span></span><span className="num">{money(data.dian.gmf_real)}</span></div>
                </div>
                <div className="form-actions" style={{ marginTop: 12 }}>
                  <button className="btn btn-primary" onClick={useForDeclaration}><Icon name="check" size={16} /> Usar en mi declaración</button>
                </div>
              </div>
            </div>
          )}

          {hasFiles && data.p2p_unmatched.length > 0 && (
            <Note kind="warn">
              <b>{data.p2p_unmatched.length} {data.p2p_unmatched.length === 1 ? "orden P2P no aparece" : "órdenes P2P no aparecen"} en tus extractos.</b>{" "}
              Sube el extracto de la cuenta con que pagaste o cobraste:{" "}
              {data.p2p_unmatched.slice(0, 6).map((m) => `${m.kind === "compra" ? "pagaste" : "cobraste"} ${money(m.cop_value)} el ${date(m.t)}${m.pay_method ? ` (${methodName(m.pay_method)})` : ""}`).join(" · ")}
              {data.p2p_unmatched.length > 6 && " · …"}
            </Note>
          )}

          {/* ---------- movimientos ---------- */}
          {hasFiles ? (
            <div className="card">
              <div className="card-head">
                <div className="actions">
                  <div className="filter-inline">
                    <Select label="Cuenta" value={String(acc)} onChange={(v) => setAcc(v === "all" ? "all" : Number(v))} options={[
                      { value: "all", label: "Todas las cuentas", icon: <Icon name="bank" size={16} /> },
                      ...data.accounts.map((a) => ({ value: String(a.id), label: a.name, search: a.name, icon: <BankLogo name={a.name} kind={a.kind} size={20} />, hint: a.n || undefined })),
                    ]} />
                  </div>
                  <div className="filter-inline">
                    <Select label="Categoría" value={cat} onChange={(v) => setCat(v as BankCategory | "all")} options={[
                      { value: "all", label: "Todas las categorías", icon: <Icon name="list" size={16} /> },
                      ...(Object.keys(names) as BankCategory[]).map((c) => ({ value: c, label: names[c], search: names[c], icon: <span className={`kind-dot cat-${CAT_BADGE[c] ?? "info"}`} />,
                        hint: data.transactions.filter((t) => t.category === c).length || undefined })),
                    ] satisfies SelectOption[]} />
                  </div>
                  <label className="search-field">
                    <Icon name="search" size={15} />
                    <input type="search" placeholder="Buscar en la descripción…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
                  </label>
                  {pending > 0 && <button className="btn btn-sm" onClick={() => setCat("otro")}><Icon name="alert" size={14} /> {pending} sin clasificar</button>}
                </div>
                <label className="check"><input type="checkbox" checked={similar} onChange={(e) => setSimilar(e.target.checked)} /> Aplicar a los parecidos</label>
              </div>
              {!rows.length ? <Empty icon="list" title="Nada con ese filtro" /> : (
                <>
                  <div className="table-wrap">
                    <table className="t">
                      <thead><tr><th>Fecha</th><th className="hide-sm">Cuenta</th><th>Descripción</th><th className="r">Valor</th><th>Categoría</th></tr></thead>
                      <tbody>
                        {rows.slice(page * PAGE, page * PAGE + PAGE).map((t) => (
                          <tr key={t.id}>
                            <td className="nowrap">{fmtDay(t.day)}</td>
                            <td className="hide-sm">{accName(t.account_id)}</td>
                            <td>
                              {t.description}
                              {t.match && <span className="cell-sub">Orden P2P: {t.match.kind === "compra" ? "compraste" : "vendiste"} {num(t.match.qty, t.match.qty < 1 ? 6 : 2)} {t.match.asset}</span>}
                              {t.balance != null && <span className="cell-sub">Saldo {money(t.balance)}</span>}
                            </td>
                            <td className={`r ${tone(t.amount)}`}><b>{signedMoney(t.amount)}</b></td>
                            <td>
                              <Select label="Categoría" value={t.category} floating searchable={false}
                                className={`cat-select ${t.category === "otro" ? "pending" : ""}`}
                                onChange={(v) => setCategory(t.id, v as BankCategory)}
                                options={(Object.keys(names) as BankCategory[]).map((c) => ({ value: c, label: names[c], icon: <span className={`cat-dot cat-${c}`} /> }))} />
                              {!t.auto && <span className="cell-sub">Clasificado por ti</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={page} pages={Math.ceil(rows.length / PAGE)} onPage={setPage} />
                </>
              )}
            </div>
          ) : (
            <div className="card"><Empty icon="upload" title="Sube tu primer extracto">PDF, Excel o CSV. La app lee las fechas, los valores y el saldo.</Empty></div>
          )}

          {hasFiles && (
            <div className="card files">
              <div className="card-head">
                <div>
                  <h2>Extractos subidos <span className="muted">({data.files.length})</span></h2>
                  <span className="sub">Si subiste uno mal o repetido, bórralo: se van también sus movimientos del banco</span>
                </div>
                {delSel.size > 0 && (
                  <div className="actions files-actions">
                    <button className="btn btn-sm btn-ghost" onClick={() => setDelSel(new Set())}>Cancelar</button>
                    <button className="btn btn-sm btn-danger" onClick={() => setConfirmDel([...delSel])}><Icon name="trash" size={14} /> Borrar {delSel.size}</button>
                  </div>
                )}
              </div>
              <div className="table-wrap">
                <table className="t">
                  <thead><tr>
                    <th className="files-check"><input type="checkbox" aria-label="Elegir todos" checked={delSel.size === data.files.length}
                      onChange={(e) => setDelSel(e.target.checked ? new Set(data.files.map((f) => f.id)) : new Set())} /></th>
                    <th>Archivo</th><th className="hide-sm">Cuenta</th><th className="r">Movimientos</th><th>Periodo</th><th className="hide-sm">Subido</th><th />
                  </tr></thead>
                  <tbody>
                    {data.files.map((f) => (
                      <tr key={f.id} className={delSel.has(f.id) ? "files-picked" : ""}>
                        <td className="files-check"><input type="checkbox" aria-label={`Elegir ${f.name}`} checked={delSel.has(f.id)}
                          onChange={(e) => setDelSel((x) => { const n = new Set(x); if (e.target.checked) n.add(f.id); else n.delete(f.id); return n; })} /></td>
                        <td className="files-name">{f.name}<span className="cell-sub show-sm">{accName(f.account_id)}</span></td>
                        <td className="hide-sm">{accName(f.account_id)}</td><td className="r">{f.rows}</td>
                        <td className="nowrap">{fmtDay(f.day_from)} a {fmtDay(f.day_to)}</td><td className="hide-sm muted">{dateTime(f.uploaded)}</td>
                        <td className="r"><button className="btn btn-sm btn-ghost files-del" onClick={() => setConfirmDel([f.id])} aria-label={`Borrar ${f.name}`} title="Borrar este extracto"><Icon name="trash" size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {confirmDel && (
            <DeleteFilesModal files={data.files.filter((f) => confirmDel.includes(f.id))} accName={accName}
              onClose={() => setConfirmDel(null)} onConfirm={() => deleteFiles(confirmDel)} />
          )}
        </>
      )}

      {modal === "account" && <AccountModal account={editing} onClose={() => setModal("")} onDone={() => { setModal(""); load(); }} />}
      {modal === "upload" && <UploadModal accounts={data.accounts} initial={uploadFor} onClose={() => setModal("")} onDone={() => { setModal(""); load(); refresh(); }} />}
    </div>
  );
}

function AccountModal({ account, onClose, onDone }: { account: BankAccount | null; onClose: () => void; onDone: () => void }) {
  const { me, toast } = useWallet();
  const [inst, setInst] = useState<Institution | "otra" | null>(account ? institutionOf(account.name) ?? "otra" : null);
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "ahorros");
  const [pms, setPms] = useState<string[]>(account?.pay_methods ?? []);
  const [find, setFind] = useState("");
  const [error, setError] = useState("");
  const used = me.p2p_methods ?? (me.pay_methods ?? []).map((p) => ({ method: p.method, buys: p.n, sells: 0, total: p.total }));
  const stats = new Map(used.map((p) => [p.method, p]));
  const known = Array.from(new Set([...used.map((p) => p.method), ...pms]));
  /** Medios de pago de Binance que son de esa entidad: Nequi → "Nequi", Bancolombia → "BancolombiaSA"… */
  const methodsOf = (i: Institution) => known.filter((m) => institutionOf(methodName(m))?.id === i.id);
  const picking = !account && inst === null;

  const needle = find.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const list = INSTITUTIONS.filter((i) => !needle || i.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(needle));

  function pick(i: Institution | "otra") {
    setInst(i);
    if (i !== "otra") {
      setName(i.name);
      setKind(i.kind);
      setPms(methodsOf(i));
    }
  }

  async function save() {
    setError("");
    try {
      await api.bancoCuenta({ id: account?.id, name: name.trim(), kind, pay_methods: pms });
      toast(account ? "Cuenta actualizada" : "Cuenta creada", undefined, "good");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove() {
    if (!account || !confirm(`¿Borrar la cuenta "${account.name}" con todos sus extractos y movimientos?`)) return;
    await api.bancoCuentaBorrar(account.id).catch(() => undefined);
    onDone();
  }

  if (picking) {
    const groups: [string, Institution[]][] = [["Bancos", list.filter((i) => i.group === "banco")], ["Billeteras y bancos digitales", list.filter((i) => i.group === "digital")]];
    return (
      <Modal title="Nueva cuenta" onClose={onClose} wide>
        <p className="muted" style={{ marginBottom: 12 }}>¿De qué banco o billetera es?</p>
        <label className="search-field wide">
          <Icon name="search" size={15} />
          <input type="search" placeholder="Buscar: Bancolombia, Nequi, Nu…" value={find} onChange={(e) => setFind(e.target.value)} autoFocus aria-label="Buscar entidad" />
        </label>
        <div className="inst-scroll">
          {groups.map(([title, items]) => items.length > 0 && (
            <section key={title}>
              <h3 className="inst-title">{title}</h3>
              <div className="inst-grid">
                {items.map((i) => (
                  <button key={i.id} type="button" className="inst-tile" onClick={() => pick(i)}>
                    <BankLogo name={i.name} size={34} />
                    <span>{i.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          <section>
            <h3 className="inst-title">¿No está en la lista?</h3>
            <div className="inst-grid">
              <button type="button" className="inst-tile" onClick={() => pick("otra")}>
                <BankLogo name="" size={34} />
                <span>Otra entidad</span>
              </button>
            </div>
          </section>
        </div>
      </Modal>
    );
  }

  const instName = inst && inst !== "otra" ? inst.name : "";
  const autoPicked = !account && inst && inst !== "otra" && methodsOf(inst).length > 0;
  return (
    <Modal title={account ? "Editar cuenta" : "Nueva cuenta"} onClose={onClose}>
      <div className="inst-picked">
        <BankLogo name={name || instName} kind={kind} size={44} />
        <div>
          <b>{name.trim() || instName || "Cuenta nueva"}</b>
          <small>{instName || "Entidad sin logo"} · {KIND_LABEL[kind]}</small>
        </div>
        {!account && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setInst(null); setName(""); setPms([]); }}>Cambiar</button>}
      </div>
      <div className="form">
        <Field label="Nombre" wide hint={instName ? `Si tienes varias en ${instName}, diferéncialas: “${instName} ahorros”, “${instName} nómina”…` : "Como la reconozcas: Banco Popular, Cooperativa…"}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
        </Field>
        <Field label="Tipo" wide>
          <Select label="Tipo de cuenta" value={kind} searchable={false} onChange={(v) => setKind(v as AccountKind)}
            options={(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => ({ value: k, label: KIND_LABEL[k], icon: <Icon name={KIND_ICON[k]} size={16} />, hint: KIND_HINT[k] }))} />
        </Field>
        {known.length > 0 && (
          <Field label="Medios de pago de Binance P2P de esta cuenta" wide
            hint={autoPicked ? `Marcamos los que son de ${instName} según tus órdenes de Binance. Revisa: Bre-B márcalo en la cuenta de donde salen tus llaves.` : "Sacados de tus órdenes P2P de Binance. Sirven para cruzar cada orden con el extracto correcto."}>
            <div className="pm-toggles">
              {known.map((m) => {
                const on = pms.includes(m);
                return (
                  <button key={m} type="button" className={`pm-toggle ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setPms(on ? pms.filter((x) => x !== m) : [...pms, m])}>
                    <BankLogo name={methodName(m)} size={20} />
                    <span className="pm-txt">{methodName(m)}{stats.has(m) && <small>{orders(stats.get(m)!)}</small>}</span>
                    {on && <Icon name="check" size={14} />}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
      </div>
      {error && <p className="form-error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="form-actions">
        {account && <button className="btn btn-danger" style={{ marginRight: "auto" }} onClick={remove}><Icon name="trash" size={15} /> Borrar</button>}
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}

/** Confirmar antes de borrar extractos: cuáles y cuántos movimientos se van. */
function DeleteFilesModal({ files, accName, onClose, onConfirm }: {
  files: { id: number; name: string; account_id: number; rows: number; day_from: string | null; day_to: string | null }[];
  accName: (id: number) => string; onClose: () => void; onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const rows = files.reduce((a, f) => a + f.rows, 0);
  return (
    <Modal title={files.length === 1 ? "¿Borrar este extracto?" : `¿Borrar ${files.length} extractos?`} onClose={busy ? () => undefined : onClose}>
      <p className="kind-hint">Se borran con sus {num(rows)} movimientos del banco. Tus compras y ventas de Binance no se tocan. Si te equivocas, lo vuelves a subir.</p>
      <div className="up-files" style={{ marginTop: 4 }}>
        {files.map((f, i) => (
          <div key={f.id} className="up-file bad" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
            <Icon name="trash" size={15} />
            <span className="up-file-name">{f.name}</span>
            <small>{accName(f.account_id)} · {num(f.rows)} movimientos · {fmtDay(f.day_from)} a {fmtDay(f.day_to)}</small>
          </div>
        ))}
      </div>
      <div className="form-actions">
        <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-danger" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); }}>
          <Icon name="trash" size={14} /> {busy ? "Borrando…" : files.length === 1 ? "Borrar" : `Borrar ${files.length}`}
        </button>
      </div>
    </Modal>
  );
}

type PickedFile = { name: string; data: string };
type FileCheck = { file: PickedFile; preview?: StatementPreview; error?: string };

/** Subir extractos: uno o varios a la vez (por ejemplo, un PDF por mes con la misma clave). Lo repetido no se duplica. */
function UploadModal({ accounts, initial, onClose, onDone }: { accounts: BankAccount[]; initial: number | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useWallet();
  const [aid, setAid] = useState<number>(initial ?? accounts[0]?.id);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [password, setPassword] = useState("");
  const [checks, setChecks] = useState<FileCheck[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const anyPdf = files.some((f) => f.name.toLowerCase().endsWith(".pdf"));

  const read = (f: File) => new Promise<PickedFile>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: f.name, data: String(r.result).split(",")[1] ?? "" });
    r.onerror = () => reject(new Error(`No se pudo leer ${f.name}.`));
    r.readAsDataURL(f);
  });

  async function pick(list: FileList | null) {
    setChecks(null);
    setError("");
    const chosen = Array.from(list ?? []);
    if (!chosen.length) return;
    const big = chosen.filter((f) => f.size > 12 * 1024 * 1024);
    if (big.length) return setError(`${big.map((f) => f.name).join(", ")} pesa${big.length > 1 ? "n" : ""} más de 12 MB.`);
    if (chosen.length > 24) return setError("Máximo 24 archivos a la vez.");
    try {
      setFiles(await Promise.all(chosen.map(read)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function check() {
    if (!files.length) return;
    setError("");
    const out: FileCheck[] = [];
    for (const [i, file] of files.entries()) {  // uno por uno: el servidor lee cada PDF con la misma clave
      setBusy(files.length > 1 ? `Leyendo ${i + 1} de ${files.length}…` : "Leyendo…");
      try {
        out.push({ file, preview: await api.extractoPreview({ account_id: aid, filename: file.name, data: file.data, password }) });
      } catch (e) {
        out.push({ file, error: (e as Error).message });
      }
      setChecks([...out]);
    }
    setBusy("");
  }

  async function upload() {
    const ready = (checks ?? []).filter((c) => c.preview && c.preview.total - c.preview.known > 0);
    let added = 0, skipped = 0;
    const failed: string[] = [];
    for (const [i, c] of ready.entries()) {
      setBusy(ready.length > 1 ? `Importando ${i + 1} de ${ready.length}…` : "Importando…");
      try {
        const r = await api.extractoSubir({ account_id: aid, filename: c.file.name, data: c.file.data, password });
        added += r.added;
        skipped += r.skipped;
      } catch (e) {
        failed.push(`${c.file.name}: ${(e as Error).message}`);
      }
    }
    setBusy("");
    if (added || !failed.length) {
      toast(ready.length > 1 ? `${ready.length - failed.length} extractos importados` : "Extracto importado",
        `${added} movimientos nuevos${skipped ? ` · ${skipped} ya estaban` : ""}`, "good");
    }
    if (failed.length) setError(`No se pudieron importar: ${failed.join(" · ")}`);
    else onDone();
  }

  const ok = (checks ?? []).filter((c) => c.preview);
  const sum = ok.reduce((a, c) => ({ total: a.total + c.preview!.total, known: a.known + c.preview!.known, inflow: a.inflow + c.preview!.inflow,
    outflow: a.outflow + c.preview!.outflow }), { total: 0, known: 0, inflow: 0, outflow: 0 });
  const days = ok.flatMap((c) => [c.preview!.day_from, c.preview!.day_to]).filter((d): d is string => !!d).sort();
  const fresh = sum.total - sum.known;
  const rows = ok.flatMap((c) => c.preview!.rows).sort((x, y) => (x.day < y.day ? 1 : -1));
  const one = files.length === 1;

  return (
    <Modal title="Subir extractos" onClose={busy ? () => undefined : onClose} wide>
      <div className="form">
        <Field label="Cuenta">
          <Select label="Cuenta" value={String(aid)} onChange={(v) => { setAid(Number(v)); setChecks(null); }}
            options={accounts.map((a) => ({ value: String(a.id), label: a.name, search: a.name, icon: <BankLogo name={a.name} kind={a.kind} size={22} />, hint: KIND_LABEL[a.kind] }))} />
        </Field>
        <Field label="Clave de los PDF (si tienen)" hint="La misma para todos. Muchos bancos usan tu número de cédula.">
          <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setChecks(null); }} disabled={!anyPdf} autoComplete="off" placeholder={anyPdf ? "Opcional" : "Solo para PDF"} />
        </Field>
        <label className={`drop field wide ${files.length ? "has-files" : ""}`}>
          <Icon name="upload" size={22} />
          <b>{!files.length ? "Elige uno o varios extractos: PDF, Excel (.xlsx, .xls) o CSV" : one ? files[0].name : `${files.length} archivos elegidos`}</b>
          <span>{files.length > 1 ? "Toca para cambiarlos · se revisan todos con la misma clave" : "Puedes elegir varios meses a la vez: lo repetido no se duplica"}</span>
          <input type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.txt" onChange={(e) => void pick(e.target.files)} />
        </label>
      </div>

      {files.length > 1 && (
        <div className="up-files">
          {files.map((f, i) => {
            const c = checks?.find((x) => x.file === f);
            return (
              <div key={`${f.name}-${i}`} className={`up-file ${c?.error ? "bad" : c?.preview ? "ok" : ""}`} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                <Icon name={c?.error ? "alert" : c?.preview ? "check" : "file"} size={15} />
                <span className="up-file-name">{f.name}</span>
                <small>
                  {c?.error ? c.error
                    : c?.preview ? `${num(c.preview.total)} movimientos${c.preview.known ? ` · ${c.preview.known} ya estaban` : ""}${c.preview.day_from ? ` · ${fmtDay(c.preview.day_from)} a ${fmtDay(c.preview.day_to)}` : ""}`
                    : busy ? "En fila…" : "Sin revisar"}
                </small>
              </div>
            );
          })}
        </div>
      )}

      {error && <div style={{ marginTop: 12 }}><Note kind="bad">{error}</Note></div>}
      {one && checks?.[0]?.error && <div style={{ marginTop: 12 }}><Note kind="bad">{checks[0].error}</Note></div>}

      {ok.length > 0 && (
        <div className="stack" style={{ marginTop: 14 }}>
          <div className="kpis kpis-3">
            <div className="kpi"><small>Movimientos</small><b>{num(sum.total)}</b><span>{sum.known ? `${sum.known} ya estaban` : "Todos nuevos"}</span></div>
            <div className="kpi"><small>Periodo</small><b style={{ fontSize: 16 }}>{days.length ? `${fmtDay(days[0])} a ${fmtDay(days[days.length - 1])}` : "—"}</b><span>{ok.length > 1 ? `${ok.length} archivos` : "Según las fechas"}</span></div>
            <div className="kpi"><small>Entró / salió</small><b style={{ fontSize: 16 }}><span className="up">{money(sum.inflow)}</span> / <span className="down">{money(sum.outflow)}</span></b><span>{ok.length > 1 ? "En estos archivos" : "En este archivo"}</span></div>
          </div>
          {ok.flatMap((c) => c.preview!.warnings.map((w, i) => <Note key={`${c.file.name}-${i}`} kind="warn">{ok.length > 1 ? `${c.file.name}: ` : ""}{w}</Note>))}
          {rows.length > 0 && (
            <div className="table-wrap preview-table">
              <table className="t">
                <thead><tr><th>Fecha</th><th>Descripción</th><th className="r">Valor</th><th className="r">Saldo</th></tr></thead>
                <tbody>
                  {rows.slice(0, 15).map((r, i) => (
                    <tr key={i}><td className="nowrap">{fmtDay(r.day)}</td><td>{r.description}</td><td className={`r ${tone(r.amount)}`}>{signedMoney(r.amount)}</td><td className="r">{r.balance != null ? money(r.balance) : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sum.total > 15 && <small className="muted">Y {num(sum.total - 15)} más.</small>}
        </div>
      )}

      <div className="form-actions">
        <button className="btn" onClick={onClose} disabled={!!busy}>Cancelar</button>
        {!checks || checks.length < files.length ? (
          <button className="btn btn-primary" disabled={!files.length || !!busy} onClick={() => void check()}>{busy || (files.length > 1 ? `Revisar ${files.length} archivos` : "Revisar")}</button>
        ) : (
          <button className="btn btn-primary" disabled={!!busy || fresh <= 0} onClick={() => void upload()}>
            {busy || (fresh <= 0 ? "Ya estaban todos" : `Importar ${num(fresh)} movimientos`)}
          </button>
        )}
      </div>
    </Modal>
  );
}
