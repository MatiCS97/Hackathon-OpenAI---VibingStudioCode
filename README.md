# Agente de diagnóstico y matching de precisión

Proyecto para la hackathon **Agents, Everywhere** (AI Tinkerers x OpenAI). Equipo: **PromecTeam**.

Un agente embebible en cualquier app de servicios: el usuario describe su problema
(texto, foto o voz), y el agente lo diagnostica, busca profesionales que realmente
resuelven ese problema específico (no solo por categoría) y explica por qué recomienda
a cada uno, con costo y tiempo estimados.

Inspirado en el mismo problema que resuelve ChambaYa, pero este es un **prototipo
nuevo e independiente**, construido desde cero durante el evento — no toca código de
producción de ChambaYa.

## Stack

- **Next.js 16** (App Router) + **CopilotKit** para el frontend y la Generative UI del chat.
- **Claude (`claude-sonnet-5`)** para diagnóstico de texto/visión y explicabilidad.
- **Voyage AI** para embeddings (matching semántico contra la base de profesionales).
- **Web Speech API** del navegador para entrada por voz (nativa, sin key).
- Tool nativa `web_search` de Claude como fallback cuando el problema no está cubierto
  por la base local de profesionales.

## Cómo correrlo

```bash
npm install
cp .env.local.example .env.local   # completar ANTHROPIC_API_KEY y VOYAGE_API_KEY
npm run dev
```

Abrir `http://localhost:3000`.

## Dataset

`data/profiles.json` contiene perfiles **sintéticos** de profesionales (rubro,
especialidad, ubicación, rating) generados con `scripts/generate_profiles.py`, usados
solo para la demo. No son datos reales de ninguna plataforma.

```bash
python scripts/generate_profiles.py --count 20000 --out data/profiles.json
```

## Especificación completa

Ver [`CLAUDE.md`](./CLAUDE.md) — contrato de datos, arquitectura, roles y timeline del
equipo para el día del evento.
