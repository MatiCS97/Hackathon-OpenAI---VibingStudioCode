import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, beforeEach, test } from "node:test";

// Resuelve los mismos aliases y JSON de Next sin instalar otro runner.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (context.parentURL?.startsWith(new URL("../src/", import.meta.url).href) && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith("/data/profiles.json")) {
      return { format: "module", source: `export default ${readFileSync(fileURLToPath(url), "utf8")}`, shortCircuit: true };
    }
    return next(url, context);
  },
});

const diagnostico = {
  categoria: "Plomeria", sub_especialidad: "reparacion de canerias", urgencia: "media",
  certificaciones_requeridas: [], costo_estimado_min: 100000,
  costo_estimado_max: 200000, horas_estimadas: 2, fuente_estimacion: "base_local",
};
const config = { proveedor: "openai", modelo: "gpt-5-nano", apiKey: "sk-test-only" };
const llamadas = [];
let respuestaDiagnostico = diagnostico;
let status = 200;
let rechazarJsonSchema = false;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  const body = JSON.parse(init?.body ?? await input.text());
  llamadas.push({ url, body, headers: new Headers(init?.headers) });
  if (status !== 200) return Response.json({ error: { message: "Cuota de prueba", type: "rate_limit_error" } }, { status });
  if (url === "https://api.openai.com/v1/responses") {
    return Response.json({
      id: "resp_test", object: "response", status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(respuestaDiagnostico), annotations: [] }] }],
      usage: { input_tokens: 80, output_tokens: 100 },
    });
  }
  // Gemini y OpenRouter: mismo dialecto de OpenAI, distinta baseURL.
  if (url.endsWith("/chat/completions")) {
    if (rechazarJsonSchema && body.response_format?.type === "json_schema") {
      return Response.json({ error: { message: "json_schema no soportado por este modelo" } }, { status: 400 });
    }
    return Response.json({
      id: "chatcmpl_test", object: "chat.completion",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(respuestaDiagnostico), annotations: [] } }],
      usage: { prompt_tokens: 80, completion_tokens: 100 },
    });
  }
  if (url === "https://api.anthropic.com/v1/messages") {
    return Response.json({ id: "msg_test", type: "message", role: "assistant",
      content: [{ type: "tool_use", id: "tool_test", name: "registrar_diagnostico", input: respuestaDiagnostico }],
      usage: { input_tokens: 80, output_tokens: 100 }, stop_reason: "tool_use" });
  }
  throw new Error(`Llamada externa inesperada: ${new URL(url).hostname}`);
};
await import("openai/shims/web");
const { POST: orquestar } = await import("../src/app/api/orchestrate/route.ts");
const { POST: proveedores } = await import("../src/app/api/proveedores/route.ts");
const { diagnosticar } = await import("../src/lib/diagnostico.ts");
const { leerConfiguracionDelBody, configuracionDelServidor } = await import("../src/lib/ia-config.ts");
after(() => { globalThis.fetch = fetchOriginal; });
beforeEach(() => { llamadas.length = 0; status = 200; respuestaDiagnostico = diagnostico; rechazarJsonSchema = false; });

const request = (body) => new Request("http://localhost/api/orchestrate", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("diagnostico economico: una llamada, modelo/key elegidos y matching sin Gemini", async () => {
  const respuesta = await orquestar(request({ texto: "Caneria rota prueba uno", configuracionIA: config }));
  assert.equal(respuesta.status, 200);
  const datos = await respuesta.json();
  assert.equal(datos.diagnostico.categoria, "Plomeria");
  assert.ok(datos.matches.length > 0);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].headers.get("authorization"), `Bearer ${config.apiKey}`);
  assert.equal(llamadas[0].body.model, "gpt-5-nano");
  assert.deepEqual(llamadas[0].body.reasoning, { effort: "minimal" });
  assert.equal(llamadas[0].body.store, false);
  assert.equal(llamadas[0].body.tools, undefined);
});

test("cache reutiliza diagnosticos y aisla cuentas, modelos y fotos", async () => {
  const body = { texto: "Caneria rota prueba cache", configuracionIA: config };
  await orquestar(request(body));
  await orquestar(request(body));
  assert.equal(llamadas.length, 1);
  await orquestar(request({ ...body, configuracionIA: { ...config, apiKey: "sk-another-test" } }));
  await orquestar(request({ ...body, configuracionIA: { ...config, modelo: "gpt-4o-mini" } }));
  assert.equal(llamadas.length, 3);
  assert.equal(llamadas[2].body.reasoning, undefined);
  await orquestar(request({ ...body, imagenBase64: "data:image/jpeg;base64,dGVzdA==" }));
  assert.equal(llamadas.length, 4);
});

test("foto no identificada no dispara lecturas adicionales en ningun proveedor", async () => {
  respuestaDiagnostico = { ...diagnostico, categoria: "Desconocido", sub_especialidad: "Desconocido" };
  const input = { imagenBase64: "data:image/jpeg;base64,dGVzdA==" };
  for (const configuracion of [config, { proveedor: "anthropic", modelo: "claude-haiku-4-5", apiKey: "sk-ant-test" }]) {
    llamadas.length = 0;
    const resultado = await diagnosticar(input, configuracion, "economico");
    assert.equal(resultado.categoria, "Desconocido");
    assert.equal(llamadas.length, 1);
  }
});

test("429 no genera reintentos automaticos ni se cachea como exito", async () => {
  status = 429;
  const body = { texto: "Caneria prueba cuota", configuracionIA: config };
  assert.equal((await orquestar(request(body))).status, 500);
  assert.equal(llamadas.length, 1);
  status = 200;
  assert.equal((await orquestar(request(body))).status, 200);
  assert.equal(llamadas.length, 2);
});

