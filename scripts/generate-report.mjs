import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const resultsDir = path.join(root, 'results');

const metricLabels = {
  fcp: 'FCP',
  lcp: 'LCP',
  tbt: 'TBT',
  cls: 'CLS',
  domContentLoaded: 'DOMContentLoaded',
  loadEvent: 'Load Event',
  transferKB: 'Transfer Size KB',
  requestCount: 'Request Count'
};

const lowerIsBetter = new Set(Object.keys(metricLabels));

function median(values) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function percentile(values, p) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const index = Math.ceil((p / 100) * clean.length) - 1;
  return clean[Math.max(0, Math.min(index, clean.length - 1))];
}

function fmt(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return Number(value).toFixed(digits);
}

function improvement(oldValue, newValue, metric) {
  if (!Number.isFinite(oldValue) || !Number.isFinite(newValue) || oldValue === 0) return null;
  const value = lowerIsBetter.has(metric)
    ? ((oldValue - newValue) / oldValue) * 100
    : ((newValue - oldValue) / oldValue) * 100;
  return value;
}

function getTargets(raw) {
  const targets = [];
  const seen = new Set();
  for (const sample of raw.samples || []) {
    if (seen.has(sample.target.id)) continue;
    seen.add(sample.target.id);
    targets.push(sample.target);
  }
  return targets;
}

function getBaselineTarget(targets) {
  return targets.find((target) => target.id === 'old')
    || targets.find((target) => target.id === 'v1')
    || targets.find((target) => /舊|old|uniapp/i.test(target.label))
    || targets[0]
    || null;
}

