# ⚛️ NPP Monitor

> Site web temps réel pour suivre la production, la disponibilité et l'état de chacun des **57 réacteurs nucléaires français** (56 tranches historiques + l'EPR de Flamanville 3), inspiré par le site originel **Nuclear Monitor** (`nuclear-monitor.fr`).

---

## 🚀 Lancement Rapide

Vous pouvez lancer l'application immédiatement avec le script Python inclus (aucune dépendance externe requise) :

```bash
python3 server.py
```
Puis ouvrez votre navigateur sur : **[http://localhost:8080](http://localhost:8080)** (ou le port indiqué dans le terminal).

Vous pouvez aussi simplement ouvrir le fichier `index.html` directement dans votre navigateur web moderne.

---

## ✨ Fonctionnalités Clés

### 1. 📊 Tableau de Bord & KPIs Nationaux en Direct
* **Puissance totale injectée** en temps réel (MW et GW) issue directement des télémesures officielles **RTE éCO2mix**.
* **Facteur de charge global du parc** calculé sur la capacité nominale installée de **62 900 MW**.
* **Part du nucléaire** dans la production électrique française en direct.
* **Solde net des échanges transfrontaliers** (exportations/importations avec le Royaume-Uni, l'Espagne, l'Italie, la Suisse, l'Allemagne et la Belgique).
* **Intensité carbone** du kilowattheure produit en France (g CO₂ / kWh).
* **Synthèse visuelle de l'état du parc** :
  - 🟢 **En production nominale** (> 85% de la capacité)
  - 🔵 **En modulation / suivi de charge** (15% à 85%)
  - 🟠 **Arrêt programmé** (rechargement de combustible ou visite décennale VD4)
  - 🔴 **Arrêt fortuit / imprévu** (aléa technique ou maintenance courte)
  - 🟣 **Essais & divergence** (Flamanville 3 EPR)

### 2. ⚛️ Suivi Tranche par Tranche (Fleet View)
* Cartes interactives pour chacun des **57 réacteurs** avec :
  - Production instantanée en MW et jauge de puissance animée.
  - Facteur de charge individuel (%).
  - Palier technologique (CP0, CP1, CP2, P4, P'4, N4, EPR).
  - Code EIC officiel (norme ENTSO-E).
  - Statut opérationnel et motif détaillé en cas d'arrêt.
  - Mini-courbe d'évolution (*sparkline*) sur 24 heures.
  - Type de refroidissement (eau de mer ou fleuve, tours aéroréfrigérantes).
  - Compatibilité combustible MOX.
* **Filtres et recherche avancée** :
  - Recherche instantanée par nom de tranche ou de centrale.
  - Filtre par statut opérationnel.
  - Filtre par palier technologique (900 MW, 1300 MW, 1450 MW, EPR).
  - Filtre par milieu de refroidissement (Mer ou Fleuve).
  - Tri par puissance décroissante, facteur de charge, alphabétique, centrale, etc.
  - Bascule d'affichage : **Vue Grille de cartes** ou **Vue Tableau compact**.

### 3. 🗺️ Carte Interactive des 18 Centrales Françaises
* Carte interactive complète de la France métropolitaine basée sur **Leaflet** et fond sombre haute lisibilité.
* Marqueurs avec halo dynamique pulsant, code couleur selon la disponibilité du site et nombre de réacteurs.
* Clic sur un marqueur pour afficher la popover de synthèse ou ouvrir la fiche complète de la centrale.

### 4. ⚡ Mix Énergétique & Échanges Transfrontaliers
* Courbe temporelle interactive sur 24 heures : production nucléaire comparée à la consommation totale française, à l'éolien et au solaire.
* Diagramme circulaire (*doughnut*) en direct du mix de production français.
* Panneau des flux commerciaux d'électricité aux 5 frontières (Royaume-Uni, Espagne, Italie, Suisse, Allemagne/Belgique).

### 5. 🔍 Fiches Détaillées par Centrale & Tranche (Dialogues natifs)
* Fiche complète pour chaque centrale : photo satellite, fleuve/mer récepteur, tours de refroidissement, coordonnées GPS, liste des réacteurs, liens officiels ASN, EDF et Wikipédia.
* Fiche détaillée par réacteur : courbe historique 24h haute définition, caractéristiques thermiques et électriques, historique de mise en service.

---

## 📡 Sources de Données Publiques

1. **RTE éCO2mix (ODRÉ - Open Data Réseaux Énergies)** :
   - API temps réel : `eco2mix-national-tr`
   - Fréquence : Toutes les 15 minutes.
   - En-tête `Access-Control-Allow-Origin: *` (CORS ouvert, requêtes directes côté client).
2. **EDF Open Data & Registre National des Installations** :
   - Données techniques des réacteurs, paliers technologiques et puissances nettes nominales.
3. **ASN (Autorité de Sûreté Nucléaire)** :
   - Rapports d'exploitation, visites décennales et autorisations de combustible MOX.

---

## 🏗️ Structure du Projet

```text
Nuclear monitor 2/
├── index.html          # Application principale SPA
├── css/
│   └── styles.css      # Thème sombre salle de contrôle & responsive design
├── js/
│   ├── data.js         # Données statiques des 18 centrales et 57 réacteurs
│   ├── api.js          # Client RTE éCO2mix & moteur de calibration temps réel
│   ├── charts.js       # Moteur graphique Chart.js (courbe 24h, mix, sparklines)
│   ├── map.js          # Carte interactive Leaflet & marqueurs personnalisés
│   └── app.js          # Contrôleur d'application, navigation, filtres & modales
├── data/
│   ├── plants.json     # Métadonnées des 18 centrales nucléaires
│   └── reactors.json   # Spécifications détaillées des 57 réacteurs
├── server.py           # Serveur web local Python
└── README.md           # Documentation
```

---

## ⚙️ Architecture & Résilience Réseau

- **Mode En Ligne Direct** : Interroge l'API ODRÉ éCO2mix toutes les 60 secondes avec compte à rebours visuel et bouton d'actualisation manuelle.
- **Mode Hors-Ligne / Fallback** : Si l'API publique est momentanément inaccessible ou si la connexion internet est coupée, l'application bascule automatiquement sur son modèle calibré interne pour que l'interface reste toujours active et informative.
- **Aucune dépendance npm requise** : Conçu en JavaScript moderne standard (ES6+), CSS natif et HTML5 avec intégration CDN pour Leaflet et Chart.js.
