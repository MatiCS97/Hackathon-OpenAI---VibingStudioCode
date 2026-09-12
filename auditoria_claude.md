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

## Ronda 2 — para Codex

Fecha: 2026-09-12
Revisado: commit `8e1cd2f` "Implement diagnostic matching pipeline" (rama `main`).

### Lo que quedó bien (no tocar)

- `src/lib/types.ts`, `diagnostico.ts`, `matching.ts`, `explicabilidad.ts`, `src/app/api/orchestrate/route.ts`: siguen el contrato de `CLAUDE.md` al pie de la letra. Tool-forced JSON en Claude, cache de embeddings en disco, filtros duros, fallback web por umbral — todo como se pidió en la Ronda 1.
- `page.tsx`: UI completa de texto/foto/mic + cards de diagnóstico y matches, conectado a `useCopilotAction`/`useCopilotReadable`. Buen trabajo.

### Bugs a corregir (prioridad alta)

1. **Match por substring falla con tildes.** `data/profiles.json` tiene acentos (`iluminación`, `construcción`, `albañilería`), pero el diagnóstico de Claude puede devolver texto sin tildes o con variaciones. `scoreFiltrosDuros` en `matching.ts` compara con `.includes()` directo → un desajuste de tilde hace que un match válido dé `hardScore = 0` y desaparezca, aunque el embedding semántico sea perfecto.
   - Fix: normalizar (quitar diacríticos) antes de comparar en `scoreFiltrosDuros`, `textoDiagnostico` y `textoPerfil`. Algo simple: `texto.normalize("NFD").replace(/[̀-ͯ]/g, "")` antes de `toLocaleLowerCase`.

2. **Generación de embeddings on-the-fly es riesgo para la demo en vivo.** `cargarOGenerarEmbeddings()` en `matching.ts` genera embeddings de los 20000 perfiles en el primer request si no existe `data/profile-embeddings.json`. Con Voyage en tier gratis y 157 batches secuenciales, el primer diagnóstico en la demo podría tardar minutos o pegar contra rate limit, justo cuando hay que grabar el video.
   - Fix: correr la generación **ahora, de antemano**, como script (`scripts/generate_profile_embeddings.ts` o similar, ejecutado una vez con `VOYAGE_API_KEY` local) y **commitear** `data/profile-embeddings.json` al repo. Así el flujo en vivo solo hace 1 embedding (el del diagnóstico), no 20000.
   - Si el archivo pesa mucho para git, evaluar recortar el dataset de demo a ~1000-2000 perfiles en vez de 20000 (más que suficiente para la demo, y no rompe el contrato).

3. **Escritura de cache puede tirar error en entorno serverless.** `writeFile(EMBEDDINGS_PATH, ...)` en `matching.ts` asume filesystem escribible. Si se despliega en Vercel (serverless, fs efímero/read-only fuera de `/tmp`), esto puede tirar excepción y romper todo el endpoint. Envolver en try/catch y solo loguear un warning si falla — no bloquear la respuesta al usuario. (Se vuelve moot si se resuelve el punto 2 con el archivo pre-generado y commiteado.)

### Pendiente del roadmap (falta empezar)

4. **Demo host app** (sección 5 de `CLAUDE.md`): página tipo "marketplace genérico" que embeba el agente, mostrando el caso de uso real. Todavía no existe — es lo último antes de grabar el video.

5. **README de arranque para el equipo**: agregar al `README.md` los pasos para correr localmente (`npm install`, copiar `.env.example` a `.env.local`, cómo generar embeddings si hace falta, `npm run dev`).

### Qué NO tocar

- No cambiar el contrato de `types.ts`.
- No agregar frameworks de testing pesados — un `assert`/self-check simple alcanza si se agrega algo de validación.
- No regenerar `data/profiles.json` salvo que se decida recortar el dataset (punto 2), y si se hace, avisar en el chat porque afecta a todo el equipo.

## Aviso de coordinación de ramas (leer antes de seguir)

Fecha: 2026-09-12

Confirmado el estado de ramas remotas:

- `main` → `cb1d8aa` (incluye esta auditoría, Ronda 2).
- `diagnostico` (rama de Matias/Codex) → `8e1cd2f`, ya tiene TODO el pipeline
  (`diagnostico.ts`, `matching.ts`, `explicabilidad.ts`, `orchestrate/route.ts`,
  `page.tsx`). Está al día con `main` menos el commit de esta auditoría.
- `Matching` (rama del compañero) → `95eea0f`, **todavía sin cambios propios**.
  El compañero no pusheó nada nuevo todavía.

**Importante para Codex**: como `diagnostico` ya implementó el matching completo
(Paso 2) además del diagnóstico (Paso 1), cuando el compañero pushee a `Matching`
va a haber conflicto/duplicación casi seguro en `src/lib/matching.ts` y
`src/lib/types.ts`. Antes de seguir sumando features nuevas en `diagnostico`:

1. Aplicar primero los 3 fixes de la Ronda 2 (tildes, embeddings pre-generados,
   try/catch en cache) en `diagnostico`, y avisar en el chat del equipo que
   `matching.ts` ya está resuelto en esta rama — así el compañero no lo reescribe
   desde cero en `Matching` y solo se enfoca en lo que falte (demo host app, UI,
   o lo que se reparta).
2. Cuando el compañero pushee a `Matching`, la integración a `main` la va a
   necesitar hacer alguien manualmente (probablemente Matias) comparando ambas
   ramas — avisar acá cuando esté pusheado para que se audite el merge.

## Siguiente auditoría

Voy a releer el repo después del próximo commit de Codex y actualizar este archivo con una Ronda 3.
