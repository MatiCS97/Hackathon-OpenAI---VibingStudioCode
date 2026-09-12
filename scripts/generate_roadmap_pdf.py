#!/usr/bin/env python3
"""Genera un PDF con el roadmap del hackathon para repartir al equipo."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, ListFlowable, ListItem
)

styles = getSampleStyleSheet()
h1 = ParagraphStyle("h1", parent=styles["Heading1"], spaceAfter=10)
h2 = ParagraphStyle("h2", parent=styles["Heading2"], spaceBefore=14, spaceAfter=6, textColor=colors.HexColor("#1a3c8f"))
body = ParagraphStyle("body", parent=styles["BodyText"], spaceAfter=6, leading=15)
small = ParagraphStyle("small", parent=styles["BodyText"], fontSize=9, textColor=colors.grey)
cell = ParagraphStyle("cell", parent=styles["BodyText"], fontSize=9, leading=12)
cell_head = ParagraphStyle("cell_head", parent=styles["BodyText"], fontSize=9, leading=12, textColor=colors.white)

def P(text, style=cell):
    return Paragraph(text, style)

doc = SimpleDocTemplate(
    "Roadmap_Hackathon_PromecTeam.pdf", pagesize=A4,
    topMargin=2*cm, bottomMargin=2*cm, leftMargin=2*cm, rightMargin=2*cm,
)

story = []

story.append(Paragraph("Roadmap — Hackathon Agents, Everywhere", h1))
story.append(Paragraph("PromecTeam · Agente de diagnóstico y matching de precisión", body))
story.append(Paragraph("Repo: github.com/MatiCS97/Hackathon-OpenAI---PromecTeam", small))
story.append(Spacer(1, 10))

story.append(Paragraph("1. Ya hecho antes del evento (setup, no funcionalidad central)", h2))
done = [
    "Next.js 16 + Tailwind + CopilotKit instalado, build probado sin errores.",
    "Runtime de CopilotKit conectado a Claude (claude-sonnet-5) — texto y visión probados.",
    "Voyage AI conectado para embeddings — probado, devuelve vectores de 1024 dims.",
    "Script generador de dataset sintético de profesionales (5.000–20.000 perfiles).",
    "Repo GitHub público creado (vacío, listo para el primer push).",
    "CLAUDE.md con el contrato de datos, stack y decisiones ya escrito en la raíz del repo.",
]
story.append(ListFlowable([ListItem(Paragraph(x, body)) for x in done], bulletType="bullet"))

story.append(Paragraph("2. Qué falta construir (en vivo, durante el evento)", h2))
pending = [
    "Paso 1 — Diagnóstico: texto/foto/voz → JSON estructurado, incluye cotizador de costo y horas estimadas.",
    "Paso 2 — Matching: embedding del diagnóstico (Voyage) vs. embeddings de perfiles, + filtros duros (ubicación/disponibilidad).",
    "Paso 2b — Fallback: si el score de match es bajo, usar la tool nativa web_search de Claude para estimar costo con datos reales de internet.",
    "Paso 3 — Explicabilidad: por qué se eligió cada profesional, citando datos concretos.",
    "Frontend: reemplazar el placeholder por input de foto/texto, botón de voz (Web Speech API del navegador), y useCopilotAction/useCopilotReadable para mostrar todo como Generative UI dentro del chat.",
    "Demo host app: mini marketplace genérico para grabar el video sin depender de ChambaYa.",
]
story.append(ListFlowable([ListItem(Paragraph(x, body)) for x in pending], bulletType="bullet"))

story.append(Paragraph("3. División de roles (equipo de 2 — ajustar si son más)", h2))
data = [
    [P("Persona", cell_head), P("Módulo", cell_head), P("Detalle", cell_head)],
    [P("Vos"), P("Frontend + Diagnóstico"), P("UI, foto/voz, Paso 1 con cotizador. Ya tenés la base armada (route.ts, provider).")],
    [P("Compañero"), P("Matching + Explicabilidad"), P("Paso 2-3, embeddings Voyage, fallback web_search. Módulo aislado, no pisa tus archivos.")],
    [P("Ambos"), P("Integración + Demo"), P("14:45–15:15: unir todo, probar end to end, grabar video, armar submission.")],
]
t = Table(data, colWidths=[2.8*cm, 4.2*cm, 8.5*cm])
t.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#1a3c8f")),
    ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTSIZE", (0,0), (-1,-1), 9),
    ("GRID", (0,0), (-1,-1), 0.5, colors.grey),
    ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#f2f5fb")]),
    ("TOPPADDING", (0,0), (-1,-1), 6),
    ("BOTTOMPADDING", (0,0), (-1,-1), 6),
]))
story.append(t)

story.append(Paragraph("4. Git: cuándo se hace push", h2))
git_steps = [
    "11:15–11:30 — cada uno clona el repo, crea su propia rama (ej. diagnostico / matching).",
    "11:30 en adelante — commits chicos y frecuentes, push seguido apenas algo compile. No se guarda todo para el final.",
    "13:00–13:15 — Checkpoint 1: primer merge real, se detectan roturas de contrato JSON entre los dos módulos mientras hay tiempo de arreglarlas.",
    "13:15–14:45 — se sigue construyendo y resolviendo lo que falló en el checkpoint.",
    "14:45–15:15 — integración final en la demo host app + pulido.",
    "Nadie edita el mismo archivo al mismo tiempo sin avisar antes por chat del equipo.",
]
story.append(ListFlowable([ListItem(Paragraph(x, body)) for x in git_steps], bulletType="bullet"))

story.append(Paragraph("5. Timeline del día", h2))
timeline = [
    ["10:00–10:30", "Check-in, comida"],
    ["10:30–11:00", "Charla de apertura + briefing"],
    ["11:00–11:15", "Cerrar contrato de datos en equipo"],
    ["11:15–11:30", "Setup: repo, ramas, cada uno con su Claude Code"],
    ["11:30–13:00", "Build en paralelo por módulo"],
    ["13:00–13:15", "Checkpoint 1: integrar y detectar roturas"],
    ["13:15–14:45", "Seguir build + resolver lo que falló"],
    ["14:45–15:15", "Integración final + pulido"],
    ["15:15–15:30", "Grabar video de demo (2 min)"],
    ["15:30–16:00", "Submission: título, descripción, repo, video, post social"],
]
timeline_rows = [[P("Hora", cell_head), P("Actividad", cell_head)]] + [[P(h), P(a)] for h, a in timeline]
t2 = Table(timeline_rows, colWidths=[3.2*cm, 12.3*cm])
t2.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#1a3c8f")),
    ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTSIZE", (0,0), (-1,-1), 9),
    ("GRID", (0,0), (-1,-1), 0.5, colors.grey),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#f2f5fb")]),
    ("TOPPADDING", (0,0), (-1,-1), 5),
    ("BOTTOMPADDING", (0,0), (-1,-1), 5),
]))
story.append(t2)

story.append(Paragraph("6. Claves compartidas (no subir a git)", h2))
keys = [
    "ANTHROPIC_API_KEY y VOYAGE_API_KEY: una sola de cada una para todo el equipo, no una por persona.",
    "Van en .env.local — ya está en .gitignore, nunca se commitea. Se comparten por chat privado del equipo.",
    "Antes del primer 'git add', correr 'git status' y confirmar que .env.local NO aparece en la lista.",
]
story.append(ListFlowable([ListItem(Paragraph(x, body)) for x in keys], bulletType="bullet"))

story.append(Paragraph("7. Checklist final de submission", h2))
checklist = [
    "Título del proyecto",
    "Descripción escrita clara",
    "Repo de GitHub público (ya creado)",
    "Video de demo de 2 minutos",
    "Post en redes sociales etiquetando a los partners del evento",
    "Poder explicar qué partes se construyeron durante el evento",
]
story.append(ListFlowable([ListItem(Paragraph(x, body)) for x in checklist], bulletType="bullet"))

doc.build(story)
print("PDF generado: Roadmap_Hackathon_PromecTeam.pdf")
