"use client";

import { useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Icon, Logo, type IconName } from "@/components/ui";
import {
  AlertPhone, Board, CoinCards, EASE, FAQ, Faq, Form210, LOGIN, Perms, Pill, Receipt, Reveal, Spark, Stagger, StaggerItem,
  coin, gapOf, pct, price, toneOf, useMarket, type Hist, type Market,
} from "../sitio";

// Portada de arbicrypto.org: oscura y sobria, con un solo acento (el dorado de la marca). Al centro, el teléfono con la
// app y los precios P2P reales; alrededor, poco texto. Navbar y footer vienen del layout del sitio.

// Mientras llegan los precios, el teléfono muestra una gráfica de ejemplo
const DEMO = [12, 14, 13, 17, 16, 20, 18, 23, 21, 19, 24, 27, 25, 29, 26, 31, 30, 34, 29, 33, 37, 35, 39, 42];

const line: Variants = { hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } } };

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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="wb-ph-row"><span><img src={coin("USDT")} alt="" width={16} height={16} /> Compra</span><b>{price("USDT", usdt?.buy ?? null)}</b></div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="wb-ph-row"><span><img src={coin("USDT")} alt="" width={16} height={16} /> Venta</span><b>{price("USDT", usdt?.sell ?? null)}</b></div>
        <motion.div className="wb-ph-alert" initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 22, delay: 1.1 }}>
          <span className="wb-ph-alert-ic"><Icon name="bolt" size={14} /></span>
          <span><b>+$4,65 por dólar</b><small>Ruta lista · ya neta</small></span>
        </motion.div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- contenido

const TRUST: { ic: IconName; h: string; p: string; href: string }[] = [
  { ic: "shield", h: "Solo lectura", p: "La llave de Binance no puede operar ni retirar. Si puede, se rechaza.", href: "/seguridad" },
  { ic: "receipt", h: "Ya neto", p: "Comisión de Binance, redondeo y 4x1000 descontados antes de avisarte.", href: "/precios#la-cuenta" },
  { ic: "bellRing", h: "Avisos al instante", p: "Sonido, notificación y Telegram solo cuando de verdad quedan pesos.", href: "/arbitraje" },
];

type Feature = { k: string; t: string; h: string; p: string; href: string; minis: [string, string][]; view: "receipt" | "board" | "panel" | "dian" | "safe" };

