"use client";

import { useState } from "react";
import { EndBand, FAQ, Faq, NumSteps, PageHero, PillTabs, SecHead } from "../sitio";

const CATS = [
  { k: "general", t: "General" },
  { k: "operar", t: "Operar" },
  { k: "seguridad", t: "Seguridad" },
  { k: "wallet", t: "Wallet" },
] as const;

export default function Contenido() {
  const [cat, setCat] = useState<(typeof CATS)[number]["k"]>("general");
  return (
    <>
      <PageHero kicker="Ayuda" title={<>¿Preguntas?<br />Aquí las respuestas.</>} cta={false}
        lead="Lo que todos preguntan antes de conectar su cuenta y cuando les llega el primer aviso." />

      <section className="wb-sec tight">
        <div className="wb-wrap wb-faq-in">
          <PillTabs tabs={CATS} active={cat} onChange={setCat} id="faq" />
          <Faq items={FAQ[cat]} resetKey={cat} />
        </div>
      </section>

      <section id="empezar" className="wb-sec">
        <div className="wb-wrap">
          <SecHead kicker="Cómo empezar" title="Tres pasos y a vigilar" />
          <NumSteps items={[
            ["Recibe tu invitación", "Entras con el código que te pasa alguien del equipo. Sin código no hay registro."],
            ["Conecta Binance", "Pegas una llave de solo lectura. Si tiene permiso de operar o retirar, se rechaza."],
            ["Pon tu capital y tu mínimo", "Desde ahí el panel hace la cuenta cada segundo y solo suena cuando quedan pesos."],
          ]} />
        </div>
      </section>

      <EndBand />
    </>
  );
}
