"use client";

import { useEffect, useState } from "react";
import { App } from "@/components/App";
import { Skeleton } from "@/components/ui";
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

  if (state === "loading") return <main><Skeleton rows={5} /></main>;
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
  if (!me) return <main><Skeleton rows={5} /></main>;
  return (
    <WalletProvider initial={me}>
      <App />
    </WalletProvider>
  );
}
