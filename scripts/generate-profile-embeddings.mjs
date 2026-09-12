import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

const batchSize = 100;
const checkpointInterval = 100;
const minimumBatchIntervalMs = 61_000;
const embeddingDimensions = 768;
const geminiModel = "gemini-embedding-001";
const projectRoot = process.cwd();
const profilesPath = path.join(projectRoot, "data", "profiles.json");
const embeddingsPath = path.join(projectRoot, "data", "profile-embeddings.json");

if (!process.env.GEMINI_API_KEY) {
  throw new Error("Falta GEMINI_API_KEY. Configurala en .env.local antes de generar embeddings.");
}

const profiles = JSON.parse(await readFile(profilesPath, "utf8"));
const limit = obtenerLimite(process.argv, profiles.length);
const profilesParaProcesar = profiles.slice(0, limit);
const gemini = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  modelName: geminiModel,
});
const embeddings = await cargarCacheExistente();
if (embeddings.length > profilesParaProcesar.length) {
  embeddings.length = profilesParaProcesar.length;
}

for (let index = embeddings.length; index < profilesParaProcesar.length; index += batchSize) {
  const batch = profilesParaProcesar.slice(index, index + batchSize);
  const response = await generarLote(batch);

  response.forEach((embedding, offset) => {
    if (embedding.length < embeddingDimensions) {
      throw new Error(`Gemini devolvio un perfil sin embedding en el lote ${index / batchSize + 1}.`);
    }

    embeddings.push({ id: batch[offset].id, embedding: embedding.slice(0, embeddingDimensions) });
  });

  const procesados = Math.min(index + batch.length, profilesParaProcesar.length);
  console.log(`Procesados ${procesados}/${profilesParaProcesar.length} perfiles.`);

  if (procesados % checkpointInterval === 0) {
    await guardarCache();
  }

  if (procesados < profilesParaProcesar.length) {
    await esperar(minimumBatchIntervalMs);
  }
}

await guardarCache();
console.log(`Embeddings guardados en ${embeddingsPath}.`);

async function cargarCacheExistente() {
  try {
    const cache = JSON.parse(await readFile(embeddingsPath, "utf8"));
    return cache.provider === "gemini" &&
      cache.model === geminiModel &&
      cache.dimensions === embeddingDimensions &&
      Array.isArray(cache.embeddings)
      ? cache.embeddings
      : [];
  } catch {
    return [];
  }
}

function guardarCache() {
  return writeFile(
    embeddingsPath,
    JSON.stringify({
      provider: "gemini",
      model: geminiModel,
      dimensions: embeddingDimensions,
      embeddings,
    }),
    "utf8",
  );
}

async function generarLote(batch) {
  while (true) {
    const response = await gemini.embedDocuments(batch.map(textoPerfil));
    const esValido =
      response.length === batch.length &&
      response.every((embedding) => embedding.length >= embeddingDimensions);

    if (esValido) return response;

    console.warn("Gemini limito el lote. Reintentando en un minuto sin perder el checkpoint.");
    await esperar(minimumBatchIntervalMs);
  }
}

function textoPerfil(profile) {
  return [
    normalizarTexto(profile.rubro),
    profile.especialidades.map(normalizarTexto).join(", "),
    profile.certificaciones.map(normalizarTexto).join(", "),
    normalizarTexto(profile.ubicacion.ciudad),
  ].join(". ");
}

function normalizarTexto(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

function obtenerLimite(args, maximo) {
  const argumento = args.find((arg) => arg.startsWith("--limit="));
  if (!argumento) return maximo;

  const limit = Number(argumento.slice("--limit=".length));
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Usa un limite entero positivo, por ejemplo --limit=10000.");
  }

  return Math.min(limit, maximo);
}

function esperar(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
