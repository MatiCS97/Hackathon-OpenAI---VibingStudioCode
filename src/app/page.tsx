"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  useCopilotAction,
  useCopilotAdditionalInstructions,
  useCopilotChatInternal,
  useCopilotReadable,
} from "@copilotkit/react-core";
import { BotonConfiguracionIA } from "@/components/panel-configuracion-ia";
import { MapaProfesionales } from "@/components/mapa-profesionales";
import { useConfiguracionIA } from "@/hooks/use-configuracion-ia";
import type { UbicacionCliente } from "@/lib/matching";
import { diagnosticoSinIdentificar } from "@/lib/types";
import type { OrquestacionResultado, ProveedorWeb } from "@/lib/types";

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
  onerror: ((evento: { error?: string }) => void) | null;
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

// El modelo necesita la instruccion explicita para invocar la accion, pero el
// cliente no tiene por que leerla: se envia con el prefijo y se muestra sin el.
const PREFIJO_DIAGNOSTICO =
  "Usa la accion diagnosticarProblema para diagnosticar este problema: ";
const MENSAJE_SOLO_FOTO =
  "Usa la accion diagnosticarProblema con texto 'Diagnostica el problema de la foto adjunta'. El cliente subio una foto y no escribio descripcion.";
// La pantalla ya muestra diagnostico, mapa y telefonos: repetirlos en prosa solo
// alarga la espera. Va en el mensaje y no en las instrucciones del provider
// porque asi llega al modelo sin depender de como CopilotKit arme el contexto.
const SUFIJO_BREVEDAD =
  " Cuando termines, responde en una sola frase corta, texto plano, sin markdown ni emojis, sin repetir el costo, el tiempo ni los nombres que ya se ven en pantalla.";

function textoVisible(contenido: string) {
  const sinSufijo = contenido.endsWith(SUFIJO_BREVEDAD)
    ? contenido.slice(0, -SUFIJO_BREVEDAD.length)
    : contenido;

  if (sinSufijo === MENSAJE_SOLO_FOTO) return "Subi una foto para diagnosticar.";
  return sinSufijo.startsWith(PREFIJO_DIAGNOSTICO)
    ? sinSufijo.slice(PREFIJO_DIAGNOSTICO.length)
    : sinSufijo;
}

// Al modelo se le pide texto plano, pero cuando igual manda markdown el HTML
// colapsa los saltos de linea y queda un parrafo con asteriscos sueltos. Esto
// cubre lo unico que llega a usar: titulos, viñetas y negritas.
function TextoChat({ contenido }: { contenido: string }) {
  const lineas = contenido
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);

  return (
    <>
      {lineas.map((linea, indice) => {
        const esItem = /^(?:[-*•]|\d+[.)])\s+/.test(linea);
        const esTitulo = /^#{1,6}\s+/.test(linea);
        const limpia = linea
          .replace(/^#{1,6}\s+/, "")
          .replace(/^(?:[-*•]|\d+[.)])\s+/, "");

        return (
          <span
            key={indice}
            className={[
              "block",
              indice > 0 ? "mt-1" : "",
              esItem ? "pl-3 -indent-3" : "",
              esTitulo ? "font-semibold" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {esItem ? "· " : null}
            {conNegritas(limpia)}
          </span>
        );
      })}
    </>
  );
}

