"use client";

import { useEffect, useState } from "react";
import { App } from "@/components/App";
import { Splash } from "@/components/splash";
import { WalletProvider } from "@/components/wallet";
import { api, ApiError, type Me } from "@/lib/api";

export default function Page() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");

  // Sin sesión: se entra desde el panel con su misma sesión (/entrar pide el pase al panel)
  const load = () =>
    api.me().then(
      (m) => { setMe(m); setState("ready"); },
      (e: ApiError) => (e.status === 401 ? window.location.replace("/entrar") : setState("offline")),
    );

  useEffect(() => { void load(); }, []);

  if (state === "loading") return <Splash text="Abriendo tu wallet" sub="Trayendo tus movimientos y tus libros" />;
  if (state === "offline") {
    return (
      <div className="login">
        <div className="card login-card">
          <p>No hay conexión con el servidor. Revisa que la wallet esté prendida (<b>pm2 status</b>) y recarga la página.</p>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => { setState("loading"); void load(); }}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!me) return <Splash text="Abriendo tu wallet" />;
  return (
    <WalletProvider initial={me}>
      <App />
      <Splash text="Abriendo tu wallet" show={false} />
    </WalletProvider>
  );
}
