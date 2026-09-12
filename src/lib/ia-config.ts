export type ProveedorIA = "anthropic" | "openai";
export type ModoIA = "economico" | "completo";

export const MODELO_OPENAI_ECONOMICO = "gpt-5-nano";
export const MODELO_ANTHROPIC_ECONOMICO = "claude-haiku-4-5";

// Catalogo de modelos con vision y salida estructurada, verificado en OpenAI Docs.
export const MODELOS_OPENAI = [
  { id: "gpt-5-nano", nombre: "GPT-5 nano (economico)" },
  { id: "gpt-4o-mini", nombre: "GPT-4o mini" },
  { id: "gpt-5.4-nano", nombre: "GPT-5.4 nano" },
  { id: "gpt-5.4-mini", nombre: "GPT-5.4 mini" },
];

export function normalizarModoIA(valor: unknown): ModoIA {
  return valor === "completo" ? "completo" : "economico";
}

export interface ConfiguracionIA {
  proveedor: ProveedorIA;
  modelo: string;
  apiKey: string;
}

export const MODELOS_ANTHROPIC = [
  { id: "claude-sonnet-5", nombre: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", nombre: "Claude Haiku 4.5 (mas barato)" },
];

const LLAVE_LOCALSTORAGE = "servicia:configuracion-ia";
const LLAVE_MODO = "servicia:modo-ia";

export function leerModoGuardado(): ModoIA {
  if (typeof window === "undefined") return "economico";
  try {
    return normalizarModoIA(window.localStorage.getItem(LLAVE_MODO));
  } catch {
    return "economico";
  }
}

export function guardarModo(modo: ModoIA) {
  window.localStorage.setItem(LLAVE_MODO, modo);
}

export function leerConfiguracionGuardada(): ConfiguracionIA | null {
  if (typeof window === "undefined") return null;

  try {
    const crudo = window.localStorage.getItem(LLAVE_LOCALSTORAGE);
    if (!crudo) return null;

    return leerConfiguracionDelBody(JSON.parse(crudo)) ?? null;
  } catch {
    return null;
  }
}

export function guardarConfiguracion(config: ConfiguracionIA | null) {
  if (typeof window === "undefined") return;

  if (!config) {
    window.localStorage.removeItem(LLAVE_LOCALSTORAGE);
    return;
  }

  window.localStorage.setItem(LLAVE_LOCALSTORAGE, JSON.stringify(config));
}

// Default del servidor cuando el visitante no trajo su propia key. Sin estas
// variables se usa ANTHROPIC_API_KEY como siempre; con ellas, el deploy entero
// pasa a OpenAI, que es lo que permite mover la demo a la cuenta que tenga
// credito sin tocar codigo.
export function configuracionDelServidor(modo: ModoIA = "economico"): ConfiguracionIA | undefined {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelo = process.env.OPENAI_MODELO || MODELO_OPENAI_ECONOMICO;

  if (process.env.IA_PROVEEDOR === "openai" && apiKey) {
    return { proveedor: "openai", modelo, apiKey };
  }

  if (process.env.IA_PROVEEDOR === "openai") {
    throw new Error("Falta OPENAI_API_KEY en el servidor o tu propia key en configuracion.");
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      proveedor: "anthropic",
      modelo: modo === "economico" ? MODELO_ANTHROPIC_ECONOMICO : "claude-sonnet-5",
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }

  return undefined;
}

// Server-side: valida lo que llega en el body de un request. Nunca se loguea ni
// se persiste — se usa una vez, para las llamadas de ese request, y se descarta.
export function leerConfiguracionDelBody(valor: unknown): ConfiguracionIA | undefined {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor !== "object") throw new Error("Configuracion de IA invalida.");

  const datos = valor as Partial<ConfiguracionIA>;
  if (
    typeof datos.apiKey !== "string" || !datos.apiKey.trim() ||
    typeof datos.modelo !== "string" || !datos.modelo.trim() ||
    (datos.proveedor !== "anthropic" && datos.proveedor !== "openai")
  ) throw new Error("Completa el proveedor, modelo y API key de tu configuracion.");

  return { proveedor: datos.proveedor, modelo: datos.modelo.trim(), apiKey: datos.apiKey.trim() };
}
