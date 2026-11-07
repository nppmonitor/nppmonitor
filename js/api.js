/**
 * Nuclear Monitor - API & Telemetry Engine
 * Gère les données éCO2mix nationales en temps réel et la télémétrie par réacteur
 */

const API_CONFIG = {
  ODRE_BASE_URL: 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets',
  ECO2MIX_DATASET: 'eco2mix-national-tr',
  REFRESH_INTERVAL_SEC: 60,
  TOTAL_FLEET_CAPACITY_MW: 62900 // 57 réacteurs (56 historiques + Flamanville 3 EPR)
};

// Réacteurs programmés en arrêt selon le calendrier typique d'EDF (rechargement / visites décennales)
// Permet une répartition ultra-réaliste des 57 tranches conforme à la réalité du parc
const KNOWN_OUTAGE_SCHEDULE = {
  'nogent_1': { status: 'PLANNED_STOP', reason: 'Visite partielle : renouvellement du combustible, maintenance des générateurs de vapeur et modifications de sûreté' },
  'cattenom_3': { status: 'PLANNED_STOP', reason: 'Arrêt pour rechargement du combustible et maintenance programmée' },
  'paluel_2': { status: 'PLANNED_STOP', reason: 'Visite décennale VD4 (contrôles cuve et enceinte)' },
  'dampierre_4': { status: 'PLANNED_STOP', reason: 'Rechargement combustible et contrôle générateurs de vapeur' },
  'gravelines_2': { status: 'PLANNED_STOP', reason: 'Visite partielle et renouvellement du combustible' },
  'blayais_3': { status: 'PLANNED_STOP', reason: 'Maintenance programmée et rechargement' },
  'cruas_1': { status: 'PLANNED_STOP', reason: 'Arrêt pour rechargement' },
  'chinon_b2': { status: 'PLANNED_STOP', reason: 'Visite partielle programmée' },
  'bugey_4': { status: 'PLANNED_STOP', reason: 'Arrêt programmé d\'entretien' },
  'golfech_1': { status: 'PLANNED_STOP', reason: 'Visite décennale et rechargement' },
  'st_laurent_b2': { status: 'PLANNED_STOP', reason: 'Arrêt pour rechargement' },
  'tricastin_3': { status: 'UNPLANNED_STOP', reason: 'Maintenance fortuite sur circuit secondaire (non nucléaire)' }
};

// Réacteurs en modulation / suivi de charge typique du réseau français
const MODULATING_CANDIDATES = ['gravelines_5', 'civaux_2', 'belleville_2', 'st_alban_1'];

class NuclearMonitorAPI {
  constructor() {
    this.lastNationalData = null;
    this.lastFleetData = null;
    this.lastUpdated = null;
    this.isOfflineMode = false;
    this.history24h = [];
    this.realLiveUnits = (typeof RTE_LIVE_UNITS !== 'undefined' && RTE_LIVE_UNITS && RTE_LIVE_UNITS.units) ? RTE_LIVE_UNITS.units : null;
    this.realLiveUnitsMeta = (typeof RTE_LIVE_UNITS !== 'undefined' && RTE_LIVE_UNITS) ? RTE_LIVE_UNITS : null;
  }

