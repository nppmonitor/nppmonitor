/**
 * Nuclear Monitor - Main Application Controller
 * Gestion des vues, filtres, recherche, modales et synchronisation temps réel
 */

class NuclearMonitorApp {
  constructor() {
    this.activeTab = 'map'; // Carte par défaut en page d'accueil !
    this.viewMode = 'grid'; // 'grid' ou 'table'
    this.searchQuery = '';
    this.statusFilter = 'ALL';
    this.stageFilter = 'ALL';
    this.coolingFilter = 'ALL';
    this.sortOption = 'power_desc';

    this.autoRefresh = true;
    this.refreshInterval = 60; // secondes
    this.secondsLeft = 60;
    this.timer = null;

    this.nationalData = null;
    this.fleetData = null;
    this.nuclearMap = null;

    this.init();
  }

  async init() {
    this.setupEventListeners();
    this.initMap();

    // Rendu immédiat des données initiales (chargement instantané à froid)
    this.nationalData = apiService.generateSimulatedEco2mix();
    this.fleetData = apiService.calibrateFleet(this.nationalData.nuclearMW);
    this.renderTopKpis();
    this.renderFleet();
    this.renderMapQuickPlants();
    if (this.nuclearMap) {
      this.nuclearMap.updateMarkers(this.fleetData.plants);
      this.nuclearMap.invalidateSize();
    }

    // Gestion de l'ancrage direct par hash d'URL (ex: #plant=GRAVELINES ou #GRAVELINES)
    this.handleUrlHash();
    window.addEventListener('hashchange', () => this.handleUrlHash());

    // Actualisation asynchrone avec l'API RTE temps réel
    await this.refreshData();
    this.startCountdownTimer();
  }

