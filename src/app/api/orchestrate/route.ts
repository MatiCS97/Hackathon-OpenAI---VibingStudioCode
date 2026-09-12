import {
  buscarProveedoresWeb,
  diagnosticar,
  estimarConWebSearch,
} from "@/lib/diagnostico";
import { encontrarMatches, type UbicacionCliente } from "@/lib/matching";
import type { OrquestacionResultado } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      texto?: string;
      imagenBase64?: string;
      ubicacion?: UbicacionCliente;
    };

    if (!body.texto?.trim() && !body.imagenBase64) {
      return Response.json(
        { error: "Describe el problema o subi una foto." },
        { status: 400 },
      );
    }

    const diagnosticoInicial = await diagnosticar(body);
    const ubicacionCliente = esUbicacionValida(body.ubicacion)
      ? body.ubicacion
      : undefined;
    const resultadoMatching = await encontrarMatches(
      diagnosticoInicial,
      ubicacionCliente,
    );
    // Sin nadie en la base, un precio de referencia no le sirve al cliente: lo que
    // necesita es un telefono. Las dos busquedas van en paralelo para no sumar
    // latencia una arriba de la otra.
    // Las dos son mejoras sobre el diagnostico, no el diagnostico: si una falla
    // el cliente igual tiene que recibir lo que ya se calculo.
    const [estimacionWeb, proveedoresWeb] = await Promise.all([
      resultadoMatching.fallback_web
        ? estimarConWebSearch(diagnosticoInicial).catch(() => null)
        : null,
      resultadoMatching.matches.length === 0
        ? buscarProveedoresWeb(diagnosticoInicial, ubicacionCliente).catch(() => [])
        : [],
    ]);

    const resultado: OrquestacionResultado = {
      diagnostico: estimacionWeb?.diagnostico ?? diagnosticoInicial,
      matches: resultadoMatching.matches,
      fallback_web: resultadoMatching.fallback_web,
      fuentes_web: estimacionWeb?.fuentes ?? [],
      proveedores_web: proveedoresWeb,
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
