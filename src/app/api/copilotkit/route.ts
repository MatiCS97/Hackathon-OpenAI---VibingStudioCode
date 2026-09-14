import {
  CopilotRuntime,
  AnthropicAdapter,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { NextRequest } from "next/server";
import {
  BASE_URL_COMPATIBLE,
  MODELO_ANTHROPIC_ECONOMICO,
  configuracionDelServidor,
  esCompatible,
  esProveedorIA,
  type ConfiguracionIA,
} from "@/lib/ia-config";
import { limitarPorIp } from "@/lib/limite-uso";

const runtime = new CopilotRuntime();

// El visitante puede elegir su propio proveedor/modelo/key en el panel de
// configuracion; viaja como headers (ver copilot-provider.tsx) porque el body de
// este endpoint es el protocolo interno de CopilotKit, no uno propio. Sin esos
// headers, se arma el adapter de siempre con la key del equipo.
function armarServiceAdapter(delVisitante: ConfiguracionIA | undefined) {
  if (delVisitante) return adapterDe(delVisitante);

  // Este runtime solo decide cuando llamar a diagnosticarProblema y despues
  // contesta en una frase corta (ver SUFIJO_BREVEDAD en page.tsx); el diagnostico
  // en si corre aparte via diagnosticar(). Es la llamada que mas se repite (una
  // por mensaje de chat), asi que siempre va en el modelo economico del
  // proveedor configurado, sin importar el modo elegido en pantalla.
  const delServidor = configuracionDelServidor("economico");
  if (delServidor) return adapterDe(delServidor);

  return new AnthropicAdapter({
    anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    model: MODELO_ANTHROPIC_ECONOMICO,
  });
}

function configuracionDeHeaders(req: NextRequest): ConfiguracionIA | undefined {
  const proveedor = req.headers.get("x-servicia-proveedor");
  const modelo = req.headers.get("x-servicia-modelo");
  const apiKey = req.headers.get("x-servicia-api-key");

  if (!esProveedorIA(proveedor) || !modelo || !apiKey) return undefined;
  return { proveedor, modelo, apiKey };
}

function adapterDe(config: ConfiguracionIA) {
  if (config.proveedor === "anthropic") {
    return new AnthropicAdapter({
      anthropic: new Anthropic({ apiKey: config.apiKey, maxRetries: 0 }),
      model: config.modelo,
    });
  }

  // Gemini y OpenRouter responden en /chat/completions igual que OpenAI, que es
  // lo que este adapter llama: alcanza con apuntarle la baseURL.
  return new OpenAIAdapter({
    openai: new OpenAI({
      apiKey: config.apiKey,
      ...(esCompatible(config.proveedor) ? { baseURL: BASE_URL_COMPATIBLE[config.proveedor] } : {}),
    }),
    model: config.modelo,
  });
}

export const POST = async (req: NextRequest) => {
  const delVisitante = configuracionDeHeaders(req);

  if (!delVisitante && (await esEjecucionDeAgente(req))) {
    const bloqueo = limitarPorIp(req, "chat");
    if (bloqueo) return bloqueo;
  }

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: armarServiceAdapter(delVisitante),
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};

// Solo agent/run llama al modelo. El resto del protocolo (info, connect) llega
// en cada carga de pagina sin gastar nada y no debe comerse el cupo. Se lee un
// clon porque el body original lo consume CopilotKit despues.
async function esEjecucionDeAgente(req: NextRequest) {
  const envoltura = (await req.clone().json().catch(() => null)) as { method?: unknown } | null;
  return envoltura?.method === "agent/run";
}
