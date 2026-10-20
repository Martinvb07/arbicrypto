import { pageMeta } from "../meta";
import Contenido from "./contenido";

export const metadata = pageMeta("/renta", "Wallet y renta para la DIAN",
  "La wallet trae tus órdenes de Binance, valora cada permuta con la TRM del día y te arma la declaración de renta de tus cripto, lista para la DIAN.");

export default function Page() {
  return <Contenido />;
}