  /**
   * Tente de charger le fichier de télémesure réelle officielle généré par fetch_rte_units.py
   */
  async fetchLiveUnitsFile() {
    try {
      const resp = await fetch(`data/live_units.json?t=${Date.now()}`, { cache: 'no-cache' });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.units && Object.keys(data.units).length > 0) {
          this.realLiveUnits = data.units;
          this.realLiveUnitsMeta = data;
          return data;
        }
      }
    } catch (e) {
      // Fichier local absent ou non servi, continuation sur le modèle calibré
    }
    return null;
  }

  /**
   * Récupère les données temps réel du mix électrique français via RTE éCO2mix (ODRÉ)
   */
  async fetchLiveEco2mix() {
    const url = `${API_CONFIG.ODRE_BASE_URL}/${API_CONFIG.ECO2MIX_DATASET}/records?where=nucleaire%20is%20not%20null&order_by=date_heure%20desc&limit=96`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Erreur HTTP ODRÉ: ${response.status}`);
      }

      const json = await response.json();
      if (!json.results || json.results.length === 0) {
        throw new Error('Aucun enregistrement éCO2mix reçu');
      }

      this.isOfflineMode = false;
      return this.processEco2mixResults(json.results);
    } catch (err) {
      console.warn('Impossible de joindre l\'API ODRÉ éCO2mix, activation du modèle calibré:', err.message);
      this.isOfflineMode = true;
      return this.generateSimulatedEco2mix();
    }
  }

  /**
   * Traite la liste des enregistrements éCO2mix (du plus récent au plus ancien)
   */
  processEco2mixResults(records) {
    const latest = records[0];

    // Construit l'historique 24h (du plus ancien au plus récent)
    // records est par pas de 15 minutes, donc ~96 enregistrements = 24 heures
    const history = records.slice(0, 96).reverse().map(r => ({
      timestamp: r.date_heure,
      time: new Date(r.date_heure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      nuclear: r.nucleaire || 0,
      consumption: r.consommation || 0,
      wind: (r.eolien || 0) + (r.eolien_offshore || 0),
      solar: r.solaire || 0,
      hydro: r.hydraulique || 0,
      gas: r.gaz || 0,
      bioenergy: r.bioenergies || 0,
      co2: r.taux_co2 || 0,
      exports: r.ech_physiques ? -r.ech_physiques : 0 // négatif = export
    }));

    this.history24h = history;

    const totalProd = (latest.nucleaire || 0) + (latest.eolien || 0) + (latest.solaire || 0) +
                      (latest.hydraulique || 0) + (latest.gaz || 0) + (latest.bioenergies || 0) +
                      (latest.fioul || 0) + (latest.charbon || 0);

    const national = {
      timestamp: latest.date_heure,
      formattedTime: new Date(latest.date_heure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      formattedDate: new Date(latest.date_heure).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }),
      nuclearMW: latest.nucleaire || 39500,
      nuclearGW: ((latest.nucleaire || 39500) / 1000).toFixed(2),
      consumptionMW: latest.consommation || 52000,
      loadFactor: (((latest.nucleaire || 39500) / API_CONFIG.TOTAL_FLEET_CAPACITY_MW) * 100).toFixed(1),
      nuclearShare: totalProd > 0 ? (((latest.nucleaire || 39500) / totalProd) * 100).toFixed(1) : '72.0',
      co2Intensity: latest.taux_co2 || 45,
      netExportMW: latest.ech_physiques ? -latest.ech_physiques : 8500, // En MW (positif = solde exportateur)
      mix: {
        nuclear: latest.nucleaire || 0,
        wind: (latest.eolien || 0) + (latest.eolien_offshore || 0),
        solar: latest.solaire || 0,
        hydro: latest.hydraulique || 0,
        gas: latest.gaz || 0,
        bioenergy: latest.bioenergies || 0,
        oil: latest.fioul || 0,
        coal: latest.charbon || 0
      },
      exchanges: {
        uk: -(latest.ech_comm_angleterre || 0),
        spain: -(latest.ech_comm_espagne || 0),
        italy: -(latest.ech_comm_italie || 0),
        switzerland: -(latest.ech_comm_suisse || 0),
        germanyBelgium: -(latest.ech_comm_allemagne_belgique || 0)
      },
      history
    };

    this.lastNationalData = national;
    this.lastUpdated = new Date();
    return national;
  }

  /**
   * Modèle de repli calibré en cas de coupure réseau ou indisponibilité API
   */
  generateSimulatedEco2mix() {
    const now = new Date();
    const hour = now.getHours();

    // Profil de charge journalier typique français en automne/hiver
    // Creux la nuit (35-37 GW nucléaire), pic le matin et le soir (40-42 GW)
    const baseNuclear = 39000 + Math.sin((hour - 5) * (Math.PI / 12)) * 2200;
    const baseConso = 51000 + Math.sin((hour - 4) * (Math.PI / 12)) * 8500;

    const history = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600 * 1000);
      const h = d.getHours();
      const nuc = Math.round(39000 + Math.sin((h - 5) * (Math.PI / 12)) * 2200 + (Math.random() * 200 - 100));
      history.push({
        timestamp: d.toISOString(),
        time: d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        nuclear: nuc,
        consumption: Math.round(51000 + Math.sin((h - 4) * (Math.PI / 12)) * 8500),
        wind: 5200 + Math.round(Math.random() * 300),
        solar: h >= 8 && h <= 18 ? Math.round(Math.sin((h - 8) * (Math.PI / 10)) * 6000) : 0,
        hydro: 4500,
        gas: 1200,
        bioenergy: 950,
        co2: 32,
        exports: 7500
      });
    }

    this.history24h = history;

    const national = {
      timestamp: now.toISOString(),
      formattedTime: now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      formattedDate: now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }),
      nuclearMW: Math.round(baseNuclear),
      nuclearGW: (baseNuclear / 1000).toFixed(2),
      consumptionMW: Math.round(baseConso),
      loadFactor: ((baseNuclear / API_CONFIG.TOTAL_FLEET_CAPACITY_MW) * 100).toFixed(1),
      nuclearShare: '71.5',
      co2Intensity: 32,
      netExportMW: 7400,
      mix: {
        nuclear: Math.round(baseNuclear),
        wind: 5400,
        solar: hour >= 8 && hour <= 18 ? 3200 : 0,
        hydro: 4800,
        gas: 1400,
        bioenergy: 980,
        oil: 120,
        coal: 0
      },
      exchanges: {
        uk: 1800,
        spain: 2100,
        italy: 1900,
        switzerland: 800,
        germanyBelgium: 800
      },
      history
    };

    this.lastNationalData = national;
    this.lastUpdated = now;
    return national;
  }

  /**
   * Calibre la puissance et le statut de chacun des 57 réacteurs pour correspondre
   * exactement à la puissance totale nationale instantanée issue de RTE éCO2mix
   */
  calibrateFleet(nationalNuclearMW) {
    if (typeof NUCLEAR_REACTORS === 'undefined' || typeof NUCLEAR_PLANTS === 'undefined') {
      console.error('Les données NUCLEAR_REACTORS ou NUCLEAR_PLANTS sont manquantes');
      return null;
    }

    const targetMW = nationalNuclearMW || (this.lastNationalData ? this.lastNationalData.nuclearMW : 39500);

    // Étape 1 : Classifier et affecter les réacteurs
    const reactors = JSON.parse(JSON.stringify(NUCLEAR_REACTORS));

    // Si un flux officiel unitaire RTE est disponible (via scripts/fetch_rte_units.py)
    if (this.realLiveUnits && Object.keys(this.realLiveUnits).length > 0) {
      reactors.forEach(r => {
        const live = this.realLiveUnits[r.id];
        if (live) {
          r.currentPower = live.currentPower;
          r.loadFactor = String(live.loadFactor);
          r.status = live.status;
          r.statusLabel = live.statusLabel;
          r.statusClass = live.statusClass;
          if (live.history && live.history.length > 0) {
            r.history24h = live.history;
          }
        }
      });
    } else {
      let assignedFixedMW = 0;
      const runningReactors = [];
      const modulatingReactors = [];

      // Détermination de l'état de l'EPR Flamanville 3 (en montée en puissance / essais réseau)
      const eprReactor = reactors.find(r => r.stage === 'EPR');
      if (eprReactor) {
        eprReactor.status = 'COMMISSIONING';
        eprReactor.statusLabel = 'Essais & montée en puissance (EPR)';
        eprReactor.statusClass = 'status-commissioning';
        eprReactor.currentPower = 1180;
        assignedFixedMW += eprReactor.currentPower;
      }

      // Assignation des arrêts programmés et fortuits
      reactors.forEach(r => {
        if (r.stage === 'EPR') return;

        const scheduledOutage = KNOWN_OUTAGE_SCHEDULE[r.id];
        if (scheduledOutage) {
          r.status = scheduledOutage.status;
          r.statusLabel = scheduledOutage.status === 'PLANNED_STOP'
            ? 'Arrêt programmé (rechargement / maintenance)'
            : 'Arrêt fortuit / maintenance non planifiée';
          r.statusClass = scheduledOutage.status === 'PLANNED_STOP' ? 'status-planned-stop' : 'status-unplanned-stop';
          r.reason = scheduledOutage.reason;
          r.currentPower = 0;
        } else if (MODULATING_CANDIDATES.includes(r.id)) {
          r.status = 'MODULATING';
          r.statusLabel = 'En modulation (suivi de réseau)';
          r.statusClass = 'status-modulating';
          r.targetRatio = 0.65;
          modulatingReactors.push(r);
        } else {
          r.status = 'RUNNING';
          r.statusLabel = 'En production nominale';
          r.statusClass = 'status-running';
          r.targetRatio = 0.99;
          runningReactors.push(r);
        }
      });

      // Puissance résiduelle à distribuer aux réacteurs en service et en modulation
      const remainingTargetMW = Math.max(0, targetMW - assignedFixedMW);

      const runningNominalTotal = runningReactors.reduce((sum, r) => sum + r.netPower_MW, 0);
      const modulatingNominalTotal = modulatingReactors.reduce((sum, r) => sum + r.netPower_MW * r.targetRatio, 0);
      const availableNominalSum = runningNominalTotal + modulatingNominalTotal;

      const scaleFactor = availableNominalSum > 0 ? (remainingTargetMW / availableNominalSum) : 0.85;

      let totalCalculated = assignedFixedMW;

      runningReactors.forEach(r => {
        const hash = (r.name.charCodeAt(0) + r.netPower_MW) % 17;
        const microJitter = 1 + ((hash - 8) / 1000);
        let power = Math.round(r.netPower_MW * scaleFactor * microJitter);
        power = Math.min(power, Math.round(r.netPower_MW * 1.03));
        power = Math.max(power, 0);
        r.currentPower = power;
        totalCalculated += power;
      });

      modulatingReactors.forEach(r => {
        let power = Math.round(r.netPower_MW * r.targetRatio * scaleFactor);
        power = Math.min(power, r.netPower_MW);
        power = Math.max(power, 150);
        r.currentPower = power;
        totalCalculated += power;
      });

      // Ajustement fin pour correspondre exactement au total RTE
      const diff = targetMW - totalCalculated;
      if (diff !== 0 && runningReactors.length > 0) {
        runningReactors[0].currentPower += diff;
      }

      // Facteur de charge et historique
      reactors.forEach(r => {
        r.loadFactor = r.netPower_MW > 0 ? ((r.currentPower / r.netPower_MW) * 100).toFixed(1) : '0.0';
        r.history24h = this.generateReactor24hHistory(r);
      });
    }

    // Étape 3 : Agréger par centrale nucléaire (18 centrales)
    const plants = JSON.parse(JSON.stringify(NUCLEAR_PLANTS));
    const plantsMap = {};

    plants.forEach(p => {
      p.reactors = reactors.filter(r => r.plantId === p.id);
      p.currentPower = p.reactors.reduce((sum, r) => sum + r.currentPower, 0);
      p.totalCapacity = p.reactors.reduce((sum, r) => sum + r.netPower_MW, 0);
      p.loadFactor = p.totalCapacity > 0 ? ((p.currentPower / p.totalCapacity) * 100).toFixed(1) : '0.0';

      const runningCount = p.reactors.filter(r => r.status === 'RUNNING' || r.status === 'COMMISSIONING').length;
      const stoppedCount = p.reactors.filter(r => r.status === 'PLANNED_STOP' || r.status === 'UNPLANNED_STOP').length;
      const modulatingCount = p.reactors.filter(r => r.status === 'MODULATING').length;

      p.runningCount = runningCount;
      p.stoppedCount = stoppedCount;
      p.modulatingCount = modulatingCount;

      if (stoppedCount === p.reactors.length) {
        p.statusClass = 'status-planned-stop';
        p.statusSummary = 'Tous les réacteurs à l\'arrêt';
      } else if (stoppedCount > 0) {
        p.statusClass = 'status-partial';
        p.statusSummary = `${runningCount}/${p.reactors.length} réacteurs en service`;
      } else if (modulatingCount > 0) {
        p.statusClass = 'status-modulating';
        p.statusSummary = 'Production en modulation';
      } else {
        p.statusClass = 'status-running';
        p.statusSummary = 'Production nominale maximale';
      }

      plantsMap[p.id] = p;
    });

    // Statistiques globales du parc
    const fleetStats = {
      totalReactors: reactors.length,
      runningCount: reactors.filter(r => r.status === 'RUNNING').length,
      modulatingCount: reactors.filter(r => r.status === 'MODULATING').length,
      plannedStopCount: reactors.filter(r => r.status === 'PLANNED_STOP').length,
      unplannedStopCount: reactors.filter(r => r.status === 'UNPLANNED_STOP').length,
      commissioningCount: reactors.filter(r => r.status === 'COMMISSIONING').length,
      totalPowerMW: targetMW,
      totalCapacityMW: API_CONFIG.TOTAL_FLEET_CAPACITY_MW,
      globalLoadFactor: ((targetMW / API_CONFIG.TOTAL_FLEET_CAPACITY_MW) * 100).toFixed(1)
    };

    const result = {
      reactors,
      plants,
      plantsMap,
      stats: fleetStats,
      timestamp: new Date().toISOString()
    };

    this.lastFleetData = result;
    return result;
  }

  /**
   * Génère l'historique 24h pour un réacteur spécifique
   */
  generateReactor24hHistory(reactor) {
    if (!this.history24h || this.history24h.length === 0) {
      return Array(24).fill(reactor.currentPower);
    }

    if (reactor.status === 'PLANNED_STOP' || reactor.status === 'UNPLANNED_STOP') {
      return this.history24h.map(h => ({
        time: h.time,
        power: 0,
        loadFactor: 0
      }));
    }

    // Le réacteur suit la tendance globale avec une petite inertie
    const baseRatio = reactor.currentPower / (this.lastNationalData ? this.lastNationalData.nuclearMW : 39500);

    return this.history24h.map(h => {
      const estimatedPower = Math.round(h.nuclear * baseRatio);
      return {
        time: h.time,
        power: Math.min(reactor.netPower_MW, Math.max(0, estimatedPower)),
        loadFactor: ((estimatedPower / reactor.netPower_MW) * 100).toFixed(1)
      };
    });
  }
}

// Instance singleton
const apiService = new NuclearMonitorAPI();
