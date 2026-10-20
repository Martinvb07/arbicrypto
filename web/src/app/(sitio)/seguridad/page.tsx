import { pageMeta } from "../meta";
import Contenido from "./contenido";

export const metadata = pageMeta("/seguridad", "Seguridad: puede mirar, no puede tocar",
  "ArbiCrypto se conecta a Binance con una llave de solo lectura: no puede operar ni retirar. Tus saldos y órdenes los ves solo tú.");

export default function Page() {
  return <Contenido />;
}
