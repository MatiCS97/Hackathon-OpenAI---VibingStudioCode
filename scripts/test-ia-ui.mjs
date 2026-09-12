import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const capturas = mkdtempSync(join(tmpdir(), "servicia-ui-"));
const diagnostico = {
  categoria: "Plomeria", sub_especialidad: "Reparacion de canerias", urgencia: "media",
  certificaciones_requeridas: [], costo_estimado_min: 100000,
  costo_estimado_max: 200000, horas_estimadas: 2, fuente_estimacion: "base_local",
};
try {
  for (const width of [1366, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, permissions: ["geolocation"], geolocation: { latitude: -25.3, longitude: -57.6 } });
    const page = await context.newPage();
    const errores = [];
    page.on("pageerror", (error) => errores.push(error.message));
    const solicitudes = [];
    let busquedasWeb = 0;
    let consultasChat = 0;
    await page.route("**/api/orchestrate", async (route) => {
      solicitudes.push(route.request().postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ json: { diagnostico, matches: [], fallback_web: false, fuentes_web: [], proveedores_web: [] } });
    });
    await page.route("**/api/proveedores", async (route) => {
      busquedasWeb++;
      await route.fulfill({ json: { proveedores: [] } });
    });
    await page.route("**/api/copilotkit**", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.method !== "agent/run") return route.continue();
      consultasChat++;
      await route.abort();
    });
    await page.goto("http://127.0.0.1:3000");
    await page.getByRole("button", { name: /Configurar IA/ }).click();
    const dialogo = page.getByRole("dialog", { name: "Configuracion de IA" });
    assert.equal(await dialogo.getByRole("checkbox").isChecked(), true);
    await dialogo.getByRole("button", { name: "OpenAI", exact: true }).click();
    assert.equal(await dialogo.getByRole("combobox").inputValue(), "gpt-5-nano");
    assert.equal(await dialogo.locator("option").count(), 5);
    await dialogo.getByRole("button", { name: "Google Gemini", exact: true }).click();
    assert.equal(await dialogo.getByRole("combobox").inputValue(), "gemini-3.1-flash-lite");
    // La limitacion se avisa antes de que gaste una consulta en descubrirla.
    await dialogo.getByText(/no expone busqueda web/).waitFor();
    await dialogo.getByRole("button", { name: "OpenRouter", exact: true }).click();
    assert.equal(await dialogo.getByRole("combobox").inputValue(), "google/gemini-3.8-flash");
    await dialogo.getByRole("button", { name: "OpenAI", exact: true }).click();
    await dialogo.getByLabel("Tu API key de OpenAI").fill("sk-browser-test");
    await page.screenshot({ path: join(capturas, `modelos-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bounds = await dialogo.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await dialogo.getByRole("button", { name: "Guardar", exact: true }).click();

    await page.getByRole("button", { name: /tu key/ }).click();
    assert.equal(await dialogo.getByRole("combobox").inputValue(), "gpt-5-nano");
    await dialogo.getByRole("combobox").selectOption("gpt-4o-mini");
    await dialogo.getByRole("button", { name: "Guardar", exact: true }).click();
    const configGuardada = await page.evaluate(() => JSON.parse(localStorage.getItem("servicia:configuracion-ia")));
    assert.equal(configGuardada.apiKey, "sk-browser-test");
    assert.equal(configGuardada.modelo, "gpt-4o-mini");

    const foto = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 2048;
      canvas.height = 1536;
      const contexto = canvas.getContext("2d");
      contexto.fillStyle = "#456789";
      contexto.fillRect(0, 0, 2048, 1536);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.locator('input[type="file"]').setInputFiles({ name: "prueba.png", mimeType: "image/png", buffer: Buffer.from(foto, "base64") });
    const preview = page.getByRole("img", { name: "Vista previa de la foto adjunta" });
    await preview.waitFor();
    const dimensiones = await preview.evaluate(async (img) => { await img.decode(); return [img.naturalWidth, img.naturalHeight]; });
    assert.deepEqual(dimensiones, [1024, 768]);

    await page.getByLabel("Qué te está pasando").fill("Tengo una caneria rota");
    consultasChat = 0;
    await page.getByRole("button", { name: "Diagnosticar", exact: true }).evaluate((boton) => { boton.click(); boton.click(); });
    await page.getByRole("heading", { name: "Plomeria", exact: true }).waitFor();
    assert.equal(solicitudes.length, 1);
    assert.equal(solicitudes[0].modoIA, "economico");
    assert.equal(solicitudes[0].configuracionIA.apiKey, "sk-browser-test");
    assert.equal(solicitudes[0].configuracionIA.modelo, "gpt-4o-mini");
    assert.ok(solicitudes[0].imagenBase64.startsWith("data:image/jpeg;base64,"));
    assert.deepEqual(solicitudes[0].ubicacion, { lat: -25.3, lon: -57.6 });
    assert.equal(busquedasWeb, 0);
    assert.equal(consultasChat, 0);
    assert.ok((await page.getByRole("link", { name: "Buscar profesionales en Google" }).getAttribute("href")).startsWith("https://www.google.com/search?q="));
    await page.screenshot({ path: join(capturas, `diagnostico-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await page.getByRole("button", { name: "Preguntarle a ServicIA" }).click();
    await page.getByRole("dialog", { name: "Ayuda de ServicIA" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /tu key/ }).click();
    await dialogo.getByRole("checkbox").uncheck();
    assert.equal(busquedasWeb, 0);
    await dialogo.getByRole("checkbox").check();
    await dialogo.getByRole("button", { name: "Volver a la key del equipo" }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem("servicia:configuracion-ia")), null);
    assert.deepEqual(errores, []);
    console.log(`UI ${width}px: selector, persistencia, doble clic, diagnostico directo, ubicacion y Google OK`);
    await context.close();
  }
  console.log(`Capturas: ${capturas}`);
} finally {
  await browser.close();
}
