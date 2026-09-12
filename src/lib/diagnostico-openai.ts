import OpenAI from "openai";
import { diagnosticoSinIdentificar } from "./types";
import type { Diagnostico, FuenteWeb, ProveedorWeb } from "./types";

// Espejo de diagnostico.ts pero para visitantes que traen su propia key de
// OpenAI. La Responses API resuelve lo mismo que el tool-use de Anthropic con
// piezas distintas: json_schema en vez de tool_choice forzado, web_search_preview
// en vez de web_search, input_image en vez de un bloque de imagen aparte.

const DIAGNOSTICO_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    categoria: { type: "string" },
    sub_especialidad: { type: "string" },
    urgencia: { type: "string", enum: ["baja", "media", "alta"] },
    certificaciones_requeridas: { type: "array", items: { type: "string" } },
    costo_estimado_min: { type: "number" },
    costo_estimado_max: { type: "number" },
    horas_estimadas: { type: "number" },
    fuente_estimacion: { type: "string", enum: ["base_local", "web_search"] },
  },
  required: [
    "categoria",
    "sub_especialidad",
    "urgencia",
    "certificaciones_requeridas",
    "costo_estimado_min",
    "costo_estimado_max",
    "horas_estimadas",
    "fuente_estimacion",
  ],
};

const PROVEEDORES_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    proveedores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          nombre: { type: "string" },
          telefono: { type: ["string", "null"] },
          direccion: { type: ["string", "null"] },
          url: { type: ["string", "null"] },
        },
        // El modo strict de OpenAI exige que todo campo declarado este en
        // required; los opcionales se expresan con union a null, no omitiendolos.
        required: ["nombre", "telefono", "direccion", "url"],
      },
    },
  },
  required: ["proveedores"],
};

type DiagnosticarInputOpenAI = {
  texto?: string;
  imagenBase64?: string;
};

export async function diagnosticarOpenAI(
  input: DiagnosticarInputOpenAI,
  apiKey: string,
  modelo: string,
): Promise<Diagnostico> {
  const client = new OpenAI({ apiKey });
  const imagenDataUrl = aDataUrl(input.imagenBase64);

  const diagnostico = await estructurarDiagnostico(
    client,
    modelo,
    input.texto?.trim() ||
      "Diagnostica el problema observado en la imagen y estima costo/tiempo.",
    imagenDataUrl,
  );

  // Misma logica que con Claude: el schema empuja al modelo a escaparse con un
  // "no se" antes que arriesgar una categoria en una foto dificil.
  if (!imagenDataUrl || !diagnosticoSinIdentificar(diagnostico)) return diagnostico;

  const descripcion = await describirImagen(client, modelo, imagenDataUrl);
  if (!descripcion) return diagnostico;

  const segundoIntento = await estructurarDiagnostico(
    client,
    modelo,
    `Un tecnico mira la foto del cliente y describe: ${descripcion}. A partir de eso diagnostica el problema y estima costo/tiempo.`,
    imagenDataUrl,
  );

  return diagnosticoSinIdentificar(segundoIntento) ? diagnostico : segundoIntento;
}

async function estructurarDiagnostico(
  client: OpenAI,
  modelo: string,
  texto: string,
  imagenDataUrl: string | null,
): Promise<Diagnostico> {
  const contenido: OpenAI.Responses.ResponseInputMessageContentList = [
    { type: "input_text", text: texto },
  ];

  if (imagenDataUrl) {
    contenido.push({ type: "input_image", image_url: imagenDataUrl, detail: "auto" });
  }

  const respuesta = await client.responses.create({
    model: modelo,
    max_output_tokens: 900,
    input: [
      {
        role: "system",
        content:
          "Sos un agente de diagnostico para un marketplace de servicios en Paraguay. Devolve exclusivamente el JSON del contrato pedido. Estima costos en guaranies paraguayos.",
      },
      { role: "user", content: contenido },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "diagnostico",
        schema: DIAGNOSTICO_JSON_SCHEMA,
        strict: true,
      },
    },
  });

  return validarDiagnostico(parsearJson(respuesta.output_text));
}

