<p align="center">
  <img src="public/wattsup.svg" alt="" width="96" height="96">
</p>

<h1 align="center">WattsUp Energy</h1>

<p align="center">
  Budget, contrats d'électricité, chauffage et rentabilité solaire du foyer,<br>
  à partir des données que <strong>Home Assistant</strong> lui envoie.
</p>

<p align="center">
  <a href="https://wattsup-energy.kraftpunk.app"><strong>wattsup-energy.kraftpunk.app</strong></a>
  ·
  <a href="https://github.com/kraftpunkapp/wattsup-energy/wiki">Guide d'utilisation</a>
  ·
  <a href="#notes-de-version">Notes de version</a>
</p>

---

## Ce que fait WattsUp Energy

Votre Home Assistant connaît déjà vos compteurs d'énergie. WattsUp les transforme en euros et
en décisions : combien coûte le mois, quel contrat serait moins cher, quand lancer les
appareils, combien de sacs de granulés commander, quand les panneaux seront remboursés.

- **Vue d'ensemble** : coût du mois et projection de l'année, origine de la consommation
  (réseau, solaire, batterie), talon de consommation, heures conseillées pour consommer.
- **Contrats** : Base, Heures creuses, Tempo ; historique des prix et comparaison des offres
  heure par heure, sur votre propre consommation, y compris celles des fournisseurs du marché.
- **Chauffage** : granulés et bois (stock, achats, sacs versés), coût par saison corrigé de
  la météo, prévision de réapprovisionnement.
- **Rentabilité** : retour sur investissement des panneaux solaires et de la batterie,
  simulateur « Et si… ».
- **Alertes** dans l'appli, par email ou en notification sur le téléphone : stock bas,
  Home Assistant muet, production solaire anormale, budget dépassé.
- **Vos données** : import de l'historique en CSV, export complet à tout moment, résumé
  lisible par des capteurs de Home Assistant.
- Application installable sur le téléphone, thème clair ou sombre.

Home Assistant **pousse** ses données vers WattsUp : aucun port à ouvrir chez vous,
WattsUp n'accède jamais à votre installation.

## S'inscrire

