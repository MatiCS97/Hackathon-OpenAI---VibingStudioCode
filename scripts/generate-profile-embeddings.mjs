import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { VoyageAIClient } from "voyageai";

const batchSize = 128;
const minimumRequestIntervalMs = 21_000;
const projectRoot = process.cwd();
const profilesPath = path.join(projectRoot, "data", "profiles.json");
const embeddingsPath = path.join(projectRoot, "data", "profile-embeddings.json");

if (!process.env.VOYAGE_API_KEY) {
  throw new Error("Falta VOYAGE_API_KEY. Configurala en .env.local antes de generar embeddings.");
}

const profiles = JSON.parse(await readFile(profilesPath, "utf8"));
const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
const embeddings = [];

for (let index = 0; index < profiles.length; index += batchSize) {
  const batch = profiles.slice(index, index + batchSize);
  const response = await voyage.embed({
    input: batch.map(textoPerfil),
    model: "voyage-3.5",
    inputType: "document",
  });

  if (!response.data || response.data.length !== batch.length) {
    throw new Error(`Voyage no devolvio embeddings validos para el lote ${index / batchSize + 1}.`);
  }

  response.data.forEach((item, offset) => {
    if (!item.embedding) {
      throw new Error(`Voyage devolvio un perfil sin embedding en el lote ${index / batchSize + 1}.`);
    }

    embeddings.push({ id: batch[offset].id, embedding: item.embedding });
  });

  console.log(`Procesados ${Math.min(index + batch.length, profiles.length)}/${profiles.length} perfiles.`);

  if (index + batchSize < profiles.length) {
    await esperar(minimumRequestIntervalMs);
  }
}

await writeFile(embeddingsPath, JSON.stringify(embeddings), "utf8");
console.log(`Embeddings guardados en ${embeddingsPath}.`);

function textoPerfil(profile) {
  return [
    normalizarTexto(profile.rubro),
    profile.especialidades.map(normalizarTexto).join(", "),
    profile.certificaciones.map(normalizarTexto).join(", "),
    normalizarTexto(profile.bio),
    normalizarTexto(profile.ubicacion.ciudad),
  ].join(". ");
}

function normalizarTexto(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

function esperar(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
