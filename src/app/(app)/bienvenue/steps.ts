// Étapes du parcours de bienvenue (T31), dans l'ordre. Partagé serveur / client.
export const STEPS = [
  {
    title: "Votre profil",
    description: "Cochez les équipements de votre foyer : l'interface masque le reste.",
  },
  {
    title: "Votre commune",
    description: "Pour la météo : ensoleillement face à la production, froid face au chauffage.",
  },
  {
    title: "Votre contrat",
    description:
      "Votre contrat d'électricité actuel, avec sa date de début, pour chiffrer ce que vous payez. Si vous payez par mensualités, indiquez-la : WattsUp vérifiera qu'elle couvre votre consommation.",
  },
  {
    title: "Home Assistant",
    description: "Connectez Home Assistant : il enverra vos données d'énergie toutes les heures.",
  },
  {
    title: "Votre historique",
    description: "Facultatif : importez le passé en CSV pour comparer dès aujourd'hui.",
  },
] as const;
