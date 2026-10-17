"use client";

import { useCallback, useEffect, useState } from "react";
import { Sidebar, TABS, Topbar, type TabId } from "@/components/Header";
import { Logo } from "@/components/ui";
import { Account } from "@/components/tabs/Account";
import { AdSim } from "@/components/tabs/AdSim";
import { Chat, ChatDock } from "@/components/tabs/Chat";
import { History } from "@/components/tabs/History";
import { Home } from "@/components/tabs/Home";
import { Market } from "@/components/tabs/Market";
import { Sell } from "@/components/tabs/Sell";
import { Team } from "@/components/tabs/Team";
import { LiveProvider, useLive } from "@/lib/live";
import { ConfirmHost } from "@/components/overlay";
import { Splash } from "@/components/splash";

function Banners() {
  const { state } = useLive();
  if (!state) return null;
  const names: Record<string, string> = { spot: "los precios de Binance Spot", p2p: "el mercado P2P", account: "tu cuenta", watch: "la vigilancia de ventas" };
  return (
    <>
      {Object.entries(state.errors).filter(([k]) => {
        const t = k === "p2p" ? state.p2p?.t : k === "spot" ? state.spot?.t : undefined;
        return !t || state.now - t > 30;
      }).map(([k, e]) => (
        <div key={k} className="banner err">
          <b>!</b>
          <span>No se pudo actualizar {names[k] ?? k}: {e.msg}. Reintentando automáticamente.</span>
        </div>
      ))}
    </>
  );
}

function App() {
  const [tab, setTab] = useState<TabId>("mercado");
  const [noWallet, setNoWallet] = useState(false);

  useEffect(() => {
    const read = () => {
      if (window.location.hash === "#sin-wallet") setNoWallet(true);
      const h = window.location.hash.slice(1) as TabId;
      setTab(TABS.some((t) => t.id === h) ? h : "mercado");  // Precios P2P es la principal
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const go = useCallback((t: TabId) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const { state } = useLive();
  return (
    <>
      <Splash text="Abriendo el panel" sub="Conectando con Binance en vivo" show={!state} />
      <ConfirmHost />
      <div className="shell">
      <Sidebar tab={tab} onTab={go} />
      <div className="shell-main">
      <Topbar tab={tab} onTab={go} />
      <main className="wrap page-in" key={tab}>
        <Banners />
        {noWallet && (
          <div className="banner err">
            <b>!</b>
            <span>Tu usuario no tiene acceso a la wallet. Pídele a un administrador que te lo active en Equipo.</span>
          </div>
        )}
        {tab === "inicio" && <Home onTab={go} />}
        {tab === "vender" && <Sell />}
        {tab === "mercado" && <Market />}
        {tab === "anuncios" && <AdSim />}
        {tab === "historial" && <History />}
        {tab === "chat" && <Chat />}
        {tab === "cuenta" && <Account />}
        {tab === "equipo" && <Team />}
      </main>
      <ChatDock hidden={tab === "chat"} onFull={(p) => {
        try {
          sessionStorage.setItem("cj-chat-peer", p); // el chat completo abre la misma conversación
        } catch {
          /* sin almacenamiento */
        }
        go("chat");
      }} />
      <footer className="wrap foot">
        <Logo size={22} />
        <span>ArbiCrypto · datos en vivo de Binance · confirma el precio antes de pagar</span>
      </footer>
      </div>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <LiveProvider>
      <App />
    </LiveProvider>
  );
}
