import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { CopilotProvider } from "@/components/copilot-provider";

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const body = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "ServicIA — diagnostica y conecta",
  description:
    "ServicIA escucha tu problema (foto, texto o voz) y te conecta al instante con quien puede resolverlo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
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
