"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type BinanceStatus, type Me, type Report } from "@/lib/api";

type ToastKind = "good" | "bad" | "";
interface Toast { id: number; title: string; text?: string; kind: ToastKind }

interface Ctx {
  me: Me;
  setMe: (m: Me) => void;
  year: number;
  setYear: (y: number) => void;
  report: Report | null;
  reportError: string | null;
  /** Vuelve a pedir el reporte y los datos de la cuenta (después de cambiar algo). */
  refresh: () => void;
  version: number;
  toast: (title: string, text?: string, kind?: ToastKind) => void;
  binance: BinanceStatus | null;
  setBinance: (b: BinanceStatus) => void;
}

const WalletCtx = createContext<Ctx | null>(null);

export function useWallet(): Ctx {
  const c = useContext(WalletCtx);
  if (!c) throw new Error("useWallet fuera de WalletProvider");
  return c;
}

export function WalletProvider({ initial, children }: { initial: Me; children: ReactNode }) {
  const [me, setMe] = useState(initial);
  // por defecto el año en curso
  const [year, setYear] = useState(() => initial.years[0]);
  const [report, setReport] = useState<Report | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [binance, setBinanceState] = useState<BinanceStatus | null>(null);
  const seq = useRef(0);
  const wasRunning = useRef(false);

  const toast = useCallback((title: string, text?: string, kind: ToastKind = "") => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, title, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "bad" ? 7000 : 4000);
  }, []);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Estado de Binance: cuando una sincronización termina, se recalcula todo solo.
  const setBinance = useCallback((b: BinanceStatus) => {
    const running = b.job.state === "running";
    if (wasRunning.current && !running) {
      if (b.job.state === "done") {
        const n = b.job.added ?? 0;
        toast("Binance sincronizado", n ? `${n} movimientos nuevos` : "Sin movimientos nuevos", "good");
        if (n) setVersion((v) => v + 1);
      } else if (b.job.state === "error") {
        toast("No se pudo sincronizar Binance", b.job.step, "bad");
      }
    }
    wasRunning.current = running;
    setBinanceState(b);
  }, [toast]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      api.binance().then(
        (b) => {
          if (!alive) return;
          setBinance(b);
          timer = setTimeout(tick, b.job.state === "running" ? 2500 : 10000);
        },
        () => { if (alive) timer = setTimeout(tick, 15000); },
      );
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [setBinance, binance?.job.state === "running"]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    setReportError(null);
    api.report(year).then(
      (r) => alive && setReport(r),
      (e: Error) => alive && setReportError(e.message),
    );
    if (version > 0) api.me().then((m) => alive && setMe(m), () => undefined);
    return () => { alive = false; };
  }, [year, version]);

  return (
    <WalletCtx.Provider value={{
      me, setMe, year, setYear, report: report?.year === year ? report : null, reportError, refresh, version, toast,
      binance, setBinance,
    }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <b>{t.title}</b>
            {t.text && <span>{t.text}</span>}
          </div>
        ))}
      </div>
    </WalletCtx.Provider>
  );
}
