"use client";

import { useEffect, useState } from "react";
import { Icon, Logo, type IconName } from "@/components/ui";

// Portada de arbicrypto.org: oscura y sobria, con un solo acento (el dorado de la marca). Al centro, el teléfono con la
// app y los precios P2P reales; alrededor, poco texto. El login vive en /login: desde ahí cada quien sigue a SU panel o a SU wallet.

type Quote = { asset: string; buy: number | null; sell: number | null };
type Market = { t: number | null; rows: Quote[] };
type Hist = Record<string, number[]>;

const LOGIN = { panel: "/login?next=panel", wallet: "/login?next=wallet", invite: "/login?mode=registro" };
const STABLE = new Set(["USDT", "USDC", "FDUSD"]);
const CARDS = ["USDT", "BTC", "ETH", "BNB"];
const NAMES: Record<string, string> = { USDT: "Tether", BTC: "Bitcoin", ETH: "Ethereum", BNB: "BNB", SOL: "Solana", XRP: "XRP", USDC: "USD Coin", FDUSD: "First Digital USD" };
const FEE = 0.0014;  // comisión P2P de ejemplo para el recibo (el panel usa la de cada cuenta)
const GMF = 0.004;   // 4x1000
const KEEP = 40;     // puntos de la minigráfica (uno por consulta)
// Mientras llegan los precios, el teléfono muestra una gráfica de ejemplo
const DEMO = [12, 14, 13, 17, 16, 20, 18, 23, 21, 19, 24, 27, 25, 29, 26, 31, 30, 34, 29, 33, 37, 35, 39, 42];

const es = (v: number, d = 0) => v.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
const cop = (v: number) => `$${es(Math.round(v))}`;
const price = (asset: string, v: number | null) => (v == null ? "—" : STABLE.has(asset) ? `$${es(v, 2)}` : cop(v));
const gapOf = (q?: Quote) => (q?.buy && q.sell ? ((q.sell - q.buy) / q.buy) * 100 : null);
const pct = (g: number | null) => (g == null ? "—" : `${g > 0 ? "+" : ""}${es(g, 2)} %`);
const toneOf = (g: number | null) => (g == null ? "" : g > 0 ? "up" : "down");
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const coin = (a: string) => `/coins/${a.toLowerCase()}.svg`;

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

/** Línea de precio: con relleno suave debajo y el último punto marcado. */
function Spark({ pts, tone, w = 96, h = 32, dot = false }: { pts?: number[]; tone: string; w?: number; h?: number; dot?: boolean }) {
  if (!pts || pts.length < 2) return <svg className="wb-spark idle" viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><line x1="0" y1={h / 2} x2={w} y2={h / 2} /></svg>;
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * w, h - 3 - ((p - lo) / span) * (h - 6)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className={`wb-spark ${tone}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,${h} ${line} ${w},${h}`} />
      <polyline points={line} />
      {dot && <circle cx={lx} cy={ly} r="3" />}
    </svg>
  );
}

// ---------------------------------------------------------------- teléfonos

