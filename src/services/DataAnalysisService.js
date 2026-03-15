/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  DATA ANALYSIS SERVICE v1.0                                          ║
 * ║                                                                      ║
 * ║  Datenanalyse & Visualisierung für Johnny:                          ║
 * ║  - Daten laden (CSV, JSON, Excel, API)                              ║
 * ║  - Statistische Analyse (Mittelwert, Median, Korrelation, ...)      ║
 * ║  - Chart-Generierung (SVG, Chart.js-Konfig)                        ║
 * ║  - Daten-Zusammenfassung mit LLM-Unterstützung                     ║
 * ║  - Anomalie-Erkennung                                               ║
 * ║  - Trend-Analyse                                                     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const fs   = require('fs').promises;
const path = require('path');

class DataAnalysisService {
  constructor(config = {}) {
    this.agentManager = config.agentManager;
    this.maxRows      = config.maxRows || 100000;
  }

  // ════════════════════════════════════════════════════════════════════
  // DATEN LADEN
  // ════════════════════════════════════════════════════════════════════

  /**
   * Lädt Daten aus verschiedenen Quellen
   * @param {string} source - Dateipfad oder URL
   * @param {Object} options - { format, delimiter, headers, sheet }
   * @returns {Promise<{columns: string[], rows: Array, meta: Object}>}
   */
  async loadData(source, options = {}) {
    const { format: fmt, delimiter = ',', headers = true } = options;
    const format = fmt || this._detectFormat(source);

    let raw;
    if (source.startsWith('http://') || source.startsWith('https://')) {
      const fetch = (await import('node-fetch')).default;
      const resp  = await fetch(source);
      raw = await resp.text();
    } else {
      raw = await fs.readFile(source, 'utf-8');
    }

    let data;
    switch (format) {
      case 'csv':
      case 'tsv':
        data = this._parseCSV(raw, format === 'tsv' ? '\t' : delimiter, headers);
        break;
      case 'json':
        data = this._parseJSON(raw);
        break;
      default:
        throw new Error(`Unbekanntes Format: ${format}. Unterstützt: csv, tsv, json`);
    }

    // Zeilen begrenzen
    if (data.rows.length > this.maxRows) {
      data.rows = data.rows.slice(0, this.maxRows);
      data.meta.truncated = true;
    }

    data.meta.source = source;
    data.meta.format = format;
    data.meta.loadedAt = new Date().toISOString();

    return data;
  }

  _detectFormat(source) {
    const ext = path.extname(source).toLowerCase();
    if (ext === '.csv') return 'csv';
    if (ext === '.tsv') return 'tsv';
    if (ext === '.json' || ext === '.jsonl') return 'json';
    return 'csv';
  }

