import type { Diagnostico, Profesional } from "./types";

export function explicarMatch(
  profesional: Profesional,
  diagnostico: Diagnostico,
  score: number,
): string {
  const especialidadesRelevantes = profesional.especialidades.filter((especialidad) =>
    diagnostico.sub_especialidad
      .toLocaleLowerCase("es")
      .includes(especialidad.toLocaleLowerCase("es")),
  );

  const certificacionesRelevantes = profesional.certificaciones.filter((certificacion) =>
    diagnostico.certificaciones_requeridas.some(
      (requerida) =>
        requerida.toLocaleLowerCase("es") === certificacion.toLocaleLowerCase("es") ||
        certificacion.toLocaleLowerCase("es").includes(requerida.toLocaleLowerCase("es")),
    ),
  );

  const razones = [
    `trabaja en ${profesional.rubro}`,
    especialidadesRelevantes.length > 0
      ? `declara especialidad en ${especialidadesRelevantes.join(", ")}`
      : `tiene especialidades cercanas: ${profesional.especialidades.slice(0, 2).join(", ")}`,
    certificacionesRelevantes.length > 0
      ? `cumple certificaciones: ${certificacionesRelevantes.join(", ")}`
      : profesional.certificaciones.length > 0
        ? `cuenta con ${profesional.certificaciones[0]}`
        : "no declara certificaciones especificas",
    `${profesional.trabajos_completados} trabajos completados`,
    `${profesional.rating.toFixed(1)} de rating`,
    `atiende en ${profesional.ubicacion.ciudad}`,
  ];

  return `Elegido para ${diagnostico.sub_especialidad} porque ${razones.join(", ")}. Score ${score.toFixed(2)}.`;
}
