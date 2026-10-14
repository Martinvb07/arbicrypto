"use client";

import { useEffect, useState } from "react";
import { api, type CashBook, type FsNote, type InventoryBook, type Libros } from "@/lib/api";
import { date, money } from "@/lib/format";
import { NoteModal } from "../NoteModal";
import { BalanceView, CashBookView, CashFlowView, EquityView, IncomeView, InventoryView, JournalView, NotesView, TrialView } from "../Statements";
import { Closings } from "./Closings";
import { ExcelButton, Kardex, OpsRegister } from "./CryptoBook";
import { Empty, Icon, Note, Pager, Segmented, Select, Skeleton } from "../ui";
import { useWallet } from "../wallet";

export type BooksView = "diario" | "mayor" | "inventarios" | "balance" | "resultados" | "patrimonio" | "flujo" | "notas"
  | "caja" | "cripto" | "registro" | "cierres";
type View = BooksView;

/** En el orden en que los revisa un contador: libros oficiales, estados financieros con sus notas, auxiliares y cierres. */
const GROUPS: { label: string; views: { id: View; label: string; title: string }[] }[] = [
  { label: "Libros oficiales", views: [
    { id: "diario", label: "Libro diario", title: "Libro diario" },
    { id: "mayor", label: "Mayor y balances", title: "Libro mayor y balances" },
    { id: "inventarios", label: "Inventarios y balances", title: "Libro de inventarios y balances" },
  ] },
  { label: "Estados financieros", views: [
    { id: "balance", label: "Situación financiera", title: "Estado de situación financiera (balance general)" },
    { id: "resultados", label: "Resultados", title: "Estado de resultados" },
    { id: "patrimonio", label: "Cambios en el patrimonio", title: "Estado de cambios en el patrimonio" },
    { id: "flujo", label: "Flujo de efectivo", title: "Estado de flujos de efectivo (método directo)" },
    { id: "notas", label: "Notas", title: "Notas a los estados financieros" },
  ] },
  { label: "Auxiliares", views: [
    { id: "caja", label: "Caja diaria", title: "Libro de caja y bancos · cierre diario" },
    { id: "cripto", label: "Kardex cripto", title: "Kardex de criptoactivos" },
    { id: "registro", label: "Registro de operaciones", title: "Registro de operaciones" },
  ] },
  { label: "Control", views: [{ id: "cierres", label: "Cierres", title: "Cierres" }] },
];
const ALL = GROUPS.flatMap((g) => g.views.map((v) => ({ ...v, group: g.label })));
const YEARLY: View[] = ["cripto", "registro", "notas"];  // libros anuales: el año se elige arriba
const LEDGER: View[] = ["diario", "mayor", "balance", "resultados", "patrimonio", "flujo"];
const AT_CUT: View[] = ["balance", "inventarios"];  // se presentan a una fecha de corte, no por periodo
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const PAGE = 40;

function csvHref(view: View, year: number, month: number) {
  if (view === "cripto") return `/api/export/libro-cripto.csv?year=${year}`;
  if (view === "registro") return `/api/export/movimientos.csv?year=${year}`;
  return `/api/export/libro-${view}.csv?year=${year}&month=${month}`;
}