  _parseCSV(raw, delimiter, hasHeaders) {
    const lines = raw.split('\n').filter(l => l.trim());
    if (!lines.length) return { columns: [], rows: [], meta: { rowCount: 0 } };

    const columns = hasHeaders
      ? lines[0].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''))
      : lines[0].split(delimiter).map((_, i) => `col_${i}`);

    const dataLines = hasHeaders ? lines.slice(1) : lines;
    const rows = dataLines.map(line => {
      const values = this._splitCSVLine(line, delimiter);
      const row = {};
      columns.forEach((col, i) => {
        const val = (values[i] || '').trim().replace(/^["']|["']$/g, '');
        // Auto-Typ-Erkennung
        row[col] = val === '' ? null
          : !isNaN(val) && val !== '' ? parseFloat(val)
          : val.toLowerCase() === 'true' ? true
          : val.toLowerCase() === 'false' ? false
          : val;
      });
      return row;
    });

    return {
      columns,
      rows,
      meta: { rowCount: rows.length, columnCount: columns.length },
    };
  }

  _splitCSVLine(line, delimiter) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  _parseJSON(raw) {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : (parsed.data || parsed.results || [parsed]);
    if (!arr.length) return { columns: [], rows: [], meta: { rowCount: 0 } };

    const columns = [...new Set(arr.flatMap(r => Object.keys(r)))];
    return {
      columns,
      rows: arr,
      meta: { rowCount: arr.length, columnCount: columns.length },
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // STATISTISCHE ANALYSE
  // ════════════════════════════════════════════════════════════════════

  /**
   * Berechnet statistische Kennzahlen für numerische Spalten
   */
  analyze(data) {
    const stats = {};

    for (const col of data.columns) {
      const values = data.rows.map(r => r[col]).filter(v => typeof v === 'number' && !isNaN(v));

      if (values.length === 0) {
        // Kategorische Spalte
        const allVals = data.rows.map(r => r[col]).filter(v => v != null);
        const freq = new Map();
        for (const v of allVals) freq.set(v, (freq.get(v) || 0) + 1);
        const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);

        stats[col] = {
          type: 'categorical',
          count: allVals.length,
          unique: freq.size,
          topValues: sorted.slice(0, 10).map(([v, c]) => ({ value: v, count: c })),
          nullCount: data.rows.length - allVals.length,
        };
      } else {
        // Numerische Spalte
        const sorted = [...values].sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / values.length;
        const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;

        stats[col] = {
          type: 'numeric',
          count: values.length,
          nullCount: data.rows.length - values.length,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          mean: Math.round(mean * 1000) / 1000,
          median: this._median(sorted),
          stdDev: Math.round(Math.sqrt(variance) * 1000) / 1000,
          q1: this._percentile(sorted, 25),
          q3: this._percentile(sorted, 75),
          sum: Math.round(sum * 100) / 100,
          skewness: this._skewness(values, mean, Math.sqrt(variance)),
        };
      }
    }

    return stats;
  }

  /**
   * Berechnet Korrelationsmatrix für numerische Spalten
   */
  correlationMatrix(data) {
    const numCols = data.columns.filter(col =>
      data.rows.some(r => typeof r[col] === 'number')
    );

    const matrix = {};
    for (const col1 of numCols) {
      matrix[col1] = {};
      for (const col2 of numCols) {
        matrix[col1][col2] = this._pearsonCorrelation(
          data.rows.map(r => r[col1]).filter(v => typeof v === 'number'),
          data.rows.map(r => r[col2]).filter(v => typeof v === 'number')
        );
      }
    }

    return { columns: numCols, matrix };
  }

  /**
   * Erkennt Anomalien (IQR-Methode)
   */
  detectAnomalies(data, column, method = 'iqr') {
    const values = data.rows.map((r, i) => ({ index: i, value: r[column] }))
      .filter(v => typeof v.value === 'number');

    const sorted = values.map(v => v.value).sort((a, b) => a - b);
    const q1 = this._percentile(sorted, 25);
    const q3 = this._percentile(sorted, 75);
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;

    const anomalies = values.filter(v => v.value < lower || v.value > upper);

    return {
      column,
      method,
      bounds: { lower: Math.round(lower * 100) / 100, upper: Math.round(upper * 100) / 100 },
      q1, q3, iqr,
      anomalyCount: anomalies.length,
      anomalies: anomalies.slice(0, 50).map(a => ({
        rowIndex: a.index,
        value: a.value,
        deviation: a.value < lower ? 'unter' : 'über',
      })),
    };
  }

  /**
   * Erkennt Trends in Zeitreihen
   */
  detectTrend(data, valueColumn, timeColumn = null) {
    let values;
    if (timeColumn) {
      values = data.rows
        .map(r => ({ time: new Date(r[timeColumn]).getTime(), value: r[valueColumn] }))
        .filter(v => !isNaN(v.time) && typeof v.value === 'number')
        .sort((a, b) => a.time - b.time)
        .map(v => v.value);
    } else {
      values = data.rows.map(r => r[valueColumn]).filter(v => typeof v === 'number');
    }

    if (values.length < 3) return { trend: 'insufficient_data', values: values.length };

    // Lineare Regression
    const n = values.length;
    const xs = values.map((_, i) => i);
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;

    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - xMean) * (values[i] - yMean);
      den += (xs[i] - xMean) ** 2;
    }

    const slope = den === 0 ? 0 : num / den;
    const intercept = yMean - slope * xMean;

    // R² berechnen
    const predicted = xs.map(x => slope * x + intercept);
    const ssRes = values.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0);
    const ssTot = values.reduce((s, v) => s + (v - yMean) ** 2, 0);
    const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

    // Moving Average (Window: 20% der Datenpunkte)
    const window = Math.max(3, Math.round(n * 0.2));
    const movingAvg = values.map((_, i) => {
      const start = Math.max(0, i - Math.floor(window / 2));
      const end = Math.min(n, i + Math.ceil(window / 2));
      const slice = values.slice(start, end);
      return Math.round(slice.reduce((a, b) => a + b, 0) / slice.length * 100) / 100;
    });

    return {
      trend: slope > 0.01 ? 'steigend' : slope < -0.01 ? 'fallend' : 'stabil',
      slope: Math.round(slope * 10000) / 10000,
      intercept: Math.round(intercept * 100) / 100,
      rSquared: Math.round(rSquared * 1000) / 1000,
      dataPoints: n,
      movingAverage: movingAvg,
      changePercent: values[0] !== 0
        ? Math.round((values[n - 1] - values[0]) / Math.abs(values[0]) * 10000) / 100
        : null,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // VISUALISIERUNG
  // ════════════════════════════════════════════════════════════════════

  /**
   * Generiert eine Chart.js-kompatible Konfiguration
   */
  generateChart(data, options = {}) {
    const {
      type     = 'bar',       // 'bar'|'line'|'pie'|'scatter'|'doughnut'|'radar'
      xColumn,
      yColumns = [],
      title    = '',
      colors   = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'],
      maxDataPoints = 50,
    } = options;

    const rows = data.rows.slice(0, maxDataPoints);
    const labels = xColumn ? rows.map(r => r[xColumn]) : rows.map((_, i) => i + 1);
    const yCols = yColumns.length ? yColumns : data.columns.filter(c =>
      c !== xColumn && rows.some(r => typeof r[c] === 'number')
    );

    const datasets = yCols.map((col, i) => ({
      label: col,
      data: rows.map(r => r[col]),
      backgroundColor: type === 'line' ? 'transparent' : colors[i % colors.length] + '80',
      borderColor: colors[i % colors.length],
      borderWidth: type === 'line' ? 2 : 1,
      fill: type === 'line' ? false : undefined,
      tension: type === 'line' ? 0.3 : undefined,
    }));

    return {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: {
          title: { display: !!title, text: title },
          legend: { display: yCols.length > 1 },
        },
        scales: ['bar', 'line', 'scatter'].includes(type)
          ? { y: { beginAtZero: true } }
          : undefined,
      },
    };
  }

  /**
   * Generiert eine einfache SVG-Visualisierung (kein Browser nötig)
   */
  generateSVG(data, options = {}) {
    const {
      type      = 'bar',
      xColumn,
      yColumn,
      width     = 600,
      height    = 400,
      title     = '',
      color     = '#4F46E5',
    } = options;

    const rows = data.rows.slice(0, 30);
    const values = rows.map(r => r[yColumn]).filter(v => typeof v === 'number');
    const labels = xColumn ? rows.map(r => String(r[xColumn]).slice(0, 15)) : values.map((_, i) => `${i + 1}`);

    if (!values.length) return '<svg><text>Keine numerischen Daten</text></svg>';

    const max = Math.max(...values);
    const min = Math.min(0, Math.min(...values));
    const range = max - min || 1;
    const padding = { top: 40, right: 20, bottom: 60, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    let content = '';

    if (type === 'bar') {
      const barW = chartW / values.length * 0.8;
      const gap = chartW / values.length * 0.2;

      values.forEach((v, i) => {
        const x = padding.left + i * (barW + gap);
        const barH = ((v - min) / range) * chartH;
        const y = padding.top + chartH - barH;

        content += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" opacity="0.8" rx="2"/>`;
        content += `<text x="${x + barW / 2}" y="${height - padding.bottom + 15}" text-anchor="middle" font-size="10" fill="#666" transform="rotate(-45 ${x + barW / 2} ${height - padding.bottom + 15})">${labels[i] || ''}</text>`;
        content += `<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="9" fill="#333">${v}</text>`;
      });
    } else if (type === 'line') {
      const points = values.map((v, i) => {
        const x = padding.left + (i / Math.max(1, values.length - 1)) * chartW;
        const y = padding.top + chartH - ((v - min) / range) * chartH;
        return `${x},${y}`;
      });

      content += `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;
      points.forEach((p, i) => {
        const [x, y] = p.split(',');
        content += `<circle cx="${x}" cy="${y}" r="3" fill="${color}"/>`;
      });
    }

    // Achsen
    content += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartH}" stroke="#ccc" stroke-width="1"/>`;
    content += `<line x1="${padding.left}" y1="${padding.top + chartH}" x2="${padding.left + chartW}" y2="${padding.top + chartH}" stroke="#ccc" stroke-width="1"/>`;

    // Titel
    if (title) {
      content += `<text x="${width / 2}" y="25" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">${title}</text>`;
    }

    // Y-Achsen-Labels
    for (let i = 0; i <= 4; i++) {
      const v = min + (range * i) / 4;
      const y = padding.top + chartH - (i / 4) * chartH;
      content += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#999">${Math.round(v * 10) / 10}</text>`;
      content += `<line x1="${padding.left}" y1="${y}" x2="${padding.left + chartW}" y2="${y}" stroke="#eee" stroke-width="0.5"/>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="font-family:sans-serif">${content}</svg>`;
  }

  // ════════════════════════════════════════════════════════════════════
  // LLM-GESTÜTZTE ANALYSE
  // ════════════════════════════════════════════════════════════════════

  /**
   * Generiert eine natürlichsprachliche Zusammenfassung der Daten
   */
  async summarize(data, stats = null) {
    const s = stats || this.analyze(data);

    if (!this.agentManager) {
      return this._offlineSummary(data, s);
    }

    const prompt = `Analysiere diese Daten und erstelle eine verständliche Zusammenfassung auf Deutsch:

Spalten: ${data.columns.join(', ')}
Zeilen: ${data.meta.rowCount}
Statistiken:
${JSON.stringify(s, null, 2).slice(0, 3000)}

Erste 5 Zeilen:
${JSON.stringify(data.rows.slice(0, 5), null, 2).slice(0, 1000)}

Erstelle:
1. Eine kurze Zusammenfassung (2-3 Sätze)
2. Die wichtigsten Erkenntnisse (3-5 Punkte)
3. Auffälligkeiten oder mögliche Probleme
4. Empfehlungen für weitere Analyse`;

    try {
      const result = await this.agentManager.sendMessage('Johnny', prompt);
      return { summary: result.response, stats: s, automated: true };
    } catch (e) {
      return this._offlineSummary(data, s);
    }
  }

  _offlineSummary(data, stats) {
    const numCols = Object.entries(stats).filter(([, s]) => s.type === 'numeric');
    const catCols = Object.entries(stats).filter(([, s]) => s.type === 'categorical');

    const lines = [`Datensatz: ${data.meta.rowCount} Zeilen, ${data.columns.length} Spalten.`];

    if (numCols.length) {
      lines.push(`\nNumerische Spalten (${numCols.length}):`);
      for (const [col, s] of numCols.slice(0, 5)) {
        lines.push(`  ${col}: Ø ${s.mean}, Min ${s.min}, Max ${s.max}, StdAbw ${s.stdDev}`);
      }
    }

    if (catCols.length) {
      lines.push(`\nKategorische Spalten (${catCols.length}):`);
      for (const [col, s] of catCols.slice(0, 5)) {
        lines.push(`  ${col}: ${s.unique} verschiedene Werte, Top: ${s.topValues[0]?.value || '-'}`);
      }
    }

    return { summary: lines.join('\n'), stats, automated: false };
  }

  // ════════════════════════════════════════════════════════════════════
  // MATH-HELPERS
  // ════════════════════════════════════════════════════════════════════

  _median(sorted) {
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2 * 1000) / 1000;
  }

  _percentile(sorted, p) {
    const i = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return lo === hi ? sorted[lo] : Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)) * 1000) / 1000;
  }

  _skewness(values, mean, stdDev) {
    if (stdDev === 0) return 0;
    const n = values.length;
    const skew = values.reduce((s, v) => s + ((v - mean) / stdDev) ** 3, 0) / n;
    return Math.round(skew * 1000) / 1000;
  }

  _pearsonCorrelation(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 3) return 0;

    const xSlice = x.slice(0, n);
    const ySlice = y.slice(0, n);
    const xMean = xSlice.reduce((a, b) => a + b, 0) / n;
    const yMean = ySlice.reduce((a, b) => a + b, 0) / n;

    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xSlice[i] - xMean;
      const dy = ySlice[i] - yMean;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }

    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : Math.round(num / den * 1000) / 1000;
  }
}

module.exports = DataAnalysisService;
