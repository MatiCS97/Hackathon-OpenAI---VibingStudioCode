import { diagnosticar, estimarConWebSearch } from "@/lib/diagnostico";
import { encontrarMatches } from "@/lib/matching";
import type { OrquestacionResultado } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      texto?: string;
      imagenBase64?: string;
    };

    if (!body.texto?.trim() && !body.imagenBase64) {
      return Response.json(
        { error: "Describe el problema o subi una foto." },
        { status: 400 },
      );
    }

    const diagnosticoInicial = await diagnosticar(body);
    const resultadoMatching = await encontrarMatches(diagnosticoInicial);
    const diagnostico = resultadoMatching.fallback_web
      ? await estimarConWebSearch(diagnosticoInicial)
      : diagnosticoInicial;

    const resultado: OrquestacionResultado = {
      diagnostico,
      matches: resultadoMatching.matches,
      fallback_web: resultadoMatching.fallback_web,
    };

    return Response.json(resultado);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo ejecutar el diagnostico.";

    return Response.json({ error: message }, { status: 500 });
  }
}
