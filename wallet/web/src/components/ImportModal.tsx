"use client";

import { useState } from "react";
import { api, ApiError, type CsvResult } from "@/lib/api";
import { Icon, Modal, Note } from "./ui";
import { useWallet } from "./wallet";

export function ImportModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Subir archivo" onClose={onClose} wide>
      <CsvImport />
    </Modal>
  );
}

function CsvImport() {
  const { toast, refresh } = useWallet();
  const [file, setFile] = useState<{ name: string; text?: string; pdf?: string } | null>(null);
  const [result, setResult] = useState<CsvResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [valid, setValid] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function pick(f: File | undefined) {
    if (!f) return;
    setResult(null); setErrors([]); setError("");
    if (f.name.toLowerCase().endsWith(".pdf")) {  // el historial P2P que Binance ahora entrega en PDF
      if (f.size > 8 * 1024 * 1024) return setError("El PDF pesa más de 8 MB. Expórtalo por periodos más cortos.");
      const pdf = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(new Error("No se pudo leer el archivo."));
        r.readAsDataURL(f);
      });
      return setFile({ name: f.name, pdf });
    }
    if (f.size > 2.5 * 1024 * 1024) return setError("El archivo pesa más de 2,5 MB. Divídelo por años.");
    const buf = await f.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf); // Excel en Windows
    setFile({ name: f.name, text });
  }

  async function send(partial: boolean) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const r = file.pdf ? await api.importPdf(file.pdf, partial) : await api.importCsv(file.text ?? "", partial);
      setResult(r); setErrors(r.errors); setFile(null);
      toast("Archivo importado", `${r.added} movimientos nuevos`, "good");
      refresh();
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      setErrors((err.data?.errors as string[]) ?? []);
      setValid(Number(err.data?.valid ?? 0));
    }
    setBusy(false);
  }

  return (
    <div className="stack">
      <Note>
        Acepta <b>el historial de órdenes P2P de Binance</b> en PDF o CSV (P2P → Órdenes → Exportar; súbelo tal cual, sin abrirlo en Excel)
        o <b>la plantilla</b> para cualquier otro movimiento.{" "}
        <a href="/api/plantilla.csv" download className="link">Descargar plantilla</a>
      </Note>
      <label className={`drop ${over ? "on" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void pick(e.dataTransfer.files[0]); }}>
        <Icon name="upload" size={22} />
        <b>{file ? file.name : "Elige o arrastra tu archivo: PDF o CSV"}</b>
        <span>Si Binance te da un .zip, descomprímelo primero · lo que ya estaba no se duplica</span>
        <input type="file" accept=".pdf,.csv,text/csv,application/pdf" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {error && (
        <Note kind="bad">
          <b>{error}</b>
          {errors.length > 0 && <ul className="err-list">{errors.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        </Note>
      )}
      {result && (
        <Note kind="good">
          <b>{result.added} movimientos nuevos.</b>
          {result.skipped > 0 && ` ${result.skipped} ya estaban.`}
          {result.examples > 0 && ` Se ignoraron ${result.examples} filas de ejemplo.`}
          {!!result.locked && ` ${result.locked} caen en periodos cerrados y no se agregaron.`}
          {errors.length > 0 && <ul className="err-list">{errors.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        </Note>
      )}
      <div className="form-actions" style={{ marginTop: 0 }}>
        {error && valid > 0 && file && (
          <button className="btn" disabled={busy} onClick={() => send(true)}>Importar solo las {valid} filas buenas</button>
        )}
        <button className="btn btn-primary" disabled={!file || busy} onClick={() => send(false)}>
          {busy ? "Importando…" : "Importar archivo"}
        </button>
      </div>
    </div>
  );
}