function conNegritas(texto: string) {
  return texto
    .split(/\*\*(.+?)\*\*/g)
    .map((parte, indice) =>
      indice % 2 === 1 ? <strong key={indice}>{parte}</strong> : parte,
    );
}

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
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const [enfocado, setEnfocado] = useState<string | null>(null);
  const [pregunta, setPregunta] = useState("");
  const [proveedores, setProveedores] = useState<ProveedorWeb[]>([]);
  const [buscandoProveedores, setBuscandoProveedores] = useState(false);
  const { messages, sendMessage, isLoading: chatLoading } = useCopilotChatInternal();
  const { config: configuracionIA } = useConfiguracionIA();

  const matches = resultado?.matches ?? [];
  const hayProfesionales = matches.length > 0;

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

  useCopilotAdditionalInstructions({
    instructions:
      "Despues de usar diagnosticarProblema, el cliente ya ve una tarjeta con la categoria, el costo, el tiempo y los profesionales recomendados. No repitas esos datos. Responde en una o dos frases cortas, en español rioplatense, texto plano: sin markdown, sin asteriscos, sin titulos, sin listas numeradas y sin emojis. Si no hubo profesionales, deci en una frase que te falta informacion y que dato concreto necesitas.",
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
          body: JSON.stringify({
            texto: textoFinal,
            imagenBase64,
            ubicacion: ubicacionParaMatching,
            configuracionIA,
          }),
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
    [imagenBase64, texto, ubicacion, configuracionIA],
  );

  // El diagnostico ya esta en pantalla; los telefonos se piden aparte y se
  // suman cuando llegan, sin hacer esperar al resto.
  useEffect(() => {
    if (!resultado || resultado.matches.length > 0) {
      setProveedores([]);
      return;
    }

    let cancelado = false;
    setBuscandoProveedores(true);

    fetch("/api/proveedores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagnostico: resultado.diagnostico, ubicacion, configuracionIA }),
    })
      .then((respuesta) => respuesta.json())
      .then((datos: { proveedores?: ProveedorWeb[] }) => {
        if (!cancelado) setProveedores(datos.proveedores ?? []);
      })
      .catch(() => {
        if (!cancelado) setProveedores([]);
      })
      .finally(() => {
        if (!cancelado) setBuscandoProveedores(false);
      });

    return () => {
      cancelado = true;
    };
  }, [resultado, ubicacion, configuracionIA]);

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
      content: `${mensaje ? `${PREFIJO_DIAGNOSTICO}${mensaje}` : MENSAJE_SOLO_FOTO}${SUFIJO_BREVEDAD}`,
    });
  };

  // En la ventana de ayuda el cliente repregunta sobre lo que ya vio, asi que el
  // mensaje va tal cual: sin el prefijo que fuerza la accion de diagnostico.
  const enviarPregunta = async () => {
    const texto = pregunta.trim();
    if (!texto) return;

    setPregunta("");
    await sendMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: `${texto}${SUFIJO_BREVEDAD}`,
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
    recognition.onerror = (evento) => {
      setEscuchando(false);
      setError(motivoDeVoz(evento.error));
    };
    recognition.onend = () => setEscuchando(false);

    // start() puede tirar sincronicamente (permiso denegado, otra sesion de voz
    // abierta). Marcar el estado despues evita que el boton quede clavado en
    // "Escuchando" cuando en realidad nunca arranco.
    try {
      recognition.start();
      setError(null);
      setEscuchando(true);
    } catch {
      setEscuchando(false);
      setError(motivoDeVoz());
    }
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
          <BotonConfiguracionIA />
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

          </div>

          {/* Con profesionales en pantalla el chat estorba: queda detras del boton
              de ayuda. Sin resultados es lo unico que puede desbloquear al cliente,
              asi que ocupa el lugar principal. */}
          {hayProfesionales && resultado ? (
            <ResumenDiagnostico
              resultado={resultado}
              onPedirAyuda={() => setAyudaAbierta(true)}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {resultado && (buscandoProveedores || proveedores.length > 0) ? (
                <ProveedoresWeb
                  proveedores={proveedores}
                  buscando={buscandoProveedores}
                />
              ) : null}
              <PanelConversacion
                mensajes={messages}
                cargando={loading || chatLoading}
                vacio={
                  resultado
                    ? "No encontre profesionales para este caso. Contame un poco mas y sigo buscando."
                    : "Contanos el problema y ServicIA encuentra a quien puede resolverlo."
                }
              />
            </div>
          )}
        </section>
      </main>

      {hayProfesionales && resultado ? (
        <MapaProfesionales
          matches={matches}
          cliente={ubicacion}
          enfocado={enfocado}
          onEnfocar={setEnfocado}
        />
      ) : null}

      {ayudaAbierta ? (
        <VentanaAyuda onCerrar={() => setAyudaAbierta(false)}>
          <PanelConversacion
            mensajes={messages}
            cargando={loading || chatLoading}
            vacio="Preguntame lo que quieras sobre el diagnostico o los profesionales."
            sinBorde
          />
          <form
            className="mt-2 flex gap-2 border-t border-line pt-3"
            onSubmit={(evento) => {
              evento.preventDefault();
              void enviarPregunta().catch(() => undefined);
            }}
          >
            <input
              value={pregunta}
              onChange={(evento) => setPregunta(evento.target.value)}
              placeholder="Escribi tu pregunta"
              aria-label="Escribi tu pregunta"
              autoFocus
              className="min-w-0 flex-1 border border-line bg-mist/60 px-3 py-2 text-sm outline-none transition focus:border-cobalt"
            />
            <button
              type="submit"
              disabled={chatLoading || pregunta.trim().length === 0}
              className="bg-cobalt px-3 py-2 text-sm font-semibold text-paper transition hover:bg-[#152fbf] disabled:cursor-not-allowed disabled:bg-steel"
            >
              {chatLoading ? "Pensando…" : "Enviar"}
            </button>
          </form>
        </VentanaAyuda>
      ) : null}
    </div>
  );
}

