/**
 * Nuclear Monitor - Interactive Fleet Map
 * Carte interactive des 18 centrales nucléaires françaises avec Leaflet
 */

class NuclearMap {
  constructor(containerId, onPlantSelect) {
    this.containerId = containerId;
    this.onPlantSelect = onPlantSelect;
    this.map = null;
    this.markers = {};
    this.isInitialized = false;
  }

  init() {
    if (this.isInitialized || typeof L === 'undefined' || !document.getElementById(this.containerId)) return;

    // Centrage sur la France métropolitaine
    this.map = L.map(this.containerId, {
      center: [46.7, 2.5],
      zoom: 6,
      minZoom: 5,
      maxZoom: 11,
      zoomControl: true,
      attributionControl: false
    });

    // Couche 1 (Par défaut) : ESRI World Dark Gray (sans watermark, sombre, fluide et sans clé API)
    const esriDarkBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors'
    });
    const esriDarkRef = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16
    });
    const esriDarkGroup = L.layerGroup([esriDarkBase, esriDarkRef]).addTo(this.map);

    // Couche 2 (Alternative) : OpenStreetMap Standard (100% open data)
    const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
    });

    // Sélecteur de couches
    const baseLayers = {
      "🌙 Fond Sombre Haute Précision": esriDarkGroup,
      "🗺️ OpenStreetMap": osmLayer
    };
    this.layerControl = L.control.layers(baseLayers, null, { position: 'topright' }).addTo(this.map);

    // Amélioration de l'ergonomie : ouverture/fermeture au clic sur l'icône de calques
    const layersContainer = this.layerControl.getContainer();
    const toggleBtn = layersContainer.querySelector('.leaflet-control-layers-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (layersContainer.classList.contains('leaflet-control-layers-expanded')) {
          this.layerControl.collapse();
        } else {
          this.layerControl.expand();
        }
      });
    }

    // Contrôle d'attribution discret
    L.control.attribution({
      position: 'bottomright',
      prefix: 'Données <a href="https://odre.opendatasoft.com" target="_blank">RTE éCO2mix</a> · Carte Esri & OSM'
    }).addTo(this.map);

    this.isInitialized = true;
  }

  /**
   * Met à jour ou crée les marqueurs des 18 centrales nucléaires
   */
  updateMarkers(plants) {
    if (!this.map) this.init();
    if (!plants) return;

    plants.forEach(plant => {
      const load = parseFloat(plant.loadFactor);
      let statusColor = '#10b981'; // Vert nominal
      let glowClass = 'pulse-green';

      if (load < 10) {
        statusColor = '#ef4444'; // Arrêt
        glowClass = 'pulse-red';
      } else if (plant.stoppedCount > 0) {
        statusColor = '#f59e0b'; // Arrêt partiel
        glowClass = 'pulse-amber';
      } else if (plant.modulatingCount > 0) {
        statusColor = '#06b6d4'; // Modulation
        glowClass = 'pulse-cyan';
      }

      if (plant.id === 'FLAMANVILLE') {
        statusColor = '#8b5cf6'; // Flamanville (EPR)
        glowClass = 'pulse-purple';
      }

      // Icône SVG personnalisée avec anneau de charge
      const iconHtml = `
        <div class="reactor-map-marker ${glowClass}" data-plant-id="${plant.id}">
          <div class="marker-core" style="background-color: ${statusColor};">
            <span class="marker-reactors">${plant.reactors.length}</span>
          </div>
          <div class="marker-label">${plant.name}</div>
          <div class="marker-power">${plant.currentPower.toLocaleString('fr-FR')} MW</div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-reactor-pin',
        html: iconHtml,
        iconSize: [120, 60],
        iconAnchor: [60, 13], // Ancre le centre du badge circulaire (diamètre 26px) pile sur les coordonnées GPS
        popupAnchor: [0, -18]
      });

      // Création du contenu de la popup
      const popupHtml = `
        <div class="plant-map-popup">
          <div class="popup-header">
            <h4>Centrale de ${plant.name}</h4>
            <span class="badge ${plant.statusClass}">${plant.statusSummary}</span>
          </div>
          <div class="popup-meta">
            <div><strong>Région :</strong> ${plant.region} (${plant.department})</div>
            <div><strong>Refroidissement :</strong> ${plant.coolingPlace} (${plant.coolingType === 'SEA' ? 'Mer' : 'Fleuve'})</div>
            <div><strong>Tours :</strong> ${plant.towers > 0 ? plant.towers + ' tours' : 'Circuit ouvert (0 tour)'}</div>
          </div>
          <div class="popup-power-stat">
            <div class="power-gauge-label">
              <span>Production actuelle :</span>
              <strong class="power-val">${plant.currentPower.toLocaleString('fr-FR')} MW</strong>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${plant.loadFactor}%; background-color: ${statusColor}"></div>
            </div>
            <div class="power-sub">Capacité nominale : ${plant.totalCapacity.toLocaleString('fr-FR')} MW (${plant.loadFactor}%)</div>
          </div>
          <div class="popup-reactors-list">
            <strong>Tranches (${plant.reactors.length}) :</strong>
            <div class="mini-reactors-chips">
              ${plant.reactors.map(r => `
                <span class="mini-chip ${r.statusClass}" title="${r.name}: ${r.currentPower} MW (${r.statusLabel})">
                  ${r.name.replace(plant.name, '').trim()} : ${r.currentPower} MW
                </span>
              `).join('')}
            </div>
          </div>
          <button class="btn-popup-inspect" onclick="window.nuclearApp.openPlantModal('${plant.id}')">
            🔍 Voir la fiche détaillée de la centrale
          </button>
        </div>
      `;

      if (this.markers[plant.id]) {
        this.markers[plant.id].setIcon(customIcon);
        this.markers[plant.id].setPopupContent(popupHtml);
      } else {
        const marker = L.marker([plant.lat, plant.long], { icon: customIcon })
          .addTo(this.map)
          .bindPopup(popupHtml, { maxWidth: 320, className: 'dark-popup' });

        marker.on('click', () => {
          if (this.onPlantSelect) {
            this.onPlantSelect(plant.id);
          }
        });

        this.markers[plant.id] = marker;
      }
    });
  }

  /**
   * Centre la carte sur une centrale spécifique
   */
  focusPlant(plantId, plantsMap) {
    if (!this.map) return;
    const plant = plantsMap[plantId];
    if (plant) {
      this.map.flyTo([plant.lat, plant.long], 8, { duration: 1.2 });
      if (this.markers[plantId]) {
        this.markers[plantId].openPopup();
      }
    }
  }

  /**
   * Réinitialise la vue sur la France
   */
  resetView() {
    if (this.map) {
      this.map.flyTo([46.7, 2.5], 6, { duration: 1 });
    }
  }

  /**
   * Invalide la taille après changement d'onglet
   */
  invalidateSize() {
    if (this.map) {
      setTimeout(() => this.map.invalidateSize(), 150);
    }
  }
}
