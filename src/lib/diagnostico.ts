import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  TextBlock,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";
import {
  buscarProveedoresWebCompatible,
  diagnosticarCompatible,
  estimarConWebSearchCompatible,
} from "./diagnostico-compatible";
import {
  buscarProveedoresWebOpenAI,
  diagnosticarOpenAI,
  estimarConWebSearchOpenAI,
} from "./diagnostico-openai";
import { diagnosticoSinIdentificar } from "./types";
import { esCompatible, type ConfiguracionIA, type ModoIA } from "./ia-config";
import type { Diagnostico, FuenteWeb, ProveedorWeb } from "./types";

const MODELO_ANTHROPIC_POR_DEFECTO = "claude-sonnet-5";
const MODELO_ANTHROPIC_ECONOMICO = "claude-haiku-4-5";

// El visitante puede traer su propia key (Anthropic u OpenAI) desde el panel de
// configuracion; sin eso, se usa la key del equipo via variable de entorno. La
// key nunca se loguea ni se guarda: vive solo mientras dura este request.
function clienteAnthropic(config?: ConfiguracionIA) {
  const apiKey = config?.proveedor === "anthropic" ? config.apiKey : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Falta una API key de Anthropic (variable de entorno o panel de configuracion).");
  }

  return new Anthropic({ apiKey, maxRetries: 0, timeout: 30_000 });
}

const DIAGNOSTICO_SCHEMA: Tool.InputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    categoria: { type: "string" },
    sub_especialidad: { type: "string" },
    urgencia: { type: "string", enum: ["baja", "media", "alta"] },
    certificaciones_requeridas: {
      type: "array",
      items: { type: "string" },
    },
    costo_estimado_min: { type: "number" },
    costo_estimado_max: { type: "number" },
    horas_estimadas: { type: "number" },
    fuente_estimacion: {
      type: "string",
      enum: ["base_local", "web_search"],
    },
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

type DiagnosticarInput = {
  texto?: string;
  imagenBase64?: string;
};

type ImagenNormalizada = NonNullable<ReturnType<typeof normalizarImagenBase64>>;

export async function diagnosticar(
  input: DiagnosticarInput,
  config?: ConfiguracionIA,
  modo: ModoIA = "economico",
  signal?: AbortSignal,
): Promise<Diagnostico> {
  if (config?.proveedor === "openai") {
    return diagnosticarOpenAI(input, config.apiKey, config.modelo, modo, signal);
  }

  if (config && esCompatible(config.proveedor)) {
    return diagnosticarCompatible(input, config.proveedor, config.apiKey, config.modelo, modo, signal);
  }

  const anthropic = clienteAnthropic(config);
  const modelo = config?.modelo || (modo === "economico" ? MODELO_ANTHROPIC_ECONOMICO : MODELO_ANTHROPIC_POR_DEFECTO);
  const imagen = normalizarImagenBase64(input.imagenBase64);
  const diagnostico = await estructurarDiagnostico(
    anthropic,
    modelo,
    input.texto?.trim() ||
      "Diagnostica el problema observado en la imagen y estima costo/tiempo.",
    imagen,
    signal,
  );

  // Obligado por el schema, el modelo prefiere responder "Desconocido" antes que
  // arriesgar una categoria. Pedirle primero que describa la foto en texto libre
  // le saca esa presion, y la descripcion alimenta el mismo paso estructurado.
  if (modo === "economico" || !imagen || !diagnosticoSinIdentificar(diagnostico)) return diagnostico;

  const descripcion = await describirImagen(anthropic, imagen, signal);
  if (!descripcion) return diagnostico;

  const segundoIntento = await estructurarDiagnostico(
    anthropic,
    modelo,
    `Un tecnico mira la foto del cliente y describe: ${descripcion}. A partir de eso diagnostica el problema y estima costo/tiempo.`,
    null,
    signal,
  );

  return diagnosticoSinIdentificar(segundoIntento) ? diagnostico : segundoIntento;
}

async function estructurarDiagnostico(
  anthropic: Anthropic,
  modelo: string,
  texto: string,
  imagen: ImagenNormalizada | null,
  signal?: AbortSignal,
) {
  const content: Anthropic.Messages.MessageParam["content"] = [
    { type: "text", text: texto },
  ];

  if (imagen) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imagen.mediaType,
        data: imagen.data,
      },
    });
  }

  const message = await anthropic.messages.create({
    model: modelo,
    max_tokens: 700,
    system:
      "Sos un agente de diagnostico para un marketplace de servicios en Paraguay. Responde usando exclusivamente la tool registrar_diagnostico con el contrato exacto. Estima costos en guaranies paraguayos.",
    messages: [{ role: "user", content }],
    tools: [
      {
        name: "registrar_diagnostico",
        description: "Devuelve el diagnostico estructurado del problema reportado.",
        input_schema: DIAGNOSTICO_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "registrar_diagnostico" },
  }, { signal });

  console.info("[IA diagnostico]", {
    proveedor: "anthropic", modelo,
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
  });

  const block = message.content.find(
    (item): item is ToolUseBlock =>
      item.type === "tool_use" && item.name === "registrar_diagnostico",
  );

  if (!block) {
    throw new Error("Claude no devolvio el diagnostico estructurado esperado.");
  }

  return validarDiagnostico(block.input);
}

