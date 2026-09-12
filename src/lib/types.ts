export type Urgencia = "baja" | "media" | "alta";
export type FuenteEstimacion = "base_local" | "web_search";

export interface Diagnostico {
  categoria: string;
  sub_especialidad: string;
  urgencia: Urgencia;
  certificaciones_requeridas: string[];
  costo_estimado_min: number;
  costo_estimado_max: number;
  horas_estimadas: number;
  fuente_estimacion: FuenteEstimacion;
}

export interface Profesional {
  id: string;
  nombre: string;
  rubro: string;
  especialidades: string[];
  certificaciones: string[];
  bio: string;
  ubicacion: {
    ciudad: string;
    lat: number;
    lon: number;
  };
  rating: number;
  trabajos_completados: number;
  disponible: boolean;
}

export interface MatchProfesional {
  profesional_id: string;
  score: number;
  explicacion: string;
  profesional: Profesional;
}

// Claude responde "Desconocido" (u otra variante) cuando no logra identificar el
// problema. Lo comparten el servidor, que reintenta, y la UI, que pide mas datos.
export function diagnosticoSinIdentificar(diagnostico: Diagnostico) {
  return /desconoc|no identific|indetermin/i.test(diagnostico.categoria);
}

export interface FuenteWeb {
  titulo: string;
  url: string;
}

export interface OrquestacionResultado {
  diagnostico: Diagnostico;
  matches: MatchProfesional[];
  fallback_web: boolean;
  fuentes_web: FuenteWeb[];
}
