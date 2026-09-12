#!/usr/bin/env python3
"""Genera perfiles sinteticos de profesionales para probar matching por embeddings.

Uso:
    python scripts/generate_profiles.py --count 5000 --out data/profiles.json
    python scripts/generate_profiles.py --count 20000 --out data/profiles.json
"""

import argparse
import json
import random

CIUDADES = [
    ("Asunción", -25.2637, -57.5759),
    ("Lambaré", -25.3439, -57.6062),
    ("San Lorenzo", -25.3400, -57.5083),
    ("Fernando de la Mora", -25.3300, -57.5500),
    ("Luque", -25.2697, -57.4872),
    ("Ñemby", -25.3961, -57.5347),
    ("Capiatá", -25.3556, -57.4453),
    ("Villa Elisa", -25.3667, -57.5981),
    ("Mariano Roque Alonso", -25.1900, -57.5342),
    ("Itauguá", -25.3919, -57.3558),
]

RUBROS = {
    "Plomería": {
        "especialidades": [
            "reparación de fugas de gas",
            "destape de cañerías",
            "instalación de grifería",
            "instalación de tanques de agua",
            "reparación de calefones",
        ],
        "certificaciones": ["Gasista matriculado", "Certificado SEN"],
    },
    "Electricidad": {
        "especialidades": [
            "instalaciones eléctricas domiciliarias",
            "tableros y disyuntores",
            "iluminación LED",
            "cableado estructurado",
            "sistemas de puesta a tierra",
        ],
        "certificaciones": ["Electricista matriculado ANDE", "Certificado en baja tensión"],
    },
    "Carpintería": {
        "especialidades": [
            "muebles a medida",
            "reparación de puertas y ventanas",
            "closets empotrados",
            "pisos de madera",
        ],
        "certificaciones": ["Certificado técnico en carpintería"],
    },
    "Albañilería": {
        "especialidades": [
            "construcción de muros",
            "revoque y terminaciones",
            "colocación de cerámica",
            "impermeabilización de techos",
        ],
        "certificaciones": ["Maestro mayor de obras"],
    },
    "Climatización": {
        "especialidades": [
            "instalación de aire acondicionado",
            "mantenimiento de splits",
            "carga de gas refrigerante",
            "ductos de ventilación",
        ],
        "certificaciones": ["Técnico certificado en refrigeración"],
    },
    "Cerrajería": {
        "especialidades": [
            "apertura de puertas",
            "cambio de cerraduras",
            "cerraduras de seguridad",
            "copia de llaves",
        ],
        "certificaciones": [],
    },
    "Jardinería": {
        "especialidades": [
            "poda de árboles",
            "diseño de jardines",
            "riego automático",
            "mantenimiento de césped",
        ],
        "certificaciones": [],
    },
    "Pintura": {
        "especialidades": [
            "pintura de interiores",
            "pintura de fachadas",
            "impermeabilización",
            "empapelado",
        ],
        "certificaciones": [],
    },
}

NOMBRES = [
    "Carlos", "Miguel", "Diego", "Rodrigo", "Fernando", "Pablo", "Sergio",
    "Javier", "Ricardo", "Andrés", "María", "Laura", "Patricia", "Rosa",
    "Claudia", "Gloria", "Sandra", "Liliana", "Marta", "Celeste",
]
APELLIDOS = [
    "González", "Benítez", "Fernández", "Ríos", "Martínez", "Acosta",
    "Cáceres", "Rojas", "Vera", "Villalba", "Ortiz", "Duarte", "Ayala",
    "Franco", "Rolón", "Insfrán",
]


def build_profile(idx: int) -> dict:
    rubro = random.choice(list(RUBROS.keys()))
    info = RUBROS[rubro]
    especialidades = random.sample(
        info["especialidades"], k=min(len(info["especialidades"]), random.randint(1, 3))
    )
    ciudad, lat, lon = random.choice(CIUDADES)
    # jitter para no apilar todos los perfiles en el mismo punto
    lat += random.uniform(-0.05, 0.05)
    lon += random.uniform(-0.05, 0.05)
    nombre = f"{random.choice(NOMBRES)} {random.choice(APELLIDOS)}"
    trabajos = random.randint(0, 120)
    rating = round(random.uniform(3.0, 5.0), 1) if trabajos > 0 else 0.0

    bio = (
        f"{nombre.split()[0]} trabaja en {rubro.lower()} hace {random.randint(1, 25)} años, "
        f"especializado en {', '.join(especialidades)}. "
        f"Atiende en {ciudad} y alrededores."
    )

    return {
        "id": f"prof_{idx:05d}",
        "nombre": nombre,
        "rubro": rubro,
        "especialidades": especialidades,
        "certificaciones": info["certificaciones"],
        "bio": bio,
        "ubicacion": {"ciudad": ciudad, "lat": round(lat, 5), "lon": round(lon, 5)},
        "rating": rating,
        "trabajos_completados": trabajos,
        "disponible": random.random() > 0.15,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=5000)
    parser.add_argument("--out", default="data/profiles.json")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)

    import os

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)

    profiles = [build_profile(i) for i in range(1, args.count + 1)]

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(profiles, f, ensure_ascii=False, indent=2)

    print(f"Generados {len(profiles)} perfiles -> {args.out}")


if __name__ == "__main__":
    main()