function PanelConversacion({
  mensajes,
  cargando,
  vacio,
  sinBorde = false,
}: {
  mensajes: Array<{ id: string; role: string; content?: unknown }>;
  cargando: boolean;
  vacio: string;
  sinBorde?: boolean;
}) {
  const finRef = useRef<HTMLDivElement>(null);

  // El resultado de la accion tambien llega como mensaje con contenido string, y
  // sin filtrarlo el JSON entero se imprimia arriba de la card que ya lo muestra.
  const mensajesDeTexto = mensajes.filter((mensaje) => {
    if (mensaje.role !== "user" && mensaje.role !== "assistant") return false;
    if (typeof mensaje.content !== "string") return false;

    const contenido = mensaje.content.trim();
    if (!contenido) return false;

    return !(contenido.startsWith("{") && contenido.includes('"diagnostico"'));
  });

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [mensajesDeTexto.length, cargando]);

  return (
    <section
      className={`flex flex-col ${
        sinBorde ? "min-h-0 flex-1" : "h-[32rem] border border-line bg-mist/40"
      }`}
    >
      <div
        className={`hilo flex-1 overflow-y-auto overscroll-contain ${sinBorde ? "px-1" : "p-4"}`}
      >
        <div className="flex min-h-full flex-col gap-3">
          {mensajesDeTexto.length === 0 && !cargando ? (
            <p className="m-auto max-w-64 text-center text-sm leading-6 text-steel">
              {vacio}
            </p>
          ) : null}

          {mensajesDeTexto.map((mensaje) => (
            <div
              key={mensaje.id}
              className={
                mensaje.role === "user"
                  ? "max-w-[85%] self-end bg-ink px-3 py-2 text-sm leading-6 text-paper"
                  : "max-w-[92%] self-start border border-line bg-paper px-3 py-2 text-sm leading-6 text-ink"
              }
            >
              <TextoChat contenido={textoVisible(mensaje.content as string)} />
            </div>
          ))}

          {cargando ? <ChatDiagnostico status="executing" /> : null}
          <div ref={finRef} />
        </div>
      </div>
    </section>
  );
}