/** El teléfono del hero: la app con el precio de USDT en vivo, la gráfica del rato y el último aviso. */
function HeroPhone({ m, hist }: { m: Market | null; hist: Hist }) {
  const usdt = m?.rows.find((r) => r.asset === "USDT");
  const gap = gapOf(usdt);
  const pts = (hist.USDT?.length ?? 0) >= 3 ? hist.USDT : DEMO;
  return (
    <div className="wb-phone" aria-hidden="true">
      <div className="wb-phone-screen">
        <div className="wb-ph-status"><span>9:41</span><i /><span className="wb-ph-sig" /></div>
        <div className="wb-ph-top">
          <span className="wb-ph-brand"><Logo size={18} /> ArbiCrypto</span>
          <span className={`wb-ph-live ${m ? "on" : ""}`}><i />{m ? "En vivo" : "…"}</span>
        </div>
        <small className="wb-ph-k">USDT · te cuesta comprar</small>
        <b className="wb-ph-big">{usdt?.buy ? price("USDT", usdt.buy) : "$—"}</b>
        <span className={`wb-ph-gap ${toneOf(gap)}`}>{gap == null ? "Diferencia —" : `Diferencia ${pct(gap)}`}</span>
        <div className="wb-ph-chart"><Spark pts={pts} tone="gold" w={220} h={92} dot /></div>
        <div className="wb-ph-range"><span>1h</span><span className="on">Hoy</span><span>7d</span><span>30d</span></div>
        <div className="wb-ph-btns"><span>Comprar</span><span>Vender</span></div>
        <div className="wb-ph-row"><span><img src={coin("USDT")} alt="" width={16} height={16} /> Compra</span><b>{price("USDT", usdt?.buy ?? null)}</b></div>
        <div className="wb-ph-row"><span><img src={coin("USDT")} alt="" width={16} height={16} /> Venta</span><b>{price("USDT", usdt?.sell ?? null)}</b></div>
        <div className="wb-ph-alert">
          <span className="wb-ph-alert-ic"><Icon name="bolt" size={14} /></span>
          <span><b>+$4,65 por dólar</b><small>Ruta lista · ya neta</small></span>
        </div>
      </div>
    </div>
  );
}

