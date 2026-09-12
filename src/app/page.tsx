"use client";

import { useCallback, useMemo, useState } from "react";
import { CopilotPopup } from "@copilotkit/react-ui";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import type { UbicacionCliente } from "@/lib/matching";
import type { OrquestacionResultado } from "@/lib/types";

type SpeechRecognitionResultLike = {
  readonly length: number;
  [index: number]: { transcript: string };
};

type SpeechRecognitionEventLike = {
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const TIPOS_IMAGEN_ADMITIDOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const TAMANO_MAXIMO_IMAGEN = 5 * 1024 * 1024;

export default function Home() {
  const [texto, setTexto] = useState("");
  const [imagenBase64, setImagenBase64] = useState<string | undefined>();
  const [imagenNombre, setImagenNombre] = useState<string | undefined>();
  const [ubicacion, setUbicacion] = useState<UbicacionCliente | undefined>();
  const [estadoUbicacion, setEstadoUbicacion] = useState<
    "pendiente" | "solicitando" | "activa" | "no_disponible"
  >("pendiente");
  const [resultado, setResultado] = useState<OrquestacionResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resumenCopilot = useMemo(
    () => ({
      texto,
      imagenAdjunta: Boolean(imagenBase64),
      ultimoResultado: resultado,
    }),
    [texto, imagenBase64, resultado],
  );

  useCopilotReadable({
    description:
      "Estado actual del diagnostico, input del usuario y recomendaciones visibles en Orchestator.",
    value: resumenCopilot,
  });

  const ejecutarDiagnostico = useCallback(
    async (textoManual?: string, ubicacionParaMatching = ubicacion) => {
      const textoFinal = textoManual ?? texto;
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/orchestrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto: textoFinal, imagenBase64, ubicacion: ubicacionParaMatching }),
        });

        const payload = (await response.json()) as unknown;

        if (isErrorPayload(payload)) {
          throw new Error(payload.error);
        }

        if (!response.ok) {
          throw new Error("No se pudo ejecutar el flujo.");
        }

        const resultadoPayload = payload as OrquestacionResultado;
        setResultado(resultadoPayload);
        if (textoManual) setTexto(textoManual);
        return resultadoPayload;
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "Error inesperado.";
        setError(message);
        throw caught;
      } finally {
        setLoading(false);
      }
    },
    [imagenBase64, texto, ubicacion],
  );

  const solicitarUbicacion = () =>
    new Promise<UbicacionCliente | undefined>((resolve) => {
      if (ubicacion) {
        resolve(ubicacion);
        return;
      }

      if (!navigator.geolocation) {
        setEstadoUbicacion("no_disponible");
        resolve(undefined);
        return;
      }

      setEstadoUbicacion("solicitando");
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const ubicacionActual = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          };
          setUbicacion(ubicacionActual);
          setEstadoUbicacion("activa");
          resolve(ubicacionActual);
        },
        () => {
          setEstadoUbicacion("no_disponible");
          resolve(undefined);
        },
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
      );
    });

  const diagnosticarConUbicacion = async () => {
    const ubicacionActual = await solicitarUbicacion();
    return ejecutarDiagnostico(undefined, ubicacionActual);
  };

  useCopilotAction(
    {
      name: "diagnosticarProblema",
      description:
        "Diagnostica un problema de servicios y recomienda profesionales usando Orchestator.",
      parameters: [
        {
          name: "texto",
          type: "string",
          description: "Descripcion del problema del usuario.",
          required: true,
        },
      ],
      handler: async ({ texto: textoDesdeChat }) =>
        ejecutarDiagnostico(textoDesdeChat),
    },
    [ejecutarDiagnostico],
  );

  const cargarImagen = async (file?: File) => {
    if (!file) return;

    if (!TIPOS_IMAGEN_ADMITIDOS.includes(file.type)) {
      setError("Usa una imagen PNG, JPG, WebP o GIF. Las fotos HEIC no son compatibles.");
      return;
    }

    if (file.size > TAMANO_MAXIMO_IMAGEN) {
      setError("La imagen debe pesar menos de 5 MB.");
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setImagenBase64(dataUrl);
      setImagenNombre(file.name);
      setError(null);
    } catch {
      setError("No se pudo leer la imagen. Intenta seleccionarla otra vez.");
    }
  };

  const iniciarVoz = () => {
    const speechWindow = window as Window &
      typeof globalThis & {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      };
    const Recognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

    if (!Recognition) {
      setError("La voz funciona en Chrome o navegadores con Web Speech API.");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "es-PY";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript =
        event.results[event.results.length - 1]?.[0]?.transcript ?? "";
      setTexto((current) => `${current} ${transcript}`.trim());
    };
    recognition.onerror = () => setEscuchando(false);
    recognition.onend = () => setEscuchando(false);
    setEscuchando(true);
    recognition.start();
  };

  return (
    <div className="min-h-screen bg-[#f7f4ee] text-[#171717]">
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-[#d9d2c5] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#7b3f30]">
              Marketplace generico de servicios
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-normal text-[#202020]">
              Orchestator
            </h1>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Metric label="Perfiles" value="20k" />
            <Metric label="Modo" value="Claude" />
            <Metric label="Match" value="Voyage" />
          </div>
        </header>

        <section className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="flex flex-col gap-4">
            <div className="border border-[#d8d0c2] bg-white p-4 shadow-sm">
              <label
                htmlFor="problema"
                className="text-sm font-semibold text-[#2f2f2f]"
              >
                Problema del cliente
              </label>
              <textarea
                id="problema"
                value={texto}
                onChange={(event) => setTexto(event.target.value)}
                placeholder="Ej: Hay olor a gas cerca de la cocina y la llave principal esta dura."
                className="mt-3 min-h-44 w-full resize-none border border-[#cfc7ba] bg-[#fbfaf7] p-3 text-base outline-none transition focus:border-[#2f5d50]"
              />

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <label className="flex cursor-pointer items-center justify-center border border-[#2f5d50] px-3 py-2 text-sm font-semibold text-[#2f5d50] transition hover:bg-[#e4efe9]">
                  Foto
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="sr-only"
                    onChange={(event) => cargarImagen(event.target.files?.[0])}
                  />
                </label>
                <button
                  type="button"
                  onClick={iniciarVoz}
                  className="border border-[#71533f] px-3 py-2 text-sm font-semibold text-[#71533f] transition hover:bg-[#efe5dc]"
                >
                  {escuchando ? "Escuchando" : "Microfono"}
                </button>
                <button
                  type="button"
                  onClick={() => void diagnosticarConUbicacion().catch(() => undefined)}
                  disabled={loading || estadoUbicacion === "solicitando"}
                  className="bg-[#1f5b4f] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#17463d] disabled:cursor-not-allowed disabled:bg-[#91aaa3]"
                >
                  {loading ? "Procesando" : "Diagnosticar"}
                </button>
              </div>

              <p className="mt-3 text-sm text-[#625b52]">
                {estadoUbicacion === "activa"
                  ? "Ubicacion actual activa para ordenar profesionales cercanos."
                  : estadoUbicacion === "solicitando"
                    ? "Solicitando ubicacion actual..."
                    : estadoUbicacion === "no_disponible"
                      ? "Se continuara sin ubicacion."
                      : "Al diagnosticar se pedira permiso para usar tu ubicacion actual."}
              </p>

              {imagenNombre ? (
                <div className="mt-3 flex items-center gap-3 border border-[#ded7cb] bg-[#fbfaf7] p-2">
                  {imagenBase64 ? (
                    <img
                      src={imagenBase64}
                      alt="Vista previa de la foto adjunta"
                      className="h-14 w-14 object-cover"
                    />
                  ) : null}
                  <p className="min-w-0 flex-1 truncate text-sm text-[#625b52]">
                    Imagen adjunta: {imagenNombre}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setImagenBase64(undefined);
                      setImagenNombre(undefined);
                    }}
                    className="border border-[#71533f] px-2 py-1 text-sm font-semibold text-[#71533f] transition hover:bg-[#efe5dc]"
                  >
                    Quitar
                  </button>
                </div>
              ) : null}
              {error ? (
                <p className="mt-3 border border-[#d39a8d] bg-[#fff3f0] px-3 py-2 text-sm text-[#8b2f21]">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <QuickPrompt
                title="Emergencia hogar"
                text="Hay una perdida de agua fuerte debajo del lavatorio del bano y no puedo cerrar la llave."
                onPick={setTexto}
              />
              <QuickPrompt
                title="Diagnostico tecnico"
                text="El tablero electrico hace chispas cuando prendo el aire acondicionado."
                onPick={setTexto}
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <DiagnosticoCard resultado={resultado} loading={loading} />
            <Matches resultado={resultado} loading={loading} />
          </div>
        </section>
      </main>

      <CopilotPopup
        labels={{
          title: "Orchestator",
          initial:
            "Describime el problema y puedo correr el diagnostico con la accion diagnosticarProblema.",
        }}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#d8d0c2] bg-white px-3 py-2 text-right">
      <div className="text-xs uppercase tracking-[0.14em] text-[#7a7166]">
        {label}
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function QuickPrompt({
  title,
  text,
  onPick,
}: {
  title: string;
  text: string;
  onPick: (value: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(text)}
      className="border border-[#d8d0c2] bg-white p-3 text-left transition hover:border-[#2f5d50]"
    >
      <div className="text-sm font-semibold text-[#262626]">{title}</div>
      <div className="mt-1 text-sm leading-5 text-[#625b52]">{text}</div>
    </button>
  );
}

function DiagnosticoCard({
  resultado,
  loading,
}: {
  resultado: OrquestacionResultado | null;
  loading: boolean;
}) {
  const diagnostico = resultado?.diagnostico;

  return (
    <section className="border border-[#d8d0c2] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Diagnostico</h2>
        <span className="border border-[#d8d0c2] px-2 py-1 text-xs uppercase tracking-[0.12em] text-[#625b52]">
          {diagnostico?.fuente_estimacion ?? "pendiente"}
        </span>
      </div>

      {loading ? (
        <div className="mt-5 h-28 animate-pulse bg-[#eee8dd]" />
      ) : diagnostico ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Fact label="Categoria" value={diagnostico.categoria} />
          <Fact label="Especialidad" value={diagnostico.sub_especialidad} />
          <Fact label="Urgencia" value={diagnostico.urgencia} />
          <Fact
            label="Tiempo"
            value={`${diagnostico.horas_estimadas} horas`}
          />
          <Fact
            label="Costo estimado"
            value={`${formatMoney(diagnostico.costo_estimado_min)} - ${formatMoney(
              diagnostico.costo_estimado_max,
            )}`}
          />
          <Fact
            label="Certificaciones"
            value={
              diagnostico.certificaciones_requeridas.join(", ") || "Sin requisito"
            }
          />
        </div>
      ) : (
        <p className="mt-4 text-sm leading-6 text-[#625b52]">
          El resultado aparecera aca con categoria, subespecialidad, urgencia,
          certificaciones, costo y tiempo.
        </p>
      )}
    </section>
  );
}

function Matches({
  resultado,
  loading,
}: {
  resultado: OrquestacionResultado | null;
  loading: boolean;
}) {
  return (
    <section className="border border-[#d8d0c2] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Profesionales</h2>
        <span className="text-sm text-[#625b52]">
          {resultado?.fallback_web ? "fallback web activo" : "base local"}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {loading ? (
          <>
            <div className="h-24 animate-pulse bg-[#eee8dd]" />
            <div className="h-24 animate-pulse bg-[#eee8dd]" />
          </>
        ) : resultado?.matches.length ? (
          resultado.matches.map((match) => (
            <article
              key={match.profesional_id}
              className="border border-[#ded7cb] bg-[#fbfaf7] p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{match.profesional.nombre}</h3>
                  <p className="text-sm text-[#625b52]">
                    {match.profesional.rubro} en{" "}
                    {match.profesional.ubicacion.ciudad}
                  </p>
                </div>
                <span className="bg-[#1f5b4f] px-2 py-1 text-sm font-semibold text-white">
                  {(match.score * 100).toFixed(0)}%
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#2f2f2f]">
                {match.explicacion}
              </p>
            </article>
          ))
        ) : (
          <p className="text-sm leading-6 text-[#625b52]">
            Los matches apareceran despues del diagnostico. Se aplican
            disponibilidad, rubro/especialidad y certificaciones duras.
          </p>
        )}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#ded7cb] bg-[#fbfaf7] p-3">
      <div className="text-xs uppercase tracking-[0.14em] text-[#7a7166]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold leading-5">{value}</div>
    </div>
  );
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function isErrorPayload(payload: unknown): payload is { error: string } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-PY", {
    style: "currency",
    currency: "PYG",
    maximumFractionDigits: 0,
  }).format(value);
}
