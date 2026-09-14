import { estimarConWebSearch } from "@/lib/diagnostico";
import { diagnosticarConCache } from "@/lib/diagnostico-cache";
import { configuracionDelServidor, leerConfiguracionDelBody, normalizarModoIA } from "@/lib/ia-config";
import { limitarPorIp } from "@/lib/limite-uso";
import { encontrarMatches, type UbicacionCliente } from "@/lib/matching";
import type { OrquestacionResultado } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      texto?: string;
      imagenBase64?: string;
      ubicacion?: UbicacionCliente;
      configuracionIA?: unknown;
      modoIA?: unknown;
    };

    if (!body.texto?.trim() && !body.imagenBase64) {
      return Response.json(
        { error: "Describe el problema o subi una foto." },
        { status: 400 },
      );
    }

    if (body.configuracionIA == null) {
      const bloqueo = limitarPorIp(request, "diagnostico");
      if (bloqueo) return bloqueo;
    }

    // Si el visitante cargo su propia key en el panel de configuracion, viaja en
    // el body de este request y se usa solo para el; nunca se guarda del lado
    // del servidor. Sin eso, se usa la key del equipo (variable de entorno).
    const modo = normalizarModoIA(body.modoIA);
    const configuracionIA =
      leerConfiguracionDelBody(body.configuracionIA) ?? configuracionDelServidor(modo);

    const diagnosticoInicial = await diagnosticarConCache(body, configuracionIA, modo, request.signal);
    const ubicacionCliente = esUbicacionValida(body.ubicacion)
      ? body.ubicacion
      : undefined;
    const resultadoMatching = await encontrarMatches(
      diagnosticoInicial,
      ubicacionCliente,
      modo === "economico",
    );
    // El mismo plazo cancela ambos pasos del enriquecimiento, no solo la espera.
    const estimacionWeb = modo === "completo" && resultadoMatching.fallback_web
      ? await estimarConWebSearch(
          diagnosticoInicial,
          configuracionIA,
          AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
        ).catch(() => null)
      : null;

    const resultado: OrquestacionResultado = {
      diagnostico: estimacionWeb?.diagnostico ?? diagnosticoInicial,
      matches: resultadoMatching.matches,
      fallback_web: resultadoMatching.fallback_web,
      fuentes_web: estimacionWeb?.fuentes ?? [],
      proveedores_web: [],
    };

    return Response.json(resultado);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo ejecutar el diagnostico.";

    return Response.json({ error: message }, { status: 500 });
  }
}

function esUbicacionValida(ubicacion?: UbicacionCliente): ubicacion is UbicacionCliente {
  return (
    typeof ubicacion?.lat === "number" &&
    Number.isFinite(ubicacion.lat) &&
    typeof ubicacion.lon === "number" &&
    Number.isFinite(ubicacion.lon)
  );
}
