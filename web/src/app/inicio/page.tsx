"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, Logo } from "@/components/ui";

// Portada de arbicrypto.org: un tablero de bolsa con los precios P2P reales, letra por letra.
// El login vive en /login: desde ahí cada quien sigue a SU panel o a SU wallet.

type Quote = { asset: string; buy: number | null; sell: number | null };
type Market = { t: number | null; rows: Quote[] };

const LOGIN = { panel: "/login?next=panel", wallet: "/login?next=wallet", invite: "/login?mode=registro" };
const ORDER = ["USDT", "BTC", "ETH", "BNB", "SOL", "XRP", "USDC", "FDUSD"];
const STABLE = new Set(["USDT", "USDC", "FDUSD"]);
const FEE = 0.0014;  // comisión P2P de ejemplo para el recibo (el panel usa la de cada cuenta)
const GMF = 0.004;   // 4x1000

const es = (v: number, d = 0) => v.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
const cop = (v: number) => `$${es(Math.round(v))}`;

/** Cifra para el tablero: los dólares con centavos, lo demás en pesos enteros (o en millones si no cabe). */
function boardNum(asset: string, v: number | null, compact: boolean) {
  if (v == null) return "—";
  if (compact && v >= 1e6) return `${es(v / 1e6, 1)}M`;
  return STABLE.has(asset) && !compact ? es(v, 2) : es(v);
}

function useMarket() {
  const [m, setM] = useState<Market | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/public/mercado")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Market | null) => alive && d && setM(d))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return m;
}

function useMedia(q: string) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setOn(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [q]);
  return on;
}

