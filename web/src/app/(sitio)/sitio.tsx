"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, MotionConfig, type Variants } from "framer-motion";
import { usePathname } from "next/navigation";
import { Icon, Logo, type IconName } from "@/components/ui";

// Piezas del sitio público (arbicrypto.org): navbar con desplegables, footer, animaciones y las piezas que comparten las
// páginas. Las animaciones siguen las de ReservaTuCancha: resortes cortos y la curva "out expo" (arranca rápido y frena suave).

export const EASE = [0.22, 1, 0.36, 1] as const;
const SPRING = { type: "spring", stiffness: 420, damping: 34 } as const;
const TAP = { type: "spring", stiffness: 400, damping: 30 } as const;

export const LOGIN = { panel: "/login?next=panel", wallet: "/login?next=wallet", invite: "/login?mode=registro" };

// ---------------------------------------------------------------- datos del mercado

export type Quote = { asset: string; buy: number | null; sell: number | null };
export type Market = { t: number | null; rows: Quote[] };
export type Hist = Record<string, number[]>;

const STABLE = new Set(["USDT", "USDC", "FDUSD"]);
export const NAMES: Record<string, string> = { USDT: "Tether", BTC: "Bitcoin", ETH: "Ethereum", BNB: "BNB", SOL: "Solana", XRP: "XRP", USDC: "USD Coin", FDUSD: "First Digital USD" };
const KEEP = 40;  // puntos de la minigráfica (uno por consulta)

export const es = (v: number, d = 0) => v.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
export const cop = (v: number) => `$${es(Math.round(v))}`;
export const isStable = (a: string) => STABLE.has(a);
export const price = (asset: string, v: number | null) => (v == null ? "—" : STABLE.has(asset) ? `$${es(v, 2)}` : cop(v));
export const gapOf = (q?: Quote) => (q?.buy && q.sell ? ((q.sell - q.buy) / q.buy) * 100 : null);
export const pct = (g: number | null) => (g == null ? "—" : `${g > 0 ? "+" : ""}${es(g, 2)} %`);
export const toneOf = (g: number | null) => (g == null ? "" : g > 0 ? "up" : "down");
export const coin = (a: string) => `/coins/${a.toLowerCase()}.svg`;

/** Precios públicos cada 15 s, y lo que va del rato para las minigráficas. */
export function useMarket() {
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

// ---------------------------------------------------------------- animación

const rise: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

/** Aparece al llegar a él (sube y se funde). */
export function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.15 }}
      variants={{ hidden: rise.hidden, show: { ...rise.show, transition: { duration: 0.6, ease: EASE, delay } } }}>
      {children}
    </motion.div>
  );
}

/** Contenedor que hace entrar a sus <StaggerItem> uno tras otro. */
export function Stagger({ children, className, gap = 0.08 }: { children: React.ReactNode; className?: string; gap?: number }) {
  return (
    <motion.div className={className} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.12 }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return <motion.div className={className} variants={rise}>{children}</motion.div>;
}

