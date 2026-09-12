import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // matching.ts lee la cache con readFile(process.cwd() + ...), una ruta que el
  // tracing de Next no puede detectar, asi que el archivo no entra en la funcion
  // serverless y en Vercel falla con "Falta la cache de embeddings".
  outputFileTracingIncludes: {
    "/api/orchestrate": ["./data/profile-embeddings.json"],
  },
};

export default nextConfig;
