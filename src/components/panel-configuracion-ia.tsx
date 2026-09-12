"use client";

import { useEffect, useState } from "react";
import { useConfiguracionIA } from "@/hooks/use-configuracion-ia";
import { MODELOS_ANTHROPIC, type ProveedorIA } from "@/lib/ia-config";

export function BotonConfiguracionIA() {
  const [abierto, setAbierto] = useState(false);
  const { config } = useConfiguracionIA();

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="border border-line px-3 py-1.5 font-[family-name:var(--font-mono)] text-xs text-steel transition hover:border-cobalt hover:text-cobalt"
      >
        {config ? `tu key · ${config.proveedor}` : "usar tu propia key"}
      </button>

      {abierto ? <PanelConfiguracionIA onCerrar={() => setAbierto(false)} /> : null}
    </>
  );
}

function PanelConfiguracionIA({ onCerrar }: { onCerrar: () => void }) {
  const { config, guardar } = useConfiguracionIA();
  const [proveedor, setProveedor] = useState<ProveedorIA>(config?.proveedor ?? "anthropic");
  const [modelo, setModelo] = useState(
    config?.modelo ?? MODELOS_ANTHROPIC[0].id,
  );
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);

  const cambiarProveedor = (nuevo: ProveedorIA) => {
    setProveedor(nuevo);
    setModelo(nuevo === "anthropic" ? MODELOS_ANTHROPIC[0].id : "");
  };

  const guardarYcerrar = () => {
    if (!apiKey.trim() || !modelo.trim()) return;
    guardar({ proveedor, modelo: modelo.trim(), apiKey: apiKey.trim() });
    onCerrar();
  };

  const volverALaKeyDelEquipo = () => {
    guardar(null);
    onCerrar();
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
        className="ventana-ayuda flex w-full max-w-md flex-col border border-line bg-paper shadow-[0_18px_48px_-12px_rgba(5,7,13,0.35)]"
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
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => cambiarProveedor("anthropic")}
              className={`border px-3 py-2 text-sm font-medium transition ${
                proveedor === "anthropic"
                  ? "border-cobalt bg-ink text-paper"
                  : "border-line text-ink hover:border-cobalt"
              }`}
            >
              Claude (Anthropic)
            </button>
            <button
              type="button"
              onClick={() => cambiarProveedor("openai")}
              className={`border px-3 py-2 text-sm font-medium transition ${
                proveedor === "openai"
                  ? "border-cobalt bg-ink text-paper"
                  : "border-line text-ink hover:border-cobalt"
              }`}
            >
              OpenAI
            </button>
          </div>

          {proveedor === "anthropic" ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-ink">Modelo</span>
              <select
                value={modelo}
                onChange={(evento) => setModelo(evento.target.value)}
                className="border border-line bg-mist/60 px-3 py-2 text-sm outline-none focus:border-cobalt"
              >
                {MODELOS_ANTHROPIC.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-ink">
                Modelo (nombre exacto de tu cuenta de OpenAI)
              </span>
              <input
                value={modelo}
                onChange={(evento) => setModelo(evento.target.value)}
                placeholder="ej: gpt-4o-mini"
                className="border border-line bg-mist/60 px-3 py-2 text-sm outline-none focus:border-cobalt"
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink">
              Tu API key de {proveedor === "anthropic" ? "Anthropic" : "OpenAI"}
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(evento) => setApiKey(evento.target.value)}
              placeholder={proveedor === "anthropic" ? "sk-ant-..." : "sk-..."}
              autoComplete="off"
              className="border border-line bg-mist/60 px-3 py-2 font-[family-name:var(--font-mono)] text-sm outline-none focus:border-cobalt"
            />
          </label>

          <div className="flex items-center justify-between gap-2 pt-1">
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

            <button
              type="button"
              onClick={guardarYcerrar}
              disabled={!apiKey.trim() || !modelo.trim()}
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
