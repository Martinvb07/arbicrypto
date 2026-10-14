import type { AccountKind } from "./api";

/** Entidad financiera de Colombia: colores de su marca para el logo y el tipo de cuenta más común. */
export interface Institution {
  id: string;
  name: string;
  /** Texto del logo (monograma) */
  mark: string;
  bg: string;
  fg: string;
  group: "banco" | "digital";
  kind: AccountKind;
  /** Palabras con las que se reconoce en el nombre de la cuenta */
  alias: string[];
}

const b = (id: string, name: string, mark: string, bg: string, fg: string, alias: string[], group: Institution["group"] = "banco",
  kind: AccountKind = group === "banco" ? "ahorros" : "billetera"): Institution => ({ id, name, mark, bg, fg, group, kind, alias });

/** Bancos, billeteras y neobancos que más se usan en Colombia. */
export const INSTITUTIONS: Institution[] = [
  b("bancolombia", "Bancolombia", "B", "#FDDA24", "#1A1A1A", ["bancolombia"]),
  b("davivienda", "Davivienda", "D", "#ED1C27", "#FFFFFF", ["davivienda"]),
  b("bogota", "Banco de Bogotá", "BB", "#0B2F6B", "#FFFFFF", ["bogota", "bogotá"]),
  b("bbva", "BBVA", "BBVA", "#004481", "#FFFFFF", ["bbva"]),
  b("occidente", "Banco de Occidente", "BO", "#0A4DA2", "#FFFFFF", ["occidente"]),
  b("popular", "Banco Popular", "BP", "#00843D", "#FFFFFF", ["popular"]),
  b("avvillas", "Banco AV Villas", "AV", "#003DA5", "#FFFFFF", ["av villas", "avvillas"]),
  b("cajasocial", "Banco Caja Social", "CS", "#005EB8", "#FFFFFF", ["caja social"]),
  b("colpatria", "Scotiabank Colpatria", "SC", "#EC111A", "#FFFFFF", ["colpatria", "scotiabank"]),
  b("itau", "Itaú", "itaú", "#EC7000", "#FFFFFF", ["itau", "itaú"]),
  b("agrario", "Banco Agrario", "BA", "#00703C", "#FFE14D", ["agrario"]),
  b("gnb", "GNB Sudameris", "GNB", "#0B2C5F", "#FFFFFF", ["gnb", "sudameris"]),
  b("falabella", "Banco Falabella", "F", "#3F9B35", "#FFFFFF", ["falabella"]),
  b("pichincha", "Banco Pichincha", "P", "#FFD100", "#0F265C", ["pichincha"]),
  b("bancoomeva", "Bancoomeva", "BC", "#00843D", "#FFFFFF", ["bancoomeva", "coomeva"]),
  b("serfinanza", "Banco Serfinanza", "S", "#E4002B", "#FFFFFF", ["serfinanza"]),
  b("finandina", "Banco Finandina", "Fi", "#00A0DF", "#FFFFFF", ["finandina"]),
  b("santander", "Banco Santander", "S", "#EC0000", "#FFFFFF", ["santander"]),
  b("bancow", "Banco W", "W", "#E6007E", "#FFFFFF", ["banco w"]),
  b("mundomujer", "Banco Mundo Mujer", "MM", "#E5007D", "#FFFFFF", ["mundo mujer"]),
  b("bancamia", "Bancamía", "Bm", "#F39200", "#FFFFFF", ["bancamia", "bancamía"]),
  b("coopcentral", "Banco Coopcentral", "CC", "#00965E", "#FFFFFF", ["coopcentral"]),
  b("confiar", "Confiar Cooperativa", "C", "#E30613", "#FFFFFF", ["confiar"]),
  b("jfk", "JFK Cooperativa", "JFK", "#00529B", "#FFFFFF", ["jfk"]),
  b("nequi", "Nequi", "N", "#210049", "#FF2D93", ["nequi"], "digital"),
  b("daviplata", "Daviplata", "DP", "#E30613", "#FFFFFF", ["daviplata"], "digital"),
  b("nu", "Nu Colombia", "nu", "#820AD1", "#FFFFFF", ["nu ", "nubank", "nu colombia"], "digital", "ahorros"),
  b("lulo", "Lulo Bank", "L", "#D7F205", "#111111", ["lulo"], "digital", "ahorros"),
  b("rappipay", "RappiPay", "R", "#FF441F", "#FFFFFF", ["rappi"], "digital"),
  b("movii", "Movii", "M", "#5B2C8F", "#FFFFFF", ["movii"], "digital"),
  b("dale", "dale!", "d!", "#00B5AD", "#FFFFFF", ["dale"], "digital"),
  b("uala", "Ualá", "U", "#3564FD", "#FFFFFF", ["uala", "ualá"], "digital"),
  b("ban100", "Ban100", "100", "#F28C00", "#FFFFFF", ["ban100"], "digital", "ahorros"),
  b("global66", "Global66", "G", "#0F2B5B", "#2BD4C1", ["global66", "global 66"], "digital"),
  b("powwi", "Powwi", "P", "#00A9E0", "#FFFFFF", ["powwi"], "digital"),
  b("tpaga", "Tpaga", "T", "#00C389", "#FFFFFF", ["tpaga"], "digital"),
];

const norm = (s: string) => ` ${s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;

/** Reconoce la entidad por el nombre que le diste a la cuenta ("Bancolombia ahorros" → Bancolombia). */
export function institutionOf(name: string): Institution | undefined {
  const n = norm(name);
  // primero los nombres más largos: "daviplata" antes que "davivienda", "banco w" antes que otros
  let best: Institution | undefined;
  let len = 0;
  for (const i of INSTITUTIONS) {
    for (const a of i.alias) {
      const k = norm(a).trim();
      if (k.length > len && (n.includes(` ${k} `) || n.includes(` ${k}`) && k.length >= 4)) { best = i; len = k.length; }
    }
  }
  return best;
}
