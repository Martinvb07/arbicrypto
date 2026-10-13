"use client";

import { useEffect, useState } from "react";
import { Icon, Logo } from "@/components/ui";

// Portada de arbicrypto.org, en formato de periódico con los colores y la letra del panel.
// El login vive en /login: desde ahí cada quien sigue a SU panel o a SU wallet.

type Quote = { asset: string; buy: number | null; sell: number | null };
type Market = { t: number | null; rows: Quote[] };

const LOGIN = { panel: "/login?next=panel", wallet: "/login?next=wallet", invite: "/login?mode=registro" };

const cop = (v: number | null) =>
  v == null ? "—" : `$${v.toLocaleString("es-CO", { maximumFractionDigits: v >= 1000 ? 0 : 2 })}`;

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

/** Fecha de hoy en Colombia (se pone en el navegador: la página se compila una sola vez). */
function useToday() {
  const [d, setD] = useState("");
  useEffect(() => {
    const s = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" });
    setD(s.charAt(0).toUpperCase() + s.slice(1));
  }, []);
  return d;
}

function ThemeButton() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    setLight(root.dataset.theme ? root.dataset.theme === "light" : !matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const toggle = () => {
    const next = light ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    setLight(!light);
    try { localStorage.setItem("theme", next); } catch { /* sin almacenamiento */ }
  };
  return (
    <button className="icon-btn" onClick={toggle} title={light ? "Tema oscuro" : "Tema claro"} aria-label="Cambiar tema">
      <Icon name={light ? "moon" : "sun"} size={17} />
    </button>
  );
}