// Describir una foto no exige el razonamiento de Sonnet, y esto solo corre
// cuando la primera clasificacion ya fallo.
async function describirImagen(anthropic: Anthropic, imagen: ImagenNormalizada, signal?: AbortSignal) {
  const message = await anthropic.messages.create({
    model: MODELO_ANTHROPIC_ECONOMICO,
    max_tokens: 400,
    system:
      "Describi lo que ves en la foto: materiales, instalaciones, daño visible, humedad, oxido, roturas, y el ambiente. No clasifiques ni des un diagnostico, solo descripcion concreta. Si la foto es ilegible decilo en una linea.",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "¿Que se ve en esta foto?" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: imagen.mediaType,
              data: imagen.data,
            },
          },
        ],
      },
    ],
  }, { signal });

  const texto = message.content.find(
    (item): item is TextBlock => item.type === "text",
  )?.text;

  return texto?.trim() || null;
}

// Dos llamadas a proposito: forzar tool_choice a registrar_diagnostico en la misma
// llamada que web_search impide que el modelo llegue a buscar (la tool forzada se
// invoca de inmediato), asi que primero se busca y despues se estructura.
export async function estimarConWebSearch(
  diagnostico: Diagnostico,
  config?: ConfiguracionIA,
  signal?: AbortSignal,
): Promise<{ diagnostico: Diagnostico; fuentes: FuenteWeb[] }> {
  if (config?.proveedor === "openai") {
    return estimarConWebSearchOpenAI(diagnostico, config.apiKey, config.modelo, signal);
  }

  if (config && esCompatible(config.proveedor)) {
    return estimarConWebSearchCompatible(diagnostico, config.proveedor, config.apiKey, config.modelo, signal);
  }

  const anthropic = clienteAnthropic(config);
  const modelo = config?.modelo || MODELO_ANTHROPIC_POR_DEFECTO;

  const busqueda = await anthropic.messages.create({
    model: modelo,
    // Es un resumen de precios en un parrafo, no un documento: 4000 sobraba de
    // margen sin necesidad, sin haber tocado nunca el techo.
    max_tokens: 1200,
    system:
      "Sos un agente de diagnostico para un marketplace de servicios en Paraguay. Busca en la web precios y tiempos actuales para el trabajo descrito y resumi los numeros que encuentres, en guaranies paraguayos.",
    messages: [
      {
        role: "user",
        content: `Necesito precio y duracion de mercado para este trabajo: ${JSON.stringify(diagnostico)}. Busca referencias actuales y resumi los rangos encontrados.`,
      },
    ],
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 1 }],
  }, { signal });

  const fuentes = extraerFuentes(busqueda);
  const hallazgos = busqueda.content
    .filter((item): item is TextBlock => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();

  // Si la busqueda no trajo ninguna fuente, la estimacion no esta respaldada por
  // la web: se devuelve el diagnostico local sin mentir sobre su origen.
  if (fuentes.length === 0) {
    return { diagnostico, fuentes };
  }

  // Copiar 3 campos numericos a un schema ya definido es extraccion, no
  // diagnostico: no necesita el modelo que interpreto la foto o el texto.
  const estructurado = await anthropic.messages.create({
    model: MODELO_ANTHROPIC_ECONOMICO,
    max_tokens: 700,
    system:
      "Actualiza solamente costo_estimado_min, costo_estimado_max y horas_estimadas segun los hallazgos de la busqueda web. Manten el resto del contrato igual. Responde usando la tool registrar_diagnostico.",
    messages: [
      {
        role: "user",
        content: `Diagnostico local con bajo match: ${JSON.stringify(diagnostico)}\n\nHallazgos de la busqueda web:\n${hallazgos}\n\nDevolve el mismo contrato con costo y horas actualizados.`,
      },
    ],
    tools: [
      {
        name: "registrar_diagnostico",
        description: "Devuelve el diagnostico actualizado con estimacion respaldada.",
        input_schema: DIAGNOSTICO_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "registrar_diagnostico" },
  }, { signal });

  const block = estructurado.content.find(
    (item): item is ToolUseBlock =>
      item.type === "tool_use" && item.name === "registrar_diagnostico",
  );

  if (!block) {
    return { diagnostico: { ...diagnostico, fuente_estimacion: "web_search" }, fuentes };
  }

  return {
    diagnostico: { ...validarDiagnostico(block.input), fuente_estimacion: "web_search" },
    fuentes,
  };
}

function extraerFuentes(message: Message): FuenteWeb[] {
  const fuentes = new Map<string, FuenteWeb>();

  for (const bloque of message.content) {
    if (bloque.type !== "web_search_tool_result") continue;
    // En error, content es un objeto ({error_code}), no un array de resultados.
    if (!Array.isArray(bloque.content)) continue;

    for (const resultado of bloque.content) {
      if (resultado.url) {
        fuentes.set(resultado.url, { titulo: resultado.title, url: resultado.url });
      }
    }
  }

  return [...fuentes.values()];
}

function normalizarImagenBase64(imagenBase64?: string) {
  if (!imagenBase64) return null;

  const match = imagenBase64.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
  if (match) {
    return { mediaType: match[1] as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: match[2] };
  }

  return { mediaType: "image/jpeg" as const, data: imagenBase64 };
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

const PROVEEDORES_SCHEMA: Tool.InputSchema = {
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
          telefono: { type: "string" },
          direccion: { type: "string" },
          url: { type: "string" },
        },
        required: ["nombre"],
      },
    },
  },
  required: ["proveedores"],
};

