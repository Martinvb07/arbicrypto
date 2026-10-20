"use client";

import { Cards, EndBand, NumSteps, PageHero, Perms, SecHead } from "../sitio";

export default function Contenido() {
  return (
    <>
      <PageHero kicker="Seguridad" title={<>Puede mirar.<br />No puede tocar.</>}
        lead="ArbiCrypto se conecta a Binance con una llave de solo lectura. Las compras y ventas las haces siempre tú.">
        <Perms />
      </PageHero>

      <section className="wb-sec">
        <div className="wb-wrap">
          <SecHead kicker="Cómo te cuidamos" title="Tu plata sigue siendo tuya" />
          <Cards items={[
            { ic: "key", h: "Llave de solo lectura", p: "Si la llave puede operar o retirar, se rechaza. Se guarda cifrada y la borras cuando quieras." },
            { ic: "eyeOff", h: "Solo tú ves lo tuyo", p: "Saldos, órdenes, wallet y declaración: ni los administradores entran. Lo único compartido es el chat." },
            { ic: "lock", h: "Entrada cuidada", p: "Solo con invitación, contraseñas con PBKDF2 de 600.000 iteraciones, HTTPS y bloqueo a quien intente adivinar." },
          ]} />
        </div>
      </section>

      <section className="wb-sec">
        <div className="wb-wrap">
          <SecHead kicker="Tu llave" title="Crear la llave en Binance" sub="Toma un minuto y no le da a nadie permiso de mover tu plata." />
          <NumSteps items={[
            ["Abre Gestión de API", "En Binance: Perfil → Gestión de API → Crear API, y elige “Generada por el sistema”."],
            ["Deja solo lectura", "No actives trading ni retiros. Si los activas, el panel no acepta la llave."],
            ["Pégala en el panel", "En Mi Binance pegas la llave y el secreto. Desde ahí ves tus saldos y órdenes."],
          ]} />
        </div>
      </section>

      <EndBand />
    </>
  );
}
