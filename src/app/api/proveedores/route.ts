import { buscarProveedoresWeb } from "@/lib/diagnostico";
import { configuracionDelServidor, leerConfiguracionDelBody, normalizarModoIA } from "@/lib/ia-config";
import type { UbicacionCliente } from "@/lib/matching";
import type { Diagnostico } from "@/lib/types";

// Buscar negocios en la web tarda ~30s contra los 3s del diagnostico. Va en su
// propio endpoint para que la pantalla muestre el diagnostico apenas esta y los
// telefonos aparezcan cuando llegan, en vez de hacer esperar todo junto.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      diagnostico?: Diagnostico;
      ubicacion?: UbicacionCliente;
      configuracionIA?: unknown;
      modoIA?: unknown;
    };

    const modo = normalizarModoIA(body.modoIA);
    if (modo === "economico" || !body.diagnostico?.categoria) {
      return Response.json({ proveedores: [] });
    }

    const proveedores = await buscarProveedoresWeb(
      body.diagnostico,
      body.ubicacion,
      leerConfiguracionDelBody(body.configuracionIA) ?? configuracionDelServidor(modo),
      AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    );

    return Response.json({ proveedores });
  } catch {
    return Response.json({ proveedores: [] });
  }
}
