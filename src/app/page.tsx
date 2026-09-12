"use client";

import { CopilotPopup } from "@copilotkit/react-ui";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-center gap-4 py-32 px-16 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Orchestator
        </h1>
        <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
          Agente de IA listo. Abrí el chat (abajo a la derecha) para hablar
          con el modelo.
        </p>
      </main>
      <CopilotPopup
        labels={{
          title: "Asistente",
          initial: "Hola! ¿En qué te ayudo?",
        }}
      />
    </div>
  );
}
