# ServicIA

Proyecto para la hackathon **Agents, Everywhere** (AI Tinkerers x OpenAI). Equipo: **Vibing Studio Code**.

ServicIA es un agente embebible para marketplaces de servicios. El cliente describe un
problema por texto, foto o voz; el agente lo diagnostica, estima costo y tiempo, y
recomienda profesionales con una explicación concreta. El modo económico está activo
por defecto; el modo completo agrega conversación y enriquecimiento web automático.

Es un prototipo genérico e independiente construido durante el evento.

## Qué tipo de agente es

No es un loop autónomo que decide sus propios pasos: es un **agente de tool use con
pipeline determinístico**. El modelo hace el trabajo que solo un modelo puede hacer —
interpretar lenguaje natural y una foto, y producir un diagnóstico estructurado — y el
código hace el resto: recuperar, filtrar, rankear y explicar. Esa separación es
deliberada, porque el orden de los pasos no depende del problema del cliente y dejarlo
a criterio del modelo agregaría latencia y variabilidad sin ganar nada.

En modo completo, CopilotKit corre en modo **headless** y puede invocar la acción de
diagnóstico desde el chat. En modo económico, el botón llama directamente al pipeline
y muestra el mismo resumen, evitando las llamadas de chat antes y después del diagnóstico.
El chat sigue disponible para preguntas explícitas sobre el resultado.

## Modelos y consumo

En **Configurar IA**, cada visitante puede guardar su API key de Anthropic, OpenAI,
Google Gemini u OpenRouter, elegir un modelo de la lista o ingresar otro ID compatible
con visión y salida estructurada. Cambiar de modelo del mismo proveedor conserva la key
guardada.
La configuración se guarda en `localStorage` del navegador y se envía al servidor
para cada consulta; la aplicación no escribe las claves en archivos, logs ni Git.
Usar **Volver a la key del equipo** elimina la clave personal guardada.

