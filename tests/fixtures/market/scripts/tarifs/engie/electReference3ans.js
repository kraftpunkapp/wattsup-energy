// Prix reconstitués depuis la fiche descriptive (tous les montants en TTC) :
// abonnement = colonne "Abonnement" des tableaux fourniture + acheminement,
// prix du kWh = somme des colonnes "Prix par kWh" fourniture + acheminement
// + obligation, convertie en centimes (× 100).
defineTarif({
    name: "Engie - Elec Référence 3 ans",
    offer_type: "Marché",
    lastUpdate: "2026-02-04",
    isCommunity: true,
    subscription_url: "https://particuliers.engie.fr/electricite.html",
    price_url: "https://particuliers.engie.fr/content/dam/pdf/fiches-descriptives/fiche-descriptive-elec-reference-3-ans.pdf",
    // tableau "Fourniture comptage simple (CS)", colonne "Abonnement"
    // + tableau "Acheminement sans différenciation temporelle - courte utilisation (CU)"
    subscriptions: {
        3: (47.88 + 99.37) / 12,
        6: (48.43 + 145.20) / 12,
        9: (50.69 + 191.03) / 12,
        12: (52.24 + 236.86) / 12,
        15: (51.05 + 282.69) / 12,
        18: (51.31 + 328.52) / 12,
        24: (57.29 + 420.18) / 12,
        30: (55.79 + 511.84) / 12,
        36: (54.85 + 603.50) / 12
    },
    // fourniture CS 0.13474 + acheminement CU 0.05808 + obligation CS
    // (0.01447 jusqu'à 6 kVA, 0.01486 au-delà)
    dayTypes: { bleu: { price: (0.13474 + 0.05808 + 0.01486) * 100 } },
    priceOverrides: {
        3: { bleu: { price: (0.13474 + 0.05808 + 0.01447) * 100 } },
        6: { bleu: { price: (0.13474 + 0.05808 + 0.01447) * 100 } }
    },
    dayRule: { type: "constant", dayType: "bleu" }
});

defineTarif({
    name: "Engie - Elec Référence 3 ans HC",
    offer_type: "Marché",
    lastUpdate: "2026-02-04",
    isCommunity: true,
    subscription_url: "https://particuliers.engie.fr/electricite.html",
    price_url: "https://particuliers.engie.fr/content/dam/pdf/fiches-descriptives/fiche-descriptive-elec-reference-3-ans.pdf",
    // tableau "Fourniture comptage Heures pleines/Heures creuses (HP/HC)", colonne "Abonnement"
    // + tableau "Acheminement à 2 plages temporelles - moyenne utilisation (MUDT)"
    subscriptions: {
        6: (43.16 + 165.24) / 12,
        9: (44.53 + 221.09) / 12,
        12: (44.03 + 276.94) / 12,
        15: (40.80 + 332.79) / 12,
        18: (39.00 + 388.64) / 12,
        24: (40.88 + 500.33) / 12,
        30: (35.28 + 612.03) / 12,
        36: (30.24 + 723.73) / 12
    },
    // fourniture HP/HC + acheminement MUDT + obligation HP/HC 0.01489
    dayTypes: {
        bleu: {
            HP: (0.13222 + 0.05928 + 0.01489) * 100,
            HC: (0.11579 + 0.04200 + 0.01489) * 100
        }
    },
    dayRule: { type: "constant", dayType: "bleu" },
    hcRanges: [{ from: "22:00", to: "24:00" }, { from: "00:00", to: "06:00" }]
});
