import { pageMeta } from "../meta";
import Contenido from "./contenido";

export const metadata = pageMeta("/arbitraje", "Arbitraje P2P y Spot en pesos",
  "Rutas de arbitraje en Binance P2P y Spot calculadas con tu capital, la comisión, el redondeo y el 4x1000, con avisos solo cuando de verdad quedan pesos.");

export default function Page() {
  return <Contenido />;
}