function Ticker() {
  const m = useMarket();
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now() / 1000);
    const id = setInterval(() => setNow(Date.now() / 1000), 5000);
    return () => clearInterval(id);
  }, []);
  const rows = m?.rows ?? [];
  const age = m?.t && now ? Math.max(0, Math.round(now - m.t)) : null;
  return (
    <section className="np-ticker" aria-label="Precios P2P en pesos">
      <div className="np-ticker-label">
        <span className={`np-dot ${rows.length ? "live" : ""}`} />
        <b>Mercado P2P</b>
        <span>{rows.length ? (age != null && age < 120 ? `hace ${age} s` : "en pesos") : "en pesos"}</span>
      </div>
      <div className="np-ticker-rows">
        {rows.length ? rows.map((q) => (
          <div className="np-quote" key={q.asset}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/coins/${q.asset.toLowerCase()}.svg`} alt="" width={18} height={18} />
            <b>{q.asset}</b>
            <span title="Compras a (mejor anuncio)"><small>compra</small> {cop(q.buy)}</span>
            <span title="Vendes a (mejor anuncio)"><small>venta</small> {cop(q.sell)}</span>
          </div>
        )) : <p className="np-ticker-empty">Los precios en vivo de USDT, BTC, ETH y las demás aparecen aquí y, con todo el detalle, dentro del panel.</p>}
      </div>
    </section>
  );
}

/** Ilustración: cómo se lee una ruta de arbitraje (sin cifras inventadas). */
function RouteFigure() {
  const steps = [
    { k: "Pesos", t: "Tu capital en Nequi, Bancolombia o Bre-B" },
    { k: "Compras USDT", t: "Al mejor anunciante P2P, con reputación" },
    { k: "Cambias en Spot", t: "Orden de mercado, nunca Convertir" },
    { k: "Vendes por P2P", t: "Vuelven más pesos de los que salieron" },
  ];
  return (
    <figure className="np-figure">
      <ol className="np-route">
        {steps.map((s, i) => (
          <li key={s.k}>
            <span className="np-route-n">{i + 1}</span>
            <b>{s.k}</b>
            <small>{s.t}</small>
          </li>
        ))}
      </ol>
      <figcaption>
        <b>Cómo se lee una ruta.</b> El panel prueba los caminos posibles y muestra cuántos pesos deja cada dólar, ya descontado todo.
        Si no gana, no avisa.
      </figcaption>
    </figure>
  );
}

const BRIEFS = [
  { icon: "bellRing", h: "Avisos al instante", p: "Sonido, notificación de Windows y Telegram cuando aparece una ruta nueva que llega a tu mínimo. Lo que promete demasiado se ignora: casi siempre es un precio viejo." },
  { icon: "handCoins", h: "¿Dónde vendo?", p: "Anota la moneda que tienes y cuánto te costó. El panel vigila a quién venderle y te avisa cuando puedes salir sin perder." },
  { icon: "history", h: "El mercado, hora por hora", p: "Cuántas oportunidades hubo, cuánto duraron y a qué hora del día el mercado se acerca más a dar ganancia." },
  { icon: "chat", h: "Un equipo, un chat", p: "Canal general y mensajes privados. Lo demás es de cada quien: capital, avisos, bitácora y cuenta de Binance." },
] as const;

const LEDGER = [
  "Casillas del formulario 210 que tocan tus cripto, con su explicación",
  "Kardex por cripto: entradas, salidas, costo y utilidad de cada venta",
  "Libros con cuentas del PUC: diario, mayor y balances",
  "Estados financieros y notas generadas con tus cifras",
  "4x1000 por cuenta y extractos bancarios clasificados",
  "Cierres de mes automáticos y paquete para tu contador",
];

export default function Portada() {
  const today = useToday();
  return (
    <div className="np">
      {/* ---------- barra superior ---------- */}
      <div className="np-top">
        <div className="np-wrap np-top-in">
          <span className="np-date">{today || " "}</span>
          <span className="np-edition">Edición Colombia · Precios en pesos</span>
          <div className="np-top-actions">
            <ThemeButton />
            <a className="btn btn-brand" href="/login">Iniciar sesión</a>
          </div>
        </div>
      </div>

      {/* ---------- cabecera ---------- */}
      <header className="np-wrap np-masthead">
        <a href="/" className="np-title" aria-label="ArbiCrypto, portada">
          <Logo size={64} />
          <span>Arbi<em>Crypto</em></span>
        </a>
        <p className="np-motto">El diario del arbitraje en pesos</p>
        <nav className="np-sections" aria-label="Secciones">
          <a href="#portada">Portada</a>
          <a href="#mercados">Mercados</a>
          <a href="#finanzas">Finanzas</a>
          <a href="#opinion">Opinión</a>
          <a href="#guia">Guía</a>
          <a href="#seguridad">Seguridad</a>
        </nav>
      </header>

      <div className="np-wrap">
        <Ticker />

        {/* ---------- portada: el panel ---------- */}
        <main>
          <section id="portada" className="np-front">
            <article className="np-lead">
              <p className="np-kicker">Portada · Arbitraje en Binance</p>
              <h1>Comprar barato y vender más caro, al mismo tiempo y en pesos</h1>
              <p className="np-deck">
                ArbiCrypto revisa el P2P de Binance en pesos colombianos y el Spot en tiempo real, y solo avisa cuando la cuenta da
                después de comisiones, redondeos y 4x1000.
              </p>
              <p className="np-byline">Por la redacción de ArbiCrypto · <span>panel.arbicrypto.org</span></p>
              <div className="np-cols">
                <p className="np-drop">
                  El arbitraje es simple de explicar y difícil de hacer a mano: comprar una cripto donde está barata y venderla donde
                  está cara antes de que el precio se mueva. En el P2P de Binance los anuncios cambian cada segundo, y entre la comisión,
                  el redondeo de cantidades y el 4x1000 del banco, una diferencia que parece ganancia muchas veces es pérdida.
                </p>
                <p>
                  El panel hace esa cuenta por ti. Mide todo en <b>pesos por dólar</b>, prueba las rutas entre las criptos principales
                  (USDT, BTC, ETH, BNB, SOL, XRP, USDC y FDUSD) y ordena de la mejor a la peor con el capital que tú escribes. Toca
                  <i> Pasos</i> y te dice a quién comprarle y a quién venderle.
                </p>
                <p>
                  En Spot los precios llegan en vivo y, cuando una ruta está cerca de dar ganancia, se calcula con la profundidad real del
                  libro para tu monto. Solo cuenta a los anunciantes con buena reputación: veinte órdenes o más y casi todas cumplidas.
                </p>
              </div>
              <div className="np-cta">
                <a className="btn btn-brand btn-lg" href={LOGIN.panel}>Entrar al panel <Icon name="arrowRight" size={17} /></a>
                <a className="btn btn-lg np-btn-line" href={LOGIN.invite}><Icon name="ticket" size={17} /> Tengo un código de invitación</a>
              </div>
            </article>

            <aside id="mercados" className="np-side" aria-label="Breves">
              <RouteFigure />
              <h2 className="np-side-h">Breves</h2>
              {BRIEFS.map((b) => (
                <article className="np-brief" key={b.h}>
                  <h3><Icon name={b.icon} size={16} /> {b.h}</h3>
                  <p>{b.p}</p>
                </article>
              ))}
            </aside>
          </section>

          {/* ---------- finanzas: la wallet ---------- */}
          <section id="finanzas" className="np-section">
            <div className="np-section-h"><span>Finanzas</span></div>
            <div className="np-finance">
              <article>
                <p className="np-kicker">Impuestos · DIAN</p>
                <h2>Tus ganancias en cripto, listas para la declaración de renta</h2>
                <p className="np-deck">
                  La wallet lleva tu contabilidad sola desde Binance y arma lo que pide la DIAN para el formulario 210 de persona natural.
                </p>
                <p className="np-byline">Sección Finanzas · <span>wallet.arbicrypto.org</span></p>
                <div className="np-cols">
                  <p className="np-drop">
                    Conectas tu Binance con una llave de solo lectura y la wallet trae tus órdenes P2P, Convert y Spot cada media hora.
                    Cada venta encuentra su compra, cada permuta se valora en pesos con la TRM del día y el 4x1000 se calcula según lo que
                    de verdad te cobra tu banco.
                  </p>
                  <p>
                    Al cierre del año descargas un solo Excel explicado en palabras sencillas, con las comprobaciones que dicen si todo
                    cuadra, o el paquete completo para tu contador. Sigue el Estatuto Tributario y el Concepto Unificado DIAN 1621 de 2023.
                  </p>
                </div>
                <div className="np-cta">
                  <a className="btn btn-brand btn-lg" href={LOGIN.wallet}>Entrar a mi wallet <Icon name="arrowRight" size={17} /></a>
                </div>
              </article>
              <aside className="np-box" aria-label="Qué trae la wallet">
                <h3>En la edición de fin de año</h3>
                <ul>
                  {LEDGER.map((x) => <li key={x}><Icon name="check" size={15} /> {x}</li>)}
                </ul>
                <p className="np-fine">Cálculo informativo. Revísalo con un contador antes de declarar.</p>
              </aside>
            </div>
          </section>

          {/* ---------- opinión ---------- */}
          <section id="opinion" className="np-section">
            <div className="np-section-h"><span>Opinión</span></div>
            <div className="np-opinion">
              <blockquote>
                <p>“Preferimos avisar menos y que cada aviso sea de verdad.”</p>
                <footer>Nota del editor sobre los cálculos conservadores</footer>
              </blockquote>
              <div className="np-cols np-cols-3">
                <p>
                  <b>Todo descontado.</b> Cada cambio en Spot resta la comisión, el redondeo de cantidades de Binance y un colchón por
                  si el precio se mueve mientras operas. En P2P entra la comisión y el 4x1000 de lo que pagas.
                </p>
                <p>
                  <b>Rutas justas, marcadas.</b> Si una ruta deja poco margen sale como <i>justa · actúa rápido</i>: gana poco y, si un
                  precio cambia a mitad de camino, puede volverse pérdida.
                </p>
                <p>
                  <b>Sin promesas raras.</b> Lo que promete más del 3 % casi siempre es un anuncio viejo o una trampa, y se ignora. Las
                  rutas de Spot deben verse en dos revisiones seguidas antes de avisar.
                </p>
              </div>
            </div>
          </section>

          {/* ---------- guía ---------- */}
          <section id="guia" className="np-section">
            <div className="np-section-h"><span>Guía</span></div>
            <ol className="np-steps">
              <li>
                <span>1</span>
                <h3>Recibe tu invitación</h3>
                <p>El acceso es solo con código de invitación de un solo uso. Con él creas tu usuario y tu contraseña.</p>
              </li>
              <li>
                <span>2</span>
                <h3>Conecta tu Binance</h3>
                <p>Con una llave de <b>solo lectura</b>: ni el panel ni la wallet pueden operar ni retirar por ti.</p>
              </li>
              <li>
                <span>3</span>
                <h3>Opera y declara</h3>
                <p>En el panel ves las oportunidades y recibes los avisos. En la wallet, tus ganancias e impuestos. Una sola sesión para los dos.</p>
              </li>
            </ol>
          </section>

          {/* ---------- seguridad ---------- */}
          <section id="seguridad" className="np-section">
            <div className="np-section-h"><span>Seguridad</span></div>
            <div className="np-security">
              <h2>Tus datos son tuyos</h2>
              <div className="np-cols np-cols-2">
                <p>
                  <Icon name="lock" size={15} /> Cada persona ve solo lo suyo: saldos, órdenes, bitácora, wallet y declaración. Ni los
                  administradores pueden verlo. Lo único compartido es el chat del equipo.
                </p>
                <p>
                  <Icon name="key" size={15} /> Las llaves de Binance se aceptan solo si son de lectura y se guardan cifradas. Las contraseñas,
                  con PBKDF2 de 600.000 iteraciones; las sesiones viajan por HTTPS y se bloquea a quien intente adivinar.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* ---------- pie ---------- */}
      <footer className="np-foot">
        <div className="np-wrap np-foot-in">
          <a href="/" className="np-title np-title-sm"><Logo size={30} /><span>Arbi<em>Crypto</em></span></a>
          <nav aria-label="Entrar">
            <a href={LOGIN.panel}>Panel</a>
            <a href={LOGIN.wallet}>Wallet</a>
            <a href="/login">Iniciar sesión</a>
          </nav>
          <p>
            Acceso solo con invitación. Las ganancias son estimadas con el mejor precio del momento: confirma siempre en Binance antes de
            pagar. No es asesoría financiera ni tributaria.
          </p>
        </div>
      </footer>
    </div>
  );
}
