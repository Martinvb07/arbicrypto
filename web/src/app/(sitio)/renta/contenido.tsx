"use client";

import { Cards, EndBand, Form210, LOGIN, PageHero, Pill, SecHead, Split } from "../sitio";

export default function Contenido() {
  return (
    <>
      <PageHero kicker="Producto · Wallet" title={<>Tu renta en cripto,<br />lista para la DIAN.</>} cta={false}
        lead="La wallet trae tus órdenes de Binance sola, le encuentra la compra a cada venta y te arma el formulario con un Excel explicado en palabras sencillas.">
        <Form210 />
      </PageHero>

      <section className="wb-sec">
        <div className="wb-wrap">
          <SecHead kicker="Qué hace" title="La contabilidad que nadie quiere hacer" />
          <Cards items={[
            { ic: "download", h: "Trae tus órdenes", p: "Directo de Binance con tu llave de solo lectura, o subiendo el PDF o Excel del historial." },
            { ic: "layers", h: "Compra de cada venta", p: "Le encuentra el costo a cada venta, para saber cuánto ganaste de verdad." },
            { ic: "calendar", h: "TRM del día", p: "Cada permuta entre monedas se valora en pesos con la TRM de ese día." },
            { ic: "bank", h: "4x1000 real", p: "Según lo que de verdad te cobra tu banco, y cuánto es deducible." },
            { ic: "book", h: "Kardex y PUC", p: "Los libros con cuentas del PUC que pide tu contador." },
            { ic: "badgeCheck", h: "Comprobaciones", p: "Te dice si todo cuadra antes de declarar." },
          ]} />
        </div>
      </section>

      <Split kicker="Al cierre" title={<>Descargas todo<br />en un clic</>}
        art={<Cards cols={2} items={[
          { ic: "receipt", h: "Excel explicado", p: "Cada cifra con su porqué, en palabras sencillas." },
          { ic: "users", h: "Para tu contador", p: "El paquete completo con libros y soportes." },
        ]} />}>
        <p>Patrimonio en cripto a 31 de diciembre, ingresos por ventas, costos de lo vendido, 4x1000 deducible y ganancia ocasional,
          con el Estatuto Tributario y el Concepto Unificado DIAN 1621 de 2023.</p>
        <p className="wb-note">Es un cálculo informativo: revísalo con tu contador antes de declarar.</p>
        <div className="wb-cta"><Pill href={LOGIN.wallet}>Entrar a mi wallet</Pill></div>
      </Split>

      <EndBand title="Declara tranquilo." text="Tu wallet hace las cuentas; tú solo las revisas con tu contador." />
    </>
  );
}
