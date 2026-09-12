import { buscarProveedoresWeb } from "@/lib/diagnostico";
import { leerConfiguracionDelBody } from "@/lib/ia-config";
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
    };

    if (!body.diagnostico?.categoria) {
      return Response.json({ proveedores: [] });
    }

    const proveedores = await buscarProveedoresWeb(
      body.diagnostico,
      body.ubicacion,
      leerConfiguracionDelBody(body.configuracionIA),
    );

    return Response.json({ proveedores });
  } catch {
    return Response.json({ proveedores: [] });
  }
}
