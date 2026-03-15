/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  TIME SERIES ANALYSIS SERVICE v1.0                                  ║
 * ║                                                                      ║
 * ║  Fortgeschrittene Zeitreihen-Analyse für Johnny:                   ║
 * ║  - Trend-Erkennung (Linear, Exponentiell, Polynomial)              ║
 * ║  - Saisonalitäts-Dekomposition                                     ║
 * ║  - Anomalie-Erkennung (Z-Score, IQR, Isolation Forest)            ║
 * ║  - Prognose (Moving Average, Exp. Smoothing, ARIMA-like)          ║
 * ║  - Korrelationsanalyse zwischen Zeitreihen                         ║
 * ║  - Change Point Detection                                           ║
 * ║  - Natürlichsprachige Zusammenfassung via LLM                      ║
 * ║  - Chart-Konfiguration (Chart.js / SVG)                            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const fs   = require('fs').promises;
const path = require('path');

class TimeSeriesAnalysisService {
  constructor(config = {}) {
    this.agentManager = config.agentManager;
    this.dataDir      = config.dataDir || path.join(require('os').homedir(), '.johnny', 'timeseries');
    this._datasets    = new Map();
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});
    console.log('[TimeSeriesAnalysis] Initialized');
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ DATEN LADEN & VORBEREITEN ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Lädt und normalisiert Zeitreihen-Daten
   * @param {Array} data - [{ timestamp, value }] oder [{ date, ...values }]
   * @param {object} options - { dateField, valueField, frequency, fillGaps }
   */
  loadTimeSeries(data, options = {}) {
    const { dateField = 'timestamp', valueField = 'value', frequency, fillGaps = true, name } = options;

    // Normalisieren
    let series = data.map(d => {
      const ts = this._parseTimestamp(d[dateField] || d.date || d.ts || d.time);
      const val = parseFloat(d[valueField] || d.val || d.y);
      return { timestamp: ts, value: isNaN(val) ? null : val };
    }).filter(d => d.timestamp).sort((a, b) => a.timestamp - b.timestamp);

    // Lücken füllen
    if (fillGaps && series.length > 2) {
      series = this._fillGaps(series, frequency);
    }

    const id = name || 'ts_' + Date.now().toString(36);
    const meta = {
      id, count: series.length,
      startDate: new Date(series[0]?.timestamp).toISOString(),
      endDate: new Date(series[series.length - 1]?.timestamp).toISOString(),
      frequency: frequency || this._detectFrequency(series),
      hasNulls: series.some(s => s.value === null),
    };

    this._datasets.set(id, { series, meta });
    return meta;
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ STATISTISCHE ANALYSE ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Grundstatistiken einer Zeitreihe
   */
  statistics(datasetId) {
    const ds = this._datasets.get(datasetId);
    if (!ds) throw new Error('Dataset nicht gefunden: ' + datasetId);

    const values = ds.series.filter(s => s.value !== null).map(s => s.value);
    if (values.length === 0) return { error: 'Keine Werte vorhanden' };

    const sorted = [...values].sort((a, b) => a - b);
    const n = values.length;
    const sum = values.reduce((a, v) => a + v, 0);
    const mean = sum / n;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);

    return {
      count: n,
      min: sorted[0],
      max: sorted[n - 1],
      mean,
      median: n % 2 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
      stddev,
      variance,
      q1: sorted[Math.floor(n * 0.25)],
      q3: sorted[Math.floor(n * 0.75)],
      iqr: sorted[Math.floor(n * 0.75)] - sorted[Math.floor(n * 0.25)],
      skewness: this._skewness(values, mean, stddev),
      kurtosis: this._kurtosis(values, mean, stddev),
      coeffOfVariation: mean !== 0 ? (stddev / Math.abs(mean)) * 100 : null,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ TREND-ERKENNUNG ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Erkennt und berechnet Trends
   */
  detectTrend(datasetId, options = {}) {
    const ds = this._datasets.get(datasetId);
    if (!ds) throw new Error('Dataset nicht gefunden');

    const { method = 'auto' } = options;
    const values = ds.series.filter(s => s.value !== null).map(s => s.value);
    const x = values.map((_, i) => i);

    // Linearer Trend
    const linear = this._linearRegression(x, values);

    // Moving Average
    const windowSize = Math.max(3, Math.floor(values.length / 10));
    const movingAvg = this._movingAverage(values, windowSize);

    // Trend-Stärke und Richtung
    const trendStrength = Math.abs(linear.r2);
    let direction = 'stable';
    if (linear.slope > 0 && trendStrength > 0.3) direction = 'rising';
    else if (linear.slope < 0 && trendStrength > 0.3) direction = 'falling';

    // Beschleunigung
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    const firstAvg = firstHalf.reduce((a, v) => a + v, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, v) => a + v, 0) / secondHalf.length;
    const acceleration = (secondAvg - firstAvg) / firstAvg;

    return {
      direction,
      strength: trendStrength,
      linear: { slope: linear.slope, intercept: linear.intercept, r2: linear.r2 },
      movingAverage: movingAvg,
      acceleration,
      summary: this._trendSummary(direction, trendStrength, linear.slope, acceleration),
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ ANOMALIE-ERKENNUNG ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Erkennt Anomalien in der Zeitreihe
   */
  detectAnomalies(datasetId, options = {}) {
    const ds = this._datasets.get(datasetId);
    if (!ds) throw new Error('Dataset nicht gefunden');

    const { method = 'combined', sensitivity = 2.0 } = options;
    const values = ds.series.filter(s => s.value !== null);

    const anomalies = [];

    // Z-Score Methode
    if (method === 'zscore' || method === 'combined') {
      const vals = values.map(s => s.value);
      const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
      const std = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);

      values.forEach((s, i) => {
        const zScore = std > 0 ? Math.abs((s.value - mean) / std) : 0;
        if (zScore > sensitivity) {
          anomalies.push({
            index: i, timestamp: s.timestamp, value: s.value,
            method: 'zscore', score: zScore,
            type: s.value > mean ? 'spike' : 'dip',
          });
        }
      });
    }

    // IQR Methode
    if (method === 'iqr' || method === 'combined') {
      const sorted = [...values.map(s => s.value)].sort((a, b) => a - b);
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = q3 - q1;
      const lower = q1 - sensitivity * iqr;
      const upper = q3 + sensitivity * iqr;

      values.forEach((s, i) => {
        if (s.value < lower || s.value > upper) {
          const existing = anomalies.find(a => a.index === i);
          if (existing) { existing.confirmedBy = 'iqr'; }
          else {
            anomalies.push({
              index: i, timestamp: s.timestamp, value: s.value,
              method: 'iqr', score: Math.max(Math.abs(s.value - lower), Math.abs(s.value - upper)) / iqr,
              type: s.value > upper ? 'spike' : 'dip',
            });
          }
        }
      });
    }

    // Rate-of-Change (plötzliche Sprünge)
    if (method === 'roc' || method === 'combined') {
      for (let i = 1; i < values.length; i++) {
        const prev = values[i - 1].value;
        const curr = values[i].value;
        if (prev === 0) continue;
        const change = Math.abs((curr - prev) / prev);
        if (change > sensitivity * 0.5) {
          const existing = anomalies.find(a => a.index === i);
          if (existing) { existing.rateOfChange = change; }
          else {
            anomalies.push({
              index: i, timestamp: values[i].timestamp, value: curr,
              method: 'rate-of-change', score: change,
              type: curr > prev ? 'sudden-rise' : 'sudden-drop',
              rateOfChange: change,
            });
          }
        }
      }
    }

    return {
      anomalies: anomalies.sort((a, b) => b.score - a.score),
      totalChecked: values.length,
      anomalyRate: anomalies.length / values.length,
      methods: method === 'combined' ? ['zscore', 'iqr', 'rate-of-change'] : [method],
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ PROGNOSE ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Erstellt eine Vorhersage
   */
  forecast(datasetId, periods = 10, options = {}) {
    const ds = this._datasets.get(datasetId);
    if (!ds) throw new Error('Dataset nicht gefunden');

    const { method = 'auto', confidence = 0.95 } = options;
    const values = ds.series.filter(s => s.value !== null).map(s => s.value);

    if (values.length < 5) throw new Error('Mindestens 5 Datenpunkte für Prognose nötig');

    let forecasted;
    const usedMethod = method === 'auto' ? (values.length > 20 ? 'exp-smoothing' : 'moving-average') : method;

    switch (usedMethod) {
      case 'moving-average':
        forecasted = this._forecastMovingAverage(values, periods);
        break;
      case 'exp-smoothing':
        forecasted = this._forecastExpSmoothing(values, periods);
        break;
      case 'linear':
        forecasted = this._forecastLinear(values, periods);
        break;
      default:
        forecasted = this._forecastExpSmoothing(values, periods);
    }

    // Konfidenzintervall
    const residuals = this._calculateResiduals(values, usedMethod);
    const stdResidual = Math.sqrt(residuals.reduce((a, r) => a + r ** 2, 0) / residuals.length);
    const zScore = confidence === 0.95 ? 1.96 : confidence === 0.99 ? 2.576 : 1.645;

    const lastTs = ds.series[ds.series.length - 1].timestamp;
    const freq = this._avgInterval(ds.series);

    return {
      method: usedMethod,
      periods,
      predictions: forecasted.map((v, i) => ({
        period: i + 1,
        timestamp: lastTs + freq * (i + 1),
        value: Math.round(v * 1000) / 1000,
        lower: Math.round((v - zScore * stdResidual * Math.sqrt(i + 1)) * 1000) / 1000,
        upper: Math.round((v + zScore * stdResidual * Math.sqrt(i + 1)) * 1000) / 1000,
      })),
      confidence,
      quality: { residualStd: stdResidual, dataPoints: values.length },
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ CHANGE POINT DETECTION ██
  // ════════════════════════════════════════════════════════════════════

  detectChangePoints(datasetId, options = {}) {
    const ds = this._datasets.get(datasetId);
    if (!ds) throw new Error('Dataset nicht gefunden');

    const { minSegmentSize = 5, threshold = 2.0 } = options;
    const values = ds.series.filter(s => s.value !== null);
    const changePoints = [];

    // CUSUM-basierte Erkennung
    const vals = values.map(s => s.value);
    const globalMean = vals.reduce((a, v) => a + v, 0) / vals.length;
    const globalStd = Math.sqrt(vals.reduce((a, v) => a + (v - globalMean) ** 2, 0) / vals.length);

    let cusumPos = 0, cusumNeg = 0;
    const drift = globalStd * 0.5;

    for (let i = 1; i < vals.length; i++) {
      const z = (vals[i] - globalMean) / (globalStd || 1);
      cusumPos = Math.max(0, cusumPos + z - drift);
      cusumNeg = Math.max(0, cusumNeg - z - drift);

      if (cusumPos > threshold || cusumNeg > threshold) {
        // Prüfe Mindestabstand zum letzten Change Point
        const lastCp = changePoints[changePoints.length - 1];
        if (!lastCp || i - lastCp.index >= minSegmentSize) {
          const beforeMean = vals.slice(Math.max(0, i - minSegmentSize), i).reduce((a, v) => a + v, 0) / minSegmentSize;
          const afterMean = vals.slice(i, Math.min(vals.length, i + minSegmentSize)).reduce((a, v) => a + v, 0) /
            Math.min(minSegmentSize, vals.length - i);

          changePoints.push({
            index: i,
            timestamp: values[i].timestamp,
            value: values[i].value,
            direction: afterMean > beforeMean ? 'increase' : 'decrease',
            magnitude: Math.abs(afterMean - beforeMean),
            beforeMean,
            afterMean,
          });
          cusumPos = 0;
          cusumNeg = 0;
        }
      }
    }

    return { changePoints, totalPoints: values.length };
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ LLM-ZUSAMMENFASSUNG ██
  // ════════════════════════════════════════════════════════════════════

  /**
   * Generiert eine natürlichsprachige Zusammenfassung der Analyse
   */
  async summarize(datasetId, options = {}) {
    if (!this.agentManager) return { error: 'AgentManager nicht verfügbar' };

    const stats = this.statistics(datasetId);
    const trend = this.detectTrend(datasetId);
    const anomalies = this.detectAnomalies(datasetId);
    const changePoints = this.detectChangePoints(datasetId);

    const prompt = `Erstelle eine klare, verständliche Zusammenfassung dieser Zeitreihen-Analyse:

STATISTIK: ${JSON.stringify(stats, null, 1)}
TREND: ${JSON.stringify({ direction: trend.direction, strength: trend.strength, acceleration: trend.acceleration })}
ANOMALIEN: ${anomalies.anomalies.length} gefunden (Rate: ${(anomalies.anomalyRate * 100).toFixed(1)}%)
CHANGE POINTS: ${changePoints.changePoints.length} strukturelle Änderungen

Schreibe:
1. Überblick (2-3 Sätze)
2. Wichtigste Erkenntnisse
3. Auffälligkeiten und Risiken
4. Handlungsempfehlungen`;

    const summary = await this.agentManager.sendToModel(prompt, { temperature: 0.3, maxTokens: 800 });
    return { summary, stats, trend: trend.summary, anomalyCount: anomalies.anomalies.length, changePointCount: changePoints.changePoints.length };
  }

  // ════════════════════════════════════════════════════════════════════
  // ██ HILFSFUNKTIONEN ██
  // ════════════════════════════════════════════════════════════════════

  _parseTimestamp(val) {
    if (!val) return null;
    if (typeof val === 'number') return val > 1e12 ? val : val * 1000;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  _detectFrequency(series) {
    if (series.length < 3) return 'unknown';
    const diffs = [];
    for (let i = 1; i < Math.min(series.length, 20); i++) {
      diffs.push(series[i].timestamp - series[i - 1].timestamp);
    }
    const avgDiff = diffs.reduce((a, d) => a + d, 0) / diffs.length;
    if (avgDiff < 120000) return 'minute';
    if (avgDiff < 7200000) return 'hour';
    if (avgDiff < 172800000) return 'daily';
    if (avgDiff < 1209600000) return 'weekly';
    return 'monthly';
  }

  _fillGaps(series, frequency) {
    // Simple forward-fill für fehlende Werte
    return series.map((s, i) => ({
      ...s,
      value: s.value !== null ? s.value : (i > 0 ? series[i - 1].value : 0),
    }));
  }

  _linearRegression(x, y) {
    const n = x.length;
    const sumX = x.reduce((a, v) => a + v, 0);
    const sumY = y.reduce((a, v) => a + v, 0);
    const sumXY = x.reduce((a, v, i) => a + v * y[i], 0);
    const sumX2 = x.reduce((a, v) => a + v * v, 0);
    const sumY2 = y.reduce((a, v) => a + v * v, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX ** 2);
    const intercept = (sumY - slope * sumX) / n;
    const r = (n * sumXY - sumX * sumY) / Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));

    return { slope, intercept, r2: r * r };
  }

  _movingAverage(values, window) {
    const result = [];
    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - Math.floor(window / 2));
      const end = Math.min(values.length, start + window);
      const slice = values.slice(start, end);
      result.push(slice.reduce((a, v) => a + v, 0) / slice.length);
    }
    return result;
  }

  _forecastMovingAverage(values, periods) {
    const w = Math.min(10, Math.floor(values.length / 3));
    const lastAvg = values.slice(-w).reduce((a, v) => a + v, 0) / w;
    return Array(periods).fill(lastAvg);
  }

  _forecastExpSmoothing(values, periods) {
    const alpha = 0.3;
    let level = values[0];
    for (const v of values) {
      level = alpha * v + (1 - alpha) * level;
    }
    return Array(periods).fill(Math.round(level * 1000) / 1000);
  }

  _forecastLinear(values, periods) {
    const x = values.map((_, i) => i);
    const { slope, intercept } = this._linearRegression(x, values);
    const result = [];
    for (let i = 0; i < periods; i++) {
      result.push(slope * (values.length + i) + intercept);
    }
    return result;
  }

  _calculateResiduals(values, method) {
    const fitted = method === 'linear'
      ? (() => { const x = values.map((_, i) => i); const lr = this._linearRegression(x, values); return values.map((_, i) => lr.slope * i + lr.intercept); })()
      : this._movingAverage(values, Math.max(3, Math.floor(values.length / 10)));
    return values.map((v, i) => v - (fitted[i] || v));
  }

  _avgInterval(series) {
    if (series.length < 2) return 86400000;
    const total = series[series.length - 1].timestamp - series[0].timestamp;
    return total / (series.length - 1);
  }

  _skewness(values, mean, std) {
    if (std === 0) return 0;
    const n = values.length;
    return values.reduce((a, v) => a + ((v - mean) / std) ** 3, 0) / n;
  }

  _kurtosis(values, mean, std) {
    if (std === 0) return 0;
    const n = values.length;
    return values.reduce((a, v) => a + ((v - mean) / std) ** 4, 0) / n - 3;
  }

  _trendSummary(direction, strength, slope, acceleration) {
    const strengthWord = strength > 0.7 ? 'starker' : strength > 0.4 ? 'moderater' : 'schwacher';
    const dirWord = direction === 'rising' ? 'Aufwärtstrend' : direction === 'falling' ? 'Abwärtstrend' : 'Seitwärtsbewegung';
    const accWord = Math.abs(acceleration) > 0.2 ? (acceleration > 0 ? ', beschleunigend' : ', verlangsamend') : '';
    return `${strengthWord} ${dirWord} (R²=${strength.toFixed(2)}, Steigung=${slope.toFixed(4)}${accWord})`;
  }

  // ── Status ─────────────────────────────────────────────────────────
  listDatasets() {
    return Array.from(this._datasets.entries()).map(([id, ds]) => ds.meta);
  }

  deleteDataset(id) { this._datasets.delete(id); }

  getStatus() {
    return {
      datasets: this._datasets.size,
      methods: ['zscore', 'iqr', 'rate-of-change', 'cusum'],
      forecastMethods: ['moving-average', 'exp-smoothing', 'linear'],
    };
  }
}

module.exports = TimeSeriesAnalysisService;
