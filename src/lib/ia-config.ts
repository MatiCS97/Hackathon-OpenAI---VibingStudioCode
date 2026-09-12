export type ProveedorIA = "anthropic" | "openai" | "gemini" | "openrouter";
// Gemini y OpenRouter hablan el dialecto de OpenAI: mismo SDK, otra baseURL.
export type ProveedorCompatible = "gemini" | "openrouter";
export type ModoIA = "economico" | "completo";

export const BASE_URL_COMPATIBLE: Record<ProveedorCompatible, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  openrouter: "https://openrouter.ai/api/v1",
};

export function esCompatible(proveedor: ProveedorIA): proveedor is ProveedorCompatible {
  return proveedor === "gemini" || proveedor === "openrouter";
}

export const MODELO_OPENAI_ECONOMICO = "gpt-5-nano";
export const MODELO_ANTHROPIC_ECONOMICO = "claude-haiku-4-5";
export const MODELO_ANTHROPIC_COMPLETO = "claude-sonnet-5";

// Catalogos de modelos con vision y salida estructurada. Anthropic y OpenAI
// salen de sus docs. Los de Gemini y OpenRouter estan verificados uno por uno
// contra sus /models el 12/09/2026, con una foto real y json_schema estricto: la
// pagina de docs de Gemini lista modelos que su propia API no sirve. Ambos
// catalogos rotan seguido, por eso el panel siempre deja escribir un slug a mano.
export const MODELOS_POR_PROVEEDOR: Record<ProveedorIA, { id: string; nombre: string }[]> = {
  anthropic: [
    { id: MODELO_ANTHROPIC_ECONOMICO, nombre: "Claude Haiku 4.5 (mas barato)" },
    { id: MODELO_ANTHROPIC_COMPLETO, nombre: "Claude Sonnet 5" },
  ],
  openai: [
    { id: MODELO_OPENAI_ECONOMICO, nombre: "GPT-5 nano (economico)" },
    { id: "gpt-4o-mini", nombre: "GPT-4o mini" },
    { id: "gpt-5.4-nano", nombre: "GPT-5.4 nano" },
    { id: "gpt-5.4-mini", nombre: "GPT-5.4 mini" },
  ],
  gemini: [
    { id: "gemini-3.1-flash-lite", nombre: "Gemini 3.1 Flash Lite (economico)" },
    { id: "gemini-3.5-flash-lite", nombre: "Gemini 3.5 Flash Lite" },
    { id: "gemini-flash-lite-latest", nombre: "Gemini Flash Lite (siempre el actual)" },
    { id: "gemini-3.8-flash", nombre: "Gemini 3.8 Flash" },
  ],
  openrouter: [
    { id: "google/gemini-3.8-flash", nombre: "Gemini 3.8 Flash (vision, barato)" },
    { id: "qwen/qwen3.8-flash", nombre: "Qwen3.8 Flash (vision, barato)" },
    { id: "inclusionai/ling-3.0-flash-vl", nombre: "Ling 3.0 Flash VL (vision)" },
    { id: "inclusionai/ling-3.0-flash-vl:free", nombre: "Ling 3.0 Flash VL (gratis)" },
  ],
};

export const MODELO_ECONOMICO_POR_PROVEEDOR: Record<ProveedorIA, string> = {
  anthropic: MODELO_ANTHROPIC_ECONOMICO,
  openai: MODELO_OPENAI_ECONOMICO,
  gemini: "gemini-3.1-flash-lite",
  openrouter: "google/gemini-3.8-flash",
};

export const NOMBRE_PROVEEDOR: Record<ProveedorIA, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
};

// Cada proveedor lee su propia variable. Gemini reusa la misma GEMINI_API_KEY
// que ya alimenta los embeddings del matching, asi que IA_PROVEEDOR=gemini no
// obliga a dar de alta ninguna cuenta nueva.
const VARIABLE_DE_KEY: Record<ProveedorIA, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export function esProveedorIA(valor: unknown): valor is ProveedorIA {
  return typeof valor === "string" && Object.hasOwn(VARIABLE_DE_KEY, valor);
}

export function normalizarModoIA(valor: unknown): ModoIA {
  return valor === "completo" ? "completo" : "economico";
}

export interface ConfiguracionIA {
  proveedor: ProveedorIA;
  modelo: string;
  apiKey: string;
}

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

// Default del servidor cuando el visitante no trajo su propia key. Sin
// IA_PROVEEDOR se usa ANTHROPIC_API_KEY como siempre; con ella, el deploy entero
// pasa al proveedor elegido, que es lo que permite mover la demo a la cuenta que
// tenga credito sin tocar codigo.
export function configuracionDelServidor(modo: ModoIA = "economico"): ConfiguracionIA | undefined {
  const elegido = process.env.IA_PROVEEDOR;

  if (elegido) {
    if (!esProveedorIA(elegido)) {
      throw new Error(
        `IA_PROVEEDOR desconocido: ${elegido}. Validos: ${Object.keys(VARIABLE_DE_KEY).join(", ")}.`,
      );
    }

    const variable = VARIABLE_DE_KEY[elegido];
    const apiKey = process.env[variable];
    if (!apiKey) {
      throw new Error(`Falta ${variable} en el servidor o tu propia key en configuracion.`);
    }

    return { proveedor: elegido, modelo: modeloDelServidor(elegido, modo), apiKey };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      proveedor: "anthropic",
      modelo: modeloDelServidor("anthropic", modo),
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }

  return undefined;
}

// IA_MODELO sirve para cualquier proveedor; OPENAI_MODELO se sigue leyendo
// porque ya quedo puesta en los deploys hechos antes de que existiera la generica.
function modeloDelServidor(proveedor: ProveedorIA, modo: ModoIA) {
  const pedido = process.env.IA_MODELO || (proveedor === "openai" ? process.env.OPENAI_MODELO : undefined);
  if (pedido) return pedido;

  if (proveedor === "anthropic" && modo === "completo") return MODELO_ANTHROPIC_COMPLETO;
  return MODELO_ECONOMICO_POR_PROVEEDOR[proveedor];
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
    !esProveedorIA(datos.proveedor)
  ) throw new Error("Completa el proveedor, modelo y API key de tu configuracion.");

  return { proveedor: datos.proveedor, modelo: datos.modelo.trim(), apiKey: datos.apiKey.trim() };
}
