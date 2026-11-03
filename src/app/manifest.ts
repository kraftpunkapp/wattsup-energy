import type { MetadataRoute } from "next";

// Manifeste de l'appli installable (écran d'accueil du téléphone, fenêtre d'appli sur
// ordinateur). Pas de mode hors ligne : les données viennent du serveur. Toutes les icônes
// sont bord à bord (carré jaune, sans transparence) avec le logo dans la zone sûre des icônes
// adaptatives (cercle de 80 %) : le lanceur les découpe à sa forme sans marge blanche.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WattsUp Energy",
    short_name: "WattsUp",
    description: "Analyse et optimisation de l'énergie du foyer, alimentée par Home Assistant.",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F2F0EB",
    theme_color: "#F2F0EB",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