export function Books({ initialView = "diario" }: { initialView?: BooksView }) {
  const { year, version, refresh, toast } = useWallet();
  const [view, setView] = useState<View>(initialView);
  useEffect(() => setView(initialView), [initialView]);
  const [month, setMonth] = useState(0);
  const [data, setData] = useState<Libros | null>(null);
  const [cash, setCash] = useState<CashBook | null>(null);
  const [inv, setInv] = useState<InventoryBook | null>(null);
  const [notes, setNotes] = useState<FsNote[] | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const isLedger = LEDGER.includes(view);

  useEffect(() => {
    let alive = true;
    setError("");
    const fail = (e: Error) => alive && setError(e.message);
    if (isLedger) api.libros(year, month).then((d) => alive && setData(d), fail);
    if (view === "caja") api.cajaDiaria(year, month).then((d) => alive && setCash(d), fail);
    if (view === "inventarios") { setInv(null); api.inventarios(year, month).then((d) => alive && setInv(d), fail); }
    if (view === "notas") { setNotes(null); api.notasEf(year).then((d) => alive && setNotes(d.notes), fail); }
    return () => { alive = false; };
  }, [year, month, version, isLedger, view]);
  useEffect(() => setPage(0), [year, month, view]);

  async function deleteNote(id: number) {
    if (!confirm("¿Borrar esta nota de contabilidad? Sus débitos y créditos salen de todos los libros.")) return;
    try {
      await api.notaBorrar(id);
      toast("Nota borrada", undefined, "good");
      refresh();
    } catch (e) {
      toast("No se pudo borrar", (e as Error).message, "bad");
    }
  }

  const label = month ? `${MONTHS[month - 1]} ${year}` : `Año ${year}`;
  const entries = data?.journal ?? [];
  const pages = Math.ceil(entries.length / PAGE);
  const lock = (isLedger ? data?.lock_until : view === "caja" ? cash?.lock_until : 0) || 0;
  const cut = view === "balance" ? data?.balance.at : view === "inventarios" ? inv?.at : undefined;
  const period = AT_CUT.includes(view) ? (cut ? `Al ${date(cut)}` : "…") : YEARLY.includes(view) || !month ? `1 ene – 31 dic ${year}` : label;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Libros contables</h1>
          <p>Libros oficiales, estados financieros completos con sus notas y auxiliares, en el orden en que los revisa tu contador.</p>
        </div>
        <div className="actions no-print">
          <a className="btn" href={`/api/export/paquete-contador.zip?year=${year}`} download><Icon name="download" size={16} /> Paquete para el contador</a>
          <ExcelButton />
        </div>
      </div>

      <nav className="book-nav no-print" aria-label="Libros">
        {GROUPS.map((g) => (
          <div key={g.label} className="book-nav-group">
            <small>{g.label}</small>
            <Segmented value={view} options={g.views.map((v) => [v.id, v.label] as const)} onChange={setView} label={g.label} />
          </div>
        ))}
      </nav>

      {view === "cierres" ? <Closings embedded /> : (
        <>
          <BookHeader view={view} period={period} lock={lock}
            actions={<>
              {view === "diario" && <button className="btn btn-sm btn-primary" onClick={() => setNoteOpen(true)}><Icon name="plus" size={14} /> Nota de contabilidad</button>}
              {!YEARLY.includes(view) && (
                <Select compact label="Periodo" value={String(month)} onChange={(v) => setMonth(Number(v))} searchable={false}
                  options={[{ value: "0", label: AT_CUT.includes(view) ? `Corte: fin de ${year}` : `Todo el año ${year}` },
                    ...MONTHS.map((m, i) => ({ value: String(i + 1), label: `${AT_CUT.includes(view) ? `Corte: fin de ${m.toLowerCase()}` : m} ${year}` }))]} />
              )}
              {view !== "notas" && <a className="btn btn-sm" href={csvHref(view, year, month)} download><Icon name="download" size={14} /> CSV</a>}
              <button className="btn btn-sm" onClick={() => window.print()}><Icon name="print" size={14} /> Imprimir</button>
            </>} />

          {error ? <Note kind="bad">{error}</Note>
            : view === "cripto" ? <Kardex />
            : view === "registro" ? <OpsRegister />
            : view === "caja" ? (cash ? <CashBookView b={cash} label={label} /> : <Skeleton rows={4} />)
            : view === "inventarios" ? (inv ? <InventoryView inv={inv} /> : <Skeleton rows={4} />)
            : view === "notas" ? (notes ? <NotesView notes={notes} /> : <Skeleton rows={6} />)
            : !data ? <Skeleton rows={4} /> : (
              <>
                {view === "diario" && (entries.length ? (
                  <>
                    <JournalView entries={entries.slice(page * PAGE, page * PAGE + PAGE)} lock={data.lock_until} onDeleteNote={deleteNote} />
                    <Pager page={page} pages={pages} onPage={setPage} />
                    <p className="muted" style={{ fontSize: 12.5 }}>
                      {entries.length} comprobantes · débitos {money(data.trial.totals.debit)} = créditos {money(data.trial.totals.credit)}
                    </p>
                  </>
                ) : <div className="card"><Empty icon="book" title={`Sin comprobantes en ${label.toLowerCase()}`}>Aparecen solos cuando hay movimientos.</Empty></div>)}
                {view === "mayor" && <TrialView t={data.trial} />}
                {view === "balance" && <BalanceView b={data.balance} />}
                {view === "resultados" && <IncomeView i={data.income} label={`Estado de resultados · ${label}`} />}
                {view === "patrimonio" && <EquityView e={data.equity} />}
                {view === "flujo" && <CashFlowView f={data.cashflow} />}
              </>
            )}
        </>
      )}
      {noteOpen && <NoteModal onClose={() => setNoteOpen(false)} />}
    </div>
  );
}

/** Encabezado igual en todos los libros: qué libro, de quién, qué periodo y en qué moneda. */
function BookHeader({ view, period, lock, actions }: { view: View; period: string; lock: number; actions: React.ReactNode }) {
  const { me } = useWallet();
  const v = ALL.find((x) => x.id === view)!;
  const method = view === "cripto" ? ` · ${me.profile.method === "fifo" ? "PEPS" : "Promedio ponderado"}` : "";
  return (
    <div className="card book-head">
      <div>
        <span className="book-kicker">{v.group}</span>
        <h2>{v.title}{method}</h2>
        <dl className="book-meta">
          <div><dt>Contribuyente</dt><dd>{me.profile.name || me.user.username}</dd></div>
          <div><dt>Cédula / NIT</dt><dd>{me.profile.nit || "—"}</dd></div>
          <div><dt>{AT_CUT.includes(view) ? "Corte" : "Periodo"}</dt><dd>{period}</dd></div>
          <div><dt>Moneda</dt><dd>Pesos colombianos (COP)</dd></div>
          {!!lock && <div><dt>Congelado hasta</dt><dd><Icon name="lock" size={12} /> {date(lock)}</dd></div>}
        </dl>
      </div>
      <div className="actions no-print">{actions}</div>
    </div>
  );
}
