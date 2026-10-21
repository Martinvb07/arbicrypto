import { pageMeta } from "../meta";
import Contenido from "./contenido";

export const metadata = pageMeta("/calculadora", "Calculadora de arbitraje P2P",
  "Pon un monto y mira cuánto te quedaría hoy comprando y vendiendo en Binance P2P, después de la comisión y el 4x1000, con los precios en vivo.");

export default function Page() {
  return <Contenido />;
}
