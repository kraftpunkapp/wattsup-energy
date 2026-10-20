# Home Assistant → WattsUp Energy

Home Assistant **pousse** ses compteurs d'énergie vers WattsUp : aucun port entrant à ouvrir,
WattsUp n'interroge jamais votre instance. La météo n'est pas envoyée par HA : WattsUp la
récupère lui-même (Open-Meteo) pour la commune indiquée dans Réglages.

## 1. Récupérer l'endpoint et le token

Dans WattsUp : **Réglages › Home Assistant**, carte « API d'ingestion » (l'adresse exacte de l'endpoint y est affichée).

1. Choisissez la granularité :
   - **Horaire** (recommandé) : HA envoie ses index cumulés chaque heure. Toutes les
     simulations de contrats sont exactes.
   - **Quotidien** : HA envoie une fois par jour les totaux de la veille, lus sur des
     `utility_meter` quotidiens (HP et HC séparés si vous êtes en HP/HC ou Tempo).
2. Cliquez **Générer un token** et copiez-le : il n'est affiché qu'une fois.

## 2. Déclarer le `rest_command`

Dans `secrets.yaml` :

```yaml
wattsup_url: https://wattsup-energy.kraftpunk.app/api/v1/ingest
wattsup_token: "Bearer wu_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Dans `configuration.yaml` (puis redémarrer Home Assistant) :

```yaml
rest_command:
  wattsup_push:
    url: !secret wattsup_url
    method: POST
    headers:
      Authorization: !secret wattsup_token
      Content-Type: application/json
    payload: "{{ payload if payload is string else payload | to_json }}"
    timeout: 15
```

## 3. Importer le blueprint

**Paramètres › Automatisations et scènes › Blueprints › Importer un blueprint**, URL :

```
https://github.com/kraftpunkapp/wattsup-energy/blob/main/homeassistant/blueprints/wattsup_push.yaml
```

> Le blueprint est aussi servi par WattsUp : `https://wattsup-energy.kraftpunk.app/api/blueprint/wattsup_push.yaml`
> (bouton « Importer dans Home Assistant » du parcours de bienvenue, ou « Mettre à jour le blueprint d'envoi » dans Réglages › Historique).

Créez ensuite une automatisation à partir du blueprint.

### Mode horaire

| Champ                                                  | Entité attendue                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Import réseau                                          | compteur cumulé **temps réel** (pince, routeur, téléinfo), `total_increasing` ; Wh, kWh ou MWh |
| Export, production solaire, charge / décharge batterie | compteurs cumulés correspondants (optionnels)                                                  |
| Couleur Tempo                                          | optionnel : capteur dont l'état vaut bleu / blanc / rouge                                      |
| Postes                                                 | `slug: sensor.xxx_energy`, slugs copiés depuis WattsUp                                         |

Évitez les index Linky issus de l'API Enedis : ils ne changent qu'une fois par jour. Évitez aussi les compteurs « du jour » ou « du mois », qui repartent à zéro.

Le premier envoi sert de référence (avertissement `baseline`) ; les consommations
apparaissent à partir du deuxième.

### Mode quotidien

Créez des `utility_meter` avec `cycle: daily`. Le blueprint lit, à 00:05, leur
attribut `last_period` (total de la veille). En HP/HC, le plus simple est de partir des
deux index séparés que fournit le Linky (téléinfo : index HC et index HP) :

```yaml
utility_meter:
  wattsup_import_hp_jour:
    source: sensor.linky_index_hp
    cycle: daily
  wattsup_import_hc_jour:
    source: sensor.linky_index_hc
    cycle: daily
  wattsup_solaire_jour:
    source: sensor.enphase_production_cumulee
    cycle: daily
```

Sans index séparés, un seul `utility_meter` avec `tariffs: [hp, hc]` fonctionne aussi,
mais il faut alors basculer son entité `select` entre `hp` et `hc` aux heures de votre
contrat (automatisation dédiée).

Renseignez **Import HP** et **Import HC** (ou **Import réseau** seul pour un contrat
Base).

## 4. Envoyer un historique (facultatif)

Pour reprendre l'historique d'avant WattsUp, ou combler une panne, Home Assistant peut
envoyer ses **statistiques longue durée** (heure par heure) sur une période choisie. Il
faut une version récente de Home Assistant (action `recorder.get_statistics`).

1. **Mettez à jour** le blueprint d'envoi (réimportez `wattsup_push.yaml` en remplaçant la
   version installée) : l'automatisation garde ses réglages et sait désormais envoyer
   l'historique.
