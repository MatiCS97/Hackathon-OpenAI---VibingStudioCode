import { useSyncExternalStore } from "react";
import {
  guardarConfiguracion,
  guardarModo,
  leerConfiguracionGuardada,
  leerModoGuardado,
  type ConfiguracionIA,
  type ModoIA,
} from "@/lib/ia-config";

const EVENTO_CAMBIO = "servicia:configuracion-ia-cambio";
let ultimaConfig: ConfiguracionIA | null = null;

// localStorage no dispara el evento "storage" en la misma pestaña que escribe,
// asi que un evento propio es lo que permite que el panel de configuracion y el
// provider de CopilotKit (montados en lugares distintos del arbol) se enteren
// del cambio sin pasar la config por props.
function suscribir(alCambiar: () => void) {
  window.addEventListener(EVENTO_CAMBIO, alCambiar);
  window.addEventListener("storage", alCambiar);
  return () => {
    window.removeEventListener(EVENTO_CAMBIO, alCambiar);
    window.removeEventListener("storage", alCambiar);
  };
}

function snapshotConfiguracion() {
  const nueva = leerConfiguracionGuardada();
  if (JSON.stringify(nueva) !== JSON.stringify(ultimaConfig)) ultimaConfig = nueva;
  return ultimaConfig;
}

function guardar(nuevo: ConfiguracionIA | null) {
  guardarConfiguracion(nuevo);
  window.dispatchEvent(new Event(EVENTO_CAMBIO));
}

function cambiarModo(nuevo: ModoIA) {
  guardarModo(nuevo);
  window.dispatchEvent(new Event(EVENTO_CAMBIO));
}

export function useConfiguracionIA() {
  const config = useSyncExternalStore(suscribir, snapshotConfiguracion, () => null);
  const modo = useSyncExternalStore(suscribir, leerModoGuardado, () => "economico" as ModoIA);
  return { config, guardar, modo, cambiarModo };
}
