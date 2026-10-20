import { pageMeta } from "../meta";
import Contenido from "./contenido";

export const metadata = pageMeta("/preguntas", "Preguntas frecuentes",
  "Cómo funciona ArbiCrypto, cómo se conecta a Binance, qué hacer cuando llega un aviso y cómo te ayuda con la renta.");

export default function Page() {
  return <Contenido />;
}
