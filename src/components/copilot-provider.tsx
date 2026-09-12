"use client";

import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
import { useConfiguracionIA } from "@/hooks/use-configuracion-ia";

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  const runtimeUrl =
    typeof window === "undefined"
      ? "/api/copilotkit"
      : new URL("/api/copilotkit", window.location.origin).toString();

  // Si el visitante cargo su propia key, viaja como headers hacia el runtime de
  // CopilotKit (el body de ese endpoint es su propio protocolo, no uno propio).
  const { config, modo } = useConfiguracionIA();
  const headers = {
    "x-servicia-modo": modo,
    ...(config ? {
        "x-servicia-proveedor": config.proveedor,
        "x-servicia-modelo": config.modelo,
        "x-servicia-api-key": config.apiKey,
      } : {}),
  };

  return (
    <CopilotKit runtimeUrl={runtimeUrl} headers={headers}>
      {children}
    </CopilotKit>
  );
}
