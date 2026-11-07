/**
 * Nuclear Monitor - Visualization & Charts Engine
 * Graphiques de production 24h, mix énergétique et jauges avec Chart.js
 */

class NuclearCharts {
  constructor() {
    this.generationChart = null;
    this.mixChart = null;
  }

  /**
   * Crée ou met à jour la courbe de production 24h (Nucléaire vs Consommation)
   */
  renderGenerationChart(canvasId, historyData) {
    if (typeof Chart === 'undefined') return;
    const canvas = document.getElementById(canvasId);
    if (!canvas || !historyData || historyData.length === 0) return;

    const labels = historyData.map(d => d.time);
    const nuclearData = historyData.map(d => d.nuclear);
    const consumptionData = historyData.map(d => d.consumption);
    const windData = historyData.map(d => d.wind);
    const solarData = historyData.map(d => d.solar);

    const config = {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Production Nucléaire (MW)',
            data: nuclearData,
            borderColor: '#10b981', // Vert émeraude
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            fill: true,
            tension: 0.3,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: '#10b981'
          },
          {
            label: 'Consommation Nationale (MW)',
            data: consumptionData,
            borderColor: '#94a3b8', // Gris clair
            borderDash: [5, 5],
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: '#94a3b8'
          },
          {
            label: 'Éolien (MW)',
            data: windData,
            borderColor: '#06b6d4', // Cyan
            borderWidth: 1.5,
            fill: false,
            tension: 0.3,
            pointRadius: 0
          },
          {
            label: 'Solaire (MW)',
            data: solarData,
            borderColor: '#f59e0b', // Ambre
            borderWidth: 1.5,
            fill: false,
            tension: 0.3,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#cbd5e1',
              font: { family: 'Inter, system-ui, sans-serif', size: 12 },
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            backgroundColor: '#0f172a',
            titleColor: '#f8fafc',
            bodyColor: '#cbd5e1',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: function(context) {
                return `${context.dataset.label}: ${context.parsed.y.toLocaleString('fr-FR')} MW`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(51, 65, 85, 0.4)' },
            ticks: {
              color: '#94a3b8',
              maxTicksLimit: 12,
              font: { size: 11 }
            }
          },
          y: {
            grid: { color: 'rgba(51, 65, 85, 0.4)' },
            ticks: {
              color: '#94a3b8',
              callback: val => `${(val / 1000).toFixed(0)} GW`,
              font: { size: 11 }
            }
          }
        }
      }
    };

    if (this.generationChart) {
      this.generationChart.data = config.data;
      this.generationChart.update();
    } else {
      this.generationChart = new Chart(canvas, config);
    }
  }

  /**
   * Crée ou met à jour le diagramme circulaire du mix électrique français
   */
  renderMixChart(canvasId, mixData) {
    if (typeof Chart === 'undefined') return;
    const canvas = document.getElementById(canvasId);
    if (!canvas || !mixData) return;

    const dataPoints = [
      { label: 'Nucléaire', value: mixData.nuclear, color: '#10b981' },
      { label: 'Hydraulique', value: mixData.hydro, color: '#3b82f6' },
      { label: 'Éolien', value: mixData.wind, color: '#06b6d4' },
      { label: 'Solaire', value: mixData.solar, color: '#f59e0b' },
      { label: 'Gaz', value: mixData.gas, color: '#f97316' },
      { label: 'Bioénergies', value: mixData.bioenergy, color: '#84cc16' },
      { label: 'Thermique fossile (Fioul/Charbon)', value: (mixData.oil || 0) + (mixData.coal || 0), color: '#ef4444' }
    ].filter(d => d.value > 0);

    const total = dataPoints.reduce((sum, d) => sum + d.value, 0);

    const config = {
      type: 'doughnut',
      data: {
        labels: dataPoints.map(d => `${d.label} (${((d.value / total) * 100).toFixed(1)}%)`),
        datasets: [{
          data: dataPoints.map(d => d.value),
          backgroundColor: dataPoints.map(d => d.color),
          borderWidth: 2,
          borderColor: '#0f172a',
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#cbd5e1',
              font: { size: 12 },
              padding: 14,
              usePointStyle: true
            }
          },
          tooltip: {
            backgroundColor: '#0f172a',
            titleColor: '#f8fafc',
            bodyColor: '#cbd5e1',
            borderColor: '#334155',
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                const val = context.parsed;
                const pct = ((val / total) * 100).toFixed(1);
                return `${context.label.split(' (')[0]}: ${val.toLocaleString('fr-FR')} MW (${pct}%)`;
              }
            }
          }
        }
      }
    };

    if (this.mixChart) {
      this.mixChart.data = config.data;
      this.mixChart.update();
    } else {
      this.mixChart = new Chart(canvas, config);
    }
  }

  /**
   * Génère un mini code SVG sparkline 24h pour une carte de réacteur
   */
  generateSparklineSvg(history, width = 120, height = 30) {
    if (!history || history.length === 0) return '';

    const maxVal = Math.max(...history.map(d => d.power), 100);
    const points = history.map((d, i) => {
      const x = (i / (history.length - 1)) * width;
      const y = height - (d.power / maxVal) * (height - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const lastPower = history[history.length - 1].power;
    const strokeColor = lastPower > 0 ? '#10b981' : '#ef4444';

    return `
      <svg width="${width}" height="${height}" class="sparkline-svg" viewBox="0 0 ${width} ${height}">
        <polyline fill="none" stroke="${strokeColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${points}" />
      </svg>
    `;
  }
}

const chartsService = new NuclearCharts();
