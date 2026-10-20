import { pageMeta } from "../meta";
import Contenido from "./contenido";

export const metadata = pageMeta("/precios", "Precios P2P en vivo en pesos",
  "Lo que cuesta comprar y lo que recibes al vender USDT, BTC, ETH y más en Binance P2P, en pesos colombianos y en vivo.");

export default function Page() {
  return <Contenido />;
}