const FEATURES: Feature[] = [
  {
    k: "cuenta", t: "Haz la cuenta completa", view: "receipt", href: "/precios#la-cuenta",
    h: "La diferencia no es la ganancia",
    p: "Entre la comisión de Binance, el redondeo y el 4x1000 de tu banco, muchas veces lo que parece que da, pierde. Este recibo usa el precio de USDT de ahora mismo.",
    minis: [["Con tu capital", "La cuenta se hace con tu monto y tu comisión real."], ["Cada segundo", "Cada ruta se vuelve a medir con los anuncios del momento."]],
  },
  {
    k: "tablero", t: "Mira el P2P en vivo", view: "board", href: "/precios",
    h: "El tablero P2P, en pesos",
    p: "Lo que cuesta comprar y lo que recibes al vender en Binance P2P, del mejor anuncio con buena reputación de cada lado.",
    minis: [["Anunciantes buenos", "Muchas órdenes y casi no cancela."], ["Enlace directo", "Un toque y abres el anuncio en Binance."]],
  },
  {
    k: "vender", t: "Vende sin perder", view: "panel", href: "/vender",
    h: "¿Dónde vendo lo que tengo?",
    p: "Anotas lo que compraste y a cuánto. El panel vigila a quién venderle, directo o pasando por Spot, y te avisa cuando sales ganando.",
    minis: [["Directo o por Spot", "Compara todos los caminos a pesos."], ["Paso a paso", "Qué botón tocar y qué cantidad poner."]],
  },
  {
    k: "renta", t: "La renta, lista para la DIAN", view: "dian", href: "/renta",
    h: "Y para la renta, la DIAN ya está hecha",
    p: "La wallet trae tus órdenes de Binance, valora cada permuta con la TRM del día y te arma el formulario con un Excel explicado en palabras sencillas.",
    minis: [["Kardex y PUC", "Los libros que pide tu contador."], ["Comprobaciones", "Te dice si todo cuadra."]],
  },
  {
    k: "seguro", t: "Puede mirar, no puede tocar", view: "safe", href: "/seguridad",
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

function FeatureView({ f, m }: { f: Feature; m: Market | null }) {
  if (f.view === "receipt") return <Receipt m={m} />;
  if (f.view === "board") return <Board m={m} limit={6} />;
  if (f.view === "dian") return <Form210 />;
  if (f.view === "safe") return <Perms />;
  return (
    <figure className="wb-shot">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/panel-precios.jpg" alt="El panel de ArbiCrypto con los precios P2P y la gráfica del día" width={1275} height={827} loading="lazy" />
    </figure>
  );
}

/** Funciones: la raya dorada se desliza a la elegida y el contenido se cruza con un fundido. */
function Features({ m }: { m: Market | null }) {
  const [i, setI] = useState(0);
  const f = FEATURES[i];
  return (
    <section id="funciones" className="wb-feat">
      <div className="wb-wrap wb-feat-in">
        <div className="wb-feat-list" role="tablist" aria-label="Funciones">
          {FEATURES.map((x, j) => (
            <button key={x.k} role="tab" aria-selected={i === j} className={i === j ? "on" : ""} onClick={() => setI(j)}>
              {i === j && <motion.span layoutId="feat-bar" className="wb-feat-bar" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              {i === j && <motion.span layoutId="feat-bg" className="wb-feat-bg" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span>{x.t}</span>
            </button>
          ))}
        </div>
        <div className="wb-feat-body" role="tabpanel">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={f.k} initial="hidden" animate="show" exit="exit"
              variants={{
                hidden: { opacity: 0 },
                show: { opacity: 1, transition: { staggerChildren: 0.06 } },
                exit: { opacity: 0, y: -8, transition: { duration: 0.15, ease: "easeIn" } },
              }}>
              <motion.h3 className="wb-h3" variants={line}>{f.h}</motion.h3>
              <motion.p className="wb-small" variants={line}>{f.p}</motion.p>
              <motion.div className="wb-minis" variants={line}>
                {f.minis.map(([h, p]) => <div key={h}><b>{h}</b><span>{p}</span></div>)}
              </motion.div>
              <motion.div className="wb-feat-view" variants={line}><FeatureView f={f} m={m} /></motion.div>
              <motion.a className="wb-more" href={f.href} variants={line}>Ver más <Icon name="arrowRight" size={15} /></motion.a>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

export default function Portada() {
  const { m, hist } = useMarket();
  return (
    <>
      {/* ---------- hero ---------- */}
      <section className="wb-hero">
        <div className="wb-wrap wb-hero-in">
          <motion.div className="wb-hero-copy" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1 } } }}>
            <h1 className="wb-h1">
              {["Claro.", "En vivo.", "En pesos."].map((t) => <motion.span key={t} variants={line}>{t}</motion.span>)}
            </h1>
            <motion.div className="wb-cta" variants={line}>
              <Pill href={LOGIN.panel}>Entrar al panel</Pill>
              <Pill href={LOGIN.invite} kind="ghost">Tengo una invitación</Pill>
            </motion.div>
          </motion.div>
          <motion.div className="wb-hero-stage" initial={{ opacity: 0, y: 60, rotate: 6 }} animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ type: "spring", stiffness: 70, damping: 16, delay: 0.15 }}>
            <div className="wb-glow" aria-hidden="true" />
            <HeroPhone m={m} hist={hist} />
          </motion.div>
          <motion.div className="wb-hero-side" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.45 }}>
            <div className="wb-claim">
              <span className="wb-claim-mark"><Logo size={40} /></span>
              <div>
                <p>Claridad y confianza para tu plata.</p>
                <span className="wb-stack" aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {["btc", "eth", "usdt", "bnb"].map((a) => <img key={a} src={coin(a)} alt="" width={30} height={30} />)}
                </span>
              </div>
            </div>
            <p className="wb-side-note">Binance P2P y Spot leído en pesos colombianos, con comisión, redondeo y 4x1000 ya descontados.</p>
          </motion.div>
        </div>
      </section>

      {/* ---------- confianza ---------- */}
      <section id="confianza" className="wb-sec">
        <div className="wb-wrap">
          <div className="wb-trust-head">
            <Reveal><p className="wb-small">El panel mira Binance cada segundo y hace la cuenta completa. Solo te avisa cuando una ruta de verdad deja pesos.</p></Reveal>
            <Reveal delay={0.1}><h2 className="wb-h2">Tu aliado para arbitrar<br />en pesos</h2></Reveal>
          </div>
          <Stagger className="wb-trust">
            {TRUST.map((t) => (
              <StaggerItem key={t.h}>
                <motion.a className="wb-card" href={t.href} whileHover={{ y: -4 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
                  <span className="wb-ic"><Icon name={t.ic} size={20} /></span>
                  <h3>{t.h}</h3>
                  <p>{t.p}</p>
                </motion.a>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <Features m={m} />

      {/* ---------- empieza ---------- */}
      <section id="empieza" className="wb-sec">
        <div className="wb-wrap wb-begin">
          <Reveal className="wb-begin-stage">
            <div className="wb-glow sm" aria-hidden="true" />
            <AlertPhone />
          </Reveal>
          <Reveal delay={0.1}>
            <h2 className="wb-h2">Empieza a arbitrar<br />con confianza hoy</h2>
            <p className="wb-small">Deja que la cuenta la haga el panel y entra solo cuando quedan pesos. Tres pasos y a vigilar:</p>
            <Stagger className="wb-steps" gap={0.1}>
              {STEPS.map(([h, p], i) => <StaggerItem key={h} className="wb-steps-li"><span>{i + 1}</span><div><b>{h}</b><small>{p}</small></div></StaggerItem>)}
            </Stagger>
            <div className="wb-cta">
              <Pill href={LOGIN.panel}>Entrar al panel</Pill>
              <Pill href={LOGIN.wallet} kind="ghost">Entrar a mi wallet</Pill>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- precios ---------- */}
      <section id="precios" className="wb-sec">
        <div className="wb-wrap wb-prices">
          <Reveal>
            <h2 className="wb-h2">Precios P2P<br />en pesos</h2>
            <p className="wb-small">Lo que cuesta comprar en Binance P2P ahora mismo, del mejor anuncio, y cuánto se separa del precio de venta.</p>
            <Pill href="/precios" sm>Ver todos los precios</Pill>
          </Reveal>
          <CoinCards m={m} hist={hist} />
        </div>
      </section>

      {/* ---------- preguntas ---------- */}
      <section id="preguntas" className="wb-sec">
        <div className="wb-wrap wb-faq-in">
          <Reveal><h2 className="wb-h2 center">¿Preguntas? Aquí las respuestas.</h2></Reveal>
          <Reveal delay={0.08}><p className="wb-small center">Lo que todos preguntan antes de conectar su cuenta. <a className="wb-link" href="/preguntas">Ver todas</a></p></Reveal>
          <Faq items={[...FAQ.seguridad.slice(0, 1), ...FAQ.general.slice(1, 4), FAQ.wallet[0]]} />
        </div>
      </section>
    </>
  );
}
