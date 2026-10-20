import { pageMeta } from "../meta";
import Contenido from "./contenido";

export const metadata = pageMeta("/vender", "Vender sin perder",
  "Anota lo que compraste y a cuánto: ArbiCrypto compara venderlo directo en Binance P2P o pasando por Spot, y te avisa a quién venderle cuando sales ganando.");

export default function Page() {
  return <Contenido />;
}
