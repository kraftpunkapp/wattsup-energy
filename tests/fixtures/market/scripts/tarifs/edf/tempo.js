// Les jours rouges et blancs viennent du calendrier partagé
// scripts/tarifs-lib/calendars/tempo-edf.js (chargé avant ce fichier).
defineTarif({
    name: "EDF - Tempo",
    offer_type: "TRV",
    lastUpdate: "2026-08-01",
    isCommunity: false,
    subscription_url: "https://particulier.edf.fr/fr/accueil/gestion-contrat/options/tempo/details.html",
    price_url: "https://particulier.edf.fr/content/dam/2-Actifs/Documents/Offres/Grille_prix_Tarif_Bleu.pdf",
    subscriptions: { 6: 15.8, 9: 19.7, 12: 23.5, 15: 27.01, 18: 30.69, 30: 45.82, 36: 53.76 },
    dayTypes: {
        bleu: { HP: 16.54, HC: 13.56 },
        blanc: { HP: 19.21, HC: 15.36 },
        rouge: { HP: 72.95, HC: 16.15 }
    },
    dayRule: {
        type: "calendar",
        default: "bleu",
        calendar: "tempo-edf",
        previousDayBefore: 6   // avant 6h, la couleur est celle de la veille
    },
    hcRanges: [
        { from: "22:00", to: "24:00" },
        { from: "00:00", to: "06:00" }
    ]
});
