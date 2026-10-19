"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, Logo, type IconName } from "@/components/ui";

// Portada de arbicrypto.org: estilo de exchange (tarjetas de vidrio, brillos, monedas que flotan)
// con lo nuestro: el tablero de paletas con los precios P2P reales y el recibo con la cuenta completa.
// El login vive en /login: desde ahí cada quien sigue a SU panel o a SU wallet.

type Quote = { asset: string; buy: number | null; sell: number | null };
type Market = { t: number | null; rows: Quote[] };
type Hist = Record<string, number[]>;

const LOGIN = { panel: "/login?next=panel", wallet: "/login?next=wallet", invite: "/login?mode=registro" };
const ORDER = ["USDT", "BTC", "ETH", "BNB", "SOL", "XRP", "USDC", "FDUSD"];
const STABLE = new Set(["USDT", "USDC", "FDUSD"]);
const FEE = 0.0014;  // comisión P2P de ejemplo para el recibo (el panel usa la de cada cuenta)
const GMF = 0.004;   // 4x1000
const KEEP = 40;     // puntos de la minigráfica (uno por consulta)

const es = (v: number, d = 0) => v.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
const cop = (v: number) => `$${es(Math.round(v))}`;
const gapOf = (q?: Quote) => (q?.buy && q.sell ? ((q.sell - q.buy) / q.buy) * 100 : null);
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Cifra para el tablero: los dólares con centavos, lo demás en pesos enteros (o en millones si no cabe). */
function boardNum(asset: string, v: number | null, compact: boolean) {
  if (v == null) return "—";
  if (compact && v >= 1e6) return `${es(v / 1e6, 1)}M`;
  return STABLE.has(asset) && !compact ? es(v, 2) : es(v);
}

/** Precios públicos cada 15 s, y lo que va del rato para las minigráficas. */
function useMarket() {
  const [m, setM] = useState<Market | null>(null);
  const [hist, setHist] = useState<Hist>({});
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/public/mercado")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Market | null) => {
          if (!alive || !d) return;
          setM(d);
          setHist((h) => {
            const n: Hist = { ...h };
            for (const r of d.rows) if (r.buy) n[r.asset] = [...(h[r.asset] ?? []), r.buy].slice(-KEEP);
            return n;
          });
        })
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return { m, hist };
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

/** Las piezas aparecen al llegar a ellas; las que traen --i entran en cascada. */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".wb-reveal");
    if (!("IntersectionObserver" in window) || calm()) {
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

/** La captura del panel se endereza a medida que sube por la pantalla (de 24° a plana). */
function useTilt() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || calm()) return;
    let raf = 0;
    const f = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight * 0.85)));
      el.style.setProperty("--tilt", String(1 - p));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(f); };
    f();
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    return () => { removeEventListener("scroll", on); removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, []);
  return ref;
}

