import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { parseTheme } from "@/domain/theme";
import { getSession } from "@/server/session";
import "./globals.css";

// Polices auto-hébergées (variables, sous-ensemble latin, licence OFL dans src/fonts) :
// aucun appel à Google Fonts, ni au build ni chez les visiteurs.
const instrumentSans = localFont({
  src: "../fonts/InstrumentSans-Variable-latin.woff2",
  variable: "--font-instrument-sans",
  weight: "400 700",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "../fonts/JetBrainsMono-Variable-latin.woff2",
  variable: "--font-jetbrains-mono",
  weight: "400 600",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WattsUp Energy",
  description: "Analyse et optimisation de l'énergie du foyer, alimentée par Home Assistant.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  // Ajout à l'écran d'accueil sur iPhone : plein écran, barre d'état claire.
  appleWebApp: { capable: true, title: "WattsUp", statusBarStyle: "default" },
};

const LIGHT_BG = "#F2F0EB";
const DARK_BG = "#18181A";

/** Barre du navigateur mobile : couleur du fond de page, selon le thème du compte. */
export async function generateViewport(): Promise<Viewport> {
  const theme = parseTheme((await getSession())?.user.theme);
  if (theme === "auto") {
    return {
      themeColor: [
        { media: "(prefers-color-scheme: light)", color: LIGHT_BG },
        { media: "(prefers-color-scheme: dark)", color: DARK_BG },
      ],
    };
  }
  return { themeColor: theme === "dark" ? DARK_BG : LIGHT_BG };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Thème du compte posé dès le rendu serveur : aucun flash au chargement (clair sans session).
  const theme = parseTheme((await getSession())?.user.theme);
  return (
    // Variables de police sur <html> : --font-sans (défini sur :root) doit pouvoir les lire.
    <html
      lang="fr"
      data-theme={theme}
      className={`${instrumentSans.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
