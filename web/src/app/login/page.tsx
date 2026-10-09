"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Icon, Logo, PasswordInput } from "@/components/ui";

export default function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode === "register" && pass !== pass2) return setError("Las contraseñas no coinciden.");
    setBusy(true);
    try {
      if (mode === "login") await api.login(user, pass);
      else await api.register(code, user, pass);
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card login-card" onSubmit={(e) => void submit(e)}>
        <Logo size={60} />
        <h1 className="brand-name" style={{ fontSize: 26 }}>Arbi<span>Crypto</span></h1>
        <p className="sub" style={{ marginBottom: 22 }}>
          {mode === "login" ? "Arbitraje P2P en vivo para ti y tu equipo" : "Crea tu usuario con el código que te dio el administrador"}
        </p>

        {mode === "register" && (
          <label className="login-field">
            Código de invitación
            <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AC-XXXX-XXXX" autoComplete="off" spellCheck={false} required className="code-input" />
          </label>
        )}
        <label className="login-field">
          Usuario
          <input type="text" value={user} onChange={(e) => setUser(e.target.value.toLowerCase())} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
        </label>
        <label className="login-field">
          Contraseña
          <PasswordInput value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : undefined} required />
        </label>
        {mode === "register" && (
          <label className="login-field">
            Repite la contraseña
            <PasswordInput value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" minLength={8} required />
          </label>
        )}
        {error && <div className="form-err" style={{ textAlign: "left" }}>{error}</div>}
        <button className="btn btn-brand btn-lg" type="submit" disabled={busy} style={{ width: "100%", marginTop: 6 }}>
          {busy ? "Un momento…" : mode === "login" ? "Entrar" : "Crear mi cuenta"}
        </button>
        <button type="button" className="btn btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          <Icon name={mode === "login" ? "ticket" : "arrowRight"} size={16} />
          {mode === "login" ? "Tengo un código de invitación: crear cuenta" : "Ya tengo cuenta: entrar"}
        </button>
      </form>
    </div>
  );
}
