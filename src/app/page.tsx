"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type AnimeInstance = { pause: () => void };
type AnimeParams = Record<string, unknown>;
type AnimeFn = ((params: AnimeParams) => AnimeInstance) & {
  stagger: (value: number) => unknown;
};

declare global {
  interface Window {
    anime?: AnimeFn;
  }
}

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

  const micRingsRef = useRef<HTMLSpanElement>(null);
  const micAnimRef = useRef<AnimeInstance | null>(null);

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
      "Estado actual del diagnostico, input del usuario y recomendaciones visibles en ServicIA.",
    value: resumenCopilot,
  });

  useEffect(() => {
    const anime = window.anime;
    const targets = micRingsRef.current?.querySelectorAll(".mic-ring");
    if (!anime || !targets || targets.length === 0) return;

    if (escuchando) {
      micAnimRef.current = anime({
        targets,
        scale: [1, 2.8],
        opacity: [0.6, 0],
        easing: "easeOutSine",
        duration: 1300,
        loop: true,
        delay: anime.stagger(320),
      });
    } else {
      micAnimRef.current?.pause();
      micAnimRef.current = null;
      targets.forEach((el) => {
        (el as HTMLElement).style.opacity = "0";
        (el as HTMLElement).style.transform = "scale(1)";
      });
    }

    return () => {
      micAnimRef.current?.pause();
    };
  }, [escuchando]);

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
        "Diagnostica un problema de servicios y recomienda profesionales usando ServicIA.",
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
      render: ({ status, result }) => (
        <ChatDiagnostico
          status={status}
          resultado={result as OrquestacionResultado | undefined}
        />
      ),
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
    <div className="min-h-screen bg-paper text-ink">
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-line pb-5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cobalt" />
            </span>
            <span className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
              Servic<span className="text-cobalt">IA</span>
            </span>
          </div>
          <p className="font-[family-name:var(--font-mono)] text-xs text-steel">
            20 000 profesionales conectados
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start">
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
                Contanos qué
                <br />
                se rompió.
              </h1>
              <p className="mt-4 max-w-md text-base leading-6 text-steel">
                Sacale una foto, describilo o hablalo. ServicIA lo diagnostica
                al instante y te conecta con quien puede resolverlo hoy.
              </p>
            </div>

            <div className="border border-line bg-paper p-4">
              <label htmlFor="problema" className="text-sm font-medium text-ink">
                Qué te está pasando
              </label>
              <textarea
                id="problema"
                value={texto}
                onChange={(event) => setTexto(event.target.value)}
                placeholder="Ej: hay olor a gas cerca de la cocina y la llave principal está dura."
                className="mt-3 min-h-40 w-full resize-none border border-line bg-mist/60 p-3 text-base leading-6 outline-none transition focus:border-cobalt"
              />

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <label className="flex cursor-pointer items-center justify-center border border-line px-3 py-2 text-sm font-medium text-ink transition hover:border-cobalt hover:text-cobalt">
                  Subir foto
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
                  className={`relative flex items-center justify-center gap-2 border px-3 py-2 text-sm font-medium transition ${
                    escuchando
                      ? "border-cobalt bg-ink text-paper"
                      : "border-line text-ink hover:border-cobalt hover:text-cobalt"
                  }`}
                >
                  <span ref={micRingsRef} className="relative flex h-2 w-2 items-center justify-center">
                    <span className="mic-ring absolute h-2 w-2 rounded-full bg-signal opacity-0" />
                    <span className="mic-ring absolute h-2 w-2 rounded-full bg-signal opacity-0" />
                    <span
                      className={`relative h-2 w-2 rounded-full ${
                        escuchando ? "bg-signal" : "bg-steel"
                      }`}
                    />
                  </span>
                  {escuchando ? "Escuchando…" : "Hablar"}
                </button>

                <button
                  type="button"
                  onClick={() => void diagnosticarConUbicacion().catch(() => undefined)}
                  disabled={loading || estadoUbicacion === "solicitando"}
                  className="bg-cobalt px-3 py-2 text-sm font-semibold text-paper transition hover:bg-[#152fbf] disabled:cursor-not-allowed disabled:bg-steel"
                >
                  {loading ? "Diagnosticando…" : "Diagnosticar"}
                </button>
              </div>

              <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-steel">
                {estadoUbicacion === "activa"
                  ? "ubicación activa — se prioriza cercanía"
                  : estadoUbicacion === "solicitando"
                    ? "solicitando ubicación…"
                    : estadoUbicacion === "no_disponible"
                      ? "sin ubicación — se continúa igual"
                      : "al diagnosticar se pide tu ubicación"}
              </p>

              {imagenNombre ? (
                <div className="mt-3 flex items-center gap-3 border border-line bg-mist/60 p-2">
                  {imagenBase64 ? (
                    <img
                      src={imagenBase64}
                      alt="Vista previa de la foto adjunta"
                      className="h-14 w-14 object-cover"
                    />
                  ) : null}
                  <p className="min-w-0 flex-1 truncate text-sm text-steel">
                    {imagenNombre}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setImagenBase64(undefined);
                      setImagenNombre(undefined);
                    }}
                    className="border border-line px-2 py-1 text-sm font-medium text-ink transition hover:border-cobalt hover:text-cobalt"
                  >
                    Quitar
                  </button>
                </div>
              ) : null}
              {error ? (
                <p className="mt-3 border border-[#e2b6ac] bg-[#fff2ef] px-3 py-2 text-sm text-[#8b2f21]">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <QuickPrompt
                title="Emergencia hogar"
                text="Hay una pérdida de agua fuerte debajo del lavatorio del baño y no puedo cerrar la llave."
                onPick={setTexto}
              />
              <QuickPrompt
                title="Riesgo eléctrico"
                text="El tablero eléctrico hace chispas cuando prendo el aire acondicionado."
                onPick={setTexto}
              />
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <SignalPanel resultado={resultado} loading={loading} />
            <Matches resultado={resultado} loading={loading} />
          </div>
        </section>
      </main>

      <CopilotPopup
        labels={{
          title: "ServicIA",
          initial:
            "Describime el problema y puedo correr el diagnóstico con la acción diagnosticarProblema.",
        }}
      />
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
      className="border border-line bg-paper p-3 text-left transition hover:border-cobalt"
    >
      <div className="text-sm font-medium text-ink">{title}</div>
      <div className="mt-1 text-sm leading-5 text-steel">{text}</div>
    </button>
  );
}

