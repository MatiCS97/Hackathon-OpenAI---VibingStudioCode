import Anthropic from "@anthropic-ai/sdk";
import type {
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";
import type { Diagnostico } from "./types";

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

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type DiagnosticarInput = {
  texto?: string;
  imagenBase64?: string;
};

export async function diagnosticar(input: DiagnosticarInput): Promise<Diagnostico> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Falta ANTHROPIC_API_KEY en el entorno.");
  }

  const content: Anthropic.Messages.MessageParam["content"] = [
    {
      type: "text",
      text:
        input.texto?.trim() ||
        "Diagnostica el problema observado en la imagen y estima costo/tiempo.",
    },
  ];

  const image = normalizarImagenBase64(input.imagenBase64);
  if (image) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: image.data,
      },
    });
  }

  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 900,
    temperature: 0,
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

export async function estimarConWebSearch(diagnostico: Diagnostico): Promise<Diagnostico> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Falta ANTHROPIC_API_KEY en el entorno.");
  }

  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 900,
    temperature: 0,
    system:
      "Actualiza solamente costo_estimado_min, costo_estimado_max y horas_estimadas usando busqueda web cuando haga falta. Responde con la tool registrar_diagnostico.",
    messages: [
      {
        role: "user",
        content: `Diagnostico local con bajo match: ${JSON.stringify(diagnostico)}. Busca referencias actuales si hace falta y devuelve el mismo contrato.`,
      },
    ],
    tools: [
      { type: "web_search_20250305", name: "web_search" },
      {
        name: "registrar_diagnostico",
        description: "Devuelve el diagnostico actualizado con estimacion respaldada.",
        input_schema: DIAGNOSTICO_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "registrar_diagnostico" },
  });

  const block = message.content.find(
    (item): item is ToolUseBlock =>
      item.type === "tool_use" && item.name === "registrar_diagnostico",
  );

  if (!block) {
    return { ...diagnostico, fuente_estimacion: "web_search" };
  }

  return { ...validarDiagnostico(block.input), fuente_estimacion: "web_search" };
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
