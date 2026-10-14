"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type AccountKind, type BankAccount, type BankCategory, type BanksSummary, type StatementPreview } from "@/lib/api";
import { date, dateTime, money, num, signedMoney, tone } from "@/lib/format";
import { methodName } from "../GmfChoice";
import { Badge, Empty, Field, Icon, Modal, Note, Pager, Select, Skeleton } from "../ui";
import { useWallet } from "../wallet";

const KIND_LABEL: Record<AccountKind, string> = { ahorros: "Cuenta de ahorros", corriente: "Cuenta corriente", billetera: "Billetera (Nequi, Daviplata…)", tarjeta: "Tarjeta de crédito" };
const CAT_BADGE: Partial<Record<BankCategory, string>> = { binance_p2p: "brand", gmf: "bad", traslado: "", salario: "good", ingreso: "good", rendimientos: "good", otro: "warn" };
const PAGE = 50;
const fmtDay = (d: string | null) => (d ? date(Date.parse(d + "T12:00:00-05:00") / 1000) : "—");

/** Cuentas y extractos: tu plata fuera de Binance, organizada para el año. */
export function Banks() {
  const { year, version, toast, refresh } = useWallet();
  const [data, setData] = useState<BanksSummary | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"" | "upload" | "account">("");
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

  async function deleteFile(id: number, name: string) {
    if (!confirm(`¿Quitar el extracto "${name}" y sus movimientos?`)) return;
    await api.archivoBorrar(id).catch(() => undefined);
    load();
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
                  <span className="acc-ic"><Icon name={a.kind === "billetera" ? "wallet" : "bank"} size={18} /></span>
                  <div>
                    <b>{a.name}</b>
                    <small>{KIND_LABEL[a.kind]}{a.pay_methods.length ? ` · Binance: ${a.pay_methods.map(methodName).join(", ")}` : ""}</small>
                  </div>
                  <button className="btn btn-sm btn-icon btn-ghost" title="Editar cuenta" onClick={() => { setEditing(a); setModal("account"); }}><Icon name="edit" size={15} /></button>
                </div>
                <div className="acc-bal">
                  <span>{a.last_balance != null ? money(a.last_balance) : "Sin extracto"}</span>
                  <small>{a.last_day ? `Saldo al ${fmtDay(a.last_day)}` : "Sube el primero"}</small>
                </div>
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
                  <Select compact label="Cuenta" value={String(acc)} onChange={(v) => setAcc(v === "all" ? "all" : Number(v))}
                    options={[{ value: "all", label: "Todas las cuentas" }, ...data.accounts.map((a) => ({ value: String(a.id), label: a.name }))]} />
                  <Select compact label="Categoría" value={cat} onChange={(v) => setCat(v as BankCategory | "all")}
                    options={[{ value: "all", label: "Todas las categorías" }, ...(Object.keys(names) as BankCategory[]).map((c) => ({ value: c, label: names[c] }))]} />
                  <input type="search" placeholder="Buscar en la descripción…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220, height: 34 }} aria-label="Buscar" />
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
                              <select className={`cat-select ${t.category === "otro" ? "pending" : ""}`} value={t.category} onChange={(e) => setCategory(t.id, e.target.value as BankCategory)} aria-label="Categoría">
                                {(Object.keys(names) as BankCategory[]).map((c) => <option key={c} value={c}>{names[c]}</option>)}
                              </select>
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
            <details className="card files">
              <summary>Extractos subidos ({data.files.length})</summary>
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>Archivo</th><th>Cuenta</th><th className="r">Movimientos</th><th>Periodo</th><th className="hide-sm">Subido</th><th /></tr></thead>
                  <tbody>
                    {data.files.map((f) => (
                      <tr key={f.id}>
                        <td>{f.name}</td><td>{accName(f.account_id)}</td><td className="r">{f.rows}</td>
                        <td className="nowrap">{fmtDay(f.day_from)} a {fmtDay(f.day_to)}</td><td className="hide-sm muted">{dateTime(f.uploaded)}</td>
                        <td className="r"><button className="btn btn-sm btn-ghost" onClick={() => deleteFile(f.id, f.name)}><Icon name="trash" size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
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
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "ahorros");
  const [pms, setPms] = useState<string[]>(account?.pay_methods ?? []);
  const [error, setError] = useState("");
  const known = Array.from(new Set([...(me.pay_methods ?? []).map((p) => p.method), ...pms]));

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

  return (
    <Modal title={account ? "Editar cuenta" : "Nueva cuenta"} onClose={onClose}>
      <div className="form">
        <Field label="Nombre" wide hint="Como la reconozcas: Nequi, Bancolombia ahorros, Banco Popular…">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
        </Field>
        <Field label="Tipo" wide>
          <Select label="Tipo" value={kind} onChange={(v) => setKind(v as AccountKind)}
            options={(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        </Field>
        {known.length > 0 && (
          <Field label="Medios de pago de Binance que salen de esta cuenta" wide hint="Sirve para cruzar tus órdenes P2P con el extracto correcto.">
            <div className="actions">
              {known.map((m) => (
                <label key={m} className="check">
                  <input type="checkbox" checked={pms.includes(m)} onChange={(e) => setPms(e.target.checked ? [...pms, m] : pms.filter((x) => x !== m))} /> {methodName(m)}
                </label>
              ))}
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

function UploadModal({ accounts, initial, onClose, onDone }: { accounts: BankAccount[]; initial: number | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useWallet();
  const [aid, setAid] = useState<number>(initial ?? accounts[0]?.id);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isPdf = file?.name.toLowerCase().endsWith(".pdf");

  async function pick(f: File | undefined) {
    setPreview(null);
    setError("");
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) return setError("El archivo pesa más de 12 MB.");
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
      r.onerror = () => reject(new Error("No se pudo leer el archivo."));
      r.readAsDataURL(f);
    });
    setFile({ name: f.name, data });
  }

  async function check() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setPreview(await api.extractoPreview({ account_id: aid, filename: file.name, data: file.data, password }));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      const r = await api.extractoSubir({ account_id: aid, filename: file.name, data: file.data, password });
      toast("Extracto importado", `${r.added} movimientos nuevos${r.skipped ? ` · ${r.skipped} ya estaban` : ""}`, "good");
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Subir extracto" onClose={onClose} wide>
      <div className="form">
        <Field label="Cuenta">
          <Select label="Cuenta" value={String(aid)} onChange={(v) => { setAid(Number(v)); setPreview(null); }}
            options={accounts.map((a) => ({ value: String(a.id), label: a.name }))} />
        </Field>
        <Field label="Clave del PDF (si tiene)" hint="Muchos bancos usan tu número de cédula.">
          <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setPreview(null); }} disabled={!isPdf} autoComplete="off" placeholder={isPdf ? "Opcional" : "Solo para PDF"} />
        </Field>
        <label className="drop field wide">
          <Icon name="upload" size={22} />
          <b>{file ? file.name : "Elige el extracto: PDF, Excel (.xlsx, .xls) o CSV"}</b>
          <span>Puedes subir varios meses: lo repetido no se duplica</span>
          <input type="file" accept=".pdf,.xlsx,.xls,.csv,.txt" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
      </div>

      {error && <div style={{ marginTop: 12 }}><Note kind="bad">{error}</Note></div>}

      {preview && (
        <div className="stack" style={{ marginTop: 14 }}>
          <div className="kpis kpis-3">
            <div className="kpi"><small>Movimientos</small><b>{num(preview.total)}</b><span>{preview.known ? `${preview.known} ya estaban` : "Todos nuevos"}</span></div>
            <div className="kpi"><small>Periodo</small><b style={{ fontSize: 16 }}>{fmtDay(preview.day_from)} a {fmtDay(preview.day_to)}</b><span>Según las fechas</span></div>
            <div className="kpi"><small>Entró / salió</small><b style={{ fontSize: 16 }}><span className="up">{money(preview.inflow)}</span> / <span className="down">{money(preview.outflow)}</span></b><span>En este archivo</span></div>
          </div>
          {preview.warnings.map((w, i) => <Note key={i} kind="warn">{w}</Note>)}
          {preview.total > 0 && (
            <div className="table-wrap preview-table">
              <table className="t">
                <thead><tr><th>Fecha</th><th>Descripción</th><th className="r">Valor</th><th className="r">Saldo</th></tr></thead>
                <tbody>
                  {preview.rows.slice(0, 15).map((r, i) => (
                    <tr key={i}><td className="nowrap">{fmtDay(r.day)}</td><td>{r.description}</td><td className={`r ${tone(r.amount)}`}>{signedMoney(r.amount)}</td><td className="r">{r.balance != null ? money(r.balance) : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.total > 15 && <small className="muted">Y {preview.total - 15} más.</small>}
        </div>
      )}

      <div className="form-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
        {!preview ? (
          <button className="btn btn-primary" disabled={!file || busy} onClick={check}>{busy ? "Leyendo…" : "Revisar"}</button>
        ) : (
          <button className="btn btn-primary" disabled={busy || preview.total - preview.known <= 0} onClick={upload}>
            {busy ? "Importando…" : preview.total - preview.known <= 0 ? "Ya estaban todos" : `Importar ${num(preview.total - preview.known)} movimientos`}
          </button>
        )}
      </div>
    </Modal>
  );
}
