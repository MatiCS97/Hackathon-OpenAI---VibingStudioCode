import { diagnosticar, estimarConWebSearch } from "@/lib/diagnostico";
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
    const resultadoMatching = await encontrarMatches(
      diagnosticoInicial,
      esUbicacionValida(body.ubicacion) ? body.ubicacion : undefined,
    );
    const estimacionWeb = resultadoMatching.fallback_web
      ? await estimarConWebSearch(diagnosticoInicial)
      : null;

    const resultado: OrquestacionResultado = {
      diagnostico: estimacionWeb?.diagnostico ?? diagnosticoInicial,
      matches: resultadoMatching.matches,
      fallback_web: resultadoMatching.fallback_web,
      fuentes_web: estimacionWeb?.fuentes ?? [],
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
