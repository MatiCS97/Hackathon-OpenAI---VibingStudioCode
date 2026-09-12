"use client";

import { useEffect, useState } from "react";
import { useConfiguracionIA } from "@/hooks/use-configuracion-ia";
import {
  MODELOS_POR_PROVEEDOR,
  MODELO_ECONOMICO_POR_PROVEEDOR,
  NOMBRE_PROVEEDOR,
  type ProveedorIA,
} from "@/lib/ia-config";

const PROVEEDORES = Object.keys(NOMBRE_PROVEEDOR) as ProveedorIA[];

const EJEMPLO_DE_KEY: Record<ProveedorIA, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  gemini: "AIza...",
  openrouter: "sk-or-v1-...",
};

// Lo que cambia de proveedor a proveedor mas alla del modelo, dicho antes de que
// el visitante gaste una consulta para descubrirlo.
const NOTA_POR_PROVEEDOR: Partial<Record<ProveedorIA, string>> = {
  gemini:
    "Gemini no expone busqueda web por su API compatible con OpenAI: el diagnostico y el matching funcionan igual, pero no trae telefonos de la web.",
  openrouter:
    "Cualquier slug de openrouter.ai/models sirve, incluidos los que terminan en :free. Elegi uno con vision si vas a subir fotos.",
};

export function BotonConfiguracionIA() {
  const [abierto, setAbierto] = useState(false);
  const configuracion = useConfiguracionIA();
  const { config, modo } = configuracion;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="border border-line px-3 py-1.5 font-[family-name:var(--font-mono)] text-xs text-steel transition hover:border-cobalt hover:text-cobalt"
      >
        {config ? `tu key · ${config.proveedor}` : "Configurar IA"} · {modo === "economico" ? "ahorro" : "completo"}
      </button>

      {abierto ? <PanelConfiguracionIA configuracion={configuracion} onCerrar={() => setAbierto(false)} /> : null}
    </>
  );
}

function PanelConfiguracionIA({ onCerrar, configuracion }: {
  onCerrar: () => void;
  configuracion: ReturnType<typeof useConfiguracionIA>;
}) {
  const { config, guardar, modo, cambiarModo } = configuracion;
  const [proveedor, setProveedor] = useState<ProveedorIA>(config?.proveedor ?? "anthropic");
  const [modelo, setModelo] = useState(
    config?.modelo ?? MODELO_ECONOMICO_POR_PROVEEDOR.anthropic,
  );
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const modelos = MODELOS_POR_PROVEEDOR[proveedor];
  const [personalizado, setPersonalizado] = useState(
    Boolean(config && !modelos.some((item) => item.id === config.modelo)),
  );
  const keyDisponible = apiKey.trim() || (proveedor === config?.proveedor ? config.apiKey : "");

  useEffect(() => {
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);

  const cambiarProveedor = (nuevo: ProveedorIA) => {
    if (nuevo === proveedor) return;
    setProveedor(nuevo);
    setModelo(MODELO_ECONOMICO_POR_PROVEEDOR[nuevo]);
    setPersonalizado(false);
    setApiKey("");
  };

  const guardarYcerrar = () => {
    if (!keyDisponible || !modelo.trim()) return;
    try {
      guardar({ proveedor, modelo: modelo.trim(), apiKey: keyDisponible });
      onCerrar();
    } catch {
      setError("El navegador no permite guardar la configuracion.");
    }
  };

  const volverALaKeyDelEquipo = () => {
    try {
      guardar(null);
      onCerrar();
    } catch {
      setError("El navegador no permite borrar la configuracion.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-20 sm:p-6 sm:pt-24"
      onClick={onCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Configuracion de IA"
        className="ventana-ayuda flex max-h-[calc(100dvh-7rem)] w-full max-w-md flex-col overflow-y-auto border border-line bg-paper shadow-[0_18px_48px_-12px_rgba(5,7,13,0.35)]"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-[family-name:var(--font-display)] text-base font-semibold">
            Usar tu propia IA
          </h2>
          <p className="mt-1 text-sm leading-5 text-steel">
            Tu key queda solo en este navegador. Se manda en cada consulta y
            nunca se guarda en el servidor.
          </p>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <label className="flex items-center justify-between gap-3 text-sm font-medium">
            Modo economico
            <input
              type="checkbox"
              title="Una consulta de diagnostico, matching local y sin busquedas web automaticas"
              checked={modo === "economico"}
              onChange={(evento) => {
                try {
                  cambiarModo(evento.target.checked ? "economico" : "completo");
                } catch {
                  setError("El navegador no permite guardar el modo.");
                }
              }}
              className="h-4 w-4 accent-cobalt"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {PROVEEDORES.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={proveedor === item}
                onClick={() => cambiarProveedor(item)}
                className={`border px-3 py-2 text-sm font-medium transition ${
                  proveedor === item
                    ? "border-cobalt bg-ink text-paper"
                    : "border-line text-ink hover:border-cobalt"
                }`}
              >
                {NOMBRE_PROVEEDOR[item]}
              </button>
            ))}
          </div>

          {NOTA_POR_PROVEEDOR[proveedor] ? (
            <p className="text-sm leading-5 text-steel">{NOTA_POR_PROVEEDOR[proveedor]}</p>
          ) : null}

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-ink">Modelo</span>
              <select
                aria-label="Modelo"
                value={personalizado ? "personalizado" : modelo}
                onChange={(evento) => {
                  const manual = evento.target.value === "personalizado";
                  setPersonalizado(manual);
                  setModelo(manual ? "" : evento.target.value);
                }}
                className="min-w-0 w-full border border-line bg-mist/60 px-3 py-2 text-sm outline-none focus:border-cobalt"
              >
                {modelos.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nombre}
                  </option>
                ))}
                <option value="personalizado">Otro modelo</option>
              </select>
            </label>
          {personalizado ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-ink">
                ID del modelo
              </span>
              <input
                value={modelo}
                onChange={(evento) => setModelo(evento.target.value)}
                placeholder={proveedor === "openrouter" ? "ej: deepseek/deepseek-r1:free" : "ej: gpt-4o-mini"}
                className="border border-line bg-mist/60 px-3 py-2 text-sm outline-none focus:border-cobalt"
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink">
              Tu API key de {NOMBRE_PROVEEDOR[proveedor]}
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(evento) => setApiKey(evento.target.value)}
              placeholder={config?.proveedor === proveedor ? "Key guardada (dejar vacio para conservar)" : EJEMPLO_DE_KEY[proveedor]}
              autoComplete="off"
              className="border border-line bg-mist/60 px-3 py-2 font-[family-name:var(--font-mono)] text-sm outline-none focus:border-cobalt"
            />
          </label>

          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {config ? (
              <button
                type="button"
                onClick={volverALaKeyDelEquipo}
                className="text-sm text-steel underline decoration-steel/30 underline-offset-4 transition hover:text-ink hover:decoration-ink"
              >
                Volver a la key del equipo
              </button>
            ) : (
              <span />
            )}
            <button type="button" onClick={onCerrar} className="text-sm text-steel">Cerrar</button>

            <button
              type="button"
              onClick={guardarYcerrar}
              disabled={!keyDisponible || !modelo.trim()}
              className="bg-cobalt px-3 py-2 text-sm font-semibold text-paper transition hover:bg-[#152fbf] disabled:cursor-not-allowed disabled:bg-steel"
            >
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
