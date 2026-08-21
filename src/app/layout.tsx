import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_Condensed } from "next/font/google";
import "./globals.css";
import "./marketing.css";

const plexSans = IBM_Plex_Sans_Condensed({
  weight: ["400", "500", "600"],
  subsets: ["latin", "cyrillic-ext"],
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin", "cyrillic"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: {
    default: "VEYRN Chess — Play. Measure. Improve.",
    template: "%s — VEYRN Chess",
  },
  description: "Бесплатные онлайн-шахматы без регистрации: P2P-партии, точная доска и подробная локальная статистика решений.",
  keywords: ["online chess", "шахматы онлайн", "P2P chess", "chess statistics", "VEYRN"],
  openGraph: {
    title: "VEYRN Chess — Precision Digital Chess Instrument",
    description: "Instant P2P chess and a private behavioral telemetry ledger.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${plexSans.variable} ${plexMono.variable}`} data-scroll-behavior="smooth">
      <body>
        {children}
      </body>
    </html>
  );
}