La lista de OpenAI incluye GPT-5 nano, GPT-4o mini, GPT-5.4 nano y GPT-5.4 mini.
GPT-5 nano tiene la menor tarifa por token de esta lista: USD 0,05 por millón de
tokens de entrada y USD 0,40 de salida. Los tokens de razonamiento también cuentan;
la opción más barata por solicitud depende del trabajo y del modelo.
Fuentes verificadas el 12/09/2026: [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano),
[GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini),
[GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano),
[GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
El acceso a cada modelo depende de la cuenta del visitante.

**Gemini y OpenRouter** entran por la misma ruta: ambos exponen el dialecto de OpenAI
en `/chat/completions`, así que se usa el mismo SDK con otra `baseURL`
(`generativelanguage.googleapis.com/v1beta/openai/` y `openrouter.ai/api/v1`). Lo que
cambia respecto de OpenAI es la envoltura del JSON — `response_format` en lugar de la
Responses API, que ninguno de los dos implementa — y la búsqueda web. En OpenRouter
sirve cualquier slug de [openrouter.ai/models](https://openrouter.ai/models), incluidos
los `:free`; conviene uno con visión si se van a subir fotos. Los modelos que no aceptan
`json_schema` reciben un único reintento con `json_object` y el esquema en el prompt,
porque ese catálogo es heterogéneo.

**Gemini no expone búsqueda web** por su API compatible con OpenAI. El diagnóstico y el
matching funcionan igual, pero no trae teléfonos de la web: en modo completo devuelve la
estimación local sin marcarla como respaldada, en vez de inventar contactos. OpenRouter
sí busca, con el sufijo `:online` sobre el mismo slug.

**Modo económico (predeterminado):**

- Una llamada de diagnóstico con el modelo elegido, sin lecturas adicionales de fotos
  ambiguas ni reintentos automáticos del SDK.
- Fotos cargadas en este modo reducidas a un máximo de 1024 px por lado.
- Matching léxico por rubro, especialidad y ubicación, sin llamadas a Gemini.
- Diagnósticos identificados en caché durante 10 minutos, hasta 100 entradas por
  instancia del servidor, separadas por cuenta, modelo, modo, texto y foto. No se
  persisten en disco; la caché no se comparte entre instancias de Vercel.
- Sin búsqueda web automática. Si faltan profesionales, un enlace abre Google en
  otra pestaña sin consumir tokens de la aplicación.
- Sin key personal, usa el modelo económico del proveedor que tenga configurado el
  servidor: Haiku 4.5, GPT-5 nano, Gemini 3.1 Flash Lite o el slug de OpenRouter.
  Una selección personal de modelo siempre se respeta.

El **modo completo** mantiene matching semántico, chat y búsquedas automáticas, con
costos adicionales. GPT-5 nano no admite la herramienta web: en ese caso, solo la
búsqueda usa GPT-4o mini con la misma key. Las preguntas al chat consumen API en ambos
modos. Los logs `[IA diagnostico]` muestran proveedor, modelo y tokens del diagnóstico,
sin texto, imágenes ni claves; no incluyen el consumo del chat ni de búsquedas web.

## Cómo funciona por dentro

**1. Diagnóstico — `src/lib/diagnostico.ts`**

Claude recibe el texto, la foto, o ambos, y responde a través de una tool con
`tool_choice` forzado. OpenAI usa Responses API con JSON Schema estricto
(`src/lib/diagnostico-openai.ts`), y Gemini y OpenRouter comparten
`src/lib/diagnostico-compatible.ts` sobre `/chat/completions`. Los tres devuelven el
mismo contrato, validado por el servidor con el mismo código.

En modo completo, una foto sin identificar puede recibir un pase descriptivo y una
nueva clasificación usando esa descripción, sin adjuntar la foto otra vez. En modo
económico se devuelve el primer resultado para que el usuario aporte más información.

**2. Matching — `src/lib/matching.ts`**

En modo completo, el diagnóstico se convierte en embedding con Gemini y se compara por similitud coseno
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

**4. Enriquecimiento web (solo modo completo)**

Se usa la herramienta web del proveedor configurado — `web_search` en Anthropic,
`web_search_preview` en OpenAI, el sufijo `:online` en OpenRouter, y nada en Gemini,
que no la ofrece por su API compatible:

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

Para usar la cuenta de Anthropic del equipo:

```env
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
```

Para mover el servidor entero a otro proveedor, `IA_PROVEEDOR` acepta `anthropic`,
`openai`, `gemini` u `openrouter`, y cada uno lee su propia clave:

```env
IA_PROVEEDOR=gemini       # reusa la GEMINI_API_KEY de arriba, sin cuenta nueva
IA_PROVEEDOR=openai       # necesita OPENAI_API_KEY
IA_PROVEEDOR=openrouter   # necesita OPENROUTER_API_KEY
```

`IA_MODELO` es opcional y sirve para cualquier proveedor; sin ella se usa el modelo
económico de cada uno. `OPENAI_MODELO` se sigue leyendo por compatibilidad con los
deploys anteriores. Si `IA_PROVEEDOR` está puesta y falta su clave, el servidor lo dice
en vez de caer en silencio a otra cuenta.

Gemini también se usa, aparte del diagnóstico, para el matching semántico del modo
completo; esa parte siempre necesita `GEMINI_API_KEY`. También se puede iniciar sin
claves del equipo y cargar una clave personal desde **Configurar IA**.

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

Pruebas de consumo con respuestas simuladas, sin usar claves ni créditos (Node 24):

```bash
node --test scripts/test-ia.mjs
```

Para desplegar en Vercel, configurar las variables del proveedor elegido y, para
matching semántico, `GEMINI_API_KEY`. No subir `.env.local`: está ignorado por Git.

## Especificación completa

Ver [`CLAUDE.md`](./CLAUDE.md) — contrato de datos, arquitectura, roles y timeline del
equipo para el día del evento.
