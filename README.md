# ServicIA

Proyecto para la hackathon **Agents, Everywhere** (AI Tinkerers x OpenAI). Equipo: **Vibing Studio Code**.

ServicIA es un agente embebible para marketplaces de servicios. El cliente describe un
problema por texto, foto o voz; el agente lo diagnostica, estima costo y tiempo, y
recomienda profesionales con una explicación concreta. Si la base local no alcanza,
enriquece la respuesta con búsqueda web.

Es un prototipo genérico e independiente construido durante el evento.

## Stack

- **Next.js 16** (App Router) y **CopilotKit** para la experiencia de agente y Generative UI.
- **Claude (`claude-sonnet-5`)** para diagnóstico de texto/visión, explicabilidad y
  búsqueda web de respaldo.
- **Gemini `gemini-embedding-001`** para embeddings y matching semántico local.
- **Web Speech API** para entrada por voz, sin API key adicional.
- Geolocalización opcional del navegador para priorizar profesionales cercanos.

## Cómo correrlo

1. Instalar dependencias:

```bash
npm ci
```

2. Crear el archivo de variables de entorno y completar las claves:

```powershell
Copy-Item .env.local.example .env.local
```

```bash
cp .env.local.example .env.local
```

Se requieren estas variables:

```env
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
```

3. Iniciar el proyecto:

```bash
npm run dev
```

Abrir `http://localhost:3000`.

## Perfiles y embeddings

`data/profiles.json` contiene perfiles **sintéticos** de profesionales (rubro,
especialidad, ubicación, rating) generados con `scripts/generate_profiles.py`, usados
solo para la demo. No son datos reales de ninguna plataforma.

`data/profile-embeddings.json` contiene la cache de embeddings que usa el matching y
se versiona para que el proyecto funcione sin volver a procesar perfiles al iniciar.
La cache actual contiene 800 perfiles, una base deliberadamente parcial para la demo.
Cuando Gemini alcanza su cuota, la aplicación mantiene el matching sobre esa base con
un orden local por rubro, especialidad y ubicación.

Para continuar o regenerar la cache con una `GEMINI_API_KEY` disponible:

```bash
npm run embeddings:generate
```

El script retoma la cache existente y guarda checkpoints. El plan gratuito de Gemini
puede imponer límites diarios, por lo que procesar los 20.000 perfiles no es parte del
arranque normal de la aplicación.

```bash
python scripts/generate_profiles.py --count 20000 --out data/profiles.json
```

## Verificación

```bash
npm run lint
npm run build
```

Para desplegar en Vercel, configurar `ANTHROPIC_API_KEY` y `GEMINI_API_KEY` como
variables de entorno del proyecto. No subir `.env.local`: está ignorado por Git.

## Especificación completa

Ver [`CLAUDE.md`](./CLAUDE.md) — contrato de datos, arquitectura, roles y timeline del
equipo para el día del evento.
