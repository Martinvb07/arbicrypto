"use client";

import { useEffect, useState } from "react";
import { api, type Movement, type Saldos } from "@/lib/api";
import { cashValue, currentYear, date, dateTime, KIND_LABEL, money, num, qty, signedMoney, tone } from "@/lib/format";
import type { TabId } from "../App";
import { BinanceCard } from "../BinanceCard";
import { CajaCard } from "../CajaCard";
import { methodName } from "../GmfChoice";
import { GmfQuestion } from "../GmfQuestion";
import { ImportModal } from "../ImportModal";
import { MoveModal } from "../MoveModal";
import { Asset, Badge, Coin, Empty, Icon, Note, Skeleton } from "../ui";
import { useWallet } from "../wallet";
import { KIND_BADGE } from "./Movements";

const WALLET: Record<string, string> = { spot: "Spot", funding: "Funding", earn: "Earn" };

function ago(t: number | null | undefined): string {
  if (!t) return "nunca";
  const m = Math.max(0, Math.round((Date.now() / 1000 - t) / 60));
  return m < 1 ? "hace un momento" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`;
}

/** Inicio: todos tus saldos (Binance y bancos), el resultado y lo último que pasó. */
export function Home({ onTab }: { onTab: (t: TabId) => void }) {
  const { me, binance, setBinance, version, report, year, toast } = useWallet();
  const [s, setS] = useState<Saldos | null>(null);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<Movement[] | null>(null);
  const [modal, setModal] = useState<"" | "add" | "import">("");
  const lastOk = binance?.last_ok;

  useEffect(() => {
    let alive = true;
    api.saldos().then((d) => alive && setS(d), (e: Error) => alive && setError(e.message));
    api.movements(currentYear()).then((r) => alive && setRecent(r.movements.slice(-6).reverse()), () => alive && setRecent([]));
    return () => { alive = false; };
  }, [version, lastOk]);

  async function sync() {
    try {
      setBinance(await api.binanceSync());
    } catch (e) {
      toast("No se pudo actualizar", (e as Error).message, "bad");
    }
  }

  const running = binance?.job.state === "running";
  const bal = s?.binance;
  const banks = s?.banks;
  const closing = banks?.last_closing;
  const pnl = report?.books.pnl;
  const total = (bal?.total_cop ?? 0) + (closing ? banks!.books : 0);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Hola{me.profile.name ? `, ${me.profile.name.split(" ")[0]}` : ""}</h1>
          <p>Tus saldos y tu negocio al {date(Date.now() / 1000)}.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setModal("import")}><Icon name="upload" size={16} /> Subir archivo</button>
          <button className="btn btn-primary" onClick={() => setModal("add")}><Icon name="plus" size={16} /> Agregar movimiento</button>
        </div>
      </div>

      {binance && !binance.connected && <BinanceCard />}
      {binance?.connected && <BinanceCard alertsOnly />}
      {pnl && year === currentYear() && <GmfQuestion operations={pnl.gross_profit + pnl.income} gmf={pnl.gmf} onSettings={() => onTab("ajustes")} />}
      {error && <Note kind="bad">{error}</Note>}

      {/* ---------- totales ---------- */}
      <div className="kpis">
        <div className="kpi accent">
          <small>Total de tu negocio</small>
          <b>{s ? money(total) : "…"}</b>
          <span>{closing ? "Binance + pesos en tus cuentas" : "Binance (haz un cierre de caja para sumar tus pesos)"}</span>
        </div>
        <div className="kpi">
          <small>En Binance</small>
          <b>{bal ? money(bal.total_cop) : "…"}</b>
          <span>{bal ? `US$ ${num(bal.total_usd, 2)} · precio de hoy` : " "}</span>
        </div>
        <div className="kpi">
          <small>Pesos en tus cuentas</small>
          <b className={banks && banks.books < 0 ? "warn" : ""}>{banks ? money(banks.books) : "…"}</b>
          <span>{closing ? `Último cierre: ${date(closing.t)}` : "Según tus movimientos"}</span>
        </div>
        <div className="kpi">
          <small>Resultado {year}</small>
          <b className={pnl ? tone(pnl.net) : ""}>{pnl ? signedMoney(pnl.net) : "…"}</b>
          <span>{pnl ? `Operaciones ${signedMoney(pnl.gross_profit + pnl.income)}${pnl.gmf ? ` · 4x1000 −${money(pnl.gmf)}` : ""}` : " "}</span>
        </div>
      </div>

      <div className="home-grid">
        {/* ---------- Binance ---------- */}
        <div className="card">
          <div className="card-head">
            <div className="bn-title">
              <span className="bn-logo"><Coin asset="BNB" size={22} /></span>
              <div>
                <h2>Binance {bal && !bal.ok && <Badge kind="warn">No cuadra</Badge>}{bal?.ok && bal.rows.length > 0 && <Badge kind="good">Cuadra con tus libros</Badge>}</h2>
                <span className="sub">
                  {!binance?.connected ? "Sin conectar" : running ? binance.job.step : `Actualizado ${ago(lastOk)} · se actualiza solo cada 30 min`}
                </span>
              </div>
            </div>
            {binance?.connected && (
              <button className="btn btn-sm" onClick={sync} disabled={running}>
                {running ? <span className="spinner" /> : <Icon name="refresh" size={14} />} Actualizar
              </button>
            )}
          </div>
          {!s ? <div className="card-body"><Skeleton rows={2} /></div> : !bal?.rows.length ? (
            <Empty icon="wallet" title="No tienes cripto en Binance ahora">
              {binance?.connected ? "Todo está en pesos. Cuando compres, aparece aquí." : "Conecta tu Binance para ver tus saldos."}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr><th>Moneda</th><th className="r">Cantidad</th><th className="hide-sm">Dónde</th><th className="r hide-sm">Precio</th><th className="r">Valor hoy</th><th className="r hide-sm">Te costó</th><th className="r">Libros</th></tr>
                </thead>
                <tbody>
                  {bal.rows.map((r) => (
                    <tr key={r.asset}>
                      <td><Asset asset={r.asset} /></td>
                      <td className="r">{qty(r.qty)}</td>
                      <td className="hide-sm">
                        <span className="chips">
                          {Object.entries(r.wallets).filter(([, v]) => v > 0).map(([w, v]) => <span key={w} className="chip-mini" title={`${qty(v)} ${r.asset}`}>{WALLET[w]}</span>)}
                        </span>
                      </td>
                      <td className="r hide-sm">{r.usd_price != null ? `US$ ${num(r.usd_price, r.usd_price < 10 ? 4 : 2)}` : "—"}</td>
                      <td className="r"><b>{r.cop != null ? money(r.cop) : "—"}</b>{r.usd != null && <span className="cell-sub">US$ {num(r.usd, 2)}</span>}</td>
                      <td className="r hide-sm">{money(r.cost)}{r.cop != null && r.cost > 0 && <span className={`cell-sub ${tone(r.cop - r.cost)}`}>{signedMoney(r.cop - r.cost)}</span>}</td>
                      <td className="r">{r.ok ? <Icon name="check" size={16} /> : <span className="warn" title={`Según tus movimientos: ${qty(r.app_qty)}`}>Revisar</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {bal && !bal.ok && (
            <div className="card-body" style={{ paddingTop: 12 }}>
              <Note kind="warn">Lo que tienes en Binance no coincide con tus movimientos: falta alguna entrada (un depósito, P2P viejos) o salida (un retiro). Agrégalo en Movimientos.</Note>
            </div>
          )}
          {bal?.trm && <div className="card-body small-print">Valor de hoy: precio de Binance × TRM {money(bal.trm)}. Lo que se declara es lo que te costó.</div>}
        </div>

        {/* ---------- caja en pesos ---------- */}
        <CajaCard onTab={onTab} />
      </div>

      <div className="grid-2">
        {/* ---------- últimos movimientos ---------- */}
        <div className="card">
          <div className="card-head">
            <h2>Últimos movimientos</h2>
            <button className="btn btn-sm btn-ghost" onClick={() => onTab("movimientos")}>Ver todos <Icon name="chevron" size={14} /></button>
          </div>
          {!recent ? <div className="card-body"><Skeleton rows={2} /></div> : !recent.length ? (
            <Empty icon="list" title="Sin movimientos este año" />
          ) : (
            <div className="feed">
              {recent.map((m) => (
                <div key={m.id} className="feed-row">
                  <Badge kind={KIND_BADGE[m.kind]}>{KIND_LABEL[m.kind]}</Badge>
                  <span className="feed-txt">
                    {m.kind === "compra" ? `${qty(m.in_qty)} ${m.in_asset}` : m.kind === "venta" ? `${qty(m.out_qty)} ${m.out_asset}`
                      : m.kind === "permuta" ? `${m.out_asset} → ${m.in_asset}` : m.note || KIND_LABEL[m.kind]}
                    <small>{dateTime(m.t)}{m.pay_method ? ` · ${methodName(m.pay_method)}` : ""}</small>
                  </span>
                  <b className="num">{money(cashValue(m))}</b>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---------- rondas recientes ---------- */}
        <div className="card">
          <div className="card-head">
            <h2>Rondas de arbitraje</h2>
            <button className="btn btn-sm btn-ghost" onClick={() => onTab("resultados")}>Ver resultados <Icon name="chevron" size={14} /></button>
          </div>
          {!report ? <div className="card-body"><Skeleton rows={2} /></div> : !report.books.rounds.length ? (
            <Empty icon="trend" title={`Sin rondas en ${year}`}>Una ronda es cada vuelta de pesos a cripto y de vuelta a pesos.</Empty>
          ) : (
            <div className="feed">
              {report.books.rounds.slice(-5).reverse().map((r) => (
                <div key={r.start} className="feed-row">
                  <span className="route">{["COP", ...r.assets, ...(r.open ? [] : ["COP"])].map((a, i) => <Coin key={i} asset={a} size={18} />)}</span>
                  <span className="feed-txt">
                    {r.open ? "En curso" : `Recibiste ${money(r.received)}`}
                    <small>{dateTime(r.start)} · pagaste {money(r.paid)}{r.gmf ? ` · 4x1000 ${money(r.gmf)}` : ""}{r.binance_fees ? ` · Binance ${money(r.binance_fees)}` : ""}</small>
                  </span>
                  {r.open ? <Badge kind="info">En curso</Badge> : <b className={`num ${tone(r.result)}`}>{signedMoney(r.result)}</b>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {modal === "add" && <MoveModal onClose={() => setModal("")} />}
      {modal === "import" && <ImportModal onClose={() => setModal("")} />}
    </div>
  );
}
