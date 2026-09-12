import { createHash } from "node:crypto";
import { diagnosticar } from "./diagnostico";
import { diagnosticoSinIdentificar, type Diagnostico } from "./types";
import type { ConfiguracionIA, ModoIA } from "./ia-config";

const cache = new Map<string, { vence: number; diagnostico: Diagnostico }>();
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRADAS = 100;

export async function diagnosticarConCache(
  input: { texto?: string; imagenBase64?: string },
  config: ConfiguracionIA | undefined,
  modo: ModoIA,
  signal?: AbortSignal,
) {
  // La clave se incluye solo en el hash para aislar cuentas; no se conserva.
  const clave = createHash("sha256").update(JSON.stringify([
    config?.proveedor, config?.modelo, config?.apiKey, modo,
    input.texto?.trim(), input.imagenBase64,
  ])).digest("hex");
  const ahora = Date.now();
  for (const [id, item] of cache) {
    if (item.vence <= ahora) cache.delete(id);
  }
  const guardado = cache.get(clave);
  if (guardado) return structuredClone(guardado.diagnostico);

  const diagnostico = await diagnosticar(input, config, modo, signal);
  if (!diagnosticoSinIdentificar(diagnostico)) {
    if (cache.size >= MAX_ENTRADAS) cache.delete(cache.keys().next().value!);
    cache.set(clave, { vence: Date.now() + TTL_MS, diagnostico: structuredClone(diagnostico) });
  }
  return diagnostico;
}