// Describir no exige el modelo elegido para el diagnostico principal; esto solo
// corre cuando la primera clasificacion ya fallo.
async function describirImagen(client: OpenAI, modelo: string, imagenDataUrl: string) {
  const respuesta = await client.responses.create({
    model: modelo,
    max_output_tokens: 400,
    input: [
      {
        role: "system",
        content:
          "Describi lo que ves en la foto: materiales, instalaciones, daño visible, humedad, oxido, roturas, y el ambiente. No clasifiques ni des un diagnostico, solo descripcion concreta. Si la foto es ilegible decilo en una linea.",
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "¿Que se ve en esta foto?" },
          { type: "input_image", image_url: imagenDataUrl, detail: "auto" },
        ],
      },
    ],
  });

  return respuesta.output_text.trim() || null;
}

export async function estimarConWebSearchOpenAI(
  diagnostico: Diagnostico,
  apiKey: string,
  modelo: string,
): Promise<{ diagnostico: Diagnostico; fuentes: FuenteWeb[] }> {
  const client = new OpenAI({ apiKey });

  const busqueda = await client.responses.create({
    model: modelo,
    max_output_tokens: 1200,
    input: [
      {
        role: "system",
        content:
          "Sos un agente de diagnostico para un marketplace de servicios en Paraguay. Busca en la web precios y tiempos actuales para el trabajo descrito y resumi los numeros que encuentres, en guaranies paraguayos.",
      },
      {
        role: "user",
        content: `Necesito precio y duracion de mercado para este trabajo: ${JSON.stringify(diagnostico)}. Busca referencias actuales y resumi los rangos encontrados.`,
      },
    ],
    tools: [{ type: "web_search_preview" }],
  });

  const fuentes = extraerFuentes(busqueda);
  const hallazgos = busqueda.output_text.trim();

  if (fuentes.length === 0) {
    return { diagnostico, fuentes };
  }

  const estructurado = await client.responses.create({
    model: modelo,
    max_output_tokens: 700,
    input: [
      {
        role: "system",
        content:
          "Actualiza solamente costo_estimado_min, costo_estimado_max y horas_estimadas segun los hallazgos de la busqueda web. Manten el resto del contrato igual. Devolve el JSON del contrato completo.",
      },
      {
        role: "user",
        content: `Diagnostico local con bajo match: ${JSON.stringify(diagnostico)}\n\nHallazgos de la busqueda web:\n${hallazgos}\n\nDevolve el mismo contrato con costo y horas actualizados.`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "diagnostico",
        schema: DIAGNOSTICO_JSON_SCHEMA,
        strict: true,
      },
    },
  });

  const actualizado = validarDiagnostico(parsearJson(estructurado.output_text));
  return { diagnostico: { ...actualizado, fuente_estimacion: "web_search" }, fuentes };
}

