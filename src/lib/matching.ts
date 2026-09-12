import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { VoyageAIClient } from "voyageai";
import perfiles from "../../data/profiles.json";
import { explicarMatch } from "./explicabilidad";
import type { Diagnostico, MatchProfesional, Profesional } from "./types";

const EMBEDDINGS_PATH = path.join(process.cwd(), "data", "profile-embeddings.json");
const MATCH_THRESHOLD = 0.55;
const TOP_K = 5;
const BATCH_SIZE = 128;
const RADIO_REFERENCIA_KM = 50;

type PerfilEmbedding = {
  id: string;
  embedding: number[];
};

export type UbicacionCliente = {
  lat: number;
  lon: number;
};

const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
const profesionales = perfiles as Profesional[];

let embeddingsMemo: Promise<PerfilEmbedding[]> | null = null;

export async function encontrarMatches(
  diagnostico: Diagnostico,
  ubicacionCliente?: UbicacionCliente,
): Promise<{
  matches: MatchProfesional[];
  fallback_web: boolean;
}> {
  if (!process.env.VOYAGE_API_KEY) {
    throw new Error("Falta VOYAGE_API_KEY en el entorno.");
  }

  const queryEmbedding = await embedTexto(textoDiagnostico(diagnostico), "query");
  const perfilEmbeddings = await cargarOGenerarEmbeddings();
  const perfilPorId = new Map(profesionales.map((perfil) => [perfil.id, perfil]));

  const candidatos = perfilEmbeddings
    .map((item) => {
      const profesional = perfilPorId.get(item.id);
      if (!profesional || !profesional.disponible) return null;

      const hardScore = scoreFiltrosDuros(profesional, diagnostico);
      if (hardScore === 0) return null;

      const scoreUbicacion = ubicacionCliente
        ? factorUbicacion(profesional, ubicacionCliente)
        : 1;
      const score = cosineSimilarity(queryEmbedding, item.embedding) * hardScore * scoreUbicacion;
      return { profesional, score };
    })
    .filter((item): item is { profesional: Profesional; score: number } => item !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  const matches = candidatos.map(({ profesional, score }) => ({
    profesional_id: profesional.id,
    score,
    explicacion: explicarMatch(profesional, diagnostico, score),
    profesional,
  }));

  return {
    matches,
    fallback_web: (matches[0]?.score ?? 0) < MATCH_THRESHOLD,
  };
}

async function cargarOGenerarEmbeddings(): Promise<PerfilEmbedding[]> {
  embeddingsMemo ??= (async () => {
    const cache = await leerCacheEmbeddings();
    if (cache?.length === profesionales.length) return cache;

    const generados: PerfilEmbedding[] = [];
    for (let index = 0; index < profesionales.length; index += BATCH_SIZE) {
      const batch = profesionales.slice(index, index + BATCH_SIZE);
      const response = await voyage.embed({
        input: batch.map(textoPerfil),
        model: "voyage-3.5",
        inputType: "document",
      });

      const embeddings = response.data;
      if (!embeddings) {
        throw new Error("Voyage no devolvio embeddings para perfiles.");
      }

      embeddings.forEach((item, offset) => {
        if (!item.embedding) {
          throw new Error("Voyage devolvio un perfil sin embedding.");
        }

        generados.push({
          id: batch[offset].id,
          embedding: item.embedding,
        });
      });
    }

    try {
      await writeFile(EMBEDDINGS_PATH, JSON.stringify(generados), "utf8");
    } catch (error) {
      console.warn("No se pudo guardar la cache de embeddings.", error);
    }

    return generados;
  })();

  return embeddingsMemo;
}

async function leerCacheEmbeddings(): Promise<PerfilEmbedding[] | null> {
  try {
    const raw = await readFile(EMBEDDINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as PerfilEmbedding[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function embedTexto(texto: string, inputType: "query" | "document") {
  const response = await voyage.embed({
    input: texto,
    model: "voyage-3.5",
    inputType,
  });

  const embedding = response.data?.[0]?.embedding;
  if (!embedding) {
    throw new Error("Voyage no devolvio embedding.");
  }

  return embedding;
}

function scoreFiltrosDuros(profesional: Profesional, diagnostico: Diagnostico) {
  const categoria = normalizarTexto(diagnostico.categoria);
  const rubro = normalizarTexto(profesional.rubro);
  const subEspecialidad = normalizarTexto(diagnostico.sub_especialidad);

  const rubroCompatible = categoria.includes(rubro) || rubro.includes(categoria);
  const especialidadCompatible = profesional.especialidades.some((especialidad) => {
    const normalizada = normalizarTexto(especialidad);
    return subEspecialidad.includes(normalizada) || normalizada.includes(subEspecialidad);
  });

  const certificacionCompatible =
    diagnostico.certificaciones_requeridas.length === 0 ||
    diagnostico.certificaciones_requeridas.some((requerida) =>
      profesional.certificaciones.some((certificacion) =>
        normalizarTexto(certificacion).includes(normalizarTexto(requerida)),
      ),
    );

  if (!rubroCompatible && !especialidadCompatible) return 0;
  if (!certificacionCompatible && diagnostico.urgencia === "alta") return 0;

  return certificacionCompatible ? 1 : 0.82;
}

function textoDiagnostico(diagnostico: Diagnostico) {
  return [
    normalizarTexto(diagnostico.categoria),
    normalizarTexto(diagnostico.sub_especialidad),
    `urgencia ${normalizarTexto(diagnostico.urgencia)}`,
    `certificaciones ${diagnostico.certificaciones_requeridas.map(normalizarTexto).join(", ")}`,
  ].join(". ");
}

function textoPerfil(profesional: Profesional) {
  return [
    normalizarTexto(profesional.rubro),
    profesional.especialidades.map(normalizarTexto).join(", "),
    profesional.certificaciones.map(normalizarTexto).join(", "),
    normalizarTexto(profesional.bio),
    normalizarTexto(profesional.ubicacion.ciudad),
  ].join(". ");
}

function normalizarTexto(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

function factorUbicacion(profesional: Profesional, cliente: UbicacionCliente) {
  const distancia = distanciaEnKm(
    cliente.lat,
    cliente.lon,
    profesional.ubicacion.lat,
    profesional.ubicacion.lon,
  );

  return Math.max(0.7, 1 - (distancia / RADIO_REFERENCIA_KM) * 0.3);
}

function distanciaEnKm(latitudA: number, longitudA: number, latitudB: number, longitudB: number) {
  const radioTierraKm = 6371;
  const aLatitud = gradosARadianes(latitudB - latitudA);
  const aLongitud = gradosARadianes(longitudB - longitudA);
  const formulaHaversine =
    Math.sin(aLatitud / 2) ** 2 +
    Math.cos(gradosARadianes(latitudA)) *
      Math.cos(gradosARadianes(latitudB)) *
      Math.sin(aLongitud / 2) ** 2;

  return radioTierraKm * 2 * Math.atan2(Math.sqrt(formulaHaversine), Math.sqrt(1 - formulaHaversine));
}

function gradosARadianes(grados: number) {
  return (grados * Math.PI) / 180;
}

function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