function ChatDiagnostico({
  status,
  resultado,
}: {
  status: "inProgress" | "executing" | "complete";
  resultado?: OrquestacionResultado;
}) {
  if (status !== "complete" || !resultado) {
    return (
      <section className="my-2 border border-cobalt/30 bg-mist p-3 text-ink">
        <div className="flex items-center gap-3">
          <span className="relative flex h-7 w-7 items-center justify-center">
            <span className="sonar-ring absolute h-7 w-7 rounded-full border border-cobalt" />
            <span
              className="sonar-ring absolute h-7 w-7 rounded-full border border-cobalt"
              style={{ animationDelay: "0.8s" }}
            />
            <span className="relative h-2 w-2 rounded-full bg-cobalt" />
          </span>
          <div>
            <p className="font-[family-name:var(--font-display)] text-sm font-semibold">
              Diagnosticando
            </p>
            <p className="font-[family-name:var(--font-mono)] text-xs text-steel">
              Analizando el problema y buscando profesionales.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const { diagnostico, matches } = resultado;
  return (
    <section className="my-2 border border-line bg-paper p-3 text-ink">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase text-cobalt">
            Diagnostico listo
          </p>
          <h3 className="mt-1 font-[family-name:var(--font-display)] text-base font-semibold">
            {diagnostico.categoria}
          </h3>
          <p className="text-sm text-steel">{diagnostico.sub_especialidad}</p>
        </div>
        <span className="border border-line px-2 py-1 font-[family-name:var(--font-mono)] text-[11px] text-steel">
          {diagnostico.urgencia}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-px bg-line font-[family-name:var(--font-mono)] text-xs">
        <div className="bg-paper p-2">
          <span className="block text-steel">costo</span>
          {formatMoney(diagnostico.costo_estimado_min)} - {formatMoney(diagnostico.costo_estimado_max)}
        </div>
        <div className="bg-paper p-2">
          <span className="block text-steel">tiempo</span>
          {diagnostico.horas_estimadas} h estimadas
        </div>
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase text-steel">
          Profesionales recomendados
        </p>
        <div className="mt-2 flex flex-col gap-2">
          {matches.slice(0, 3).map((match) => (
            <article key={match.profesional_id} className="border-l-2 border-cobalt pl-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">{match.profesional.nombre}</p>
                <span className="font-[family-name:var(--font-mono)] text-xs text-cobalt">
                  {(match.score * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-xs text-steel">
                {match.profesional.rubro} · {match.profesional.ubicacion.ciudad}
              </p>
              <p className="mt-1 text-xs leading-5 text-ink">{match.explicacion}</p>
            </article>
          ))}
          {matches.length === 0 ? (
            <p className="text-xs leading-5 text-steel">
              No encontramos profesionales disponibles para este caso.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SignalPanel({
  resultado,
  loading,
}: {
  resultado: OrquestacionResultado | null;
  loading: boolean;
}) {
  const diagnostico = resultado?.diagnostico;

  return (
    <section className="border border-line bg-ink p-5 text-paper">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Diagnóstico
        </h2>
        <span className="font-[family-name:var(--font-mono)] text-xs text-signal">
          {diagnostico ? diagnostico.fuente_estimacion : "en espera"}
        </span>
      </div>

      {loading ? (
        <div className="relative mt-8 flex h-40 items-center justify-center">
          <span className="sonar-ring absolute h-16 w-16 rounded-full border border-signal" />
          <span
            className="sonar-ring absolute h-16 w-16 rounded-full border border-signal"
            style={{ animationDelay: "0.9s" }}
          />
          <span
            className="sonar-ring absolute h-16 w-16 rounded-full border border-signal"
            style={{ animationDelay: "1.8s" }}
          />
          <span className="relative h-3 w-3 rounded-full bg-signal" />
        </div>
      ) : diagnostico ? (
        <div className="mt-5 grid gap-3 font-[family-name:var(--font-mono)] text-sm sm:grid-cols-2">
          <Fact label="categoria" value={diagnostico.categoria} />
          <Fact label="especialidad" value={diagnostico.sub_especialidad} />
          <Fact label="urgencia" value={diagnostico.urgencia} />
          <Fact label="tiempo" value={`${diagnostico.horas_estimadas} h`} />
          <Fact
            label="costo"
            value={`${formatMoney(diagnostico.costo_estimado_min)} – ${formatMoney(
              diagnostico.costo_estimado_max,
            )}`}
          />
          <Fact
            label="certificaciones"
            value={
              diagnostico.certificaciones_requeridas.join(", ") || "ninguna"
            }
          />
        </div>
      ) : (
        <div className="mt-8 flex h-40 flex-col items-center justify-center gap-3 text-center">
          <span className="h-2 w-2 rounded-full bg-signal/40" />
          <p className="max-w-56 text-sm leading-6 text-paper/60">
            Esperando una señal. El diagnóstico va a aparecer acá con
            categoría, urgencia, costo y tiempo.
          </p>
        </div>
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
    <section className="border border-line bg-paper p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Profesionales
        </h2>
        <span className="font-[family-name:var(--font-mono)] text-xs text-steel">
          {resultado?.fallback_web ? "búsqueda web" : "base local"}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {loading ? (
          <>
            <div className="h-20 animate-pulse bg-mist" />
            <div className="h-20 animate-pulse bg-mist" />
          </>
        ) : resultado?.matches.length ? (
          resultado.matches.map((match, index) => (
            <article
              key={match.profesional_id}
              className="flex gap-4 border-t border-line py-3 first:border-t-0"
            >
              <span className="font-[family-name:var(--font-mono)] text-sm text-steel">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-medium text-ink">
                    {match.profesional.nombre}
                  </h3>
                  <span className="font-[family-name:var(--font-mono)] text-sm font-medium text-cobalt">
                    {(match.score * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-sm text-steel">
                  {match.profesional.rubro} · {match.profesional.ubicacion.ciudad}
                </p>
                <p className="mt-2 text-sm leading-6 text-ink">
                  {match.explicacion}
                </p>
              </div>
            </article>
          ))
        ) : (
          <p className="text-sm leading-6 text-steel">
            Los profesionales van a aparecer acá después del diagnóstico,
            ordenados por qué tan bien resuelven tu problema específico.
          </p>
        )}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-paper/15 px-3 py-2">
      <div className="text-signal/80">{label}</div>
      <div className="mt-1 text-paper">{value}</div>
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
