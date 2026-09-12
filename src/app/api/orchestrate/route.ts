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
    // o tarda, el cliente igual tiene que recibir lo que ya se calculo. Sin el
    // techo de tiempo una busqueda lenta deja la pantalla cargando mas de un
    // minuto por datos que son un extra.
    const [estimacionWeb, proveedoresWeb] = await Promise.all([
      resultadoMatching.fallback_web
        ? conTecho(estimarConWebSearch(diagnosticoInicial), null)
        : null,
      resultadoMatching.matches.length === 0
        ? conTecho(buscarProveedoresWeb(diagnosticoInicial, ubicacionCliente), [])
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

const TECHO_ENRIQUECIMIENTO_MS = 30_000;

function conTecho<T>(promesa: Promise<T>, siFalla: T): Promise<T> {
  return Promise.race([
    promesa.catch(() => siFalla),
    new Promise<T>((resolver) =>
      setTimeout(() => resolver(siFalla), TECHO_ENRIQUECIMIENTO_MS),
    ),
  ]);
}

function esUbicacionValida(ubicacion?: UbicacionCliente): ubicacion is UbicacionCliente {
  return (
    typeof ubicacion?.lat === "number" &&
    Number.isFinite(ubicacion.lat) &&
    typeof ubicacion.lon === "number" &&
    Number.isFinite(ubicacion.lon)
  );
}
