import OpenAI from "openai";
import {
  DIAGNOSTICO_JSON_SCHEMA,
  PROVEEDORES_JSON_SCHEMA,
  aDataUrl,
  isRecord,
  parsearJson,
  textoOpcional,
  validarDiagnostico,
} from "./diagnostico-openai";
import { BASE_URL_COMPATIBLE, type ModoIA, type ProveedorCompatible } from "./ia-config";
import { diagnosticoSinIdentificar } from "./types";
import type { Diagnostico, FuenteWeb, ProveedorWeb } from "./types";

// Gemini y OpenRouter exponen el dialecto de OpenAI, pero solo
// /chat/completions: no tienen la Responses API que usa diagnostico-openai.ts,
// asi que no alcanzaba con cambiarle la baseURL a ese modulo. Lo que cambia es
// la envoltura del JSON (response_format en vez de text.format) y la busqueda
// web. El contrato de datos y los validadores son los mismos.

const SISTEMA_DIAGNOSTICO =
  "Sos un agente de diagnostico para un marketplace de servicios en Paraguay. Devolve exclusivamente el JSON del contrato pedido. Estima costos en guaranies paraguayos.";

type Mensajes = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

function cliente(proveedor: ProveedorCompatible, apiKey: string) {
  return new OpenAI({
    apiKey,
    baseURL: BASE_URL_COMPATIBLE[proveedor],
    maxRetries: 0,
    timeout: 30_000,
  });
}

// Sin max_tokens a proposito: varios modelos de OpenRouter razonan antes de
// contestar y un techo bajo los corta a mitad de JSON. El limite real es el
// timeout del cliente, que ademas corta el gasto.
async function pedirJson(
  client: OpenAI,
  proveedor: ProveedorCompatible,
  modelo: string,
  nombre: string,
  esquema: Record<string, unknown>,
  mensajes: Mensajes,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    const respuesta = await client.chat.completions.create({
      model: modelo,
      messages: mensajes,
      response_format: { type: "json_schema", json_schema: { name: nombre, schema: esquema, strict: true } },
    }, { signal });

    registrarUso(proveedor, modelo, respuesta);
    return parsearJson(textoDe(respuesta));
  } catch (error) {
    // El catalogo de OpenRouter es heterogeneo y no todos sus modelos aceptan
    // json_schema; los que no, rechazan el request entero con un 400. Pedir
    // json_object con el esquema en el prompt es el minimo comun denominador
    // que igual devuelve JSON parseable.
    if (!(error instanceof OpenAI.APIError) || error.status !== 400) throw error;

    const respuesta = await client.chat.completions.create({
      model: modelo,
      messages: [
        ...mensajes,
        { role: "system", content: `Devolve unicamente un JSON que cumpla este esquema: ${JSON.stringify(esquema)}` },
      ],
      response_format: { type: "json_object" },
    }, { signal }).catch(() => {
      // El modelo no soporta ninguna de las dos formas: el error util es el
      // primero, que dice que rechazo el formato, no el de la reintentada.
      throw error;
    });

    registrarUso(proveedor, modelo, respuesta);
    return parsearJson(textoDe(respuesta));
  }
}

export async function diagnosticarCompatible(
  input: { texto?: string; imagenBase64?: string },
  proveedor: ProveedorCompatible,
  apiKey: string,
  modelo: string,
  modo: ModoIA = "economico",
  signal?: AbortSignal,
): Promise<Diagnostico> {
  const client = cliente(proveedor, apiKey);
  const imagen = aDataUrl(input.imagenBase64);

  const diagnostico = await estructurarDiagnostico(
    client,
    proveedor,
    modelo,
    input.texto?.trim() || "Diagnostica el problema observado en la imagen y estima costo/tiempo.",
    imagen,
    signal,
  );

  // Misma logica que con Claude y con OpenAI: el schema empuja al modelo a
  // escaparse con un "no se" antes que arriesgar una categoria en una foto
  // dificil, y describirla primero en texto libre le saca esa presion.
  if (modo === "economico" || !imagen || !diagnosticoSinIdentificar(diagnostico)) return diagnostico;

  const descripcion = await describirImagen(client, modelo, imagen, signal);
  if (!descripcion) return diagnostico;

  const segundoIntento = await estructurarDiagnostico(
    client,
    proveedor,
    modelo,
    `Un tecnico mira la foto del cliente y describe: ${descripcion}. A partir de eso diagnostica el problema y estima costo/tiempo.`,
    null,
    signal,
  );

  return diagnosticoSinIdentificar(segundoIntento) ? diagnostico : segundoIntento;
}

async function estructurarDiagnostico(
  client: OpenAI,
  proveedor: ProveedorCompatible,
  modelo: string,
  texto: string,
  imagenDataUrl: string | null,
  signal?: AbortSignal,
): Promise<Diagnostico> {
  const contenido: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: texto },
  ];

  if (imagenDataUrl) {
    contenido.push({ type: "image_url", image_url: { url: imagenDataUrl } });
  }

  return validarDiagnostico(
    await pedirJson(client, proveedor, modelo, "diagnostico", DIAGNOSTICO_JSON_SCHEMA, [
      { role: "system", content: SISTEMA_DIAGNOSTICO },
      { role: "user", content: contenido },
    ], signal),
  );
}

