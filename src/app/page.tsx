"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useCopilotAction,
  useCopilotChatInternal,
  useCopilotReadable,
} from "@copilotkit/react-core";
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
  const { messages, sendMessage, isLoading: chatLoading } = useCopilotChatInternal();

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

  const enviarMensaje = async () => {
    const mensaje = texto.trim();
    if (!mensaje && !imagenBase64) {
      setError("Describe el problema o subi una foto.");
      return;
    }

    await solicitarUbicacion();
    setError(null);
    await sendMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: mensaje
        ? `Usa la accion diagnosticarProblema para diagnosticar este problema: ${mensaje}`
        : "Usa la accion diagnosticarProblema con texto 'Diagnostica el problema de la foto adjunta'. El cliente subio una foto y no escribio descripcion.",
    });
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
      handler: async ({ texto: textoDesdeChat }) => {
        try {
          return await ejecutarDiagnostico(textoDesdeChat);
        } catch {
          return undefined;
        }
      },
      render: ({ status, result }) => (
        <ChatDiagnostico
          status={status}
          resultado={esResultadoOrquestacion(result) ? result : undefined}
          fallido={status === "complete" && result !== undefined && !esResultadoOrquestacion(result)}
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
                  onClick={() => void enviarMensaje().catch(() => undefined)}
                  disabled={loading || chatLoading || estadoUbicacion === "solicitando"}
                  className="bg-cobalt px-3 py-2 text-sm font-semibold text-paper transition hover:bg-[#152fbf] disabled:cursor-not-allowed disabled:bg-steel"
                >
                  {loading || chatLoading ? "Diagnosticando…" : "Diagnosticar"}
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

          <Conversacion
            mensajes={messages}
            resultado={resultado}
            cargando={loading || chatLoading}
          />
        </section>
      </main>

    </div>
  );
}

function Conversacion({
  mensajes,
  resultado,
  cargando,
}: {
  mensajes: Array<{ id: string; role: string; content?: unknown }>;
  resultado: OrquestacionResultado | null;
  cargando: boolean;
}) {
  const mensajesDeTexto = mensajes.filter(
    (mensaje) => typeof mensaje.content === "string" && mensaje.content.trim().length > 0,
  );

  return (
    <section className="flex min-h-[32rem] flex-col border border-line bg-mist/40 p-4">
      <div className="border-b border-line pb-3">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase text-cobalt">
          Conversacion
        </p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-lg font-semibold">
          Diagnostico en curso
        </h2>
      </div>

      <div className="flex flex-1 flex-col gap-3 py-4">
        {mensajesDeTexto.map((mensaje) => (
          <p
            key={mensaje.id}
            className={
              mensaje.role === "user"
                ? "self-end bg-ink px-3 py-2 text-sm leading-6 text-paper"
                : "self-start border border-line bg-paper px-3 py-2 text-sm leading-6 text-ink"
            }
          >
            {mensaje.content as string}
          </p>
        ))}

        {cargando ? <ChatDiagnostico status="executing" /> : null}
        {resultado ? <ChatDiagnostico status="complete" resultado={resultado} /> : null}
        {!cargando && !resultado && mensajesDeTexto.length === 0 ? (
          <p className="m-auto max-w-56 text-center text-sm leading-6 text-steel">
            Describe lo que paso y ServicIA va a encontrar a quien puede resolverlo.
          </p>
        ) : null}
      </div>
    </section>
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
  fallido = false,
}: {
  status: "inProgress" | "executing" | "complete";
  resultado?: OrquestacionResultado;
  fallido?: boolean;
}) {
  if (fallido) {
    return (
      <section className="my-2 border border-[#e2b6ac] bg-[#fff2ef] p-3 text-sm text-[#8b2f21]">
        No se pudo completar el diagnostico. Intenta nuevamente en unos minutos.
      </section>
    );
  }

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

  // Claude devuelve "Desconocido" (u otra variante) cuando la foto no le alcanza
  // para identificar el problema. Mostrar la card normal ahi deja "Desconocido,
  // 0 Gs, 0 h" y cero profesionales, que parece un error en vez de un pedido.
  if (/desconoc|no identific|indetermin/i.test(diagnostico.categoria)) {
    return (
      <section className="my-2 border border-cobalt/30 bg-mist p-3 text-ink">
        <p className="font-[family-name:var(--font-display)] text-sm font-semibold">
          No llego a identificar el problema
        </p>
        <p className="mt-1 text-sm leading-5 text-steel">
          Contame en una frase que esta pasando, o suma una foto mas cercana o con
          mejor luz, y lo diagnostico.
        </p>
      </section>
    );
  }

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

function esResultadoOrquestacion(payload: unknown): payload is OrquestacionResultado {
  if (typeof payload !== "object" || payload === null) return false;

  const resultado = payload as Partial<OrquestacionResultado>;
  return (
    typeof resultado.diagnostico === "object" &&
    resultado.diagnostico !== null &&
    typeof resultado.diagnostico.categoria === "string" &&
    Array.isArray(resultado.matches)
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-PY", {
    style: "currency",
    currency: "PYG",
    maximumFractionDigits: 0,
  }).format(value);
}