/** Segundo teléfono: un aviso con sus pasos, como llega al panel. */
function AlertPhone() {
  const steps = [
    ["cart", "Compra ETH en P2P", "a quien vende más barato"],
    ["swap", "Cámbialo a USDT en Spot", "pestaña Market · Vender ETH"],
    ["handCoins", "Vende los USDT en P2P", "recibes $503.521"],
  ] as const;
  return (
    <div className="wb-phone alt" aria-hidden="true">
      <div className="wb-phone-screen">
        <div className="wb-ph-status"><span>9:41</span><i /><span className="wb-ph-sig" /></div>
        <div className="wb-ph-top"><span className="wb-ph-brand"><Logo size={18} /> Avisos</span><span className="wb-ph-live on"><i />Nuevo</span></div>
        <div className="wb-ph-notice">
          <span className="wb-ph-alert-ic"><Icon name="bolt" size={14} /></span>
          <b>+$4,65 por dólar en P2P</b>
          <small>Con $500.000: <em>+$741</em> de ganancia, ya con comisiones y 4x1000</small>
        </div>
        <ol className="wb-ph-steps">
          {steps.map(([ic, h, p], i) => (
            <li key={h}><span className="wb-ph-n">{i + 1}</span><span><b>{h}</b><small>{p}</small></span><Icon name={ic} size={15} /></li>
          ))}
        </ol>
        <div className="wb-ph-btns one"><span>Abrir el primer paso</span></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- piezas de la sección de funciones

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
  const line = (k: string, v: string, cls = "") => <div className={`rc-line ${cls}`}><span>{k}</span><b>{v}</b></div>;
  return (
    <div className="rc">
      <p className="rc-sub">Recibo de ruta · USDT → pesos</p>
      {line("Capital", cop(cap))}
      {line("4x1000 al pagar", `−${cop(gmf)}`, "neg")}
      {line(`Compras USDT${b ? ` a ${cop(b)}` : ""}`, b ? `${es(got, 2)} USDT` : "…")}
      {line(`Comisión P2P (${es(FEE * 100, 2)} %)`, b ? `−${es(fee, 2)} USDT` : "…", "neg")}
      {line(`Vendes${s ? ` a ${cop(s)}` : ""}`, s ? cop(back) : "…")}
      <div className={`rc-total ${net == null ? "" : net >= 0 ? "up" : "down"}`}>
        <span>Te queda</span>
        <b>{net == null ? "…" : `${net >= 0 ? "+" : "−"}${cop(Math.abs(net))}`}</b>
      </div>
      <p className="rc-verdict">{net == null ? "Esperando precios en vivo…" : net >= 0 ? "Esta da. El panel te avisa." : "Esta no da. El panel se queda callado."}</p>
      <label className="rc-slider">
        <span>Tu capital <b>{cop(cap)}</b></span>
        <input type="range" min={100000} max={5000000} step={50000} value={cap} onChange={(e) => setCap(+e.target.value)}
          style={{ "--fill": `${((cap - 100000) / 4900000) * 100}%` } as React.CSSProperties} />
      </label>
    </div>
  );
}

/** Lista corta del tablero P2P en vivo. */
function Board({ m }: { m: Market | null }) {
  const rows = (m?.rows ?? []).slice(0, 6);
  return (
    <div className="wb-board" role="table" aria-label="Precios P2P en pesos colombianos, en vivo">
      <div className="wb-board-head" role="row">
        <span role="columnheader">Activo</span><span role="columnheader">Comprar</span><span role="columnheader">Vender</span><span role="columnheader">Dif.</span>
      </div>
      {rows.length ? rows.map((r) => {
        const g = gapOf(r);
        return (
          <div className="wb-board-row" role="row" key={r.asset}>
            <span role="cell" className="wb-board-a"><img src={coin(r.asset)} alt="" width={24} height={24} /><b>{r.asset}</b></span>
            <span role="cell">{price(r.asset, r.buy)}</span>
            <span role="cell">{price(r.asset, r.sell)}</span>
            <span role="cell" className={toneOf(g)}>{pct(g)}</span>
          </div>
        );
      }) : <p className="wb-board-wait">Conectando con Binance P2P…</p>}
    </div>
  );
}

const FORM = ["Patrimonio en cripto a 31 de dic.", "Ingresos por ventas", "Costos de lo vendido", "4x1000 deducible", "Ganancia ocasional"];

function Form210() {
  return (
    <div className="wb-form" aria-hidden="true">
      <div className="wb-form-head"><span>Formulario 210</span><span>Renta · persona natural</span></div>
      {FORM.map((k, i) => (
        <div className="wb-form-row" key={k}>
          <span className="wb-form-n">{String(i + 1).padStart(2, "0")}</span>
          <span>{k}</span>
          <span className="wb-form-v" style={{ width: `${40 + ((i * 37) % 45)}%` }} />
        </div>
      ))}
      <div className="wb-form-foot"><span className="wb-stamp"><Icon name="check" size={14} /> Cuadra</span><small>Estatuto Tributario y Concepto DIAN 1621 de 2023</small></div>
    </div>
  );
}

function Perms() {
  return (
    <div className="wb-perms">
      <div className="ok"><span>Lectura</span><b><Icon name="checkCircle" size={22} /> Sí</b></div>
      <div className="no"><span>Trading</span><b><Icon name="x" size={22} /> No</b></div>
      <div className="no"><span>Retiros</span><b><Icon name="x" size={22} /> No</b></div>
    </div>
  );
}

// ---------------------------------------------------------------- contenido

const TRUST: { ic: IconName; h: string; p: string }[] = [
  { ic: "shield", h: "Solo lectura", p: "La llave de Binance no puede operar ni retirar. Si puede, se rechaza." },
  { ic: "receipt", h: "Ya neto", p: "Comisión de Binance, redondeo y 4x1000 descontados antes de avisarte." },
  { ic: "bellRing", h: "Avisos al instante", p: "Sonido, notificación y Telegram solo cuando de verdad quedan pesos." },
];

type Feature = { k: string; t: string; h: string; p: string; minis: [string, string][]; view: "receipt" | "board" | "panel" | "dian" | "safe" };

const FEATURES: Feature[] = [
  {
    k: "cuenta", t: "Haz la cuenta completa", view: "receipt",
    h: "La diferencia no es la ganancia",
    p: "Entre la comisión de Binance, el redondeo y el 4x1000 de tu banco, muchas veces lo que parece que da, pierde. Este recibo usa el precio de USDT de ahora mismo.",
    minis: [["Con tu capital", "La cuenta se hace con tu monto y tu comisión real."], ["Cada segundo", "Cada ruta se vuelve a medir con los anuncios del momento."]],
  },
  {
    k: "tablero", t: "Mira el P2P en vivo", view: "board",
    h: "El tablero P2P, en pesos",
    p: "Lo que cuesta comprar y lo que recibes al vender en Binance P2P, del mejor anuncio con buena reputación de cada lado.",
    minis: [["Anunciantes buenos", "Muchas órdenes y casi no cancela."], ["Enlace directo", "Un toque y abres el anuncio en Binance."]],
  },
  {
    k: "vender", t: "Vende sin perder", view: "panel",
    h: "¿Dónde vendo lo que tengo?",
    p: "Anotas lo que compraste y a cuánto. El panel vigila a quién venderle, directo o pasando por Spot, y te avisa cuando sales ganando.",
    minis: [["Directo o por Spot", "Compara todos los caminos a pesos."], ["Paso a paso", "Qué botón tocar y qué cantidad poner."]],
  },
  {
    k: "renta", t: "La renta, lista para la DIAN", view: "dian",
    h: "Y para la renta, la DIAN ya está hecha",
    p: "La wallet trae tus órdenes de Binance, valora cada permuta con la TRM del día y te arma el formulario con un Excel explicado en palabras sencillas.",
    minis: [["Kardex y PUC", "Los libros que pide tu contador."], ["Comprobaciones", "Te dice si todo cuadra."]],
  },
  {
    k: "seguro", t: "Puede mirar, no puede tocar", view: "safe",
    h: "Tu plata sigue siendo tuya",
    p: "Las compras y ventas las haces tú en Binance. Saldos, órdenes y declaración los ves solo tú: ni los administradores entran.",
    minis: [["Llave cifrada", "Se guarda cifrada y se puede borrar cuando quieras."], ["Solo con invitación", "Contraseñas con PBKDF2 de 600.000 iteraciones."]],
  },
];

const STEPS = [
  ["Recibe tu invitación", "Entras con el código que te pasa alguien del equipo."],
  ["Conecta Binance", "Pegas una llave de solo lectura."],
  ["Pon tu capital y tu mínimo", "Desde ahí el panel solo suena cuando quedan pesos."],
];

const FAQ = [
  { q: "¿ArbiCrypto puede mover mi plata?", a: "No. La llave de Binance que aceptamos es de solo lectura: si puede operar o retirar, el panel la rechaza. Las compras y ventas las haces tú en Binance." },
  { q: "¿Por qué la diferencia de precio no es la ganancia?", a: "Porque entre la comisión de Binance, el redondeo de cantidades y el 4x1000 de tu banco, muchas veces lo que parece que da, pierde. El panel descuenta todo eso antes de avisarte." },
  { q: "¿Cómo entro?", a: "Solo con invitación. Si alguien del equipo te pasó un código, regístrate con él; si ya tienes cuenta, inicia sesión y eliges si vas al panel o a la wallet." },
  { q: "¿La wallet me sirve para la declaración de renta?", a: "Te arma el patrimonio, los ingresos, los costos, el 4x1000 deducible y la ganancia ocasional con el Estatuto Tributario y el Concepto Unificado DIAN 1621 de 2023. Es un cálculo informativo: revísalo con tu contador." },
  { q: "¿Está afiliado a Binance?", a: "No. ArbiCrypto lee los precios públicos de Binance P2P y Spot y, si conectas tu llave, tus propias órdenes. No es asesoría financiera ni tributaria." },
];

function FeatureView({ f, m }: { f: Feature; m: Market | null }) {
  if (f.view === "receipt") return <Receipt m={m} />;
  if (f.view === "board") return <Board m={m} />;
  if (f.view === "dian") return <Form210 />;
  if (f.view === "safe") return <Perms />;
  return (
    <figure className="wb-shot">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/panel-precios.jpg" alt="El panel de ArbiCrypto con los precios P2P y la gráfica del día" width={1275} height={827} loading="lazy" />
    </figure>
  );
}

export default function Portada() {
  const { m, hist } = useMarket();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [feat, setFeat] = useState(0);
  useReveal();
  useEffect(() => {
    const f = () => setScrolled(scrollY > 12);
    f();
    addEventListener("scroll", f, { passive: true });
    return () => removeEventListener("scroll", f);
  }, []);
  const byAsset = new Map((m?.rows ?? []).map((r) => [r.asset, r]));
  const f = FEATURES[feat];
  return (
    <div className="wb">
      <header className={`wb-nav ${scrolled ? "solid" : ""}`}>
        <div className="wb-wrap wb-nav-in">
          <a href="/" className="wb-brand" aria-label="ArbiCrypto, inicio"><Logo size={30} /><span>ArbiCrypto</span></a>
          <nav className={`wb-links ${menu ? "open" : ""}`} aria-label="Secciones" onClick={() => setMenu(false)}>
            <a href="#confianza">Por qué</a>
            <a href="#funciones">Funciones</a>
            <a href="#precios">Precios</a>
            <a href="#empieza">Empieza</a>
            <a href="#preguntas">Preguntas</a>
          </nav>
          <div className="wb-nav-cta">
            <a className="wb-pill-btn ghost sm" href="/login">Iniciar sesión</a>
            <a className="wb-pill-btn soft sm" href={LOGIN.invite}>Registrarme</a>
          </div>
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
              <h1 className="wb-h1"><span>Claro.</span><span>En vivo.</span><span>En pesos.</span></h1>
              <div className="wb-cta">
                <a className="wb-pill-btn solid" href={LOGIN.panel}>Entrar al panel</a>
                <a className="wb-pill-btn ghost" href={LOGIN.invite}>Tengo una invitación</a>
              </div>
            </div>
            <div className="wb-hero-stage">
              <div className="wb-glow" aria-hidden="true" />
              <HeroPhone m={m} hist={hist} />
            </div>
            <div className="wb-hero-side">
              <div className="wb-claim">
                <span className="wb-claim-mark"><Logo size={40} /></span>
                <div>
                  <p>Claridad y confianza para tu plata.</p>
                  <span className="wb-stack" aria-hidden="true">
                    {["btc", "eth", "usdt", "bnb"].map((a) => <img key={a} src={coin(a)} alt="" width={30} height={30} />)}
                  </span>
                </div>
              </div>
              <p className="wb-side-note">Binance P2P y Spot leído en pesos colombianos, con comisión, redondeo y 4x1000 ya descontados.</p>
            </div>
          </div>
        </section>

        {/* ---------- confianza ---------- */}
        <section id="confianza" className="wb-sec">
          <div className="wb-wrap">
            <div className="wb-trust-head">
              <p className="wb-small wb-reveal">El panel mira Binance cada segundo y hace la cuenta completa. Solo te avisa cuando una ruta de verdad deja pesos.</p>
              <h2 className="wb-h2 wb-reveal">Tu aliado para arbitrar<br />en pesos</h2>
            </div>
            <div className="wb-trust">
              {TRUST.map((t, i) => (
                <div className="wb-card wb-reveal" key={t.h} style={{ "--i": i } as React.CSSProperties}>
                  <span className="wb-ic"><Icon name={t.ic} size={20} /></span>
                  <h3>{t.h}</h3>
                  <p>{t.p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- funciones ---------- */}
        <section id="funciones" className="wb-feat">
          <div className="wb-wrap wb-feat-in">
            <div className="wb-feat-list" role="tablist" aria-label="Funciones">
              {FEATURES.map((x, i) => (
                <button key={x.k} role="tab" aria-selected={feat === i} className={feat === i ? "on" : ""} onClick={() => setFeat(i)}>{x.t}</button>
              ))}
            </div>
            <div className="wb-feat-body" role="tabpanel" key={f.k}>
              <h3 className="wb-h3">{f.h}</h3>
              <p className="wb-small">{f.p}</p>
              <div className="wb-minis">
                {f.minis.map(([h, p]) => <div key={h}><b>{h}</b><span>{p}</span></div>)}
              </div>
              <div className="wb-feat-view"><FeatureView f={f} m={m} /></div>
            </div>
          </div>
        </section>

        {/* ---------- empieza ---------- */}
        <section id="empieza" className="wb-sec">
          <div className="wb-wrap wb-begin">
            <div className="wb-begin-stage">
              <div className="wb-glow sm" aria-hidden="true" />
              <AlertPhone />
            </div>
            <div className="wb-reveal">
              <h2 className="wb-h2">Empieza a arbitrar<br />con confianza hoy</h2>
              <p className="wb-small">Deja que la cuenta la haga el panel y entra solo cuando quedan pesos. Tres pasos y a vigilar:</p>
              <ol className="wb-steps">
                {STEPS.map(([h, p], i) => <li key={h}><span>{i + 1}</span><div><b>{h}</b><small>{p}</small></div></li>)}
              </ol>
              <div className="wb-cta">
                <a className="wb-pill-btn solid" href={LOGIN.panel}>Entrar al panel</a>
                <a className="wb-pill-btn ghost" href={LOGIN.wallet}>Entrar a mi wallet</a>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- precios ---------- */}
        <section id="precios" className="wb-sec">
          <div className="wb-wrap wb-prices">
            <div className="wb-reveal">
              <h2 className="wb-h2">Precios P2P<br />en pesos</h2>
              <p className="wb-small">Lo que cuesta comprar en Binance P2P ahora mismo, del mejor anuncio, y cuánto se separa del precio de venta.</p>
              <a className="wb-pill-btn solid sm" href={LOGIN.panel}>Ver todo en el panel</a>
            </div>
            <div className="wb-coins">
              {CARDS.map((a, i) => {
                const q = byAsset.get(a);
                const g = gapOf(q);
                return (
                  <div className="wb-coin-card wb-reveal" key={a} style={{ "--i": i } as React.CSSProperties}>
                    <span className="wb-ic"><img src={coin(a)} alt="" width={22} height={22} /></span>
                    <small>{a} · {NAMES[a]}</small>
                    <b>{price(a, q?.buy ?? null)}</b>
                    <span className={`wb-coin-gap ${toneOf(g)}`}>{pct(g)}</span>
                    {(hist[a]?.length ?? 0) >= 3 && <Spark pts={hist[a]} tone={toneOf(g) || "gold"} />}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---------- preguntas ---------- */}
        <section id="preguntas" className="wb-sec">
          <div className="wb-wrap wb-faq-in">
            <h2 className="wb-h2 center wb-reveal">¿Preguntas? Aquí las respuestas.</h2>
            <p className="wb-small center wb-reveal">Lo que todos preguntan antes de conectar su cuenta.</p>
            <div className="wb-faq">
              {FAQ.map((x) => (
                <details key={x.q}>
                  <summary>{x.q}<Icon name="plus" size={18} /></summary>
                  <p>{x.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="wb-foot">
        <div className="wb-wrap">
          <div className="wb-foot-top">
            <a href="/" className="wb-brand"><Logo size={28} /><span>ArbiCrypto</span></a>
            <nav aria-label="Producto">
              <b>Producto</b>
              <a href={LOGIN.panel}>Panel</a>
              <a href={LOGIN.wallet}>Wallet</a>
              <a href="#precios">Precios</a>
            </nav>
            <nav aria-label="Cuenta">
              <b>Cuenta</b>
              <a href="/login">Iniciar sesión</a>
              <a href={LOGIN.invite}>Registrarme</a>
              <a href="#preguntas">Preguntas</a>
            </nav>
          </div>
          <p className="wb-legal">
            Acceso solo con invitación. Las ganancias son estimadas con el mejor precio del momento: confirma siempre en Binance antes de
            pagar. No es asesoría financiera ni tributaria. ArbiCrypto no está afiliado a Binance.
          </p>
          <p className="wb-copy">© {new Date().getFullYear()} ArbiCrypto · Colombia</p>
        </div>
      </footer>
    </div>
  );
}
