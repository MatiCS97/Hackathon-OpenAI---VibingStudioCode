import { readFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import perfiles from "../../data/profiles.json";
import { explicarMatch } from "./explicabilidad";
import type { Diagnostico, MatchProfesional, Profesional } from "./types";

const EMBEDDINGS_PATH = path.join(process.cwd(), "data", "profile-embeddings.json");
const MATCH_THRESHOLD = 0.55;
const TOP_K = 5;
const RADIO_REFERENCIA_KM = 50;
const GEMINI_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;

type PerfilEmbedding = {
  id: string;
  embedding: number[];
};

type CacheEmbeddings = {
  provider: "gemini";
  model: typeof GEMINI_MODEL;
  dimensions: typeof EMBEDDING_DIMENSIONS;
  embeddings: PerfilEmbedding[];
};

export type UbicacionCliente = {
  lat: number;
  lon: number;
};

const profesionales = perfiles as Profesional[];

let embeddingsMemo: Promise<PerfilEmbedding[]> | null = null;

export async function encontrarMatches(
  diagnostico: Diagnostico,
  ubicacionCliente?: UbicacionCliente,
): Promise<{
  matches: MatchProfesional[];
  fallback_web: boolean;
}> {
  const perfilEmbeddings = await cargarEmbeddings();
  let queryEmbedding: number[] | undefined;

  try {
    queryEmbedding = await embedTexto(textoDiagnostico(diagnostico));
  } catch (error) {
    if (!esErrorDeCuotaGemini(error)) throw error;

    console.warn(
      "Gemini no tiene cuota disponible. Se usara matching local hasta que se restablezca.",
    );
  }

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
      const similitud = queryEmbedding
        ? cosineSimilarity(queryEmbedding, item.embedding)
        : scoreTextoLocal(profesional, diagnostico);
      const score = similitud * hardScore * scoreUbicacion;
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
    fallback_web: queryEmbedding
      ? (matches[0]?.score ?? 0) < MATCH_THRESHOLD
      : false,
  };
}

// Generar los embeddings de los 20000 perfiles no entra en el tiempo de un request
// HTTP (son horas contra los limites de Gemini), asi que la cache es un requisito
// de arranque, no algo que se resuelva al vuelo.
async function cargarEmbeddings(): Promise<PerfilEmbedding[]> {
  embeddingsMemo ??= (async () => {
    const cache = await leerCacheEmbeddings();
    if (!cache?.length) {
      throw new Error(
        "Falta la cache de embeddings (data/profile-embeddings.json). Corre `npm run embeddings:generate` antes de levantar el servidor.",
      );
    }

    if (cache.length < profesionales.length) {
      console.warn(
        `Cache de embeddings incompleta: ${cache.length} de ${profesionales.length} perfiles. Los ${profesionales.length - cache.length} restantes no van a aparecer como match.`,
      );
    }

    return cache;
  })();

  return embeddingsMemo;
}

async function leerCacheEmbeddings(): Promise<PerfilEmbedding[] | null> {
  try {
    const raw = await readFile(EMBEDDINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CacheEmbeddings>;
    return parsed.provider === "gemini" &&
      parsed.model === GEMINI_MODEL &&
      parsed.dimensions === EMBEDDING_DIMENSIONS &&
      Array.isArray(parsed.embeddings)
      ? parsed.embeddings
      : null;
  } catch {
    return null;
  }
}

function obtenerClienteGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta GEMINI_API_KEY en el entorno.");
  }

  return new GoogleGenerativeAIEmbeddings({ apiKey, modelName: GEMINI_MODEL });
}

async function embedTexto(texto: string) {
  const embedding = await obtenerClienteGemini().embedQuery(texto);
  if (embedding.length < EMBEDDING_DIMENSIONS) {
    throw new Error("Gemini no devolvio embedding.");
  }

  return reducirEmbedding(embedding);
}

function reducirEmbedding(embedding: number[]) {
  return embedding.slice(0, EMBEDDING_DIMENSIONS);
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

  // Bidireccional como el chequeo de especialidad: Claude pide "Certificacion de
  // gasista matriculado" y el perfil declara "Gasista matriculado", asi que mirar
  // solo si el perfil contiene lo pedido descartaba a los 2471 gasistas del dataset.
  const certificacionCompatible =
    diagnostico.certificaciones_requeridas.length === 0 ||
    diagnostico.certificaciones_requeridas.some((requerida) => {
      const normalizadaRequerida = normalizarTexto(requerida);
      return profesional.certificaciones.some((certificacion) => {
        const normalizada = normalizarTexto(certificacion);
        return (
          normalizada.includes(normalizadaRequerida) ||
          normalizadaRequerida.includes(normalizada)
        );
      });
    });

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
    normalizarTexto(profesional.ubicacion.ciudad),
  ].join(". ");
}

function scoreTextoLocal(profesional: Profesional, diagnostico: Diagnostico) {
  const palabrasDiagnostico = new Set(
    [diagnostico.categoria, diagnostico.sub_especialidad]
      .flatMap((texto) => normalizarTexto(texto).split(/[^a-z0-9]+/))
      .filter((palabra) => palabra.length >= 3),
  );
  const palabrasPerfil = new Set(
    textoPerfil(profesional)
      .split(/[^a-z0-9]+/)
      .filter((palabra) => palabra.length >= 3),
  );
  const coincidencias = [...palabrasDiagnostico].filter((palabra) =>
    palabrasPerfil.has(palabra),
  ).length;

  // Los filtros duros ya validaron rubro/especialidad; este ordena los empates sin API.
  return Math.min(0.9, 0.6 + coincidencias / Math.max(palabrasDiagnostico.size, 1) * 0.3);
}

function esErrorDeCuotaGemini(error: unknown) {
  const mensaje = error instanceof Error ? error.message : String(error);
  return (
    mensaje.includes("Quota exceeded") ||
    mensaje.includes("Too Many Requests") ||
    mensaje.includes("Falta GEMINI_API_KEY")
  );
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

  // Decaimiento continuo y sin piso: con el piso anterior de 0.7, un profesional a
  // 60km y uno a 6000km recibian el mismo factor. Ahora 0km -> 1.0, 25km -> 0.67,
  // 50km -> 0.5, 500km -> 0.09. Es penalizacion, no exclusion: la ubicacion del
  // cliente es opcional y si no se conoce no se penaliza a nadie.
  return RADIO_REFERENCIA_KM / (RADIO_REFERENCIA_KM + distancia);
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