test("endpoint web no gasta si el modo es economico o falta", async () => {
  for (const modoIA of [undefined, "economico"]) {
    const respuesta = await proveedores(request({ diagnostico, configuracionIA: config, modoIA }));
    assert.deepEqual(await respuesta.json(), { proveedores: [] });
  }
  assert.equal(llamadas.length, 0);
});

test("configuracion personal incompleta no usa silenciosamente la key del equipo", async () => {
  assert.throws(() => leerConfiguracionDelBody({ ...config, apiKey: " " }));
  const respuesta = await orquestar(request({ texto: "Prueba configuracion", configuracionIA: { proveedor: "openai" } }));
  assert.equal(respuesta.status, 500);
  assert.equal(llamadas.length, 0);
});

const VARIABLES = ["IA_PROVEEDOR", "IA_MODELO", "OPENAI_API_KEY", "OPENAI_MODELO", "GEMINI_API_KEY", "OPENROUTER_API_KEY"];

// Aisla el entorno: deja solo las variables pedidas y restaura las originales.
function conEntorno(variables, ejecutar) {
  const anterior = Object.fromEntries(VARIABLES.map((env) => [env, process.env[env]]));
  try {
    for (const env of VARIABLES) delete process.env[env];
    Object.assign(process.env, variables);
    ejecutar();
  } finally {
    for (const env of VARIABLES) {
      if (anterior[env] === undefined) delete process.env[env]; else process.env[env] = anterior[env];
    }
  }
}

test("OpenAI del servidor tiene modelo economico por defecto y exige su propia clave", () => {
  conEntorno({ IA_PROVEEDOR: "openai", OPENAI_API_KEY: "sk-server-test" }, () => {
    assert.equal(configuracionDelServidor().modelo, "gpt-5-nano");
    delete process.env.OPENAI_API_KEY;
    assert.throws(() => configuracionDelServidor(), /OPENAI_API_KEY/);
  });
});

test("IA_PROVEEDOR=gemini reusa la GEMINI_API_KEY que ya alimenta el matching", () => {
  conEntorno({ IA_PROVEEDOR: "gemini", GEMINI_API_KEY: "AIza-server-test" }, () => {
    assert.deepEqual(configuracionDelServidor(), {
      proveedor: "gemini", modelo: "gemini-3.1-flash-lite", apiKey: "AIza-server-test",
    });
  });
  // Sin la key propia del proveedor no cae de vuelta a Anthropic por accidente.
  conEntorno({ IA_PROVEEDOR: "openrouter", ANTHROPIC_API_KEY: "sk-ant-test" }, () => {
    assert.throws(() => configuracionDelServidor(), /OPENROUTER_API_KEY/);
  });
});

test("IA_MODELO pisa el default de cualquier proveedor y un IA_PROVEEDOR raro avisa", () => {
  conEntorno({ IA_PROVEEDOR: "openrouter", OPENROUTER_API_KEY: "sk-or-v1-test", IA_MODELO: "deepseek/deepseek-r1:free" }, () => {
    assert.equal(configuracionDelServidor().modelo, "deepseek/deepseek-r1:free");
  });
  conEntorno({ IA_PROVEEDOR: "mistral", ANTHROPIC_API_KEY: "sk-ant-test" }, () => {
    assert.throws(() => configuracionDelServidor(), /IA_PROVEEDOR desconocido/);
  });
});

test("Gemini pega en su baseURL compatible, con su key y sin techo de tokens", async () => {
  const gemini = { proveedor: "gemini", modelo: "gemini-3.1-flash-lite", apiKey: "AIza-test" };
  const respuesta = await orquestar(request({ texto: "Caneria rota prueba gemini", configuracionIA: gemini }));
  assert.equal(respuesta.status, 200);
  assert.equal((await respuesta.json()).diagnostico.categoria, "Plomeria");
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(llamadas[0].headers.get("authorization"), "Bearer AIza-test");
  assert.equal(llamadas[0].body.model, "gemini-3.1-flash-lite");
  assert.equal(llamadas[0].body.response_format.type, "json_schema");
  // Un techo bajo corta a mitad de JSON a los modelos que razonan antes de responder.
  assert.equal(llamadas[0].body.max_tokens, undefined);
});

test("OpenRouter pasa el slug tal cual, incluido el sufijo :free", async () => {
  const router = { proveedor: "openrouter", modelo: "deepseek/deepseek-r1:free", apiKey: "sk-or-v1-test" };
  await orquestar(request({ texto: "Caneria rota prueba openrouter", configuracionIA: router }));
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(llamadas[0].body.model, "deepseek/deepseek-r1:free");
});

test("modelo que rechaza json_schema reintenta una vez con el esquema en el prompt", async () => {
  rechazarJsonSchema = true;
  const router = { proveedor: "openrouter", modelo: "un/modelo-viejo:free", apiKey: "sk-or-v1-test" };
  const respuesta = await orquestar(request({ texto: "Caneria rota prueba fallback", configuracionIA: router }));
  assert.equal(respuesta.status, 200);
  assert.equal((await respuesta.json()).diagnostico.categoria, "Plomeria");
  assert.equal(llamadas.length, 2);
  assert.equal(llamadas[1].body.response_format.type, "json_object");
  assert.match(JSON.stringify(llamadas[1].body.messages.at(-1)), /sub_especialidad/);
});

test("Gemini no promete telefonos web que su API compatible no puede buscar", async () => {
  const gemini = { proveedor: "gemini", modelo: "gemini-3.1-flash-lite", apiKey: "AIza-test" };
  const respuesta = await proveedores(request({ diagnostico, configuracionIA: gemini, modoIA: "completo" }));
  assert.deepEqual(await respuesta.json(), { proveedores: [] });
  assert.equal(llamadas.length, 0);
});
