export type ProveedorIA = "anthropic" | "openai";

export interface ConfiguracionIA {
  proveedor: ProveedorIA;
  modelo: string;
  apiKey: string;
}

// Modelos verificados contra la documentacion vigente de Anthropic. Para OpenAI
// no hay un catalogo verificado en este entorno, asi que el modelo se escribe a
// mano en vez de ofrecer una lista que podria estar desactualizada o inventada.
export const MODELOS_ANTHROPIC = [
  { id: "claude-sonnet-5", nombre: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", nombre: "Claude Haiku 4.5 (mas barato)" },
];

const LLAVE_LOCALSTORAGE = "servicia:configuracion-ia";

export function leerConfiguracionGuardada(): ConfiguracionIA | null {
  if (typeof window === "undefined") return null;

  try {
    const crudo = window.localStorage.getItem(LLAVE_LOCALSTORAGE);
    if (!crudo) return null;

    const datos = JSON.parse(crudo) as Partial<ConfiguracionIA>;
    if (!datos.apiKey || !datos.modelo) return null;
    if (datos.proveedor !== "anthropic" && datos.proveedor !== "openai") return null;

    return { proveedor: datos.proveedor, modelo: datos.modelo, apiKey: datos.apiKey };
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
export function configuracionDelServidor(): ConfiguracionIA | undefined {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelo = process.env.OPENAI_MODELO;

  if (process.env.IA_PROVEEDOR === "openai" && apiKey && modelo) {
    return { proveedor: "openai", modelo, apiKey };
  }

  return undefined;
}

// Server-side: valida lo que llega en el body de un request. Nunca se loguea ni
// se persiste — se usa una vez, para las llamadas de ese request, y se descarta.
export function leerConfiguracionDelBody(valor: unknown): ConfiguracionIA | undefined {
  if (typeof valor !== "object" || valor === null) return undefined;

  const datos = valor as Partial<ConfiguracionIA>;
  if (typeof datos.apiKey !== "string" || datos.apiKey.trim().length === 0) return undefined;
  if (typeof datos.modelo !== "string" || datos.modelo.trim().length === 0) return undefined;
  if (datos.proveedor !== "anthropic" && datos.proveedor !== "openai") return undefined;

  return { proveedor: datos.proveedor, modelo: datos.modelo.trim(), apiKey: datos.apiKey.trim() };
}
