import { diagnosticar, estimarConWebSearch } from "@/lib/diagnostico";
import { configuracionDelServidor, leerConfiguracionDelBody } from "@/lib/ia-config";
import { encontrarMatches, type UbicacionCliente } from "@/lib/matching";
import type { OrquestacionResultado } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      texto?: string;
      imagenBase64?: string;
      ubicacion?: UbicacionCliente;
      configuracionIA?: unknown;
    };

    if (!body.texto?.trim() && !body.imagenBase64) {
      return Response.json(
        { error: "Describe el problema o subi una foto." },
        { status: 400 },
      );
    }

    // Si el visitante cargo su propia key en el panel de configuracion, viaja en
    // el body de este request y se usa solo para el; nunca se guarda del lado
    // del servidor. Sin eso, se usa la key del equipo (variable de entorno).
    const configuracionIA =
      leerConfiguracionDelBody(body.configuracionIA) ?? configuracionDelServidor();

    const diagnosticoInicial = await diagnosticar(body, configuracionIA);
    const ubicacionCliente = esUbicacionValida(body.ubicacion)
      ? body.ubicacion
      : undefined;
    const resultadoMatching = await encontrarMatches(
      diagnosticoInicial,
      ubicacionCliente,
    );
    // La estimacion web corrige el costo del propio diagnostico, asi que no puede
    // diferirse; el techo evita que una busqueda lenta bloquee la pantalla. Los
    // telefonos de proveedores viven en /api/proveedores por lo contrario: son un
    // extra y no vale la pena hacer esperar el diagnostico por ellos.
    const estimacionWeb = resultadoMatching.fallback_web
      ? await conTecho(estimarConWebSearch(diagnosticoInicial, configuracionIA), null)
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
