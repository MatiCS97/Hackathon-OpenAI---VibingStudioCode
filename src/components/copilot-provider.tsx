"use client";

import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  const runtimeUrl =
    typeof window === "undefined"
      ? "/api/copilotkit"
      : new URL("/api/copilotkit", window.location.origin).toString();

  return (
    <CopilotKit runtimeUrl={runtimeUrl}>
      {children}
    </CopilotKit>
  );
}