/** Un número que cuenta desde cero la primera vez que se ve. */
function CountUp({ to, suffix = "", dur = 1600 }: { to: number; suffix?: string; dur?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (calm() || !("IntersectionObserver" in window)) { setV(to); return; }
    let raf = 0;
    const io = new IntersectionObserver(([x]) => {
      if (!x.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / dur);
        setV(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to, dur]);
  return <span ref={ref}>{es(Math.round(v))}{suffix}</span>;
}

/** Brillo que sigue al cursor dentro de una tarjeta. */
function spot(e: React.MouseEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
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
    if (calm()) { setShown(target); return; }
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

/** Minigráfica de lo que va del rato (se llena sola mientras la página está abierta). */
function Spark({ pts, tone }: { pts?: number[]; tone: string }) {
  const W = 96, H = 32;
  if (!pts || pts.length < 2) return <svg className="wb-spark idle" viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><line x1="0" y1={H / 2} x2={W} y2={H / 2} /></svg>;
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const xy = pts.map((p, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - 3 - ((p - lo) / span) * (H - 6)).toFixed(1)}`);
  return (
    <svg className={`wb-spark ${tone}`} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <polygon points={`0,${H} ${xy.join(" ")} ${W},${H}`} />
      <polyline points={xy.join(" ")} />
    </svg>
  );
}

// ---------------------------------------------------------------- hero

const ORBIT = [
  { a: "btc", x: 6, y: 14, s: 74, d: 1.6 },
  { a: "eth", x: 80, y: 6, s: 62, d: 1.2 },
  { a: "bnb", x: 88, y: 62, s: 56, d: 1.9 },
  { a: "sol", x: 10, y: 52, s: 50, d: 1.4 },
  { a: "xrp", x: 64, y: 86, s: 42, d: 2.2 },
  { a: "usdc", x: 40, y: -2, s: 38, d: 2.6 },
];

/** La escena del hero: la tarjeta de USDT en vivo con monedas que flotan alrededor y siguen al cursor. */
function HeroScene({ m }: { m: Market | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const usdt = m?.rows.find((r) => r.asset === "USDT");
  const gap = gapOf(usdt);
  const w = Math.max(8, cop(usdt?.buy ?? 0).length, cop(usdt?.sell ?? 0).length);
  const move = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el || calm()) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--px", ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
    el.style.setProperty("--py", ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
  };
  const leave = () => { ref.current?.style.setProperty("--px", "0"); ref.current?.style.setProperty("--py", "0"); };
  return (
    <div className="wb-scene" ref={ref} onMouseMove={move} onMouseLeave={leave} aria-hidden="true">
      <div className="wb-ring r1" />
      <div className="wb-ring r2" />
      <div className="wb-orb" />
      {ORBIT.map((c, i) => (
        <span key={c.a} className="wb-coin" style={{ left: `${c.x}%`, top: `${c.y}%`, width: c.s, height: c.s, "--d": c.d, "--i": i } as React.CSSProperties}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/coins/${c.a}.svg`} alt="" width={c.s} height={c.s} />
        </span>
      ))}
      <div className="wb-live">
        <div className="wb-live-top">
          <span className="wb-live-coin">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/coins/usdt.svg" alt="" width={34} height={34} />
            <span><b>USDT</b><small>Tether · P2P COP</small></span>
          </span>
          <span className={`wb-pill ${m ? "on" : ""}`}><span className="wb-dot" />{m ? "En vivo" : "…"}</span>
        </div>
        <div className="wb-live-q">
          <small>Te cuesta comprar</small>
          <Flap text={usdt?.buy ? cop(usdt.buy) : "—"} width={w} />
        </div>
        <div className="wb-live-q">
          <small>Recibes al vender</small>
          <Flap text={usdt?.sell ? cop(usdt.sell) : "—"} width={w} delay={2} />
        </div>
        <div className="wb-live-foot">
          <span>Diferencia</span>
          <b className={gap == null ? "" : gap > 0 ? "up" : "down"}>{gap == null ? "—" : `${gap > 0 ? "+" : ""}${es(gap, 2)} %`}</b>
        </div>
      </div>
      <div className="wb-chip c1"><Icon name="bellRing" size={16} /> Ruta lista · ya neta</div>
      <div className="wb-chip c2"><Icon name="shield" size={16} /> Solo lectura</div>
    </div>
  );
}

// ---------------------------------------------------------------- mercados

const TABS = [
  { k: "all", t: "Todos" },
  { k: "stable", t: "Dólares" },
  { k: "crypto", t: "Cripto" },
] as const;

