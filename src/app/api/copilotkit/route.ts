import {
  CopilotRuntime,
  AnthropicAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// Este runtime solo decide cuando llamar a diagnosticarProblema y despues
// contesta en una frase corta (ver SUFIJO_BREVEDAD en page.tsx); el diagnostico
// en si sigue en Sonnet via diagnosticar(). Es la llamada que mas se repite
// (una por mensaje de chat), asi que es la que mas ahorra al bajarla de modelo.
const serviceAdapter = new AnthropicAdapter({
  anthropic,
  model: "claude-haiku-4-5",
});
const runtime = new CopilotRuntime();

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