1. Rendez-vous sur [wattsup-energy.kraftpunk.app](https://wattsup-energy.kraftpunk.app) et
   créez votre compte. Selon les périodes, les inscriptions peuvent être sur invitation : un
   code vous est alors demandé.
2. Le parcours de bienvenue vous guide : profil énergétique du foyer, commune (pour la
   météo), contrat d'électricité, puis connexion de Home Assistant avec un token et un
   blueprint d'automatisation prêt à importer.
3. Les données arrivent dès le premier envoi ; vous pouvez aussi importer votre historique.

Le [guide d'utilisation](https://github.com/kraftpunkapp/wattsup-energy/wiki) détaille chaque écran.

## Configurer Home Assistant

C'est l'étape la plus technique : il faut déclarer une commande REST dans la configuration
de Home Assistant, puis créer une automatisation à partir du blueprint fourni en y
choisissant vos capteurs d'énergie (réseau, solaire, batterie, postes). Le parcours de
bienvenue vous accompagne, et tout est détaillé, avec les cas particuliers (mode quotidien,
reprise de l'historique, bouton « sac versé », capteurs REST pour afficher vos chiffres dans
Home Assistant, messages d'erreur), dans la
[documentation Home Assistant](https://github.com/kraftpunkapp/wattsup-energy/tree/main/homeassistant)
et dans le [wiki](https://github.com/kraftpunkapp/wattsup-energy/wiki/Connecter-Home-Assistant).

## 🔒 Vos données restent en France

Les données sont stockées sur des serveurs hébergés en France (Strasbourg et Gravelines) par
OVHcloud, dans le cadre du RGPD.

- Elles ne sont jamais revendues, cédées ni partagées, ni utilisées pour de la publicité ou
  l'entraînement de modèles d'intelligence artificielle.
- Vous pouvez les exporter à tout moment, et supprimer votre compte avec tout son historique
  en quelques clics depuis Mon compte.
- Seuls les emails (envoyés via Brevo) et les notifications push (services de votre
  navigateur : Google, Apple ou Mozilla) passent par des prestataires techniques, uniquement
  pour vous être remis.
- Les offres du marché proviennent des données ouvertes de
  [comparateur-abonnements-electricite.fr](https://comparateur-abonnements-electricite.fr) :
  WattsUp télécharge leur catalogue et fait le calcul chez lui, sans rien envoyer de votre
  consommation.

## Code source

Le code de WattsUp Energy est ouvert et auditable, sous licence [GPL-3.0](LICENSE). Les
remarques et signalements sont les bienvenus : voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Soutenir le projet

WattsUp vous rend service ? Vous pouvez soutenir son développement :

<a href="https://www.buymeacoffee.com/kraftpunk"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=kraftpunk&button_colour=FFDD00&font_colour=000000&font_family=Inter&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="48"></a>

## Notes de version

### 1.5.0 — 12 octobre 2026

- **Jours de sobriété EDF Zen Flex** : une règle de contrat personnalisé peut ne valoir que ces
  jours-là ; leur calendrier est importé automatiquement et corrigeable jour par jour depuis
  la page Contrats. Tous les coûts en tiennent compte.
- L'offre Zen Week-End Option Flex rejoint la comparaison des offres du marché.

### 1.4.0 — 12 octobre 2026

- **Contrats à saisons** : dans un contrat personnalisé, chaque règle peut ne valoir qu'en
  hiver, en été ou certains mois, et la journée peut commencer à 6 h (nuit comptée avec la
  veille). Nouveaux modèles « Saisons » et « Week-end + 1 jour ».
- Offres du marché : les offres à saisons (Zen Estival, Enercoop 2 saisons, Alterna Heures
  Super Creuses) et à jour choisi (Zen Week-End Plus, avec le jour le moins cher pour vous)
  sont désormais comparées.
- Comparaison des contrats en une seule carte « Comparez votre contrat » : contrat en cours,
  offres simulées, anciens contrats (masqués par défaut) et offres du marché dans un même
  classement ; une offre au même coût que la vôtre est classée en dessous.

### 1.3.0 — 12 octobre 2026

- **Offres du marché** sur la page Contrats : les offres des fournisseurs (EDF dont les tarifs
  réglementés, TotalEnergies, Engie, Mint, Alpiq, Enercoop, La Bellenergie, Alterna…) sont
  rejouées sur votre consommation réelle, avec l'écart par rapport à votre contrat. Indiquez la
  puissance de votre compteur, consultez la grille officielle, ajoutez une offre à vos offres en
  un clic. Catalogue issu de
  [comparateur-abonnements-electricite.fr](https://comparateur-abonnements-electricite.fr),
  vérifié chaque jour ; à confirmer sur le site du fournisseur avant toute décision.
- Nouvelle alerte quand une offre du marché vous ferait économiser au moins 50 € par an
  (seuil réglable).
- Comparaison des contrats « sur mesure » plus rapide.

### 1.2.0 — 9 octobre 2026

- Les emails de WattsUp (mot de passe oublié, confirmation d'adresse, alertes, contact)
  partent désormais par **Brevo**, prestataire français, à la place de Resend.
- Pages nettement plus rapides : Vue d'ensemble, Contrats et Rentabilité se calculent 3 à 6
  fois plus vite, et les allers-retours Mois / Année ne se bloquent plus.
- Changement de mois, d'année ou de saison : retour visuel immédiat pendant le chargement.

### 1.1.0 — 7 octobre 2026

- Lien **Aide** en bas du menu, à côté du numéro de version : il ouvre le
  [guide d'utilisation](https://github.com/kraftpunkapp/wattsup-energy/wiki).

### 1.0.0 — 7 octobre 2026

Première version publique.

**Fonctionnalités**

- Réception des données de Home Assistant, chaque heure ou chaque jour, avec blueprints
  d'automatisation (envoi courant, historique, sacs de granulés versés).
- Vue d'ensemble : coût du mois, projection de l'année, talon de consommation, heures
  conseillées ; blocs masquables.
- Contrats Base, Heures creuses et Tempo, comparaison des offres et suggestion d'un contrat
  moins cher.
- Chauffage aux granulés et au bois : stock, achats, coût par saison, prévision de
  réapprovisionnement.
- Rentabilité des panneaux solaires et de la batterie, simulateur « Et si… ».
- Alertes dans l'appli, par email et en notification push.
- Import CSV de l'historique, export complet des données, résumé pour les capteurs de Home
  Assistant.
- Thème sombre, application installable, boîte à idées et formulaire de contact.

**Sécurité**

- En-têtes de sécurité et politique de contenu stricte sur toutes les pages.
- Changement d'adresse email protégé par le mot de passe et confirmé par un lien.
- Limitation des tentatives sur la connexion et sur les envois de Home Assistant.
