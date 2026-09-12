@AGENTS.md

# Proyecto: Agente de diagnóstico y matching de precisión

Hackathon "Agents, Everywhere" (AI Tinkerers x OpenAI). Deadline submission: 12 de
septiembre, 5:00 PM EDT. Equipo: PromecTeam. Repo:
https://github.com/MatiCS97/Hackathon-OpenAI---PromecTeam (creado hoy, dentro de la
ventana del evento).

## Regla de elegibilidad — MUY IMPORTANTE

El proyecto debe ser **construido durante el evento**. Todo lo hecho antes de llegar
(ver sección "Ya hecho" abajo) es setup/boilerplate/dataset, NO funcionalidad central.
El pipeline real (diagnóstico → matching → explicabilidad) se escribe en vivo mañana.
No tocar código de producción de ChambaYa — este es un prototipo genérico e
independiente, nuevo, en este repo.

## La idea

Un agente embebible en cualquier app de servicios: el usuario describe su problema
(texto, foto, o voz), y el agente:
1. Diagnostica con precisión (no categoría genérica).
2. Busca profesionales que resuelven ESE problema específico (embeddings, no solo
   categoría).
3. Explica por qué recomienda a cada uno, citando datos concretos del perfil.
4. Estima costo y tiempo aproximados.
5. Si el problema es raro y no hay referencia en la base local, busca en la web con
   la tool nativa de Claude y cita la fuente.

## Stack decidido (y por qué)

- **Modelo de texto/visión: Claude (`claude-sonnet-5`)** vía `@anthropic-ai/sdk` +
  `AnthropicAdapter` de CopilotKit. No OpenAI — sin créditos disponibles, y Claude ya
  probado con texto y visión (ambos funcionan).
- **Embeddings: Voyage AI (`voyage-3.5`)** — Claude no ofrece embeddings, Voyage es
  el proveedor recomendado oficialmente por Anthropic para usar junto con Claude.
  Tier gratis, ya probado y funcionando (1024 dims).
- **Búsqueda web fallback: tool nativa `web_search` de la API de Claude** — mismo
  `ANTHROPIC_API_KEY`, sin vendor nuevo. Se activa SOLO cuando el matching local da
  score bajo (problema no cubierto por `data/profiles.json`).
- **Voz → texto: Web Speech API del navegador** (nativa, gratis, sin key). Transcribe
  y el texto entra al mismo flujo de diagnóstico de siempre. Funciona bien en Chrome
  — usar Chrome para la demo.
- **Frontend: Next.js 16 (App Router) + CopilotKit** (`react-core`, `react-ui`,
  `runtime`). UI de chat via `CopilotPopup` (cambiar a `CopilotChat`/`CopilotSidebar`
  si se quiere integrado en vez de flotante).
- **Dataset: sintético**, generado localmente (ver `scripts/generate_profiles.py`),
  no hay datos reales de ChambaYa disponibles/usados.

## Ya hecho (antes del evento, es setup válido)

- [x] Next.js scaffold + Tailwind + CopilotKit instalado, build probado (`npm run
      build` limpio, `tsc --noEmit` limpio).
- [x] `src/app/api/copilotkit/route.ts` — runtime de CopilotKit con `AnthropicAdapter`
      apuntando a `claude-sonnet-5`.
- [x] `src/components/copilot-provider.tsx` — provider envolviendo el layout.
- [x] `src/app/page.tsx` — página con `CopilotPopup` de prueba (placeholder, se
      reemplaza mañana por la UI real: subir foto/voz, cards de diagnóstico y match).
- [x] `scripts/generate_profiles.py` — genera perfiles sintéticos de profesionales.
      Uso: `python scripts/generate_profiles.py --count 20000 --out
      data/profiles.json`. Corre en <2 seg para 20k, puro stdlib, sin dependencias.
- [x] `data/profiles.json` — dataset de prueba ya generado (20000 perfiles).
- [x] Keys probadas y funcionando: `ANTHROPIC_API_KEY` (texto + visión con
      workspace-scoped key), `VOYAGE_API_KEY` (embeddings).
- [x] Repo GitHub creado (público, vacío): MatiCS97/Hackathon-OpenAI---PromecTeam.