  handleUrlHash() {
    const rawHash = window.location.hash.replace(/^#\/?/, '');
    if (!rawHash) return;
    
    if (rawHash.includes('=')) {
      const params = new URLSearchParams(rawHash);
      if (params.has('plant')) {
        this.openPlantModal(params.get('plant').toUpperCase());
      } else if (params.has('photo') || params.has('lightbox')) {
        const plantId = (params.get('photo') || params.get('lightbox')).toUpperCase();
        const plant = this.fleetData && this.fleetData.plantsMap && this.fleetData.plantsMap[plantId];
        if (plant) {
          this.openImageLightbox(plant.photo, `Centrale Nucléaire de ${plant.name}`);
        }
      } else if (params.has('reactor')) {
        this.openReactorModal(params.get('reactor'));
      } else if (params.has('tab')) {
        this.switchTab(params.get('tab'));
      } else if (params.has('scroll')) {
        window.scrollTo(0, parseInt(params.get('scroll'), 10));
      }
    } else {
      const id = rawHash.toUpperCase();
      if (this.fleetData && this.fleetData.plantsMap && this.fleetData.plantsMap[id]) {
        this.openPlantModal(id);
      } else if (this.fleetData && this.fleetData.reactors && this.fleetData.reactors.some(r => r.id === id)) {
        this.openReactorModal(id);
      }
    }
  }

  initMap() {
    this.nuclearMap = new NuclearMap('france-map-container', (plantId) => {
      this.openPlantModal(plantId);
    });
  }

  setupEventListeners() {
    // Navigation par onglets
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const target = e.currentTarget.dataset.tab;
        this.switchTab(target);
      });
    });

    // Bascule d'affichage Grille / Tableau
    const btnGrid = document.getElementById('btn-view-grid');
    const btnTable = document.getElementById('btn-view-table');
    if (btnGrid) {
      btnGrid.addEventListener('click', () => this.setViewMode('grid'));
    }
    if (btnTable) {
      btnTable.addEventListener('click', () => this.setViewMode('table'));
    }

    // Barre de recherche
    const searchInput = document.getElementById('search-reactors');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderFleet();
      });
    }

    // Filtres
    const statusSelect = document.getElementById('filter-status');
    if (statusSelect) {
      statusSelect.addEventListener('change', (e) => {
        this.statusFilter = e.target.value;
        this.renderFleet();
      });
    }

    const stageSelect = document.getElementById('filter-stage');
    if (stageSelect) {
      stageSelect.addEventListener('change', (e) => {
        this.stageFilter = e.target.value;
        this.renderFleet();
      });
    }

    const coolingSelect = document.getElementById('filter-cooling');
    if (coolingSelect) {
      coolingSelect.addEventListener('change', (e) => {
        this.coolingFilter = e.target.value;
        this.renderFleet();
      });
    }

    const sortSelect = document.getElementById('filter-sort');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this.sortOption = e.target.value;
        this.renderFleet();
      });
    }

    // Bouton de rafraîchissement manuel
    const btnRefresh = document.getElementById('btn-refresh-now');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        this.refreshData();
        this.secondsLeft = this.refreshInterval;
      });
    }

    // Modale centrale - fermeture
    const plantModalClose = document.getElementById('close-plant-modal');
    if (plantModalClose) {
      plantModalClose.addEventListener('click', () => {
        document.getElementById('plant-detail-dialog').close();
      });
    }

    // Modale réacteur - fermeture
    const reactorModalClose = document.getElementById('close-reactor-modal');
    if (reactorModalClose) {
      reactorModalClose.addEventListener('click', () => {
        document.getElementById('reactor-detail-dialog').close();
      });
    }

    // Visionneuse photo (Lightbox) - fermeture au clic ou bouton
    const lightboxDialog = document.getElementById('image-lightbox-dialog');
    if (lightboxDialog) {
      lightboxDialog.addEventListener('click', () => {
        lightboxDialog.close();
      });
    }

    // Fermeture des modales au clic sur le fond (backdrop)
    document.querySelectorAll('dialog').forEach(diag => {
      diag.addEventListener('click', (e) => {
        if (e.target === diag) diag.close();
      });
    });
  }

  switchTab(tabId) {
    this.activeTab = tabId;

    // Mise à jour des boutons d'onglets
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabId);
    });

    // Affichage des sections
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('hidden', pane.id !== `tab-${tabId}`);
    });

    // Invalider la taille de la carte si on bascule sur l'onglet carte
    if (tabId === 'map' && this.nuclearMap) {
      this.nuclearMap.init();
      this.nuclearMap.invalidateSize();
      if (this.fleetData) {
        this.nuclearMap.updateMarkers(this.fleetData.plants);
      }
    }

    // Redessiner les graphiques si on va sur l'onglet Mix
    if (tabId === 'mix' && this.nationalData) {
      this.renderMixView();
    }
  }

  setViewMode(mode) {
    this.viewMode = mode;
    const btnGrid = document.getElementById('btn-view-grid');
    const btnTable = document.getElementById('btn-view-table');

    if (btnGrid) btnGrid.classList.toggle('active', mode === 'grid');
    if (btnTable) btnTable.classList.toggle('active', mode === 'table');

    const gridContainer = document.getElementById('fleet-grid-view');
    const tableContainer = document.getElementById('fleet-table-view');

    if (gridContainer) gridContainer.classList.toggle('hidden', mode !== 'grid');
    if (tableContainer) tableContainer.classList.toggle('hidden', mode !== 'table');

    this.renderFleet();
  }

  startCountdownTimer() {
    if (this.timer) clearInterval(this.timer);
    this.secondsLeft = this.refreshInterval;

    this.timer = setInterval(() => {
      this.secondsLeft--;
      const timerEl = document.getElementById('countdown-seconds');
      if (timerEl) {
        timerEl.textContent = `${this.secondsLeft}s`;
      }

      if (this.secondsLeft <= 0) {
        this.secondsLeft = this.refreshInterval;
        if (this.autoRefresh) {
          this.refreshData();
        }
      }
    }, 1000);
  }

  async refreshData() {
    const refreshBtn = document.getElementById('btn-refresh-now');
    if (refreshBtn) refreshBtn.classList.add('refreshing');

    try {
      await apiService.fetchLiveUnitsFile();
      this.nationalData = await apiService.fetchLiveEco2mix();
      this.fleetData = apiService.calibrateFleet(this.nationalData.nuclearMW);

      this.renderTopKpis();
      this.renderFleet();
      this.renderMapQuickPlants();
      if (this.nuclearMap) {
        this.nuclearMap.updateMarkers(this.fleetData.plants);
        this.nuclearMap.invalidateSize();
      }
      if (this.activeTab === 'mix') {
        this.renderMixView();
      }

      // Mise à jour heure de synchro
      const updatedEl = document.getElementById('last-sync-time');
      if (updatedEl) {
        updatedEl.textContent = this.nationalData.formattedTime;
      }
    } catch (err) {
      console.error('Erreur de rafraîchissement:', err);
    } finally {
      if (refreshBtn) refreshBtn.classList.remove('refreshing');
    }
  }

  renderTopKpis() {
    if (!this.nationalData || !this.fleetData) return;

    const nat = this.nationalData;
    const stats = this.fleetData.stats;

    // Production totale
    const totalPowerEl = document.getElementById('kpi-total-power');
    const totalGwEl = document.getElementById('kpi-total-gw');
    if (totalPowerEl) totalPowerEl.textContent = nat.nuclearMW.toLocaleString('fr-FR');
    if (totalGwEl) totalGwEl.textContent = `${nat.nuclearGW} GW`;

    // Facteur de charge
    const loadFactorEl = document.getElementById('kpi-load-factor');
    if (loadFactorEl) loadFactorEl.textContent = `${nat.loadFactor}%`;

    // Part dans le mix
    const mixShareEl = document.getElementById('kpi-mix-share');
    if (mixShareEl) mixShareEl.textContent = `${nat.nuclearShare}%`;

    // Intensité carbone
    const co2El = document.getElementById('kpi-co2-intensity');
    if (co2El) co2El.textContent = `${nat.co2Intensity} g/kWh`;

    // Solde exportateur
    const exportEl = document.getElementById('kpi-net-export');
    if (exportEl) {
      const isExport = nat.netExportMW >= 0;
      exportEl.textContent = `${isExport ? '+' : ''}${nat.netExportMW.toLocaleString('fr-FR')} MW`;
      exportEl.className = isExport ? 'kpi-value text-emerald' : 'kpi-value text-amber';
    }

    // Répartition de la flotte (Chips du bandeau)
    const chipRunning = document.getElementById('chip-count-running');
    if (chipRunning) chipRunning.textContent = stats.runningCount;

    const chipModulating = document.getElementById('chip-count-modulating');
    if (chipModulating) chipModulating.textContent = stats.modulatingCount;

    const chipPlanned = document.getElementById('chip-count-planned');
    if (chipPlanned) chipPlanned.textContent = stats.plannedStopCount;

    const chipUnplanned = document.getElementById('chip-count-unplanned');
    if (chipUnplanned) chipUnplanned.textContent = stats.unplannedStopCount;

    const chipEpr = document.getElementById('chip-count-epr');
    if (chipEpr) chipEpr.textContent = stats.commissioningCount;

    // Barre proportionnelle de disponibilité
    const barRunning = document.getElementById('fleet-bar-running');
    const barModulating = document.getElementById('fleet-bar-modulating');
    const barPlanned = document.getElementById('fleet-bar-planned');
    const barUnplanned = document.getElementById('fleet-bar-unplanned');
    const barEpr = document.getElementById('fleet-bar-epr');

    const total = stats.totalReactors;
    if (barRunning) barRunning.style.width = `${(stats.runningCount / total) * 100}%`;
    if (barModulating) barModulating.style.width = `${(stats.modulatingCount / total) * 100}%`;
    if (barPlanned) barPlanned.style.width = `${(stats.plannedStopCount / total) * 100}%`;
    if (barUnplanned) barUnplanned.style.width = `${(stats.unplannedStopCount / total) * 100}%`;
    if (barEpr) barEpr.style.width = `${(stats.commissioningCount / total) * 100}%`;
  }

  filterAndSortReactors() {
    if (!this.fleetData) return [];

    let list = [...this.fleetData.reactors];
    const plantsMap = this.fleetData.plantsMap;

    // Filtre texte
    if (this.searchQuery) {
      const q = this.searchQuery;
      list = list.filter(r => {
        const plant = plantsMap[r.plantId];
        return r.name.toLowerCase().includes(q) ||
               (plant && plant.name.toLowerCase().includes(q)) ||
               r.stage.toLowerCase().includes(q) ||
               r.eicCode.toLowerCase().includes(q);
      });
    }

    // Filtre statut
    if (this.statusFilter !== 'ALL') {
      list = list.filter(r => r.status === this.statusFilter);
    }

    // Filtre palier
    if (this.stageFilter !== 'ALL') {
      if (this.stageFilter === '900') {
        list = list.filter(r => ['CP0', 'CP1', 'CP2'].includes(r.stage));
      } else if (this.stageFilter === '1300') {
        list = list.filter(r => ['P4', "P'4"].includes(r.stage));
      } else if (this.stageFilter === '1450') {
        list = list.filter(r => r.stage === 'N4');
      } else if (this.stageFilter === 'EPR') {
        list = list.filter(r => r.stage === 'EPR');
      }
    }

    // Filtre refroidissement
    if (this.coolingFilter !== 'ALL') {
      list = list.filter(r => {
        const plant = plantsMap[r.plantId];
        return plant && plant.coolingType === this.coolingFilter;
      });
    }

    // Tri
    list.sort((a, b) => {
      switch (this.sortOption) {
        case 'power_desc':
          return b.currentPower - a.currentPower;
        case 'load_desc':
          return parseFloat(b.loadFactor) - parseFloat(a.loadFactor);
        case 'name_asc':
          return a.name.localeCompare(b.name);
        case 'plant_asc':
          return a.plantId.localeCompare(b.plantId);
        case 'capacity_desc':
          return b.netPower_MW - a.netPower_MW;
        default:
          return b.currentPower - a.currentPower;
      }
    });

    return list;
  }

  renderFleet() {
    const reactors = this.filterAndSortReactors();
    const plantsMap = this.fleetData ? this.fleetData.plantsMap : {};

    // Compteur de résultats
    const countEl = document.getElementById('filtered-reactors-count');
    if (countEl) {
      countEl.textContent = `${reactors.length} réacteur${reactors.length > 1 ? 's' : ''}`;
    }

    if (this.viewMode === 'grid') {
      this.renderGridView(reactors, plantsMap);
    } else {
      this.renderTableView(reactors, plantsMap);
    }
  }

  renderMapQuickPlants() {
    const container = document.getElementById('map-quick-plants');
    if (!container || !this.fleetData) return;

    const plants = this.fleetData.plants;
    container.innerHTML = plants.map(plant => {
      let statusColor = '#10b981';
      if (plant.stoppedCount === plant.reactors.length) statusColor = '#ef4444';
      else if (plant.stoppedCount > 0) statusColor = '#f59e0b';
      else if (plant.modulatingCount > 0) statusColor = '#06b6d4';
      if (plant.id === 'FLAMANVILLE') statusColor = '#8b5cf6';

      return `
        <div class="quick-plant-card ${plant.statusClass}" onclick="window.nuclearApp.focusOnMapAndInspect('${plant.id}')" title="Cliquez pour centrer la carte sur ${plant.name}">
          <div class="qp-header">
            <span class="qp-name">${plant.name}</span>
            <span class="qp-load" style="color: ${statusColor}; font-weight: 800;">${plant.loadFactor}%</span>
          </div>
          <div class="qp-meta font-mono">
            <strong>${plant.currentPower.toLocaleString('fr-FR')} MW</strong> / ${plant.totalCapacity.toLocaleString('fr-FR')} MW
          </div>
          <div class="qp-track">
            <div class="qp-fill" style="width: ${plant.loadFactor}%; background-color: ${statusColor}"></div>
          </div>
          <div class="qp-footer">
            <span>${plant.reactors.length} tranche${plant.reactors.length > 1 ? 's' : ''}</span>
            <span class="qp-inspect-link">Examiner ↗</span>
          </div>
        </div>
      `;
    }).join('');
  }

  focusOnMapAndInspect(plantId) {
    if (this.nuclearMap) {
      this.nuclearMap.focusPlant(plantId, this.fleetData.plantsMap);
    }
  }

  renderGridView(reactors, plantsMap) {
    const container = document.getElementById('fleet-grid-view');
    if (!container) return;

    if (reactors.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <p>Aucun réacteur ne correspond à vos filtres actuels.</p>
          <button class="btn-reset-filters" onclick="window.nuclearApp.resetFilters()">Réinitialiser les filtres</button>
        </div>
      `;
      return;
    }

    container.innerHTML = reactors.map(r => {
      const plant = plantsMap[r.plantId] || {};
      const load = parseFloat(r.loadFactor);
      const sparkline = chartsService.generateSparklineSvg(r.history24h, 110, 28);

      let statusColor = '#10b981';
      if (r.status === 'PLANNED_STOP') statusColor = '#f59e0b';
      else if (r.status === 'UNPLANNED_STOP') statusColor = '#ef4444';
      else if (r.status === 'MODULATING') statusColor = '#06b6d4';
      else if (r.status === 'COMMISSIONING') statusColor = '#8b5cf6';

      return `
        <article class="reactor-card ${r.statusClass}" onclick="window.nuclearApp.openReactorModal('${r.id}')">
          <header class="reactor-card-header">
            <div>
              <h3 class="reactor-name">${r.name}</h3>
              <span class="plant-link" onclick="event.stopPropagation(); window.nuclearApp.openPlantModal('${r.plantId}')">
                📍 Centrale de ${plant.name || r.plantId}
              </span>
            </div>
            <span class="stage-tag">${r.stage}</span>
          </header>

          <div class="reactor-power-row">
            <div class="power-display">
              <span class="power-num">${r.currentPower.toLocaleString('fr-FR')}</span>
              <span class="power-unit">MW</span>
            </div>
            <div class="reactor-load-badge" style="color: ${statusColor}">
              ${r.loadFactor}%
            </div>
          </div>

          <div class="power-progress-track">
            <div class="power-progress-fill" style="width: ${Math.min(100, load)}%; background-color: ${statusColor}"></div>
          </div>

          <div class="nominal-sub">
            Capacité nominale : <strong>${r.netPower_MW.toLocaleString('fr-FR')} MW</strong>
          </div>

          <div class="reactor-sparkline-row">
            <div class="status-indicator">
              <span class="status-dot" style="background-color: ${statusColor}"></span>
              <span class="status-text">${r.statusLabel}</span>
            </div>
            <div class="sparkline-wrapper" title="Courbe de production sur 24h">
              ${sparkline}
            </div>
          </div>

          ${r.reason ? `<div class="outage-reason" title="${r.reason}">ℹ️ ${r.reason}</div>` : ''}

          <footer class="reactor-card-footer">
            <span class="cooling-pill">${plant.coolingType === 'SEA' ? '🌊 Mer' : '🏞️ Fleuve'}</span>
            ${r.moxAuthorized ? '<span class="mox-pill" title="Autorisé au combustible MOX">MOX</span>' : ''}
            <span class="view-details-action">Détails →</span>
          </footer>
        </article>
      `;
    }).join('');
  }

  renderTableView(reactors, plantsMap) {
    const tbody = document.getElementById('fleet-table-body');
    if (!tbody) return;

    if (reactors.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center p-8 text-slate-400">
            Aucun réacteur ne correspond à vos filtres.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = reactors.map(r => {
      const plant = plantsMap[r.plantId] || {};
      const load = parseFloat(r.loadFactor);
      let statusColor = '#10b981';
      if (r.status === 'PLANNED_STOP') statusColor = '#f59e0b';
      else if (r.status === 'UNPLANNED_STOP') statusColor = '#ef4444';
      else if (r.status === 'MODULATING') statusColor = '#06b6d4';
      else if (r.status === 'COMMISSIONING') statusColor = '#8b5cf6';

      return `
        <tr class="table-row hover-row" onclick="window.nuclearApp.openReactorModal('${r.id}')">
          <td class="font-bold text-white">${r.name}</td>
          <td>
            <span class="plant-table-link" onclick="event.stopPropagation(); window.nuclearApp.openPlantModal('${r.plantId}')">
              ${plant.name || r.plantId}
            </span>
          </td>
          <td><span class="stage-tag">${r.stage}</span></td>
          <td class="font-mono font-bold text-right text-emerald">
            ${r.currentPower.toLocaleString('fr-FR')} MW
          </td>
          <td class="font-mono text-right text-slate-400">
            ${r.netPower_MW.toLocaleString('fr-FR')} MW
          </td>
          <td class="text-right">
            <div class="table-load-cell">
              <div class="progress-mini-track">
                <div class="progress-mini-fill" style="width: ${Math.min(100, load)}%; background-color: ${statusColor}"></div>
              </div>
              <span class="font-mono font-bold" style="color: ${statusColor}">${r.loadFactor}%</span>
            </div>
          </td>
          <td>
            <span class="badge ${r.statusClass}">
              <span class="status-dot-mini" style="background-color: ${statusColor}"></span>
              ${r.statusLabel.split(' (')[0]}
            </span>
          </td>
          <td>
            <button class="btn-table-action" onclick="event.stopPropagation(); window.nuclearApp.openReactorModal('${r.id}')">
              Détails
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  renderMixView() {
    if (!this.nationalData) return;

    // Dessiner la courbe 24h
    chartsService.renderGenerationChart('generation-chart-canvas', this.nationalData.history);

    // Dessiner le mix circulaire
    chartsService.renderMixChart('mix-chart-canvas', this.nationalData.mix);

    // Remplir les échanges transfrontaliers
    const ex = this.nationalData.exchanges;
    this.renderExchangeCard('ex-uk', 'Royaume-Uni', ex.uk, '🇬🇧');
    this.renderExchangeCard('ex-spain', 'Espagne', ex.spain, '🇪🇸');
    this.renderExchangeCard('ex-italy', 'Italie', ex.italy, '🇮🇹');
    this.renderExchangeCard('ex-switzerland', 'Suisse', ex.switzerland, '🇨🇭');
    this.renderExchangeCard('ex-germany-belgium', 'Allemagne & Belgique', ex.germanyBelgium, '🇩🇪 🇧🇪');
  }

  renderExchangeCard(elId, country, powerMW, flag) {
    const el = document.getElementById(elId);
    if (!el) return;

    const isExport = powerMW >= 0;
    el.innerHTML = `
      <div class="exchange-item">
        <div class="exchange-country">
          <span class="flag">${flag}</span>
          <span>${country}</span>
        </div>
        <div class="exchange-flow ${isExport ? 'export-flow' : 'import-flow'}">
          <span>${isExport ? 'Export' : 'Import'}</span>
          <strong>${Math.abs(powerMW).toLocaleString('fr-FR')} MW</strong>
          <span class="flow-arrow">${isExport ? '↗' : '↙'}</span>
        </div>
      </div>
    `;
  }

  openPlantModal(plantId) {
    if (!this.fleetData) return;
    const plant = this.fleetData.plantsMap[plantId];
    if (!plant) return;

    const modal = document.getElementById('plant-detail-dialog');
    const titleEl = document.getElementById('plant-modal-title');
    const bodyEl = document.getElementById('plant-modal-body');

    if (titleEl) {
      titleEl.innerHTML = `Centrale Nucléaire de ${plant.name}`;
    }

    if (bodyEl) {
      const plantPhotoSrc = plant.photo || `images/plants/${plant.id.toLowerCase()}.jpg`;
      bodyEl.innerHTML = `
        <div class="plant-modal-content">
          <div class="plant-hero clickable-hero" 
               onclick="window.nuclearApp.openImageLightbox('${plantPhotoSrc}', 'Centrale Nucléaire de ${plant.name}')"
               title="Cliquez pour agrandir la photo">
            <img src="${plantPhotoSrc}" 
                 alt="Centrale Nucléaire de ${plant.name}" 
                 class="plant-hero-img"
                 loading="eager"
                 onerror="this.onerror=null; this.src='images/plants/' + '${plant.id.toLowerCase()}' + '.jpg';">
            <div class="plant-hero-zoom-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                <line x1="11" y1="8" x2="11" y2="14"></line>
                <line x1="8" y1="11" x2="14" y2="11"></line>
              </svg>
              <span>Agrandir</span>
            </div>
            <div class="plant-hero-overlay">
              <span class="badge ${plant.statusClass}">${plant.statusSummary}</span>
              <div class="hero-power-stat">
                <span>Production totale : <strong>${plant.currentPower.toLocaleString('fr-FR')} MW</strong></span>
                <span>Capacité : <strong>${plant.totalCapacity.toLocaleString('fr-FR')} MW</strong> (${plant.loadFactor}%)</span>
              </div>
            </div>
          </div>

          <div class="plant-specs-grid">
            <div class="spec-card">
              <span class="spec-label">Localisation</span>
              <span class="spec-value">${plant.department}, ${plant.region}</span>
            </div>
            <div class="spec-card">
              <span class="spec-label">Source de refroidissement</span>
              <span class="spec-value">${plant.coolingPlace} (${plant.coolingType === 'SEA' ? 'Eau de mer' : 'Fleuve'})</span>
            </div>
            <div class="spec-card">
              <span class="spec-label">Aéroréfrigérants</span>
              <span class="spec-value">${plant.towers > 0 ? `${plant.towers} tours` : 'Aucune tour (circuit ouvert)'}</span>
            </div>
            <div class="spec-card">
              <span class="spec-label">Nombre de tranches</span>
              <span class="spec-value">${plant.reactors.length} réacteurs en service</span>
            </div>
          </div>

          <p class="plant-desc">${plant.coolingDesc}</p>

          <h4 class="section-title">Tranches de production du site (${plant.reactors.length})</h4>
          <div class="plant-reactors-grid">
            ${plant.reactors.map(r => `
              <div class="modal-reactor-card ${r.statusClass}" onclick="window.nuclearApp.openReactorModal('${r.id}')">
                <div class="modal-r-header">
                  <strong>${r.name}</strong>
                  <span class="stage-tag">${r.stage}</span>
                </div>
                <div class="modal-r-power">
                  <span class="power-val">${r.currentPower.toLocaleString('fr-FR')} MW</span>
                  <span class="power-pct">/ ${r.netPower_MW} MW (${r.loadFactor}%)</span>
                </div>
                <div class="modal-r-status">
                  <span class="status-dot-mini ${r.statusClass}"></span>
                  <span>${r.statusLabel}</span>
                </div>
                ${r.reason ? `<div class="modal-r-reason">${r.reason}</div>` : ''}
              </div>
            `).join('')}
          </div>

          <div class="plant-official-links">
            <a href="${plant.edfLink}" target="_blank" rel="noopener" class="link-btn edf-link">
              Site EDF officiel ↗
            </a>
            <a href="${plant.asnLink}" target="_blank" rel="noopener" class="link-btn asn-link">
              Rapports ASN ↗
            </a>
            <a href="${plant.wikiLink}" target="_blank" rel="noopener" class="link-btn wiki-link">
              Fiche Wikipédia ↗
            </a>
          </div>
        </div>
      `;
    }

    modal.showModal();
  }

  openImageLightbox(photoUrl, title) {
    const dialog = document.getElementById('image-lightbox-dialog');
    const img = document.getElementById('lightbox-img');
    const titleEl = document.getElementById('lightbox-caption-title');
    if (!dialog || !img) return;

    img.src = photoUrl;
    img.alt = title || 'Photo de la centrale nucléaire';
    if (titleEl) {
      titleEl.textContent = title || 'Centrale Nucléaire';
    }

    dialog.showModal();
  }

  openReactorModal(reactorId) {
    if (!this.fleetData || !reactorId) return;
    const cleanId = String(reactorId).toLowerCase();
    const reactor = this.fleetData.reactors.find(r => r.id.toLowerCase() === cleanId);
    if (!reactor) return;

    const plant = this.fleetData.plantsMap[reactor.plantId] || {};
    const modal = document.getElementById('reactor-detail-dialog');
    const titleEl = document.getElementById('reactor-modal-title');
    const bodyEl = document.getElementById('reactor-modal-body');

    if (titleEl) {
      titleEl.textContent = `Tranche : ${reactor.name}`;
    }

    if (bodyEl) {
      bodyEl.innerHTML = `
        <div class="reactor-modal-content">
          <div class="reactor-status-banner ${reactor.statusClass}">
            <div class="banner-title">
              <span class="status-dot"></span>
              <strong>${reactor.statusLabel}</strong>
            </div>
            <div class="banner-power font-mono">
              ${reactor.currentPower.toLocaleString('fr-FR')} MW / ${reactor.netPower_MW.toLocaleString('fr-FR')} MW (${reactor.loadFactor}%)
            </div>
          </div>

          ${reactor.reason ? `
            <div class="outage-alert-box">
              <strong>Motif de l'état :</strong> ${reactor.reason}
            </div>
          ` : ''}

          <h4 class="section-title">Caractéristiques techniques de la tranche</h4>
          <div class="tech-specs-table">
            <div class="spec-row">
              <span class="spec-k">Centrale de rattachement</span>
              <span class="spec-v"><a href="javascript:void(0)" onclick="window.nuclearApp.openPlantModal('${reactor.plantId}')">Centrale de ${plant.name} (${plant.region})</a></span>
            </div>
            <div class="spec-row">
              <span class="spec-k">Palier technologique</span>
              <span class="spec-v">${reactor.stage} (Réacteur à eau pressurisée REP)</span>
            </div>
            <div class="spec-row">
              <span class="spec-k">Puissance thermique brute</span>
              <span class="spec-v">${reactor.thermalPower_MW.toLocaleString('fr-FR')} MWth</span>
            </div>
            <div class="spec-row">
              <span class="spec-k">Puissance électrique nette</span>
              <span class="spec-v">${reactor.netPower_MW.toLocaleString('fr-FR')} MWe</span>
            </div>
            <div class="spec-row">
              <span class="spec-k">Code EIC officiel (RTE/ENTSO-E)</span>
              <span class="spec-v font-mono text-cyan">${reactor.eicCode}</span>
            </div>
            <div class="spec-row">
              <span class="spec-k">Mise en service industrielle</span>
              <span class="spec-v">${reactor.exploitationStartDate}</span>
            </div>
            <div class="spec-row">
              <span class="spec-k">Combustible MOX (Plutonium recyclé)</span>
              <span class="spec-v">${reactor.moxAuthorized ? '✅ Autorisé' : '❌ Non utilisé'}</span>
            </div>
            <div class="spec-row">
              <span class="spec-k">Refroidissement tranche</span>
              <span class="spec-v">${reactor.coolingTowers > 0 ? `${reactor.coolingTowers} tour(s) aéroréfrigérante(s)` : 'Circuit direct sans tour'} (${plant.coolingPlace})</span>
            </div>
          </div>

          <h4 class="section-title">Profil de production sur les dernières 48 heures (2 jours réels RTE)</h4>
          <div class="reactor-chart-box">
            <canvas id="reactor-single-chart" height="180"></canvas>
          </div>
        </div>
      `;

      modal.showModal();

      // Dessiner le graphique spécifique de ce réacteur (48h réelles)
      setTimeout(() => {
        const canvas = document.getElementById('reactor-single-chart');
        if (canvas) {
          // Détruire tout graphique précédent pour éviter le bug de réutilisation
          const existingChart = Chart.getChart(canvas);
          if (existingChart) {
            existingChart.destroy();
          }

          const rawHistory = reactor.history || reactor.history48h || reactor.history24h || [];
          const labels = rawHistory.map((h, i) => {
            if (typeof h === 'number') return `-${rawHistory.length - i}h`;
            return h.time || h.date || `${i}h`;
          });
          const dataPoints = rawHistory.map(h => (typeof h === 'number' ? h : (h.power ?? 0)));

          // Couleur selon le statut
          let lineColor = '#10b981';
          let fillColor = 'rgba(16, 185, 129, 0.15)';
          if (reactor.status === 'PLANNED_STOP') {
            lineColor = '#f59e0b';
            fillColor = 'rgba(245, 158, 11, 0.15)';
          } else if (reactor.status === 'UNPLANNED_STOP') {
            lineColor = '#ef4444';
            fillColor = 'rgba(239, 68, 68, 0.15)';
          } else if (reactor.status === 'MODULATING') {
            lineColor = '#06b6d4';
            fillColor = 'rgba(6, 182, 212, 0.15)';
          } else if (reactor.status === 'COMMISSIONING') {
            lineColor = '#a855f7';
            fillColor = 'rgba(168, 85, 247, 0.15)';
          }

          new Chart(canvas, {
            type: 'line',
            data: {
              labels: labels,
              datasets: [{
                label: `Puissance ${reactor.name} (MW)`,
                data: dataPoints,
                borderColor: lineColor,
                backgroundColor: fillColor,
                fill: true,
                tension: 0.25,
                pointRadius: rawHistory.length > 24 ? 1.5 : 2.5,
                pointHoverRadius: 5,
                borderWidth: 2
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  backgroundColor: '#0f172a',
                  titleColor: '#f8fafc',
                  bodyColor: '#38bdf8',
                  borderColor: '#334155',
                  borderWidth: 1,
                  padding: 10,
                  displayColors: false,
                  callbacks: {
                    label: function(context) {
                      const mw = context.parsed.y;
                      const pct = reactor.netPower_MW > 0 ? ((mw / reactor.netPower_MW) * 100).toFixed(1) : 0;
                      return `Puissance : ${mw.toLocaleString('fr-FR')} MW (${pct}%)`;
                    }
                  }
                }
              },
              scales: {
                x: {
                  ticks: {
                    color: '#94a3b8',
                    maxTicksLimit: 12,
                    font: { size: 10 }
                  },
                  grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                y: {
                  min: 0,
                  suggestedMax: reactor.netPower_MW,
                  ticks: {
                    color: '#94a3b8',
                    callback: function(val) { return val + ' MW'; }
                  },
                  grid: { color: 'rgba(255, 255, 255, 0.05)' }
                }
              }
            }
          });
        }
      }, 100);
    }
  }

  resetFilters() {
    this.searchQuery = '';
    this.statusFilter = 'ALL';
    this.stageFilter = 'ALL';
    this.coolingFilter = 'ALL';
    this.sortOption = 'power_desc';

    const searchInput = document.getElementById('search-reactors');
    if (searchInput) searchInput.value = '';

    const statusSelect = document.getElementById('filter-status');
    if (statusSelect) statusSelect.value = 'ALL';

    const stageSelect = document.getElementById('filter-stage');
    if (stageSelect) stageSelect.value = 'ALL';

    const coolingSelect = document.getElementById('filter-cooling');
    if (coolingSelect) coolingSelect.value = 'ALL';

    const sortSelect = document.getElementById('filter-sort');
    if (sortSelect) sortSelect.value = 'power_desc';

    this.renderFleet();
  }
}

// Initialisation robuste au chargement du DOM
function startNuclearApp() {
  if (!window.nuclearApp) {
    window.nuclearApp = new NuclearMonitorApp();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startNuclearApp);
} else {
  startNuclearApp();
}
