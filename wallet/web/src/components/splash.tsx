"use client";

import { useEffect, useState } from "react";

const MARK = `<span class="splash-mark"><span class="splash-ring"></span><img src="/brand/mark-256.png" alt="" width="64" height="64"></span>`;

/** Pantalla de carga con el logo (la misma en el panel y en la wallet). */
export function Splash({ text, sub, show = true }: { text: string; sub?: string; show?: boolean }) {
  const [gone, setGone] = useState(!show);
  useEffect(() => {
    if (show) { setGone(false); return; }
    const t = setTimeout(() => setGone(true), 450);  // deja terminar la animación de salida
    return () => clearTimeout(t);
  }, [show]);
  if (gone) return null;
  return (
    <div className={`splash ${show ? "" : "out"}`} role="status" aria-live="polite">
      <span dangerouslySetInnerHTML={{ __html: MARK }} />
      <b>{text}</b>
      {sub && <small>{sub}</small>}
      <span className="splash-bar"><i /></span>
    </div>
  );
}

/** Muestra la pantalla de carga y luego cambia de página (panel ⇄ wallet), para que el salto no se vea seco. */
export function goWithSplash(url: string, text: string, sub?: string) {
  if (typeof document !== "undefined" && !document.querySelector(".splash.leaving")) {
    const el = document.createElement("div");
    el.className = "splash leaving";
    el.setAttribute("role", "status");
    el.innerHTML = `<span>${MARK}</span><b></b>${sub ? "<small></small>" : ""}<span class="splash-bar"><i></i></span>`;
    el.querySelector("b")!.textContent = text;
    if (sub) el.querySelector("small")!.textContent = sub;
    document.body.appendChild(el);
    // si el usuario vuelve con "atrás", la página puede salir del caché con la pantalla puesta
    window.addEventListener("pageshow", (e) => { if ((e as PageTransitionEvent).persisted) el.remove(); }, { once: true });
  }
  setTimeout(() => { window.location.href = url; }, 220);
}