/** Hora de Bogotá, segundo a segundo (en el navegador: la página se compila una sola vez). */
function useClock() {
  const [t, setT] = useState("");
  useEffect(() => {
    const f = () => setT(new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/Bogota" }));
    f();
    const id = setInterval(f, 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

/** Las secciones aparecen al llegar a ellas (sin animación si el sistema pide menos movimiento). */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".bd-reveal");
    if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      els.forEach((e) => e.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver((list) => {
      for (const x of list) if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

const SPIN = "0123456789$.,-+%";

/** Texto de paletas que giran: cada letra que cambia pasa por unas cuantas al azar antes de quedarse. */
function Flap({ text, width, delay = 0, tone }: { text: string; width: number; delay?: number; tone?: string }) {
  const target = text.padStart(width, " ");
  const [shown, setShown] = useState(" ".repeat(width));
  const prev = useRef(" ".repeat(width));
  useEffect(() => {
    const from = prev.current.padStart(width, " ");
    prev.current = target;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(target); return; }
    const stop = [...target].map((c, i) => (c === from[i] ? 0 : delay + 3 + Math.floor(Math.random() * 6) + Math.floor(i * 0.7)));
    const last = Math.max(0, ...stop);
    if (!last) { setShown(target); return; }
    let f = 0;
    const id = setInterval(() => {
      f++;
      setShown([...target].map((c, i) => (f >= stop[i] ? c : SPIN[Math.floor(Math.random() * SPIN.length)])).join(""));
      if (f >= last) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [target, width, delay]);
  return (
    <span className={`flap-row ${tone ?? ""}`} aria-label={text}>
      {[...shown].map((c, i) => (
        <span className={`flap ${c === " " ? "blank" : ""}`} key={i} aria-hidden="true"><span>{c}</span></span>
      ))}
    </span>
  );
}

function Board({ m }: { m: Market | null }) {
  const compact = useMedia("(max-width: 760px)");
  const clock = useClock();
  const byAsset = new Map((m?.rows ?? []).map((r) => [r.asset, r]));
  const rows = ORDER.filter((a) => !m || byAsset.has(a)).map((a) => byAsset.get(a) ?? { asset: a, buy: null, sell: null });
  const cells = rows.map((r) => {
    const gap = r.buy && r.sell ? ((r.sell - r.buy) / r.buy) * 100 : null;
    return {
      ...r,
      b: boardNum(r.asset, r.buy, compact),
      s: boardNum(r.asset, r.sell, compact),
      g: gap == null ? "—" : `${gap > 0 ? "+" : ""}${es(gap, 2)}%`,
      tone: gap == null ? "" : gap > 0 ? "up" : "down",
    };
  });
  const wB = Math.max(6, ...cells.map((c) => c.b.length));
  const wS = Math.max(6, ...cells.map((c) => c.s.length));
  const wG = Math.max(6, ...cells.map((c) => c.g.length));
  const live = !!m?.rows?.length;
  return (
    <div className="board" role="table" aria-label="Precios P2P en pesos colombianos, en vivo">
      <div className="board-top">
        <span className="board-title">Tablero P2P <i>·</i> COP <i>·</i> Binance</span>
        <span className={`board-live ${live ? "on" : ""}`}><span className="bd-dot" /> {live ? "En vivo" : "Conectando"}</span>
        <span className="board-clock">{clock || "--:--:--"} <small>BOG</small></span>
      </div>
      <div className="board-head" role="row">
        <span role="columnheader">Activo</span>
        <span role="columnheader">Te cuesta comprar</span>
        <span role="columnheader">Recibes al vender</span>
        <span role="columnheader" className="bd-hide-sm">Diferencia</span>
      </div>
      {cells.map((c, i) => (
        <div className={`board-row ${c.asset === "USDT" ? "lead" : ""}`} role="row" key={c.asset}>
          <span className="board-asset" role="cell">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/coins/${c.asset.toLowerCase()}.svg`} alt="" width={22} height={22} />
            <b>{c.asset}</b>
          </span>
          <span role="cell"><Flap text={c.b} width={wB} delay={i} /></span>
          <span role="cell"><Flap text={c.s} width={wS} delay={i + 2} /></span>
          <span role="cell" className="bd-hide-sm"><Flap text={c.g} width={wG} delay={i + 4} tone={c.tone} /></span>
        </div>
      ))}
      <div className="board-foot">
        <span>Mejor anuncio de cada lado, en pesos · antes de comisiones y 4x1000</span>
        <span>Se revisa cada 1 s</span>
      </div>
    </div>
  );
}

/** La cuenta que hace el panel con cada ruta, con los precios de USDT de ahora mismo. */
function Receipt({ m }: { m: Market | null }) {
  const [cap, setCap] = useState(500000);
  const usdt = m?.rows.find((r) => r.asset === "USDT");
  const b = usdt?.buy ?? null, s = usdt?.sell ?? null;
  const gmf = cap * GMF;
  const got = b ? cap / b : 0;
  const fee = got * FEE;
  const back = s ? (got - fee) * s : 0;
  const net = b && s ? back - cap - gmf : null;
  const line = (k: string, v: string, cls = "") => <div className={`rc-line ${cls}`}><span>{k}</span><i /><b>{v}</b></div>;
  return (
    <div className="rc">
      <div className="rc-paper">
        <p className="rc-brand">ARBICRYPTO</p>
        <p className="rc-sub">Recibo de ruta · USDT → pesos</p>
        <p className="rc-cut" />
        {line("Capital", cop(cap))}
        {line("4x1000 al pagar", `−${cop(gmf)}`, "neg")}
        {line(`Compras USDT${b ? ` a ${cop(b)}` : ""}`, b ? `${es(got, 2)} USDT` : "…")}
        {line(`Comisión P2P (${es(FEE * 100, 2)} %)`, b ? `−${es(fee, 2)} USDT` : "…", "neg")}
        {line(`Vendes${s ? ` a ${cop(s)}` : ""}`, s ? cop(back) : "…")}
        <p className="rc-cut" />
        <div className={`rc-total ${net == null ? "" : net >= 0 ? "up" : "down"}`}>
          <span>Te queda</span>
          <b>{net == null ? "…" : `${net >= 0 ? "+" : "−"}${cop(Math.abs(net))}`}</b>
        </div>
        <p className="rc-verdict">
          {net == null ? "Esperando precios en vivo…" : net >= 0 ? "★ Esta da. El panel te avisa." : "✕ Esta no da. El panel se queda callado."}
        </p>
        <p className="rc-cut" />
        <p className="rc-fine">Precios de USDT de este momento. Comisión de ejemplo: el panel usa la de tu cuenta.</p>
      </div>
      <label className="rc-slider">
        <span>Mueve tu capital <b>{cop(cap)}</b></span>
        <input type="range" min={100000} max={5000000} step={50000} value={cap} onChange={(e) => setCap(+e.target.value)} />
      </label>
    </div>
  );
}

function Ticker({ m }: { m: Market | null }) {
  const rows = m?.rows ?? [];
  const items = rows.length ? [...rows, ...rows] : [];
  return (
    <div className="bd-ticker" aria-hidden="true">
      <div className={`bd-ticker-track ${items.length ? "run" : ""}`}>
        {items.length ? items.map((q, i) => {
          const gap = q.buy && q.sell ? ((q.sell - q.buy) / q.buy) * 100 : null;
          return (
            <span key={`${q.asset}${i}`}>
              <b>{q.asset}</b> {q.buy ? cop(q.buy) : "—"}
              {gap != null && <em className={gap > 0 ? "up" : "down"}>{gap > 0 ? "▲" : "▼"} {es(Math.abs(gap), 2)}%</em>}
            </span>
          );
        }) : <span>Mercado P2P · abierto 24/7 · precios en pesos colombianos</span>}
      </div>
    </div>
  );
}

const DOES = [
  { n: "01", h: "Avisos al instante", p: "Sonido, notificación y Telegram cuando una ruta llega a tu mínimo, ya con todo descontado. Si no gana, no avisa." },
  { n: "02", h: "¿Dónde vendo?", p: "Anotas lo que compraste y a cuánto. El panel vigila a quién venderle y te avisa cuando sales sin perder." },
  { n: "03", h: "Arbitraje en Spot", p: "Rutas entre USDT, BTC, ETH y las demás, medidas con la profundidad real del libro para tu monto." },
  { n: "04", h: "Historial hora por hora", p: "Cuántas oportunidades hubo, cuánto duraron y a qué hora del día el mercado se acerca más a dar." },
  { n: "05", h: "Chat del equipo", p: "Canal general y privados. Capital, avisos y cuenta de Binance siguen siendo de cada quien." },
];

const FORM = ["Patrimonio en cripto a 31 de dic.", "Ingresos por ventas", "Costos de lo vendido", "4x1000 deducible", "Ganancia ocasional"];

export default function Portada() {
  const m = useMarket();
  useReveal();
  return (
    <div className="bd">
      <Ticker m={m} />

      <header className="bd-nav">
        <div className="bd-wrap bd-nav-in">
          <a href="/" className="bd-brand" aria-label="ArbiCrypto, inicio"><Logo size={30} /><span>Arbi<b>Crypto</b></span></a>
          <nav className="bd-links" aria-label="Secciones">
            <a href="#la-cuenta">La cuenta</a>
            <a href="#panel">Panel</a>
            <a href="#wallet">Wallet</a>
            <a href="#seguridad">Seguridad</a>
          </nav>
          <a className="bd-login" href="/login">Iniciar sesión</a>
          <a className="bd-btn bd-btn-sm" href={LOGIN.panel}>Entrar <Icon name="arrowRight" size={14} /></a>
        </div>
      </header>

      <main>
        {/* ---------- hero: el tablero ---------- */}
        <section className="bd-hero">
          <div className="bd-wrap">
            <h1 className="bd-h1">
              <span>Compra barato.</span>
              <span>Vende caro.</span>
              <span className="gold">En pesos.</span>
            </h1>
            <div className="bd-hero-row">
              <p className="bd-lead">
                ArbiCrypto mira Binance P2P y Spot cada segundo y hace la cuenta completa: comisión, redondeo y 4x1000.
                <b> Solo te avisa cuando de verdad quedan pesos.</b>
              </p>
              <div className="bd-cta">
                <a className="bd-btn" href={LOGIN.panel}>Entrar al panel <Icon name="arrowRight" size={17} /></a>
                <a className="bd-btn bd-btn-line" href={LOGIN.invite}>Tengo una invitación</a>
              </div>
            </div>
            <Board m={m} />
          </div>
        </section>

        {/* ---------- la cuenta ---------- */}
        <section id="la-cuenta" className="bd-sec">
          <div className="bd-wrap bd-split">
            <div className="bd-reveal">
              <p className="bd-kicker">01 — La cuenta</p>
              <h2 className="bd-h2">La diferencia <span className="gold">no es</span> la ganancia.</h2>
              <p className="bd-p">
                Comprar a un precio y vender a otro parece fácil. Pero entre la comisión de Binance, el redondeo de cantidades y el
                4x1000 de tu banco, la mayoría de las veces que &ldquo;parece que da&rdquo;, pierdes.
              </p>
              <p className="bd-p">
                Este recibo usa el precio de USDT de ahora mismo. El panel hace esta cuenta con cada ruta, cada segundo, con tu capital y
                tu comisión real, y solo suena cuando el total sale en verde.
              </p>
            </div>
            <div className="bd-reveal"><Receipt m={m} /></div>
          </div>
        </section>

        {/* ---------- el panel ---------- */}
        <section id="panel" className="bd-sec">
          <div className="bd-wrap">
            <div className="bd-reveal bd-sec-head">
              <p className="bd-kicker">02 — El panel</p>
              <h2 className="bd-h2">Así se ve por dentro.</h2>
            </div>
            <figure className="bd-shot bd-reveal">
              <div className="bd-shot-bar"><i /><i /><i /><span>panel.arbicrypto.org</span></div>
              <div className="bd-shot-img">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/panel-precios.jpg" alt="Precios P2P en el panel de ArbiCrypto: lo que cuesta comprar, lo que recibes al vender y la gráfica del día" width={1275} height={827} loading="lazy" />
                <span className="bd-pin" style={{ left: "2.5%", top: "35.5%" }}>A</span>
                <span className="bd-pin" style={{ left: "51%", top: "35.5%" }}>B</span>
                <span className="bd-pin" style={{ left: "2.5%", top: "54%" }}>C</span>
              </div>
            </figure>
            <ol className="bd-legend bd-reveal">
              <li><b>A</b> Lo que cuesta comprar y lo que recibes al vender, del mejor anuncio con buena reputación.</li>
              <li><b>B</b> Comprar y vender ya, con tu capital y ya neto: ahí ves si da o no.</li>
              <li><b>C</b> El día completo, para saber si el precio va de subida o de bajada.</li>
            </ol>
            <div className="bd-does">
              {DOES.map((d) => (
                <div className="bd-do bd-reveal" key={d.n}>
                  <span className="bd-do-n">{d.n}</span>
                  <h3>{d.h}</h3>
                  <p>{d.p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- wallet ---------- */}
        <section id="wallet" className="bd-sec">
          <div className="bd-wrap bd-split">
            <div className="bd-reveal">
              <p className="bd-kicker">03 — La wallet</p>
              <h2 className="bd-h2">Y para la renta, <span className="gold">la DIAN</span> ya está hecha.</h2>
              <p className="bd-p">
                La wallet trae tus órdenes de Binance sola, le encuentra la compra a cada venta, valora cada permuta con la TRM del día y
                calcula el 4x1000 según lo que de verdad te cobra tu banco.
              </p>
              <p className="bd-p">
                Al cierre descargas un Excel explicado en palabras sencillas, con el kardex, los libros con cuentas del PUC y las
                comprobaciones que dicen si todo cuadra. O el paquete completo para tu contador.
              </p>
              <a className="bd-btn" href={LOGIN.wallet}>Entrar a mi wallet <Icon name="arrowRight" size={17} /></a>
            </div>
            <div className="bd-form bd-reveal" aria-hidden="true">
              <div className="bd-form-head">
                <span>Formulario 210</span>
                <span>Renta · persona natural</span>
              </div>
              {FORM.map((k, i) => (
                <div className="bd-form-row" key={k}>
                  <span className="bd-form-n">{String(i + 1).padStart(2, "0")}</span>
                  <span>{k}</span>
                  <span className="bd-form-v" style={{ width: `${40 + ((i * 37) % 45)}%` }} />
                </div>
              ))}
              <div className="bd-form-foot">
                <span className="bd-stamp">✓ Cuadra</span>
                <small>Sigue el Estatuto Tributario y el Concepto Unificado DIAN 1621 de 2023. Cálculo informativo: revísalo con tu contador.</small>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- seguridad ---------- */}
        <section id="seguridad" className="bd-sec">
          <div className="bd-wrap">
            <div className="bd-reveal bd-sec-head">
              <p className="bd-kicker">04 — Seguridad</p>
              <h2 className="bd-h2">Puede mirar. <span className="gold">No puede tocar.</span></h2>
            </div>
            <div className="bd-perms bd-reveal">
              <div className="ok"><span>Lectura</span><b>Sí</b></div>
              <div className="no"><span>Trading</span><b>No</b></div>
              <div className="no"><span>Retiros</span><b>No</b></div>
            </div>
            <div className="bd-sec-cols bd-reveal">
              <p>Binance se conecta con una llave de <b>solo lectura</b>: si puede operar o retirar, no se acepta. Se guarda cifrada.</p>
              <p>Saldos, órdenes, wallet y declaración los ves <b>solo tú</b>. Ni los administradores entran. Lo único compartido es el chat.</p>
              <p>Entras <b>solo con invitación</b>. Contraseñas con PBKDF2 de 600.000 iteraciones, HTTPS y bloqueo a quien intente adivinar.</p>
            </div>
          </div>
        </section>

        {/* ---------- cierre ---------- */}
        <section className="bd-end">
          <div className="bd-wrap">
            <a className="bd-end-link" href={LOGIN.panel}>
              <span>Abre el tablero</span>
              <Icon name="arrowRight" size={64} />
            </a>
            <p className="bd-end-sub">¿Te pasaron un código? <a href={LOGIN.invite}>Úsalo aquí</a> · ¿Ya tienes cuenta? <a href="/login">Inicia sesión</a></p>
          </div>
        </section>
      </main>

      <footer className="bd-foot">
        <div className="bd-wrap bd-foot-in">
          <a href="/" className="bd-brand"><Logo size={26} /><span>Arbi<b>Crypto</b></span></a>
          <nav aria-label="Entrar">
            <a href={LOGIN.panel}>Panel</a>
            <a href={LOGIN.wallet}>Wallet</a>
            <a href="/login">Iniciar sesión</a>
          </nav>
          <p>
            Acceso solo con invitación. Las ganancias son estimadas con el mejor precio del momento: confirma siempre en Binance antes de
            pagar. No es asesoría financiera ni tributaria. ArbiCrypto no está afiliado a Binance.
          </p>
        </div>
      </footer>
    </div>
  );
}
