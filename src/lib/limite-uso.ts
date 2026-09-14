// Raciona la key del equipo en los endpoints publicos. El deploy corre sobre esa
// key y la misma GEMINI_API_KEY alimenta el matching: sin limite, un curl en loop
// agota la cuota de todos los visitantes. Quien carga su propia key paga lo suyo,
// asi que los endpoints solo llaman aca cuando el request usa la del equipo.
//
// ponytail: contador en memoria por instancia. Vercel puede tener varias
// instancias vivas y cada una cuenta por su lado, un cold start lo resetea, y un
// ataque desde muchas IPs pasa igual. Frena el loop desde una maquina, que es el
// abuso probable de una demo; si llega el distribuido, regla de rate limit en el
// Firewall de Vercel o un contador compartido en Redis.

const VENTANA_MS = 60 * 60 * 1000;

// Usos por IP por hora. Generosos a proposito: una clase o un cowork salen a
// internet con una sola IP, y una persona real no diagnostica 60 problemas en una
// hora. La busqueda de proveedores es la mas cara (busqueda web por request).
export const LIMITES = {
  diagnostico: 60,
  chat: 60,
  proveedores: 20,
} as const;

const ventanas = new Map<string, { vence: number; usos: number }>();

export function limitarPorIp(request: Request, endpoint: keyof typeof LIMITES): Response | null {
  const ahora = Date.now();

  if (ventanas.size > 10_000) {
    for (const [clave, ventana] of ventanas) {
      if (ventana.vence <= ahora) ventanas.delete(clave);
    }
  }

  const clave = `${endpoint}:${ipDe(request)}`;
  let ventana = ventanas.get(clave);
  if (!ventana || ventana.vence <= ahora) {
    ventana = { vence: ahora + VENTANA_MS, usos: 0 };
    ventanas.set(clave, ventana);
  }

  if (ventana.usos >= LIMITES[endpoint]) {
    const segundos = Math.ceil((ventana.vence - ahora) / 1000);
    return Response.json(
      {
        error: `Llegaste al limite de consultas por hora de esta demo. Proba de nuevo en ${Math.ceil(segundos / 60)} min, o carga tu propia key en Configurar IA.`,
      },
      { status: 429, headers: { "Retry-After": String(segundos) } },
    );
  }

  ventana.usos++;
  return null;
}

// Vercel pisa estos headers con la IP real del cliente, asi que no se pueden
// falsificar desde afuera. En local no vienen y todo cae en el mismo contador.
function ipDe(request: Request) {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}