function ResumenDiagnostico({
  resultado,
  onPedirAyuda,
}: {
  resultado: OrquestacionResultado;
  onPedirAyuda: () => void;
}) {
  const { diagnostico, matches, fallback_web, fuentes_web } = resultado;

  return (
    <section className="flex flex-col border border-line bg-paper">
      <div className="border-b border-line p-5">
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold leading-tight">
          {diagnostico.categoria}
        </h2>
        <p className="mt-1 text-sm leading-6 text-steel">
          {diagnostico.sub_especialidad}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-px border-b border-line bg-line">
        <Dato etiqueta="Costo estimado">
          {formatMoney(diagnostico.costo_estimado_min)} –{" "}
          {formatMoney(diagnostico.costo_estimado_max)}
        </Dato>
        <Dato etiqueta="Tiempo">{diagnostico.horas_estimadas} h</Dato>
        <Dato etiqueta="Urgencia">{diagnostico.urgencia}</Dato>
        <Dato etiqueta="Profesionales">{matches.length}</Dato>
      </dl>

      {fallback_web && fuentes_web.length > 0 ? (
        <div className="border-b border-line p-4">
          <p className="text-sm text-steel">
            El costo sale de precios publicados esta semana:
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {fuentes_web.slice(0, 3).map((fuente) => (
              <li key={fuente.url}>
                <a
                  href={fuente.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm leading-5 text-cobalt underline decoration-cobalt/30 underline-offset-4 transition hover:decoration-cobalt"
                >
                  {fuente.titulo}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onPedirAyuda}
        className="flex items-center justify-center gap-2 p-4 text-sm font-semibold text-cobalt transition hover:bg-mist"
      >
        <IconoAyuda />
        Preguntarle a ServicIA
      </button>
    </section>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="bg-paper p-4">
      <dt className="text-xs text-steel">{etiqueta}</dt>
      <dd className="mt-1 font-[family-name:var(--font-mono)] text-sm text-ink">
        {children}
      </dd>
    </div>
  );
}

function VentanaAyuda({
  children,
  onCerrar,
}: {
  children: ReactNode;
  onCerrar: () => void;
}) {
  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", alTeclear);

    return () => {
      document.body.style.overflow = previo;
      window.removeEventListener("keydown", alTeclear);
    };
  }, [onCerrar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-ink/40 p-4 sm:p-6"
      onClick={onCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ayuda de ServicIA"
        className="ventana-ayuda flex max-h-[min(36rem,85vh)] w-full max-w-md flex-col border border-line bg-paper shadow-[0_18px_48px_-12px_rgba(5,7,13,0.35)]"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-[family-name:var(--font-display)] text-base font-semibold">
            Ayuda de ServicIA
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar la ayuda"
            className="p-1 text-steel transition hover:text-ink"
          >
            <IconoCerrar />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-3">{children}</div>
      </div>
    </div>
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
  if (diagnosticoSinIdentificar(diagnostico)) {
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
          <h3 className="font-[family-name:var(--font-display)] text-base font-semibold">
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
        <p className="text-sm text-steel">Profesionales recomendados</p>
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
              No encontramos profesionales para este caso. Contame un poco mas
              sobre el problema o proba con otra foto, y vuelvo a buscar.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// En el celular el microfono fallaba sin decir nada: el handler descartaba el
// codigo de error, asi que un permiso denegado se veia igual que no pasar nada.
function motivoDeVoz(codigo?: string) {
  if (codigo === "not-allowed" || codigo === "service-not-allowed") {
    return "El navegador bloqueo el microfono. Habilitalo para este sitio y proba de nuevo.";
  }

  if (codigo === "no-speech") {
    return "No te escuche. Proba de nuevo hablando cerca del microfono.";
  }

  if (codigo === "audio-capture") {
    return "No encontre un microfono disponible en este dispositivo.";
  }

  if (codigo === "network") {
    return "La transcripcion necesita conexion y no pudo conectarse.";
  }

  return "No se pudo usar el microfono. Escribi el problema y sigo igual.";
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

function IconoAyuda() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5 9.4 5.6 13.5 7 9.4 8.4 8 12.5 6.6 8.4 2.5 7 6.6 5.6 8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M12.6 11.4v3M11.1 12.9h3" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconoCerrar() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function ProveedoresWeb({
  proveedores,
  buscando,
}: {
  proveedores: ProveedorWeb[];
  buscando: boolean;
}) {
  return (
    <section className="border border-line bg-paper">
      <div className="border-b border-line p-4">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Nadie registrado, pero estos atienden
        </h2>
        <p className="mt-1 text-sm leading-6 text-steel">
          {buscando
            ? "No hay profesionales de este rubro en la base todavía. Estoy buscando en la web a quién podés llamar."
            : "No hay profesionales de este rubro en la base todavía, así que los busqué en la web. Podés llamarlos directo."}
        </p>
      </div>

      {buscando && proveedores.length === 0 ? (
        <div className="flex flex-col gap-2 p-4">
          <div className="h-10 animate-pulse bg-mist" />
          <div className="h-10 animate-pulse bg-mist" />
        </div>
      ) : null}

      <ul className="flex flex-col">
        {proveedores.map((proveedor) => (
          <li
            key={`${proveedor.nombre}-${proveedor.telefono ?? proveedor.url ?? ""}`}
            className="border-b border-line p-4 last:border-b-0"
          >
            <p className="font-medium text-ink">{proveedor.nombre}</p>
            {proveedor.direccion ? (
              <p className="mt-1 text-sm leading-5 text-steel">
                {proveedor.direccion}
              </p>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-4">
              {proveedor.telefono ? (
                <a
                  href={`tel:${proveedor.telefono.replace(/[^+\d]/g, "")}`}
                  className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-sm font-medium text-cobalt underline decoration-cobalt/30 underline-offset-4 transition hover:decoration-cobalt"
                >
                  <IconoTelefono />
                  {proveedor.telefono}
                </a>
              ) : null}
              {proveedor.url ? (
                <a
                  href={proveedor.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-steel underline decoration-steel/30 underline-offset-4 transition hover:text-ink hover:decoration-ink"
                >
                  Ver sitio
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IconoTelefono() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.2 2.5H3.1c-.6 0-1.1.5-1 1.1.2 2.4 1.2 4.7 2.9 6.4 1.7 1.7 4 2.7 6.4 2.9.6.1 1.1-.4 1.1-1v-2.1c0-.5-.3-.9-.8-1l-1.8-.4c-.4-.1-.8.1-1 .4l-.6.9A8.4 8.4 0 0 1 5.3 6.7l.9-.6c.3-.2.5-.6.4-1l-.4-1.8c-.1-.5-.5-.8-1-.8Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
