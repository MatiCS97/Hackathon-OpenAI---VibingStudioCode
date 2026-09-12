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

// Claude avisa que no logro identificar el problema con un centinela que cambia
// segun la corrida: "Desconocido", "<UNKNOWN>", "No identificado". Lo comparten el
// servidor, que reintenta describiendo la foto, y la UI, que pide mas datos.
export function diagnosticoSinIdentificar(diagnostico: Diagnostico) {
  return /desconoc|unknown|no identific|sin identific|indetermin|insuficiente/i.test(
    diagnostico.categoria,
  );
}

// Cuando la base local no tiene a nadie, lo util no es una nota de precios sino
// un lugar al que llamar ahora. Esto es lo que se busca en la web en ese caso.
export interface ProveedorWeb {
  nombre: string;
  telefono: string | null;
  direccion: string | null;
  url: string | null;
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
  proveedores_web: ProveedorWeb[];
}