export async function buscarProveedoresWebOpenAI(
  diagnostico: Diagnostico,
  apiKey: string,
  modelo: string,
  ubicacion?: { lat: number; lon: number },
): Promise<ProveedorWeb[]> {
  const client = new OpenAI({ apiKey });

  const cerca = ubicacion
    ? `El cliente esta en las coordenadas ${ubicacion.lat.toFixed(4)}, ${ubicacion.lon.toFixed(4)} (Paraguay).`
    : "El cliente esta en Paraguay, zona de Asuncion y Gran Asuncion.";

  const busqueda = await client.responses.create({
    model: modelo,
    max_output_tokens: 1200,
    input: [
      {
        role: "system",
        content:
          "Busca negocios reales que presten el servicio pedido y que atiendan en Paraguay. Prioriza los que publican telefono. Enumera cada uno con su nombre, telefono, direccion y sitio o perfil, tal como figuran en la fuente. No inventes datos de contacto.",
      },
      {
        role: "user",
        content: `Necesito contactar a alguien que haga: ${diagnostico.categoria} - ${diagnostico.sub_especialidad}. ${cerca} Urgencia ${diagnostico.urgencia}. Busca negocios con telefono publicado y listalos.`,
      },
    ],
    tools: [{ type: "web_search_preview" }],
  });

  const hallazgos = busqueda.output_text.trim();
  if (!hallazgos) return [];

  const estructurado = await client.responses.create({
    model: modelo,
    max_output_tokens: 700,
    input: [
      {
        role: "system",
        content:
          "Extrae los negocios mencionados como JSON. Copia telefono, direccion y url solo si aparecen en el texto; si falta alguno, devolve null en ese campo. Maximo 4 proveedores.",
      },
      {
        role: "user",
        content: `Resultados de la busqueda:\n${hallazgos}\n\nExtrae los negocios con sus datos de contacto.`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "proveedores",
        schema: PROVEEDORES_JSON_SCHEMA,
        strict: true,
      },
    },
  });

  const datos = parsearJson(estructurado.output_text) as { proveedores?: unknown };
  const crudos = Array.isArray(datos.proveedores) ? datos.proveedores : [];

  return crudos
    .filter(isRecord)
    .map((proveedor) => ({
      nombre: String(proveedor.nombre ?? "").trim(),
      telefono: textoOpcional(proveedor.telefono),
      direccion: textoOpcional(proveedor.direccion),
      url: textoOpcional(proveedor.url),
    }))
    .filter((proveedor) => proveedor.nombre.length > 0)
    .slice(0, 4);
}

function extraerFuentes(respuesta: OpenAI.Responses.Response): FuenteWeb[] {
  const fuentes = new Map<string, FuenteWeb>();

  for (const item of respuesta.output) {
    if (item.type !== "message") continue;

    for (const parte of item.content) {
      if (parte.type !== "output_text") continue;

      for (const anotacion of parte.annotations) {
        if (anotacion.type === "url_citation") {
          fuentes.set(anotacion.url, { titulo: anotacion.title, url: anotacion.url });
        }
      }
    }
  }

  return [...fuentes.values()];
}

// OpenAI acepta la imagen tal cual como data URL, a diferencia de Anthropic que
// pide el base64 separado del media_type — no hace falta desarmar el string.
function aDataUrl(imagenBase64?: string) {
  if (!imagenBase64) return null;
  return imagenBase64.startsWith("data:")
    ? imagenBase64
    : `data:image/jpeg;base64,${imagenBase64}`;
}

function parsearJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error("El modelo no devolvio un JSON valido.");
  }
}

function validarDiagnostico(value: unknown): Diagnostico {
  if (!isRecord(value)) {
    throw new Error("Diagnostico invalido: no es un objeto.");
  }

  const diagnostico = {
    categoria: String(value.categoria ?? ""),
    sub_especialidad: String(value.sub_especialidad ?? ""),
    urgencia: normalizarUrgencia(value.urgencia),
    certificaciones_requeridas: Array.isArray(value.certificaciones_requeridas)
      ? value.certificaciones_requeridas.map(String)
      : [],
    costo_estimado_min: Number(value.costo_estimado_min ?? 0),
    costo_estimado_max: Number(value.costo_estimado_max ?? 0),
    horas_estimadas: Number(value.horas_estimadas ?? 0),
    fuente_estimacion:
      value.fuente_estimacion === "web_search" ? "web_search" : "base_local",
  } satisfies Diagnostico;

  if (!diagnostico.categoria || !diagnostico.sub_especialidad) {
    throw new Error("Diagnostico invalido: falta categoria o sub_especialidad.");
  }

  return diagnostico;
}

function normalizarUrgencia(value: unknown): Diagnostico["urgencia"] {
  return value === "alta" || value === "media" || value === "baja" ? value : "media";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textoOpcional(valor: unknown) {
  const texto = typeof valor === "string" ? valor.trim() : "";
  return texto.length > 0 ? texto : null;
}
