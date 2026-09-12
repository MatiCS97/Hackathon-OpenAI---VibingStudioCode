import { useCallback, useEffect, useState } from "react";
import {
  guardarConfiguracion,
  leerConfiguracionGuardada,
  type ConfiguracionIA,
} from "@/lib/ia-config";

const EVENTO_CAMBIO = "servicia:configuracion-ia-cambio";

// localStorage no dispara el evento "storage" en la misma pestaña que escribe,
// asi que un evento propio es lo que permite que el panel de configuracion y el
// provider de CopilotKit (montados en lugares distintos del arbol) se enteren
// del cambio sin pasar la config por props.
export function useConfiguracionIA() {
  const [config, setConfig] = useState<ConfiguracionIA | null>(null);

  useEffect(() => {
    setConfig(leerConfiguracionGuardada());

    const alCambiar = () => setConfig(leerConfiguracionGuardada());
    window.addEventListener(EVENTO_CAMBIO, alCambiar);
    window.addEventListener("storage", alCambiar);
    return () => {
      window.removeEventListener(EVENTO_CAMBIO, alCambiar);
      window.removeEventListener("storage", alCambiar);
    };
  }, []);

  const guardar = useCallback((nuevo: ConfiguracionIA | null) => {
    guardarConfiguracion(nuevo);
    setConfig(nuevo);
    window.dispatchEvent(new Event(EVENTO_CAMBIO));
  }, []);

  return { config, guardar };
}