function validateSample(sample) {
  const metrics = sample.metrics || {};
  const reasons = [];

  if (!Number.isFinite(metrics.fcp) || metrics.fcp <= 0) reasons.push('FCP missing or <= 0');
  if (!Number.isFinite(metrics.lcp) || metrics.lcp <= 0) reasons.push('LCP missing or <= 0');
  if (!Number.isFinite(metrics.domContentLoaded) || metrics.domContentLoaded <= 0) reasons.push('DOMContentLoaded missing or <= 0');
  if (!Number.isFinite(metrics.loadEvent) || metrics.loadEvent <= 0) reasons.push('Load Event missing or <= 0');
  if (!Number.isFinite(metrics.transferKB) || metrics.transferKB <= 0) reasons.push('Transfer Size missing or <= 0');
  if (!Number.isFinite(metrics.requestCount) || metrics.requestCount < 10) reasons.push('Request Count < 10');

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function createQualityBucket() {
  return {
    total: 0,
    valid: 0,
    invalid: 0,
    invalidRuns: []
  };
}

async function loadLatestRaw() {
  const explicit = path.join(resultsDir, 'latest-raw.json');
  try {
    return JSON.parse(await readFile(explicit, 'utf8'));
  } catch {
    const files = (await readdir(resultsDir))
      .filter((file) => file.endsWith('-raw.json'))
      .sort()
      .reverse();
    if (files.length === 0) {
      throw new Error('No raw benchmark result found. Run pnpm run benchmark first.');
    }
    return JSON.parse(await readFile(path.join(resultsDir, files[0]), 'utf8'));
  }
}

const raw = await loadLatestRaw();
const targets = getTargets(raw);
const baselineTarget = getBaselineTarget(targets);
const hasComparison = targets.length > 1;
const byTarget = new Map();
const quality = {};

for (const sample of raw.samples) {
  const targetId = sample.target.id;
  const result = validateSample(sample);
  if (!quality[targetId]) quality[targetId] = createQualityBucket();
  quality[targetId].total += 1;

  if (result.valid) {
    quality[targetId].valid += 1;
    if (!byTarget.has(targetId)) byTarget.set(targetId, []);
    byTarget.get(targetId).push(sample.metrics);
  } else {
    quality[targetId].invalid += 1;
    quality[targetId].invalidRuns.push({
      run: sample.run,
      reasons: result.reasons
    });
  }
}

const summary = {};
for (const [targetId, metrics] of byTarget) {
  summary[targetId] = {};
  for (const metric of Object.keys(metricLabels)) {
    const values = metrics.map((item) => item[metric]);
    summary[targetId][metric] = {
      median: median(values),
      p75: percentile(values, 75),
      min: Math.min(...values.filter((value) => Number.isFinite(value))),
      max: Math.max(...values.filter((value) => Number.isFinite(value)))
    };
  }
}

const lines = [];

lines.push(`# ${raw.project} 效能測試報告`);
lines.push('');
lines.push(`產生時間：${new Date().toISOString()}`);
lines.push('');
lines.push('## 測試條件');
lines.push('');
lines.push(`- Network: ${raw.options.network}`);
lines.push(`- Cache: ${raw.options.cache}`);
lines.push(`- CPU slowdown: ${raw.options.cpu}x`);
lines.push(`- Runs per target: ${raw.options.runs}`);
lines.push(`- Device: ${raw.device.name} ${raw.device.width}x${raw.device.height}`);
lines.push('');
lines.push('## 樣本品質');
lines.push('');
lines.push('| Target | Valid runs | Invalid runs | Invalid reason |');
lines.push('| --- | ---: | ---: | --- |');
for (const target of targets) {
  const item = quality[target.id] || createQualityBucket();
  const reasons = item.invalidRuns
    .map((run) => `#${run.run}: ${run.reasons.join('; ')}`)
    .join('<br>');
  lines.push(`| ${target.label} | ${item.valid} | ${item.invalid} | ${reasons || '-'} |`);
}
lines.push('');
lines.push('## 指標比較');
lines.push('');

const tableHeader = ['指標', '單位'];
const tableAlign = ['---', '---'];
const csvHeader = ['metric', 'unit'];

for (const target of targets) {
  tableHeader.push(`${target.label} median`, `${target.label} p75`);
  tableAlign.push('---:', '---:');
  csvHeader.push(`${target.id}_median`, `${target.id}_p75`);
  if (hasComparison && target.id !== baselineTarget.id) {
    tableHeader.push(`vs ${baselineTarget.label}`);
    tableAlign.push('---:');
    csvHeader.push(`${target.id}_improvement_percent`);
  }
}

lines.push(`| ${tableHeader.join(' | ')} |`);
lines.push(`| ${tableAlign.join(' | ')} |`);

const metricUnits = {
  fcp: 'ms',
  lcp: 'ms',
  tbt: 'ms',
  cls: 'score',
  domContentLoaded: 'ms',
  loadEvent: 'ms',
  transferKB: 'KB',
  requestCount: 'requests'
};

const csv = [csvHeader.join(',')];

for (const [metric, label] of Object.entries(metricLabels)) {
  const digits = metric === 'cls' ? 3 : 0;
  const baselineMedian = summary[baselineTarget?.id]?.[metric]?.median ?? null;
  const row = [label, metricUnits[metric]];
  const csvRow = [label, metricUnits[metric]];

  for (const target of targets) {
    const targetSummary = summary[target.id] || {};
    const targetMedian = targetSummary[metric]?.median ?? null;
    const targetP75 = targetSummary[metric]?.p75 ?? null;
    const delta = hasComparison && target.id !== baselineTarget.id
      ? improvement(baselineMedian, targetMedian, metric)
      : null;

    row.push(fmt(targetMedian, digits), fmt(targetP75, digits));
    csvRow.push(fmt(targetMedian, digits), fmt(targetP75, digits));
    if (hasComparison && target.id !== baselineTarget.id) {
      row.push(delta === null ? '-' : `${fmt(delta, 1)}%`);
      csvRow.push(delta === null ? '' : fmt(delta, 1));
    }
  }

  lines.push(`| ${row.join(' | ')} |`);
  csv.push(csvRow.join(','));
}

lines.push('');
lines.push('## 判讀');
lines.push('');
lines.push(hasComparison
  ? `- 改善幅度以 ${baselineTarget.label} 為比較基準，正數代表該 target 較快或資源更少。`
  : '- 單一 target 報告只呈現該網站的 median 與 p75，不計算改善幅度。');
lines.push('- 報告以 valid runs 計算 median 與 p75；invalid runs 不納入統計。');
lines.push('- 差異與改善幅度以 median 計算，p75 用來觀察較差情境下的穩定性。');
lines.push('- 若 CLS 改善幅度為負數，代表新版版面穩定性可能退步，需另行檢查。');

await writeFile(path.join(resultsDir, 'latest-report.md'), `${lines.join('\n')}\n`);
await writeFile(path.join(resultsDir, 'latest-summary.csv'), `${csv.join('\n')}\n`);

console.log(`Report written: ${path.join(resultsDir, 'latest-report.md')}`);
console.log(`CSV written: ${path.join(resultsDir, 'latest-summary.csv')}`);
