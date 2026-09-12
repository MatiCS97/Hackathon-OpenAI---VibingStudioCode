import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { CopilotProvider } from "@/components/copilot-provider";

export const metadata: Metadata = {
  title: "ServicIA — diagnostica y conecta",
  description:
    "ServicIA escucha tu problema (foto, texto o voz) y te conecta al instante con quien puede resolverlo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <CopilotProvider>{children}</CopilotProvider>
        <Script
          src="https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js"
          strategy="beforeInteractive"
        />
      </body>
    </html>
  );
}
