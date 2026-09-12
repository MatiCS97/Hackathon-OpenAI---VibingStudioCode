# ServicIA

Proyecto para la hackathon **Agents, Everywhere** (AI Tinkerers x OpenAI). Equipo: **Vibing Studio Code**.

ServicIA es un agente embebible para marketplaces de servicios. El cliente describe un
problema por texto, foto o voz; el agente lo diagnostica, estima costo y tiempo, y
recomienda profesionales con una explicación concreta. Si la base local no alcanza,
enriquece la respuesta con búsqueda web.

Es un prototipo genérico e independiente construido durante el evento.

## Qué tipo de agente es

No es un loop autónomo que decide sus propios pasos: es un **agente de tool use con
pipeline determinístico**. El modelo hace el trabajo que solo un modelo puede hacer —
interpretar lenguaje natural y una foto, y producir un diagnóstico estructurado — y el
código hace el resto: recuperar, filtrar, rankear y explicar. Esa separación es
deliberada, porque el orden de los pasos no depende del problema del cliente y dejarlo
a criterio del modelo agregaría latencia y variabilidad sin ganar nada.

El cliente tiene una sola superficie de interacción. CopilotKit corre en modo
**headless** (`useCopilotChat`): el campo de texto de la página *es* el input del chat,
y el diagnóstico se renderiza como **Generative UI** dentro de la conversación en vez
de como texto. No hay un widget de chat separado compitiendo con el formulario.

## Cómo funciona por dentro

**1. Diagnóstico — `src/lib/diagnostico.ts`**

Claude recibe el texto, la foto, o ambos, y responde a través de una tool con
`tool_choice` forzado. El esquema de esa tool *es* el contrato de datos, así que la
respuesta nunca puede desviarse de la forma esperada.

Cuando una foto no alcanza, el modelo tiende a escaparse con `"Desconocido"` antes que
arriesgar una categoría — es el esquema el que lo presiona, no la falta de visión. En
ese caso se hace un segundo pase pidiéndole que **describa la foto en texto libre**, sin
esquema, y esa descripción vuelve a entrar al mismo paso estructurado. Un modelo
describe mucho más suelto de lo que clasifica.

**2. Matching — `src/lib/matching.ts`**

El diagnóstico se convierte en embedding con Gemini y se compara por similitud coseno
contra los perfiles, cuyos embeddings están pre-calculados y versionados en el repo —
generarlos en caliente tardaría horas contra los límites de la API y no entra en un
request HTTP.

Sobre esa similitud se aplican filtros y factores:

- **Rubro o especialidad** compatible, comparando sin tildes en ambas direcciones
  (el modelo pide "Certificación de gasista matriculado", el perfil declara "Gasista
  matriculado").
- **Certificación**, que ordena en vez de excluir: en una urgencia el cliente necesita a
  alguien ya, y dejar afuera a los no certificados puede devolver cero opciones.
- **Distancia**, con decaimiento continuo desde la geolocalización del navegador.
- **Disponibilidad**.

Si Gemini agota su cuota, el matching cae a una comparación léxica local en vez de
fallar: se pierde precisión semántica, no el servicio.

**3. Explicabilidad — `src/lib/explicabilidad.ts`**

Cada recomendación cita datos concretos del perfil — especialidad declarada,
certificaciones, trabajos completados, ciudad — en vez de una frase genérica.

**4. Enriquecimiento web — tool nativa de Claude**

Dos usos distintos, los dos con citas de la fuente:

- Si el mejor match queda por debajo del umbral, se busca el **costo real de mercado** y
  se reemplaza la estimación, marcando `fuente_estimacion: "web_search"`.
- Si no hay ningún profesional del rubro en la base, se buscan **negocios reales con
  teléfono, dirección y sitio** (`/api/proveedores`). La respuesta útil ahí no es "no
  encontré a nadie", es un número al que llamar.

Una búsqueda web tarda cerca de un minuto y el diagnóstico tarda cuatro segundos, así
que la búsqueda de proveedores vive en su propio endpoint y la página la completa cuando
llega, en vez de bloquear todo. Cualquier fallo de estas búsquedas devuelve vacío sin
afectar el diagnóstico.

**5. Presentación — `src/app/page.tsx`**

Los profesionales se muestran sobre un mapa de **OpenStreetMap** con marcadores
numerados ligados a las tarjetas; al elegir una, el mapa vuela hacia ese profesional.
Leaflet se carga por CDN solo cuando hay algo que ubicar.

El chat ocupa la columna principal mientras no hay resultados —ahí es lo único que puede
destrabar al cliente— y cuando aparecen profesionales se repliega detrás de un botón de
ayuda, para no competir con el resultado.

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