function Markets({ m, hist }: { m: Market | null; hist: Hist }) {
  const compact = useMedia("(max-width: 760px)");
  const clock = useClock();
  const [tab, setTab] = useState<(typeof TABS)[number]["k"]>("all");
  const byAsset = new Map((m?.rows ?? []).map((r) => [r.asset, r]));
  const rows = ORDER.filter((a) => !m || byAsset.has(a))
    .filter((a) => tab === "all" || (tab === "stable") === STABLE.has(a))
    .map((a) => byAsset.get(a) ?? { asset: a, buy: null, sell: null });
  const cells = rows.map((r) => {
    const gap = gapOf(r);
    return {
      ...r,
      b: boardNum(r.asset, r.buy, compact),
      s: boardNum(r.asset, r.sell, compact),
      g: gap == null ? "—" : `${gap > 0 ? "+" : ""}${es(gap, 2)}%`,
      tone: gap == null ? "" : gap > 0 ? "up" : "down",
    };
  });
  // el ancho se toma de todos los activos para que el tablero no salte al cambiar de pestaña
  const all = (m?.rows ?? []).map((r) => [boardNum(r.asset, r.buy, compact), boardNum(r.asset, r.sell, compact)]).flat();
  const wN = Math.max(6, ...all.map((s) => s.length));
  const wG = Math.max(6, ...cells.map((c) => c.g.length));
  const live = !!m?.rows?.length;
  return (
    <div className="wb-mk wb-glass" role="table" aria-label="Precios P2P en pesos colombianos, en vivo">
      <div className="wb-mk-top">
        <div className="wb-tabs" role="tablist">
          {TABS.map((x) => (
            <button key={x.k} role="tab" aria-selected={tab === x.k} className={tab === x.k ? "on" : ""} onClick={() => setTab(x.k)}>{x.t}</button>
          ))}
        </div>
        <span className={`wb-pill ${live ? "on" : ""}`}><span className="wb-dot" />{live ? "En vivo" : "Conectando"}</span>
        <span className="wb-clock">{clock || "--:--:--"} <small>BOG</small></span>
      </div>
      <div className="wb-mk-head" role="row">
        <span role="columnheader">Activo</span>
        <span role="columnheader">Te cuesta comprar</span>
        <span role="columnheader">Recibes al vender</span>
        <span role="columnheader" className="wb-hide-sm">Diferencia</span>
        <span role="columnheader" className="wb-hide-md">Este rato</span>
      </div>
      {cells.map((c, i) => (
        <div className={`wb-mk-row ${c.asset === "USDT" ? "lead" : ""}`} role="row" key={c.asset}>
          <span className="wb-mk-asset" role="cell">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/coins/${c.asset.toLowerCase()}.svg`} alt="" width={30} height={30} />
            <span><b>{c.asset}</b><small>{STABLE.has(c.asset) ? "Dólar digital" : "Cripto"}</small></span>
          </span>
          <span role="cell"><Flap text={c.b} width={wN} delay={i} /></span>
          <span role="cell"><Flap text={c.s} width={wN} delay={i + 2} /></span>
          <span role="cell" className="wb-hide-sm"><span className={`wb-gap ${c.tone}`}>{c.g}</span></span>
          <span role="cell" className="wb-hide-md"><Spark pts={hist[c.asset]} tone={c.tone} /></span>
        </div>
      ))}
      <div className="wb-mk-foot">
        <span>Mejor anuncio de cada lado, en pesos · antes de comisiones y 4x1000</span>
        <a href={LOGIN.panel}>Ver todo en el panel <Icon name="arrowRight" size={14} /></a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- recibo

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
        <input type="range" min={100000} max={5000000} step={50000} value={cap} onChange={(e) => setCap(+e.target.value)}
          style={{ "--fill": `${((cap - 100000) / 4900000) * 100}%` } as React.CSSProperties} />
      </label>
    </div>
  );
}

function Ticker({ m }: { m: Market | null }) {
  const rows = m?.rows ?? [];
  const items = rows.length ? [...rows, ...rows] : [];
  return (
    <div className="wb-ticker" aria-hidden="true">
      <div className={`wb-ticker-track ${items.length ? "run" : ""}`}>
        {items.length ? items.map((q, i) => {
          const gap = gapOf(q);
          return (
            <span key={`${q.asset}${i}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/coins/${q.asset.toLowerCase()}.svg`} alt="" width={16} height={16} />
              <b>{q.asset}</b> {q.buy ? cop(q.buy) : "—"}
              {gap != null && <em className={gap > 0 ? "up" : "down"}>{gap > 0 ? "▲" : "▼"} {es(Math.abs(gap), 2)}%</em>}
            </span>
          );
        }) : <span>Mercado P2P · abierto 24/7 · precios en pesos colombianos</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- contenido

const STATS: { n: number; suf?: string; k: string }[] = [
  { n: 1, suf: " s", k: "Cada cuánto revisa los precios" },
  { n: 8, k: "Activos en el tablero P2P" },
  { n: 600000, k: "Iteraciones para cifrar tu contraseña" },
  { n: 0, k: "Permisos para operar o retirar" },
];

const DOES: { ic: IconName; h: string; p: string; big?: boolean }[] = [
  { ic: "bellRing", h: "Avisos al instante", p: "Sonido, notificación y Telegram cuando una ruta llega a tu mínimo, ya con todo descontado. Si no gana, no avisa.", big: true },
  { ic: "target", h: "¿Dónde vendo?", p: "Anotas lo que compraste y a cuánto. El panel vigila a quién venderle y te avisa cuando sales sin perder." },
  { ic: "swap", h: "Arbitraje en Spot", p: "Rutas entre USDT, BTC, ETH y las demás, medidas con la profundidad real del libro para tu monto." },
  { ic: "history", h: "Historial hora por hora", p: "Cuántas oportunidades hubo, cuánto duraron y a qué hora del día el mercado se acerca más a dar." },
  { ic: "chat", h: "Chat del equipo", p: "Canal general y privados. Capital, avisos y cuenta de Binance siguen siendo de cada quien." },
];

const STEPS: { ic: IconName; h: string; p: string }[] = [
  { ic: "ticket", h: "Recibe tu invitación", p: "Entras con el código que te pasa alguien del equipo. Sin código no hay registro." },
  { ic: "key", h: "Conecta Binance", p: "Pegas una llave de solo lectura. Si tiene permiso de operar o retirar, se rechaza." },
  { ic: "bell", h: "Pon tu capital y tu mínimo", p: "Desde ahí el panel hace la cuenta cada segundo y solo suena cuando quedan pesos." },
];

const FORM = ["Patrimonio en cripto a 31 de dic.", "Ingresos por ventas", "Costos de lo vendido", "4x1000 deducible", "Ganancia ocasional"];

const FAQ = [
  { q: "¿ArbiCrypto puede mover mi plata?", a: "No. La llave de Binance que aceptamos es de solo lectura: si puede operar o retirar, el panel la rechaza. Las compras y ventas las haces tú en Binance." },
  { q: "¿Por qué la diferencia de precio no es la ganancia?", a: "Porque entre la comisión de Binance, el redondeo de cantidades y el 4x1000 de tu banco, muchas veces lo que parece que da, pierde. El panel descuenta todo eso antes de avisarte." },
  { q: "¿Cómo entro?", a: "Solo con invitación. Si alguien del equipo te pasó un código, regístrate con él; si ya tienes cuenta, inicia sesión y eliges si vas al panel o a la wallet." },
  { q: "¿La wallet me sirve para la declaración de renta?", a: "Te arma el patrimonio, los ingresos, los costos, el 4x1000 deducible y la ganancia ocasional con el Estatuto Tributario y el Concepto Unificado DIAN 1621 de 2023. Es un cálculo informativo: revísalo con tu contador." },
  { q: "¿Está afiliado a Binance?", a: "No. ArbiCrypto lee los precios públicos de Binance P2P y Spot y, si conectas tu llave, tus propias órdenes. No es asesoría financiera ni tributaria." },
];

export default function Portada() {
  const { m, hist } = useMarket();
  const tilt = useTilt();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useReveal();
  useEffect(() => {
    const f = () => setScrolled(scrollY > 12);
    f();
    addEventListener("scroll", f, { passive: true });
    return () => removeEventListener("scroll", f);
  }, []);
  return (
    <div className="wb">
      <div className="wb-bg" aria-hidden="true"><i className="g1" /><i className="g2" /><i className="g3" /></div>

      <header className={`wb-nav ${scrolled ? "solid" : ""}`}>
        <div className="wb-wrap wb-nav-in">
          <a href="/" className="wb-brand" aria-label="ArbiCrypto, inicio"><Logo size={32} /><span>Arbi<b>Crypto</b></span></a>
          <nav className={`wb-links ${menu ? "open" : ""}`} aria-label="Secciones" onClick={() => setMenu(false)}>
            <a href="#mercados">Mercados</a>
            <a href="#la-cuenta">La cuenta</a>
            <a href="#panel">Panel</a>
            <a href="#wallet">Wallet</a>
            <a href="#seguridad">Seguridad</a>
            <a href="#preguntas">Preguntas</a>
          </nav>
          <a className="wb-login" href="/login">Iniciar sesión</a>
          <a className="wb-btn wb-btn-sm" href={LOGIN.invite}>Registrarme</a>
          <button className="wb-burger" aria-label="Menú" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            <Icon name={menu ? "x" : "menu"} size={22} />
          </button>
        </div>
      </header>

      <main>
        {/* ---------- hero ---------- */}
        <section className="wb-hero">
          <div className="wb-wrap wb-hero-in">
            <div className="wb-hero-copy">
              <span className="wb-badge"><span className="wb-dot" /> Binance P2P y Spot · en pesos colombianos</span>
              <h1 className="wb-h1">
                <span>Compra barato.</span>
                <span>Vende caro.</span>
                <span className="wb-grad">En pesos.</span>
              </h1>
              <p className="wb-lead">
                ArbiCrypto mira Binance cada segundo y hace la cuenta completa: comisión, redondeo y 4x1000.
                <b> Solo te avisa cuando de verdad quedan pesos.</b>
              </p>
              <div className="wb-cta">
                <a className="wb-btn" href={LOGIN.panel}>Entrar al panel <Icon name="arrowRight" size={18} /></a>
                <a className="wb-btn wb-btn-ghost" href={LOGIN.invite}><Icon name="ticket" size={18} /> Tengo una invitación</a>
              </div>
            </div>
            <HeroScene m={m} />
          </div>
          <div className="wb-wrap">
            <div className="wb-stats">
              {STATS.map((s, i) => (
                <div className="wb-stat wb-reveal" key={s.k} style={{ "--i": i } as React.CSSProperties}>
                  <b><CountUp to={s.n} suffix={s.suf} /></b>
                  <span>{s.k}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Ticker m={m} />

        {/* ---------- mercados ---------- */}
        <section id="mercados" className="wb-sec">
          <div className="wb-wrap">
            <div className="wb-head wb-reveal">
              <p className="wb-kicker">Mercados</p>
              <h2 className="wb-h2">El tablero P2P, <span className="wb-grad">en vivo</span>.</h2>
              <p className="wb-sub">Lo que cuesta comprar y lo que recibes al vender en Binance P2P, del mejor anuncio de cada lado.</p>
            </div>
            <div className="wb-reveal"><Markets m={m} hist={hist} /></div>
          </div>
        </section>

        {/* ---------- la cuenta ---------- */}
        <section id="la-cuenta" className="wb-sec">
          <div className="wb-wrap wb-split">
            <div className="wb-reveal">
              <p className="wb-kicker">La cuenta</p>
              <h2 className="wb-h2">La diferencia <span className="wb-grad">no es</span> la ganancia.</h2>
              <p className="wb-p">
                Comprar a un precio y vender a otro parece fácil. Pero entre la comisión de Binance, el redondeo de cantidades y el
                4x1000 de tu banco, la mayoría de las veces que &ldquo;parece que da&rdquo;, pierdes.
              </p>
              <p className="wb-p">
                Este recibo usa el precio de USDT de ahora mismo. El panel hace esta cuenta con cada ruta, cada segundo, con tu capital y
                tu comisión real, y solo suena cuando el total sale en verde.
              </p>
            </div>
            <div className="wb-reveal wb-rc-stage"><Receipt m={m} /></div>
          </div>
        </section>

        {/* ---------- el panel ---------- */}
        <section id="panel" className="wb-sec">
          <div className="wb-wrap">
            <div className="wb-head center wb-reveal">
              <p className="wb-kicker">El panel</p>
              <h2 className="wb-h2">Todo lo que necesitas, <span className="wb-grad">en una pantalla</span>.</h2>
            </div>
            <div className="wb-tilt" ref={tilt}>
              <figure className="wb-shot">
                <div className="wb-shot-bar"><i /><i /><i /><span>panel.arbicrypto.org</span></div>
                <div className="wb-shot-img">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/panel-precios.jpg" alt="Precios P2P en el panel de ArbiCrypto: lo que cuesta comprar, lo que recibes al vender y la gráfica del día" width={1275} height={827} loading="lazy" />
                  <span className="wb-pin" style={{ left: "2.5%", top: "35.5%" }}>A</span>
                  <span className="wb-pin" style={{ left: "51%", top: "35.5%" }}>B</span>
                  <span className="wb-pin" style={{ left: "2.5%", top: "54%" }}>C</span>
                </div>
              </figure>
            </div>
            <ol className="wb-legend">
              <li className="wb-reveal" style={{ "--i": 0 } as React.CSSProperties}><b>A</b> Lo que cuesta comprar y lo que recibes al vender, del mejor anuncio con buena reputación.</li>
              <li className="wb-reveal" style={{ "--i": 1 } as React.CSSProperties}><b>B</b> Comprar y vender ya, con tu capital y ya neto: ahí ves si da o no.</li>
              <li className="wb-reveal" style={{ "--i": 2 } as React.CSSProperties}><b>C</b> El día completo, para saber si el precio va de subida o de bajada.</li>
            </ol>
            <div className="wb-bento">
              {DOES.map((d, i) => (
                <div className={`wb-card wb-glass wb-reveal ${d.big ? "big" : ""}`} key={d.h} onMouseMove={spot} style={{ "--i": i } as React.CSSProperties}>
                  <span className="wb-ic"><Icon name={d.ic} size={24} /></span>
                  <h3>{d.h}</h3>
                  <p>{d.p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- wallet ---------- */}
        <section id="wallet" className="wb-sec">
          <div className="wb-wrap wb-split">
            <div className="wb-reveal">
              <p className="wb-kicker">La wallet</p>
              <h2 className="wb-h2">Y para la renta, <span className="wb-grad">la DIAN</span> ya está hecha.</h2>
              <p className="wb-p">
                La wallet trae tus órdenes de Binance sola, le encuentra la compra a cada venta, valora cada permuta con la TRM del día y
                calcula el 4x1000 según lo que de verdad te cobra tu banco.
              </p>
              <p className="wb-p">
                Al cierre descargas un Excel explicado en palabras sencillas, con el kardex, los libros con cuentas del PUC y las
                comprobaciones que dicen si todo cuadra. O el paquete completo para tu contador.
              </p>
              <a className="wb-btn" href={LOGIN.wallet}>Entrar a mi wallet <Icon name="arrowRight" size={18} /></a>
            </div>
            <div className="wb-form wb-glass wb-reveal" aria-hidden="true">
              <div className="wb-form-head">
                <span>Formulario 210</span>
                <span>Renta · persona natural</span>
              </div>
              {FORM.map((k, i) => (
                <div className="wb-form-row" key={k} style={{ "--i": i } as React.CSSProperties}>
                  <span className="wb-form-n">{String(i + 1).padStart(2, "0")}</span>
                  <span>{k}</span>
                  <span className="wb-form-v" style={{ width: `${40 + ((i * 37) % 45)}%` }} />
                </div>
              ))}
              <div className="wb-form-foot">
                <span className="wb-stamp">✓ Cuadra</span>
                <small>Sigue el Estatuto Tributario y el Concepto Unificado DIAN 1621 de 2023. Cálculo informativo: revísalo con tu contador.</small>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- seguridad ---------- */}
        <section id="seguridad" className="wb-sec">
          <div className="wb-wrap">
            <div className="wb-head center wb-reveal">
              <p className="wb-kicker">Seguridad</p>
              <h2 className="wb-h2">Puede mirar. <span className="wb-grad">No puede tocar.</span></h2>
            </div>
            <div className="wb-perms">
              <div className="wb-glass ok wb-reveal" style={{ "--i": 0 } as React.CSSProperties}><span>Lectura</span><b><Icon name="checkCircle" size={30} /> Sí</b></div>
              <div className="wb-glass no wb-reveal" style={{ "--i": 1 } as React.CSSProperties}><span>Trading</span><b><Icon name="x" size={30} /> No</b></div>
              <div className="wb-glass no wb-reveal" style={{ "--i": 2 } as React.CSSProperties}><span>Retiros</span><b><Icon name="x" size={30} /> No</b></div>
            </div>
            <div className="wb-sec-cols">
              {[
                { ic: "key" as IconName, t: <>Binance se conecta con una llave de <b>solo lectura</b>: si puede operar o retirar, no se acepta. Se guarda cifrada.</> },
                { ic: "eyeOff" as IconName, t: <>Saldos, órdenes, wallet y declaración los ves <b>solo tú</b>. Ni los administradores entran. Lo único compartido es el chat.</> },
                { ic: "lock" as IconName, t: <>Entras <b>solo con invitación</b>. Contraseñas con PBKDF2 de 600.000 iteraciones, HTTPS y bloqueo a quien intente adivinar.</> },
              ].map((x, i) => (
                <div className="wb-reveal" key={i} style={{ "--i": i } as React.CSSProperties}>
                  <span className="wb-ic sm"><Icon name={x.ic} size={20} /></span>
                  <p>{x.t}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- pasos ---------- */}
        <section className="wb-sec">
          <div className="wb-wrap">
            <div className="wb-head center wb-reveal">
              <p className="wb-kicker">Empieza</p>
              <h2 className="wb-h2">Tres pasos y <span className="wb-grad">a vigilar</span>.</h2>
            </div>
            <div className="wb-steps">
              {STEPS.map((s, i) => (
                <div className="wb-step wb-glass wb-reveal" key={s.h} onMouseMove={spot} style={{ "--i": i } as React.CSSProperties}>
                  <span className="wb-step-n">{i + 1}</span>
                  <span className="wb-ic"><Icon name={s.ic} size={24} /></span>
                  <h3>{s.h}</h3>
                  <p>{s.p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- preguntas ---------- */}
        <section id="preguntas" className="wb-sec">
          <div className="wb-wrap wb-faq-in">
            <div className="wb-reveal">
              <p className="wb-kicker">Preguntas</p>
              <h2 className="wb-h2">Lo que <span className="wb-grad">todos preguntan</span>.</h2>
            </div>
            <div className="wb-faq">
              {FAQ.map((f, i) => (
                <details className="wb-glass wb-reveal" key={f.q} style={{ "--i": i } as React.CSSProperties} open={i === 0}>
                  <summary>{f.q}<Icon name="plus" size={20} /></summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- cierre ---------- */}
        <section className="wb-sec">
          <div className="wb-wrap">
            <div className="wb-end wb-reveal">
              <div className="wb-end-coins" aria-hidden="true">
                {["btc", "eth", "usdt", "bnb"].map((a, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={a} src={`/coins/${a}.svg`} alt="" width={56} height={56} style={{ "--i": i } as React.CSSProperties} />
                ))}
              </div>
              <h2 className="wb-h2">Abre el tablero.</h2>
              <p>Deja que la cuenta la haga el panel y entra solo cuando quedan pesos.</p>
              <div className="wb-cta center">
                <a className="wb-btn wb-btn-dark" href={LOGIN.panel}>Entrar al panel <Icon name="arrowRight" size={18} /></a>
                <a className="wb-btn wb-btn-ghost-dark" href={LOGIN.invite}>Usar mi código</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="wb-foot">
        <div className="wb-wrap wb-foot-in">
          <a href="/" className="wb-brand"><Logo size={28} /><span>Arbi<b>Crypto</b></span></a>
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