/** Un valor que cambia: el viejo sale hacia arriba y el nuevo entra desde abajo. */
export function Num({ v, className }: { v: string; className?: string }) {
  return (
    <span className={`wb-num ${className ?? ""}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={v} initial={{ y: "60%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: "-60%", opacity: 0 }}
          transition={{ duration: 0.35, ease: EASE }}>
          {v}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Botón píldora que sube un poco al pasar y se hunde al tocar. */
export function Pill({ href, kind = "solid", sm, children }: { href: string; kind?: "solid" | "ghost" | "soft"; sm?: boolean; children: React.ReactNode }) {
  return (
    <motion.a href={href} className={`wb-pill-btn ${kind} ${sm ? "sm" : ""}`} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={TAP}>
      {children}
    </motion.a>
  );
}

/** Pestañas con una píldora que se desliza a la elegida. */
export function PillTabs<T extends string>({ tabs, active, onChange, id }: { tabs: readonly { k: T; t: string }[]; active: T; onChange: (k: T) => void; id: string }) {
  return (
    <div className="wb-pilltabs" role="tablist">
      {tabs.map((x) => {
        const on = x.k === active;
        return (
          <motion.button key={x.k} type="button" role="tab" aria-selected={on} onClick={() => onChange(x.k)} whileTap={{ scale: 0.95 }} transition={TAP}
            className={on ? "on" : ""}>
            {on && <motion.span layoutId={`${id}-pill`} className="wb-pilltabs-bg" transition={SPRING} />}
            <span>{x.t}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- navbar

type Item = { href: string; ic: IconName; h: string; p: string };
type Group = { t: string; href?: string; items?: Item[] };

const MENU: Group[] = [
  {
    t: "Productos", items: [
      { href: "/arbitraje", ic: "bolt", h: "Arbitraje P2P y Spot", p: "Rutas ya netas y avisos al instante" },
      { href: "/vender", ic: "handCoins", h: "Vender sin perder", p: "A quién venderle lo que ya tienes" },
      { href: "/renta", ic: "receipt", h: "Wallet y renta", p: "Tu declaración lista para la DIAN" },
    ],
  },
  {
    t: "Mercado", items: [
      { href: "/precios", ic: "activity", h: "Precios P2P en vivo", p: "Compra y venta en pesos, al momento" },
      { href: "/precios#la-cuenta", ic: "percent", h: "Cómo se hace la cuenta", p: "Comisión, redondeo y 4x1000" },
    ],
  },
  { t: "Seguridad", href: "/seguridad" },
  {
    t: "Ayuda", items: [
      { href: "/preguntas", ic: "info", h: "Preguntas frecuentes", p: "Lo que todos preguntan" },
      { href: "/preguntas#empezar", ic: "ticket", h: "Cómo empezar", p: "Invitación, llave y capital" },
    ],
  },
];

const here = (path: string, href: string) => href.split("#")[0] === (path.replace(/\.html$/, "").replace(/\/$/, "") || "/");

function SiteNav() {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState<string | null>(null);   // desplegable abierto (escritorio)
  const [hover, setHover] = useState<string | null>(null); // dónde está la píldora de hover
  const [mobile, setMobile] = useState(false);
  const [mGroup, setMGroup] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const f = () => setScrolled(scrollY > 12);
    f();
    addEventListener("scroll", f, { passive: true });
    return () => removeEventListener("scroll", f);
  }, []);
  // clic afuera o Escape: cierra el desplegable
  useEffect(() => {
    const out = (e: MouseEvent) => { if (!navRef.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(null); setMobile(false); } };
    addEventListener("mousedown", out);
    addEventListener("keydown", esc);
    return () => { removeEventListener("mousedown", out); removeEventListener("keydown", esc); };
  }, []);

  const enter = (t: string) => {
    if (closeT.current) clearTimeout(closeT.current);
    setHover(t);
    setOpen(MENU.find((g) => g.t === t)?.items ? t : null);
  };
  const leave = () => {
    closeT.current = setTimeout(() => { setOpen(null); setHover(null); }, 140);
  };
  const groupOn = (g: Group) => (g.href ? here(path, g.href) : g.items!.some((i) => here(path, i.href)));

  return (
    <header ref={navRef} className={`wb-nav ${scrolled || mobile ? "solid" : ""}`}>
      <div className="wb-wrap wb-nav-in">
        <a href="/" className="wb-brand" aria-label="ArbiCrypto, inicio"><Logo size={30} /><span>ArbiCrypto</span></a>

        <nav className="wb-links" aria-label="Secciones" onMouseLeave={leave}>
          {MENU.map((g) => {
            const on = groupOn(g);
            const inner = (
              <>
                {hover === g.t && <motion.span layoutId="nav-hover" className="wb-links-hover" transition={SPRING} />}
                <span className="wb-links-t">{g.t}</span>
                {g.items && (
                  <motion.span className="wb-links-chev" animate={{ rotate: open === g.t ? 180 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 28 }}>
                    <Icon name="chevronDown" size={14} />
                  </motion.span>
                )}
              </>
            );
            return (
              <div key={g.t} className="wb-links-item" onMouseEnter={() => enter(g.t)}>
                {g.href ? (
                  <a href={g.href} className={`wb-links-btn ${on ? "on" : ""}`}>{inner}</a>
                ) : (
                  <button type="button" className={`wb-links-btn ${on ? "on" : ""}`} aria-expanded={open === g.t}
                    onClick={() => setOpen(open === g.t ? null : g.t)}>{inner}</button>
                )}
                <AnimatePresence>
                  {open === g.t && g.items && (
                    <motion.div className="wb-drop" role="menu"
                      initial={{ opacity: 0, scale: 0.94, y: -6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.13, ease: "easeIn" } }}
                      transition={{ type: "spring", stiffness: 460, damping: 32, mass: 0.7 }}>
                      <motion.div initial="hidden" animate="show"
                        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } } }}>
                        {g.items.map((i) => (
                          <motion.a key={i.href} href={i.href} role="menuitem" className={`wb-drop-row ${here(path, i.href) ? "on" : ""}`}
                            variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0, transition: { duration: 0.25, ease: EASE } } }}>
                            <span className="wb-drop-ic"><Icon name={i.ic} size={18} /></span>
                            <span><b>{i.h}</b><small>{i.p}</small></span>
                          </motion.a>
                        ))}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>

        <div className="wb-nav-cta">
          <Pill href="/login" kind="ghost" sm>Iniciar sesión</Pill>
          <Pill href={LOGIN.invite} kind="soft" sm>Registrarme</Pill>
          <button className="wb-burger" aria-label={mobile ? "Cerrar menú" : "Abrir menú"} aria-expanded={mobile} onClick={() => setMobile((v) => !v)}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={mobile ? "x" : "menu"} initial={{ opacity: 0, rotate: mobile ? -90 : 90, scale: 0.7 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }} exit={{ opacity: 0, rotate: mobile ? 90 : -90, scale: 0.7 }}
                transition={{ duration: 0.2, ease: EASE }}>
                <Icon name={mobile ? "x" : "menu"} size={22} />
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </div>

      {/* celular: el menú baja (alto + fundido) y sus filas entran escalonadas */}
      <AnimatePresence initial={false}>
        {mobile && (
          <motion.div className="wb-mmenu" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ height: { duration: 0.32, ease: EASE }, opacity: { duration: 0.2 } }}>
            <div className="wb-mmenu-in">
              {MENU.map((g, gi) => (
                <motion.div key={g.t} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 + gi * 0.045, duration: 0.28, ease: EASE }}>
                  {g.href ? (
                    <a className="wb-mmenu-head" href={g.href}>{g.t}</a>
                  ) : (
                    <>
                      <button type="button" className="wb-mmenu-head" aria-expanded={mGroup === g.t} onClick={() => setMGroup(mGroup === g.t ? null : g.t)}>
                        {g.t}
                        <motion.span animate={{ rotate: mGroup === g.t ? 180 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 28 }}>
                          <Icon name="chevronDown" size={16} />
                        </motion.span>
                      </button>
                      <AnimatePresence initial={false}>
                        {mGroup === g.t && (
                          <motion.div className="wb-mmenu-sub" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            transition={{ height: { duration: 0.3, ease: EASE }, opacity: { duration: 0.2 } }}>
                            {g.items!.map((i) => (
                              <a key={i.href} href={i.href} className="wb-drop-row" onClick={() => setMobile(false)}>
                                <span className="wb-drop-ic"><Icon name={i.ic} size={18} /></span>
                                <span><b>{i.h}</b><small>{i.p}</small></span>
                              </a>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </>
                  )}
                </motion.div>
              ))}
              <div className="wb-mmenu-cta">
                <Pill href="/login" kind="ghost">Iniciar sesión</Pill>
                <Pill href={LOGIN.invite}>Registrarme</Pill>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="wb-foot">
      <div className="wb-wrap">
        <div className="wb-foot-top">
          <a href="/" className="wb-brand"><Logo size={28} /><span>ArbiCrypto</span></a>
          {MENU.filter((g) => g.items).map((g) => (
            <nav key={g.t} aria-label={g.t}>
              <b>{g.t}</b>
              {g.items!.map((i) => <a key={i.href} href={i.href}>{i.h}</a>)}
            </nav>
          ))}
          <nav aria-label="Cuenta">
            <b>Cuenta</b>
            <a href="/login">Iniciar sesión</a>
            <a href={LOGIN.invite}>Registrarme</a>
            <a href="/seguridad">Seguridad</a>
          </nav>
        </div>
        <p className="wb-legal">
          Acceso solo con invitación. Las ganancias son estimadas con el mejor precio del momento: confirma siempre en Binance antes de
          pagar. No es asesoría financiera ni tributaria. ArbiCrypto no está afiliado a Binance.
        </p>
        <p className="wb-copy">© {new Date().getFullYear()} ArbiCrypto · Colombia</p>
      </div>
    </footer>
  );
}

/** Marco de todas las páginas del sitio: navbar, contenido y footer. */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="wb">
        <SiteNav />
        <main>{children}</main>
        <SiteFooter />
      </div>
    </MotionConfig>
  );
}

/** Encabezado de una página interna: título a la izquierda y una pieza a la derecha. */
export function PageHero({ kicker, title, lead, children, cta = true }: { kicker: string; title: React.ReactNode; lead: string; children?: React.ReactNode; cta?: boolean }) {
  return (
    <section className="wb-phero">
      <div className="wb-wrap wb-phero-in">
        <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}>
          <motion.p className="wb-kicker" variants={rise}>{kicker}</motion.p>
          <motion.h1 className="wb-h1 sm" variants={rise}>{title}</motion.h1>
          <motion.p className="wb-lead" variants={rise}>{lead}</motion.p>
          {cta && (
            <motion.div className="wb-cta" variants={rise}>
              <Pill href={LOGIN.panel}>Entrar al panel</Pill>
              <Pill href={LOGIN.invite} kind="ghost">Tengo una invitación</Pill>
            </motion.div>
          )}
        </motion.div>
        {children && (
          <motion.div className="wb-phero-art" initial={{ opacity: 0, y: 30, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.8, ease: EASE, delay: 0.15 }}>
            {children}
          </motion.div>
        )}
      </div>
    </section>
  );
}

/** Franja final con el llamado a entrar. */
export function EndBand({ title = "Abre el tablero.", text = "Deja que la cuenta la haga el panel y entra solo cuando quedan pesos." }: { title?: string; text?: string }) {
  return (
    <section className="wb-sec">
      <div className="wb-wrap">
        <Reveal className="wb-end">
          <div className="wb-glow sm" aria-hidden="true" />
          <h2 className="wb-h2">{title}</h2>
          <p className="wb-small center">{text}</p>
          <div className="wb-cta center">
            <Pill href={LOGIN.panel}>Entrar al panel</Pill>
            <Pill href={LOGIN.invite} kind="ghost">Usar mi código</Pill>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- piezas

/** Segundo teléfono: un aviso con sus pasos, como llega al panel. */
export function AlertPhone() {
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
        <motion.ol className="wb-ph-steps" initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.5 }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: 0.2 } } }}>
          {steps.map(([ic, h, p], i) => (
            <motion.li key={h} variants={{ hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: EASE } } }}>
              <span className="wb-ph-n">{i + 1}</span><span><b>{h}</b><small>{p}</small></span><Icon name={ic} size={15} />
            </motion.li>
          ))}
        </motion.ol>
        <div className="wb-ph-btns one"><span>Abrir el primer paso</span></div>
      </div>
    </div>
  );
}


/** Línea de precio: con relleno suave debajo y el último punto marcado. */
export function Spark({ pts, tone, w = 96, h = 32, dot = false }: { pts?: number[]; tone: string; w?: number; h?: number; dot?: boolean }) {
  if (!pts || pts.length < 2) return <svg className="wb-spark idle" viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><line x1="0" y1={h / 2} x2={w} y2={h / 2} /></svg>;
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * w, h - 3 - ((p - lo) / span) * (h - 6)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className={`wb-spark ${tone}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,${h} ${line} ${w},${h}`} />
      <motion.polyline points={line} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: EASE }} />
      {dot && <circle cx={lx} cy={ly} r="3" />}
    </svg>
  );
}

const FEE = 0.0014;  // comisión P2P de ejemplo para el recibo (el panel usa la de cada cuenta)
const GMF = 0.004;   // 4x1000

/** La cuenta que hace el panel con cada ruta, con los precios de USDT de ahora mismo. */
export function Receipt({ m }: { m: Market | null }) {
  const [cap, setCap] = useState(500000);
  const usdt = m?.rows.find((r) => r.asset === "USDT");
  const b = usdt?.buy ?? null, s = usdt?.sell ?? null;
  const gmf = cap * GMF;
  const got = b ? cap / b : 0;
  const fee = got * FEE;
  const back = s ? (got - fee) * s : 0;
  const net = b && s ? back - cap - gmf : null;
  const line = (k: string, v: string, cls = "") => <div className={`rc-line ${cls}`}><span>{k}</span><b><Num v={v} /></b></div>;
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
        <b><Num v={net == null ? "…" : `${net >= 0 ? "+" : "−"}${cop(Math.abs(net))}`} /></b>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={net == null ? "x" : net >= 0 ? "si" : "no"} className="rc-verdict" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25, ease: EASE }}>
          {net == null ? "Esperando precios en vivo…" : net >= 0 ? "Esta da. El panel te avisa." : "Esta no da. El panel se queda callado."}
        </motion.p>
      </AnimatePresence>
      <label className="rc-slider">
        <span>Tu capital <b>{cop(cap)}</b></span>
        <input type="range" min={100000} max={5000000} step={50000} value={cap} onChange={(e) => setCap(+e.target.value)}
          style={{ "--fill": `${((cap - 100000) / 4900000) * 100}%` } as React.CSSProperties} />
      </label>
    </div>
  );
}

const BOARD_TABS = [{ k: "all", t: "Todos" }, { k: "stable", t: "Dólares" }, { k: "crypto", t: "Cripto" }] as const;

/** Tablero P2P en vivo; con `tabs`, filtra con pestañas y las filas entran y salen animadas. */
export function Board({ m, limit, tabs }: { m: Market | null; limit?: number; tabs?: boolean }) {
  const [tab, setTab] = useState<(typeof BOARD_TABS)[number]["k"]>("all");
  const rows = (m?.rows ?? []).filter((r) => tab === "all" || (tab === "stable") === STABLE.has(r.asset)).slice(0, limit);
  return (
    <div className="wb-board" role="table" aria-label="Precios P2P en pesos colombianos, en vivo">
      {tabs && (
        <div className="wb-board-top">
          <PillTabs tabs={BOARD_TABS} active={tab} onChange={setTab} id="board" />
          <span className={`wb-ph-live ${m ? "on" : ""}`}><i />{m ? "En vivo" : "Conectando"}</span>
        </div>
      )}
      <div className="wb-board-head" role="row">
        <span role="columnheader">Activo</span><span role="columnheader">Comprar</span><span role="columnheader">Vender</span><span role="columnheader">Dif.</span>
      </div>
      {rows.length ? (
        <AnimatePresence initial={false} mode="popLayout">
          {rows.map((r) => {
            const g = gapOf(r);
            return (
              <motion.div layout className="wb-board-row" role="row" key={r.asset}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
                transition={{ duration: 0.35, ease: EASE }}>
                <span role="cell" className="wb-board-a">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={coin(r.asset)} alt="" width={24} height={24} />
                  <span><b>{r.asset}</b><small>{NAMES[r.asset] ?? ""}</small></span>
                </span>
                <span role="cell"><Num v={price(r.asset, r.buy)} /></span>
                <span role="cell"><Num v={price(r.asset, r.sell)} /></span>
                <span role="cell" className={toneOf(g)}><Num v={pct(g)} /></span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      ) : <p className="wb-board-wait">Conectando con Binance P2P…</p>}
    </div>
  );
}

/** Tarjetas de precio por moneda. */
export function CoinCards({ m, hist, assets = ["USDT", "BTC", "ETH", "BNB"] }: { m: Market | null; hist: Hist; assets?: string[] }) {
  const byAsset = new Map((m?.rows ?? []).map((r) => [r.asset, r]));
  return (
    <Stagger className={`wb-coins ${assets.length > 4 ? "wide" : ""}`}>
      {assets.map((a) => {
        const q = byAsset.get(a);
        const g = gapOf(q);
        return (
          <StaggerItem key={a}>
            <motion.div className="wb-coin-card" whileHover={{ y: -4 }} transition={TAP}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <span className="wb-ic"><img src={coin(a)} alt="" width={22} height={22} /></span>
              <small>{a} · {NAMES[a]}</small>
              <b><Num v={price(a, q?.buy ?? null)} /></b>
              <span className={`wb-coin-gap ${toneOf(g)}`}><Num v={pct(g)} /></span>
              {(hist[a]?.length ?? 0) >= 3 && <Spark pts={hist[a]} tone={toneOf(g) || "gold"} />}
            </motion.div>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

const FORM = ["Patrimonio en cripto a 31 de dic.", "Ingresos por ventas", "Costos de lo vendido", "4x1000 deducible", "Ganancia ocasional"];

export function Form210() {
  return (
    <div className="wb-form" aria-hidden="true">
      <div className="wb-form-head"><span>Formulario 210</span><span>Renta · persona natural</span></div>
      {FORM.map((k, i) => (
        <div className="wb-form-row" key={k}>
          <span className="wb-form-n">{String(i + 1).padStart(2, "0")}</span>
          <span>{k}</span>
          <motion.span className="wb-form-v" initial={{ width: 0 }} whileInView={{ width: `${40 + ((i * 37) % 45)}%` }} viewport={{ once: true }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.1 + i * 0.08 }} />
        </div>
      ))}
      <div className="wb-form-foot">
        <motion.span className="wb-stamp" initial={{ scale: 0.6, opacity: 0 }} whileInView={{ scale: 1, opacity: 1 }} viewport={{ once: true }}
          transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.7 }}>
          <Icon name="check" size={14} /> Cuadra
        </motion.span>
        <small>Estatuto Tributario y Concepto DIAN 1621 de 2023</small>
      </div>
    </div>
  );
}

export function Perms() {
  const rows: [string, boolean][] = [["Lectura", true], ["Trading", false], ["Retiros", false]];
  return (
    <Stagger className="wb-perms" gap={0.1}>
      {rows.map(([k, ok]) => (
        <StaggerItem key={k} className={ok ? "ok" : "no"}>
          <span>{k}</span>
          <b><Icon name={ok ? "checkCircle" : "x"} size={22} /> {ok ? "Sí" : "No"}</b>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

/** Preguntas: la respuesta se abre con su alto y el ícono gira con resorte. */
export function Faq({ items, resetKey }: { items: { q: string; a: string }[]; resetKey?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { setOpen(null); }, [resetKey]);
  return (
    <div className="wb-faq">
      <AnimatePresence mode="popLayout">
        <motion.div key={resetKey ?? "faq"} initial="hidden" whileInView="show" exit="exit" viewport={{ once: true, amount: 0.1 }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } }, exit: { transition: { staggerChildren: 0.03, staggerDirection: -1 } } }}>
          {items.map((x, i) => {
            const on = open === i;
            return (
              <motion.div key={x.q} className={`wb-faq-item ${on ? "on" : ""}`}
                variants={{
                  hidden: { opacity: 0, y: 14 },
                  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
                  exit: { opacity: 0, y: -8, transition: { duration: 0.15, ease: "easeIn" } },
                }}>
                <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : i)}>
                  <span>{x.q}</span>
                  <motion.span className="wb-faq-ic" animate={{ rotate: on ? 45 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 28 }}>
                    <Icon name="plus" size={18} />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div className="wb-faq-a" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      transition={{ height: { duration: 0.34, ease: EASE }, opacity: { duration: 0.22 } }}>
                      <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE, delay: 0.06 } }}
                        exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}>
                        {x.a}
                      </motion.p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export const FAQ = {
  general: [
    { q: "¿Qué hace ArbiCrypto?", a: "Mira los precios de Binance P2P y Spot cada segundo, hace la cuenta completa con tu capital (comisión, redondeo y 4x1000) y te avisa solo cuando una ruta de verdad deja pesos." },
    { q: "¿Por qué la diferencia de precio no es la ganancia?", a: "Porque entre la comisión de Binance, el redondeo de cantidades y el 4x1000 de tu banco, muchas veces lo que parece que da, pierde. El panel descuenta todo eso antes de avisarte." },
    { q: "¿Cómo entro?", a: "Solo con invitación. Si alguien del equipo te pasó un código, regístrate con él; si ya tienes cuenta, inicia sesión y eliges si vas al panel o a la wallet." },
    { q: "¿Está afiliado a Binance?", a: "No. ArbiCrypto lee los precios públicos de Binance P2P y Spot y, si conectas tu llave, tus propias órdenes. No es asesoría financiera ni tributaria." },
  ],
  seguridad: [
    { q: "¿ArbiCrypto puede mover mi plata?", a: "No. La llave de Binance que aceptamos es de solo lectura: si puede operar o retirar, el panel la rechaza. Las compras y ventas las haces tú en Binance." },
    { q: "¿Quién ve mis saldos y órdenes?", a: "Solo tú. Ni los administradores entran a tus saldos, órdenes, wallet ni declaración. Lo único compartido con el equipo es el chat." },
    { q: "¿Cómo se guarda mi llave?", a: "Cifrada. La puedes borrar cuando quieras desde tu cuenta, y con eso se borran también tus saldos guardados." },
  ],
  operar: [
    { q: "¿Qué hago cuando me llega un aviso?", a: "Abres los pasos: a quién comprarle, qué cambiar en Spot (pestaña Market, nunca Convertir) y a quién venderle. Antes de pagar confirma que el precio siga igual." },
    { q: "¿Y si ya tengo dólares o cripto?", a: "En Vender anotas lo que tienes y a cuánto lo compraste. El panel compara venderlo directo o pasando por otra moneda en Spot, y te avisa cuando sales ganando." },
    { q: "¿Por qué tengo que pasar entre Fondos y Spot?", a: "Lo que compras en P2P llega a tu billetera de Fondos y Spot solo usa lo que está en Spot. Transferir entre las dos es gratis e inmediato." },
  ],
  wallet: [
    { q: "¿La wallet me sirve para la declaración de renta?", a: "Te arma el patrimonio, los ingresos, los costos, el 4x1000 deducible y la ganancia ocasional con el Estatuto Tributario y el Concepto Unificado DIAN 1621 de 2023. Es un cálculo informativo: revísalo con tu contador." },
    { q: "¿Tengo que cargar mis órdenes a mano?", a: "No. La wallet trae tus órdenes de Binance sola y le encuentra la compra a cada venta. También puedes subir el historial en PDF o Excel." },
  ],
};

// ---------------------------------------------------------------- bloques de las páginas internas

/** Encabezado centrado de una sección. */
export function SecHead({ kicker, title, sub }: { kicker?: string; title: React.ReactNode; sub?: string }) {
  return (
    <Reveal className="wb-sechead">
      {kicker && <p className="wb-kicker">{kicker}</p>}
      <h2 className="wb-h2">{title}</h2>
      {sub && <p className="wb-small center">{sub}</p>}
    </Reveal>
  );
}

/** Tarjetas con ícono que entran en cascada. */
export function Cards({ items, cols = 3 }: { items: { ic: IconName; h: string; p: string }[]; cols?: 2 | 3 }) {
  return (
    <Stagger className={`wb-grid c${cols}`}>
      {items.map((x) => (
        <StaggerItem key={x.h}>
          <motion.div className="wb-card left" whileHover={{ y: -4 }} transition={TAP}>
            <span className="wb-ic"><Icon name={x.ic} size={20} /></span>
            <h3>{x.h}</h3>
            <p>{x.p}</p>
          </motion.div>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

/** Texto a un lado y una pieza al otro. */
export function Split({ id, kicker, title, children, art, flip }: { id?: string; kicker?: string; title: React.ReactNode; children: React.ReactNode; art: React.ReactNode; flip?: boolean }) {
  return (
    <section id={id} className="wb-sec">
      <div className={`wb-wrap wb-split ${flip ? "flip" : ""}`}>
        <Reveal>
          {kicker && <p className="wb-kicker">{kicker}</p>}
          <h2 className="wb-h2">{title}</h2>
          <div className="wb-split-txt">{children}</div>
        </Reveal>
        <Reveal delay={0.1} className="wb-split-art">{art}</Reveal>
      </div>
    </section>
  );
}

/** Pasos numerados en tarjetas. */
export function NumSteps({ items }: { items: [string, string][] }) {
  return (
    <Stagger className="wb-grid c3">
      {items.map(([h, p], i) => (
        <StaggerItem key={h}>
          <div className="wb-card left">
            <span className="wb-stepn">{i + 1}</span>
            <h3>{h}</h3>
            <p>{p}</p>
          </div>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
