# Auditoría Claude — Ronda 1

Fecha: 2026-09-12
Auditor: Claude (Orchestator)

## Estado actual del repo

- Scaffold Next.js 16 + CopilotKit funcionando (`src/app/api/copilotkit/route.ts`, `src/components/copilot-provider.tsx`).
- `page.tsx` solo tiene el `CopilotPopup` placeholder, sin UI de diagnóstico.
- `data/profiles.json` generado (20000 perfiles sintéticos).
- Falta: `voyageai` en `package.json` — necesario para embeddings (Paso 2).
- Falta: `.env.example` — nadie sabe qué variables setear sin preguntar en el chat.
- No existe ningún archivo del pipeline real (diagnóstico, matching, explicabilidad).

## Recomendaciones para esta ronda (prioridad orden)

1. **Agregar `.env.example`** con `ANTHROPIC_API_KEY=` y `VOYAGE_API_KEY=` (sin valores reales). Esto evita que alguien commitee `.env.local` sin querer y da el contrato claro.

2. **Instalar `voyageai`** (paquete oficial) y agregarlo a `package.json`.

3. **Paso 1 — Diagnóstico** (`src/lib/diagnostico.ts`):
   - Función `diagnosticar(input: {texto?: string; imagenBase64?: string}): Promise<Diagnostico>`.
   - Llama a Claude (`claude-sonnet-5`) vía `@anthropic-ai/sdk`, con tool/structured output para forzar el JSON exacto del contrato en `CLAUDE.md` (categoria, sub_especialidad, urgencia, certificaciones_requeridas, costo_estimado_min/max, horas_estimadas, fuente_estimacion).
   - No inventar campos nuevos sin actualizar el contrato en `CLAUDE.md`.

4. **Paso 2 — Matching** (`src/lib/matching.ts`):
   - Generar embedding del diagnóstico con Voyage (`voyage-3.5`).
   - Pre-computar (o cachear en disco) embeddings de `data/profiles.json` una sola vez — no repetir la llamada a Voyage por cada perfil en cada request (20000 perfiles × cada búsqueda sería carísimo y lento).
   - Cosine similarity + filtros duros (ubicación, disponibilidad).
   - Si mejor score < umbral (definir ej. 0.55), disparar fallback `web_search` nativo de Claude.

5. **Paso 3 — Explicabilidad**: función que arma el texto citando datos concretos del perfil (no genérico).

6. **`page.tsx`**: reemplazar placeholder por input de texto + botón subir foto + botón mic (Web Speech API), conectado vía `useCopilotAction`/`useCopilotReadable`.

## Cosas a NO hacer (evitar over-engineering para hackathon)

- No armar capa de abstracción de "providers" genérica — solo se usa Claude y Voyage, hardcodear.
- No agregar autenticación, base de datos real, ni testing framework pesado.
- No tocar `scripts/generate_profiles.py` ni regenerar el dataset salvo que cambie el contrato de perfil.

## Siguiente auditoría

Voy a releer el repo después del próximo commit de ChatGPT y actualizar este archivo con una Ronda 2, marcando qué de esta lista quedó hecho, qué falta, y nuevos hallazgos (bugs, desvíos del contrato, etc).
