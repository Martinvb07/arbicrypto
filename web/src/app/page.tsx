"use client";

import { useCallback, useEffect, useState } from "react";
import { Header, Nav, TABS, type TabId } from "@/components/Header";
import { Logo } from "@/components/ui";
import { Account } from "@/components/tabs/Account";
import { Chat, ChatDock } from "@/components/tabs/Chat";
import { History } from "@/components/tabs/History";
import { Home } from "@/components/tabs/Home";
import { Journal } from "@/components/tabs/Journal";
import { Market } from "@/components/tabs/Market";
import { Sell } from "@/components/tabs/Sell";
import { Team } from "@/components/tabs/Team";
import { LiveProvider, useLive } from "@/lib/live";
import { ConfirmHost } from "@/components/overlay";

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
  const [tab, setTab] = useState<TabId>("inicio");

  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1) as TabId;
      setTab(TABS.some((t) => t.id === h) ? h : "inicio");
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

  return (
    <>
      <ConfirmHost />
      <Header onTab={go} />
      <Nav tab={tab} onTab={go} />
      <main className="wrap">
        <Banners />
        {tab === "inicio" && <Home onTab={go} />}
        {tab === "vender" && <Sell />}
        {tab === "mercado" && <Market />}
        {tab === "historial" && <History />}
        {tab === "bitacora" && <Journal />}
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