async function describirImagen(
  client: OpenAI,
  modelo: string,
  imagenDataUrl: string,
  signal?: AbortSignal,
) {
  const respuesta = await client.chat.completions.create({
    model: modelo,
    messages: [
      {
        role: "system",
        content:
          "Describi lo que ves en la foto: materiales, instalaciones, daño visible, humedad, oxido, roturas, y el ambiente. No clasifiques ni des un diagnostico, solo descripcion concreta. Si la foto es ilegible decilo en una linea.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "¿Que se ve en esta foto?" },
          { type: "image_url", image_url: { url: imagenDataUrl } },
        ],
      },
    ],
  }, { signal });

  return textoDe(respuesta) || null;
}

export async function estimarConWebSearchCompatible(
  diagnostico: Diagnostico,
  proveedor: ProveedorCompatible,
  apiKey: string,
  modelo: string,
  signal?: AbortSignal,
): Promise<{ diagnostico: Diagnostico; fuentes: FuenteWeb[] }> {
  // La capa OpenAI de Gemini no expone ninguna tool de busqueda, asi que no hay
  // con que respaldar la estimacion: se devuelve la local sin mentir sobre su
  // origen, igual que cuando la busqueda no trae fuentes.
  if (proveedor !== "openrouter") return { diagnostico, fuentes: [] };

  const client = cliente(proveedor, apiKey);
  const busqueda = await client.chat.completions.create({
    model: conBusquedaWeb(modelo),
    messages: [
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
  }, { signal });

  const fuentes = extraerFuentes(busqueda);
  const hallazgos = textoDe(busqueda);
  if (fuentes.length === 0) return { diagnostico, fuentes };

  const actualizado = validarDiagnostico(
    await pedirJson(client, proveedor, modelo, "diagnostico", DIAGNOSTICO_JSON_SCHEMA, [
      {
        role: "system",
        content:
          "Actualiza solamente costo_estimado_min, costo_estimado_max y horas_estimadas segun los hallazgos de la busqueda web. Manten el resto del contrato igual. Devolve el JSON del contrato completo.",
      },
      {
        role: "user",
        content: `Diagnostico local con bajo match: ${JSON.stringify(diagnostico)}\n\nHallazgos de la busqueda web:\n${hallazgos}\n\nDevolve el mismo contrato con costo y horas actualizados.`,
      },
    ], signal),
  );

  return { diagnostico: { ...actualizado, fuente_estimacion: "web_search" }, fuentes };
}

export async function buscarProveedoresWebCompatible(
  diagnostico: Diagnostico,
  proveedor: ProveedorCompatible,
  apiKey: string,
  modelo: string,
  ubicacion?: { lat: number; lon: number },
  signal?: AbortSignal,
): Promise<ProveedorWeb[]> {
  // Sin busqueda web no hay telefonos que traer: inventarlos seria peor que no
  // mostrar ninguno, porque el cliente llamaria a un numero que no existe.
  if (proveedor !== "openrouter") return [];

  const client = cliente(proveedor, apiKey);
  const cerca = ubicacion
    ? `El cliente esta en las coordenadas ${ubicacion.lat.toFixed(4)}, ${ubicacion.lon.toFixed(4)} (Paraguay).`
    : "El cliente esta en Paraguay, zona de Asuncion y Gran Asuncion.";

  const busqueda = await client.chat.completions.create({
    model: conBusquedaWeb(modelo),
    messages: [
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
  }, { signal });

  const hallazgos = textoDe(busqueda);
  if (!hallazgos) return [];

  const datos = await pedirJson(client, proveedor, modelo, "proveedores", PROVEEDORES_JSON_SCHEMA, [
    {
      role: "system",
      content:
        "Extrae los negocios mencionados como JSON. Copia telefono, direccion y url solo si aparecen en el texto; si falta alguno, devolve null en ese campo. Maximo 4 proveedores.",
    },
    {
      role: "user",
      content: `Resultados de la busqueda:\n${hallazgos}\n\nExtrae los negocios con sus datos de contacto.`,
    },
  ], signal) as { proveedores?: unknown };

  const crudos = Array.isArray(datos?.proveedores) ? datos.proveedores : [];

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

// En OpenRouter la busqueda web se activa con el sufijo :online sobre el mismo
// slug del modelo (va al final, incluso despues de :free).
function conBusquedaWeb(modelo: string) {
  return modelo.endsWith(":online") ? modelo : `${modelo}:online`;
}

function extraerFuentes(respuesta: OpenAI.Chat.Completions.ChatCompletion): FuenteWeb[] {
  const fuentes = new Map<string, FuenteWeb>();

  for (const anotacion of respuesta.choices[0]?.message?.annotations ?? []) {
    if (anotacion.type === "url_citation") {
      fuentes.set(anotacion.url_citation.url, {
        titulo: anotacion.url_citation.title,
        url: anotacion.url_citation.url,
      });
    }
  }

  return [...fuentes.values()];
}

function textoDe(respuesta: OpenAI.Chat.Completions.ChatCompletion) {
  return respuesta.choices[0]?.message?.content?.trim() ?? "";
}

function registrarUso(
  proveedor: ProveedorCompatible,
  modelo: string,
  respuesta: OpenAI.Chat.Completions.ChatCompletion,
) {
  console.info("[IA diagnostico]", {
    proveedor,
    modelo,
    input_tokens: respuesta.usage?.prompt_tokens,
    output_tokens: respuesta.usage?.completion_tokens,
  });
}
