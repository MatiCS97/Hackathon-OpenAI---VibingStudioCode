import {
  CopilotRuntime,
  AnthropicAdapter,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { NextRequest } from "next/server";
import { configuracionDelServidor, normalizarModoIA } from "@/lib/ia-config";

const runtime = new CopilotRuntime();

// El visitante puede elegir su propio proveedor/modelo/key en el panel de
// configuracion; viaja como headers (ver copilot-provider.tsx) porque el body de
// este endpoint es el protocolo interno de CopilotKit, no uno propio. Sin esos
// headers, se arma el adapter de siempre con la key del equipo.
function armarServiceAdapter(req: NextRequest) {
  const proveedor = req.headers.get("x-servicia-proveedor");
  const modelo = req.headers.get("x-servicia-modelo");
  const apiKey = req.headers.get("x-servicia-api-key");

  if (proveedor === "openai" && modelo && apiKey) {
    return new OpenAIAdapter({ openai: new OpenAI({ apiKey }), model: modelo });
  }

  if (proveedor === "anthropic" && modelo && apiKey) {
    return new AnthropicAdapter({ anthropic: new Anthropic({ apiKey }), model: modelo });
  }

  // Sin key del visitante, el deploy usa la suya. Si esta configurado con
  // IA_PROVEEDOR=openai, todo el sitio corre sobre esa cuenta.
  const porDefecto = configuracionDelServidor(normalizarModoIA(req.headers.get("x-servicia-modo")));
  if (porDefecto?.proveedor === "openai") {
    return new OpenAIAdapter({
      openai: new OpenAI({ apiKey: porDefecto.apiKey }),
      model: porDefecto.modelo,
    });
  }

  if (porDefecto?.proveedor === "anthropic") {
    return new AnthropicAdapter({
      anthropic: new Anthropic({ apiKey: porDefecto.apiKey, maxRetries: 0 }),
      model: "claude-haiku-4-5",
    });
  }

  // Este runtime solo decide cuando llamar a diagnosticarProblema y despues
  // contesta en una frase corta (ver SUFIJO_BREVEDAD en page.tsx); el diagnostico
  // en si sigue en Sonnet via diagnosticar(). Es la llamada que mas se repite
  // (una por mensaje de chat), asi que es la que mas ahorra al bajarla de modelo.
  return new AnthropicAdapter({
    anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    model: "claude-haiku-4-5",
  });
}

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: armarServiceAdapter(req),
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