// Cuando el matching local queda vacio, decirle al cliente "no hay nadie" no lo
// ayuda: lo que necesita es un telefono al que llamar. Dos llamadas por lo mismo
// que estimarConWebSearch: con tool_choice forzado el modelo nunca llega a buscar.
export async function buscarProveedoresWeb(
  diagnostico: Diagnostico,
  ubicacion?: { lat: number; lon: number },
  config?: ConfiguracionIA,
  signal?: AbortSignal,
): Promise<ProveedorWeb[]> {
  if (config?.proveedor === "openai") {
    return buscarProveedoresWebOpenAI(diagnostico, config.apiKey, config.modelo, ubicacion, signal);
  }

  if (config && esCompatible(config.proveedor)) {
    return buscarProveedoresWebCompatible(diagnostico, config.proveedor, config.apiKey, config.modelo, ubicacion, signal);
  }

  const anthropic = clienteAnthropic(config);
  const modelo = config?.modelo || MODELO_ANTHROPIC_POR_DEFECTO;

  const cerca = ubicacion
    ? `El cliente esta en las coordenadas ${ubicacion.lat.toFixed(4)}, ${ubicacion.lon.toFixed(4)} (Paraguay).`
    : "El cliente esta en Paraguay, zona de Asuncion y Gran Asuncion.";

  const busqueda = await anthropic.messages.create({
    model: modelo,
    // Una lista corta de 3-4 negocios no necesita 4000 tokens de margen.
    max_tokens: 1200,
    system:
      "Busca negocios reales que presten el servicio pedido y que atiendan en Paraguay. Prioriza los que publican telefono. Enumera cada uno con su nombre, telefono, direccion y sitio o perfil, tal como figuran en la fuente. No inventes datos de contacto.",
    messages: [
      {
        role: "user",
        content: `Necesito contactar a alguien que haga: ${diagnostico.categoria} - ${diagnostico.sub_especialidad}. ${cerca} Urgencia ${diagnostico.urgencia}. Busca negocios con telefono publicado y listalos.`,
      },
    ],
    tools: [
      // Sin user_location: la API solo acepta un set de paises y rechaza PY con
      // un 400. La zona va en el texto de la consulta, que alcanza para que la
      // busqueda devuelva negocios locales.
      // Una sola busqueda: medido en produccion, cada una cuesta cerca de un
      // minuto, y con dos la espera llegaba a 115s para el mismo puñado de
      // negocios que devuelve la primera.
      { type: "web_search_20260209", name: "web_search", max_uses: 1 },
    ],
  }, { signal });

  const hallazgos = busqueda.content
    .filter((item): item is TextBlock => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();

  if (!hallazgos) return [];

  // Misma logica que en estimarConWebSearch: extraer campos de un texto ya
  // encontrado es trabajo de Haiku, no de Sonnet.
  const estructurado = await anthropic.messages.create({
    model: MODELO_ANTHROPIC_ECONOMICO,
    max_tokens: 700,
    system:
      "Extrae los negocios mencionados usando la tool registrar_proveedores. Copia telefono, direccion y url solo si aparecen en el texto; si falta alguno, omiti ese campo. Maximo 4 proveedores.",
    messages: [
      {
        role: "user",
        content: `Resultados de la busqueda:\n${hallazgos}\n\nExtrae los negocios con sus datos de contacto.`,
      },
    ],
    tools: [
      {
        name: "registrar_proveedores",
        description: "Devuelve los negocios encontrados con sus datos de contacto.",
        input_schema: PROVEEDORES_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "registrar_proveedores" },
  }, { signal });

  const block = estructurado.content.find(
    (item): item is ToolUseBlock =>
      item.type === "tool_use" && item.name === "registrar_proveedores",
  );

  if (!block || !isRecord(block.input)) return [];

  const crudos = block.input.proveedores;
  if (!Array.isArray(crudos)) return [];

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

function textoOpcional(valor: unknown) {
  const texto = typeof valor === "string" ? valor.trim() : "";
  return texto.length > 0 ? texto : null;
}