## Contrato de datos (definir/ajustar en los primeros 15 min del evento)

### JSON de diagnóstico (salida del Paso 1)

```json
{
  "categoria": "Plomería",
  "sub_especialidad": "reparación de fugas de gas",
  "urgencia": "alta",
  "certificaciones_requeridas": ["Gasista matriculado"],
  "costo_estimado_min": 150000,
  "costo_estimado_max": 400000,
  "horas_estimadas": 2,
  "fuente_estimacion": "base_local | web_search"
}
```

### JSON de perfil de profesional (ya generado por el script)

Ver `scripts/generate_profiles.py` — campos: `id, nombre, rubro, especialidades[],
certificaciones[], bio, ubicacion{ciudad,lat,lon}, rating, trabajos_completados,
disponible`.

### JSON de match + explicación (salida del Paso 2-3)

```json
{
  "profesional_id": "prof_00123",
  "score": 0.87,
  "explicacion": "Elegido porque su especialidad incluye reparación de fugas de gas, 4 trabajos similares completados, a 3km de distancia."
}
```

Si estos formatos cambian al discutirlo en equipo, ACTUALIZAR este archivo antes de
programar — es el contrato entre módulos.

## Pipeline a construir mañana (en vivo, esto es lo que falta)

1. **Paso 1 — Diagnóstico**: función que llama a Claude con texto/foto/voz-transcripta
   → devuelve el JSON de diagnóstico de arriba (incluye ya el cotizador de
   costo/tiempo, no es un módulo aparte).
2. **Paso 2 — Matching**: genera embedding del diagnóstico con Voyage, compara
   (cosine similarity) contra embeddings de `data/profiles.json`, aplica filtros
   duros (ubicación, disponibilidad). Si el mejor score es bajo, dispara el fallback
   de `web_search` de Claude para estimar costo con datos reales de la web.
3. **Paso 3 — Explicabilidad**: por cada match, generar el texto de "por qué" citando
   datos concretos del perfil.
4. **Frontend**: reemplazar el placeholder de `page.tsx` por: input de texto/foto,
   botón de mic (Web Speech API) para voz, y usar `useCopilotAction` +
   `useCopilotReadable` de CopilotKit para conectar todo esto como Generative UI
   dentro del chat (cards de diagnóstico, cards de profesionales con explicación).
5. **Demo host app**: mini página tipo "marketplace genérico de servicios" para que
   el video de demo no dependa de ChambaYa.

## Roles (sección 5 de la guía)

| Rol | Módulo |
|---|---|
| Diagnóstico | Paso 1 (incluye cotizador) |
| Matching + Explicabilidad | Pasos 2-3 (incluye fallback web_search) |
| Frontend/CopilotKit | UI, voz, Generative UI |
| Integración + Demo | Une todo, prueba end-to-end, graba video, arma submission |

## Timeline del evento (sección 7 de la guía)

11:00–11:15 cerrar contrato · 11:15–11:30 setup repo/ramas · 11:30–13:00 build
paralelo · 13:00–13:15 checkpoint 1 · 13:15–14:45 seguir build · 14:45–15:15
integración final · 15:15–15:30 grabar video · 15:30–16:00 submission.

## Reglas de convivencia en git

- Un repo, ramas o worktrees por módulo/carpeta, commits chicos y frecuentes.
- Nadie edita el mismo archivo en simultáneo sin avisar por chat antes.
- `.env.local` con `ANTHROPIC_API_KEY` y `VOYAGE_API_KEY` NUNCA se commitea (ya está
  en `.gitignore`, patrón `.env*`). Se comparte por chat privado del equipo. Antes del
  primer `git add`, correr `git status` y confirmar que `.env.local` no aparece.
- Una sola key de Claude y una de Voyage para todo el equipo, no una por persona.

## Checklist final de submission (sección 8 de la guía)

- [ ] Título del proyecto
- [ ] Descripción escrita clara
- [ ] Repo de GitHub público (ya creado, falta el contenido)
- [ ] Video de demo de 2 minutos
- [ ] Post en redes sociales etiquetando a los partners del evento
- [ ] Poder explicar qué partes se construyeron durante el evento
