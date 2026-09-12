"use client";

import { useEffect, useRef, useState } from "react";
import type { UbicacionCliente } from "@/lib/matching";
import type { OrquestacionResultado } from "@/lib/types";

type LeafletMap = {
  setView: (centro: [number, number], zoom: number) => LeafletMap;
  flyTo: (centro: [number, number], zoom: number) => void;
  fitBounds: (limites: Array<[number, number]>, opciones?: unknown) => void;
  remove: () => void;
};

type LeafletApi = {
  map: (el: HTMLElement, opciones?: unknown) => LeafletMap;
  tileLayer: (url: string, opciones?: unknown) => { addTo: (mapa: LeafletMap) => void };
  marker: (
    posicion: [number, number],
    opciones?: unknown,
  ) => { addTo: (mapa: LeafletMap) => { bindPopup: (html: string) => void } };
  divIcon: (opciones: unknown) => unknown;
};

const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";

// Leaflet se trae recien cuando hay profesionales que ubicar, asi la primera
// pantalla no carga un mapa que todavia no tiene nada que mostrar.
function cargarLeaflet(): Promise<LeafletApi | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  const global = window as Window & { L?: LeafletApi };
  if (global.L) return Promise.resolve(global.L);

  if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
    const hoja = document.createElement("link");
    hoja.rel = "stylesheet";
    hoja.href = LEAFLET_CSS;
    document.head.appendChild(hoja);
  }

  return new Promise((resolver) => {
    const existente = document.querySelector<HTMLScriptElement>(
      `script[src="${LEAFLET_JS}"]`,
    );
    const script = existente ?? document.createElement("script");

    script.addEventListener("load", () => resolver(global.L ?? null), { once: true });
    script.addEventListener("error", () => resolver(null), { once: true });

    if (!existente) {
      script.src = LEAFLET_JS;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

export function MapaProfesionales({
  matches,
  cliente,
  enfocado,
  onEnfocar,
}: {
  matches: OrquestacionResultado["matches"];
  cliente?: UbicacionCliente;
  enfocado: string | null;
  onEnfocar: (id: string) => void;
}) {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<LeafletMap | null>(null);
  const [sinMapa, setSinMapa] = useState(false);

  useEffect(() => {
    let cancelado = false;

    cargarLeaflet().then((L) => {
      if (!L) {
        setSinMapa(true);
        return;
      }

      if (cancelado || !contenedorRef.current || mapaRef.current) return;

      const mapa = L.map(contenedorRef.current, { scrollWheelZoom: false });
      mapaRef.current = mapa;

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(mapa);

      const puntos: Array<[number, number]> = [];

      matches.forEach((match, indice) => {
        const { lat, lon, ciudad } = match.profesional.ubicacion;
        puntos.push([lat, lon]);

        L.marker([lat, lon], {
          icon: L.divIcon({
            className: "",
            html: `<span class="marcador">${indice + 1}</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          }),
        })
          .addTo(mapa)
          .bindPopup(
            `<strong>${match.profesional.nombre}</strong><br>${match.profesional.rubro} &middot; ${ciudad}<br>${(match.score * 100).toFixed(0)}% de coincidencia`,
          );
      });

      if (cliente) {
        L.marker([cliente.lat, cliente.lon], {
          icon: L.divIcon({
            className: "",
            html: `<span class="marcador marcador-cliente"></span>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
        })
          .addTo(mapa)
          .bindPopup("Estas aca");
        puntos.push([cliente.lat, cliente.lon]);
      }

      if (puntos.length > 1) {
        mapa.fitBounds(puntos, { padding: [56, 56] });
      } else if (puntos.length === 1) {
        mapa.setView(puntos[0], 14);
      }
    });

    return () => {
      cancelado = true;
      mapaRef.current?.remove();
      mapaRef.current = null;
    };
  }, [matches, cliente]);

  useEffect(() => {
    const match = matches.find((item) => item.profesional_id === enfocado);
    if (!match || !mapaRef.current) return;

    mapaRef.current.flyTo(
      [match.profesional.ubicacion.lat, match.profesional.ubicacion.lon],
      15,
    );
  }, [enfocado, matches]);

  return (
    <section className="mt-12 border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-4 pt-10 sm:px-6 lg:px-8">
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
          Quién lo puede resolver
        </h2>
        <p className="mt-1 max-w-lg text-sm leading-6 text-steel">
          Ordenados por qué tan bien resuelven tu problema, no solo por cercanía.
          Tocá una tarjeta para ubicarla en el mapa.
        </p>
      </div>

      <div className="relative mt-6 lg:h-[34rem]">
        <div
          ref={contenedorRef}
          className="h-72 w-full bg-mist lg:h-full"
          aria-label="Mapa de profesionales recomendados"
        />

        {sinMapa ? (
          <p className="px-4 py-3 text-sm text-steel sm:px-6 lg:px-8">
            No se pudo cargar el mapa, pero las tarjetas siguen acá abajo.
          </p>
        ) : null}

        <div className="lg:pointer-events-none lg:absolute lg:inset-0 lg:mx-auto lg:max-w-6xl lg:px-8 lg:py-6">
          <div className="hilo flex gap-3 overflow-x-auto p-4 lg:pointer-events-auto lg:h-full lg:w-80 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:overscroll-contain lg:p-0 lg:pr-1">
            {matches.map((match, indice) => (
              <button
                key={match.profesional_id}
                type="button"
                onClick={() => onEnfocar(match.profesional_id)}
                className={`flex min-w-64 shrink-0 flex-col border bg-paper p-3 text-left shadow-[0_10px_30px_-18px_rgba(5,7,13,0.55)] transition lg:min-w-0 lg:shrink ${
                  enfocado === match.profesional_id
                    ? "border-cobalt"
                    : "border-line hover:border-cobalt"
                }`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="flex items-baseline gap-2">
                    <span className="font-[family-name:var(--font-mono)] text-xs text-steel">
                      {indice + 1}
                    </span>
                    <span className="font-medium text-ink">
                      {match.profesional.nombre}
                    </span>
                  </span>
                  <span className="font-[family-name:var(--font-mono)] text-sm font-medium text-cobalt">
                    {(match.score * 100).toFixed(0)}%
                  </span>
                </span>
                <span className="mt-1 text-sm text-steel">
                  {match.profesional.rubro} · {match.profesional.ubicacion.ciudad}
                </span>
                <span className="mt-2 font-[family-name:var(--font-mono)] text-xs text-steel">
                  {match.profesional.rating.toFixed(1)} ·{" "}
                  {match.profesional.trabajos_completados} trabajos
                </span>
                <span className="mt-2 text-xs leading-5 text-ink">
                  {match.explicacion}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