2. **Importez** le blueprint `wattsup_history.yaml` (WattsUp › Réglages › Historique, bouton
   « Importer “envoyer l'historique” ») et créez un script à partir de lui.
3. **Lancez** le script et choisissez les dates (au plus 10 ans, jusqu'à hier). L'envoi se
   fait jour par jour en arrière-plan, environ une seconde par jour ; une notification
   annonce la fin.

WattsUp ne remplace jamais une valeur déjà présente et rejette les valeurs
invraisemblables (sauts de compteur). Le détail s'affiche dans WattsUp › Réglages › Home
Assistant › Derniers envois.

## 5. Décompter un sac depuis Home Assistant (facultatif)

Pour signaler « un sac versé » sans ouvrir WattsUp (bouton du tableau de bord, bouton
physique près du poêle, automatisation) : importez le blueprint `wattsup_fuel.yaml`
(WattsUp › Réglages › Équipements, bouton « Importer “sac versé” »), créez un script à partir
de lui, puis appelez ce script où vous voulez. Une notification donne le stock restant.

## 6. Afficher les chiffres de WattsUp dans Home Assistant (facultatif)

WattsUp expose un résumé en lecture seule, avec le même token : `GET /api/v1/summary`
(coût du jour et du mois, projection de l'année, stock de combustible en jours, alertes en
cours ; 30 lectures par minute au plus). Ajoutez dans `configuration.yaml` des capteurs REST,
en mettant `Bearer wu_…` dans `secrets.yaml` (clé `wattsup_authorization`) :

```yaml
rest:
  - resource: https://wattsup-energy.kraftpunk.app/api/v1/summary
    headers:
      Authorization: !secret wattsup_authorization
    scan_interval: 900 # toutes les 15 minutes
    sensor:
      - name: WattsUp coût du jour
        value_template: "{{ value_json.cost.today_eur }}"
        unit_of_measurement: "€"
        device_class: monetary
      - name: WattsUp coût du mois
        value_template: "{{ value_json.cost.month_eur }}"
        unit_of_measurement: "€"
        device_class: monetary
      - name: WattsUp projection de l'année
        value_template: "{{ value_json.cost.year_projection_eur }}"
        unit_of_measurement: "€"
        device_class: monetary
      - name: WattsUp granulés jours restants
        value_template: "{{ value_json.fuel.pellet.days_left if value_json.fuel.pellet is defined else none }}"
        unit_of_measurement: "j"
      - name: WattsUp alertes
        value_template: "{{ value_json.alerts | length }}"
        json_attributes:
          - alerts
```

Réponse :

```json
{
  "version": 1,
  "generated_at": "2026-10-07T12:00:00.000Z",
  "cost": {
    "today_eur": 1.84,
    "month_eur": 12.6,
    "year_projection_eur": 843,
    "previous_year_eur": 824
  },
  "fuel": { "pellet": { "stock": 9, "unit": "sacs", "days_left": 9 } },
  "alerts": [
    { "key": "fuel_stock:pellet", "level": 1, "title": "Stock de granulés bas", "text": "…" }
  ]
}
```

Une valeur inconnue vaut `null` (pas de contrat, pas encore d'historique, combustible sans
consommation récente). Le résumé est celui de WattsUp à l'instant de la lecture.

## 7. Vérifier

- WattsUp : « Home Assistant connecté · Dernier push il y a X min » dans la navigation.
- Home Assistant : une notification persistante dit, en clair, ce qu'il faut corriger.
  « WattsUp Energy — envoi refusé » (token, mode, format, WattsUp injoignable) ou
  « WattsUp Energy — envoi à vérifier » (envoi accepté, mais capteur « Import réseau » oublié,
  aucun capteur lisible, compteur remis à zéro, poste inconnu…). Elle cite aussi les capteurs
  choisis restés sans valeur (`unavailable`, `unknown`) et disparaît au premier envoi sans
  rien à signaler. Le texte vient du champ `message` de la réponse de WattsUp. Après une mise
  à jour du blueprint : Paramètres › Automatisations et scènes › Blueprints › WattsUp ›
  « Réimporter le blueprint ».

| Statut                      | Cause probable                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401                         | token absent, mal recopié (le préfixe `Bearer ` est requis) ou révoqué                                                                            |
| 409                         | granularité du blueprint ≠ granularité choisie dans WattsUp                                                                                       |
| 400                         | champ invalide : le message indique lequel                                                                                                        |
| 200 + `no_energy_data`      | aucun capteur lisible : en mode quotidien, ce ne sont pas des `utility_meter` (pas d'attribut `last_period`) ; en horaire, capteurs indisponibles |
| 200 + `missing_grid_import` | d'autres compteurs arrivent, mais pas l'import réseau : capteur « Import réseau » non choisi dans l'automatisation, ou sans valeur                |
| 429                         | plus de 120 envois par minute (automatisation en boucle ?)                                                                                        |
