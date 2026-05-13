import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { platform } from 'node:os';
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

const metricHints = {
  fcp: '第一個內容出現時間，越低越好',
  lcp: '首屏主要內容完成時間，越低越好',
  tbt: '主執行緒阻塞時間，越低越好',
  cls: '版面穩定性，越低越好',
  domContentLoaded: 'DOM 解析完成時間，越低越好',
  loadEvent: '頁面 load 完成時間，越低越好',
  transferKB: '網路傳輸量，越低越好',
  requestCount: 'HTTP 請求數，越低越好'
};

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

const scoreWeights = {
  lcp: 30,
  tbt: 25,
  fcp: 15,
  cls: 10,
  transferKB: 8,
  requestCount: 6,
  domContentLoaded: 4,
  loadEvent: 2
};

const scoreThresholds = {
  lcp: { good: 2500, poor: 4000 },
  tbt: { good: 200, poor: 600 },
  fcp: { good: 1800, poor: 3000 },
  cls: { good: 0.1, poor: 0.25 },
  transferKB: { good: 1500, poor: 5000 },
  requestCount: { good: 80, poor: 250 },
  domContentLoaded: { good: 2000, poor: 5000 },
  loadEvent: { good: 4000, poor: 10000 }
};

const metricTooltips = {
  fcp: {
    meaning: 'First Contentful Paint，使用者第一次看到文字、圖片或其他內容的時間。',
    improvements: '減少阻塞 CSS/JS、壓縮首屏資源、優先載入關鍵字型與圖片、降低初始 bundle 大小。'
  },
  lcp: {
    meaning: 'Largest Contentful Paint，首屏最大內容元素完成渲染的時間，通常最接近使用者感覺到頁面可用的時間。',
    improvements: '優化首屏主圖或主要區塊、預載 LCP 圖片、降低伺服器回應時間、延後非關鍵 JS 與第三方腳本。'
  },
  tbt: {
    meaning: 'Total Blocking Time，主執行緒被長任務阻塞的總時間，會影響點擊、滑動和輸入反應。',
    improvements: '拆分長任務、減少同步 JS、延後初始化非首屏模組、降低 hydration 或大量 DOM 操作成本。'
  },
  cls: {
    meaning: 'Cumulative Layout Shift，頁面載入期間版面位移的累積分數。',
    improvements: '替圖片和 iframe 預留尺寸、避免動態插入上方內容、穩定字型載入、固定廣告或彈窗容器高度。'
  },
  domContentLoaded: {
    meaning: 'HTML 解析完成且 DOMContentLoaded 事件觸發的時間。',
    improvements: '減少同步 script、縮小 HTML 與首批 JS、延後非必要初始化、避免 parser-blocking 資源。'
  },
  loadEvent: {
    meaning: '頁面 load 事件觸發時間，代表主要文件與依賴資源大多已載入。',
    improvements: '延後非必要圖片與第三方資源、啟用快取與壓縮、減少首屏外資源、改善慢 API 或靜態資源回應。'
  },
  transferKB: {
    meaning: '頁面載入期間實際傳輸的資料量，單位是 KB。',
    improvements: '壓縮圖片與文字資源、移除未使用 JS/CSS、使用現代圖片格式、避免重複載入資源。'
  },
  requestCount: {
    meaning: '頁面載入期間發出的 HTTP 請求數。',
    improvements: '合併或移除非必要資源、延後追蹤與第三方請求、使用 sprite 或字型子集、避免重複 API 呼叫。'
  }
};

const metricTestMethods = {
  fcp: {
    source: 'Chrome Performance Timeline paint entry',
    method: '頁面導覽開始後，讀取 first-contentful-paint 的 startTime。',
    note: '代表第一個可見內容出現時間，容易受阻塞 CSS、字型、首批 JS 與伺服器回應時間影響。'
  },
  lcp: {
    source: 'PerformanceObserver 的 largest-contentful-paint entry',
    method: '監聽 LCP entry，取測試等待結束前最後一次回報的 render/load time。',
    note: '通常對應首屏最大圖片、文字區塊或主要內容容器；若首屏主元素改變，LCP 目標也可能跟著改變。'
  },
  tbt: {
    source: 'Chrome Long Task API',
    method: '收集超過 50ms 的 long task，將每個 task 超出 50ms 的部分加總。',
    note: '越高代表主執行緒越忙，使用者點擊、滑動、輸入的延遲風險越高。'
  },
  cls: {
    source: 'PerformanceObserver 的 layout-shift entry',
    method: '累加沒有 recent input 的 layout-shift value，得到載入期間的版面位移分數。',
    note: '常見原因是圖片未預留尺寸、動態插入內容、字型切換或廣告容器高度不穩。'
  },
  domContentLoaded: {
    source: 'Navigation Timing',
    method: '讀取 domContentLoadedEventEnd 減去 navigation start。',
    note: '反映 HTML 解析與同步腳本阻塞成本，不等於所有圖片或 API 都完成。'
  },
  loadEvent: {
    source: 'Navigation Timing',
    method: '讀取 loadEventEnd 減去 navigation start。',
    note: '代表 window load 事件完成時間，會受圖片、樣式、script、iframe 等資源影響。'
  },
  transferKB: {
    source: 'Chrome DevTools Protocol Network events',
    method: '累加頁面載入期間 response encodedDataLength，並換算為 KB。',
    note: '這是實際傳輸量，不一定等於解壓縮後資源大小；快取策略與壓縮會明顯影響結果。'
  },
  requestCount: {
    source: 'Chrome DevTools Protocol Network events',
    method: '統計頁面載入期間發出的網路 request 數量。',
    note: '數量高不一定每次都慢，但通常會增加排隊、握手、第三方依賴與不穩定風險。'
  }
};

const lowerIsBetter = new Set(Object.keys(metricLabels));
const shouldOpen = process.argv.includes('--open');
const timeMetrics = new Set(['fcp', 'lcp', 'tbt', 'domContentLoaded', 'loadEvent']);

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
  return lowerIsBetter.has(metric)
    ? ((oldValue - newValue) / oldValue) * 100
    : ((newValue - oldValue) / oldValue) * 100;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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

function getCompareTarget(targets, baselineTarget) {
  return targets.find((target) => target.id === 'new' && target.id !== baselineTarget?.id)
    || targets.find((target) => target.id === 'v2' && target.id !== baselineTarget?.id)
    || targets.find((target) => /新|new|nuxt/i.test(target.label) && target.id !== baselineTarget?.id)
    || targets.find((target) => target.id !== baselineTarget?.id)
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

function summarize(raw) {
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
      const finiteValues = values.filter((value) => Number.isFinite(value));
      summary[targetId][metric] = {
        median: median(values),
        p75: percentile(values, 75),
        min: finiteValues.length ? Math.min(...finiteValues) : null,
        max: finiteValues.length ? Math.max(...finiteValues) : null
      };
    }
  }

  return {
    summary,
    quality
  };
}

function scoreClass(delta) {
  if (delta === null) return 'neutral';
  if (delta >= 15) return 'good';
  if (delta >= 0) return 'ok';
  return 'bad';
}

function changeClass(baselineValue, compareValue) {
  if (!Number.isFinite(baselineValue) || !Number.isFinite(compareValue)) return 'neutral';
  if (compareValue < baselineValue) return 'good';
  if (compareValue === baselineValue) return 'neutral';
  return 'bad';
}

function renderDelta(delta) {
  const absDelta = delta === null ? 0 : Math.min(Math.abs(delta), 100);
  const className = scoreClass(delta);
  const label = delta === null
    ? '-'
    : delta > 0
      ? `改善 ${fmt(delta, 1)}%`
      : delta < 0
        ? `增加 ${fmt(Math.abs(delta), 1)}%`
        : '0.0%';
  return `
    <div class="delta ${className}">
      <span>${label}</span>
      <i style="--bar-width: ${absDelta}%"></i>
    </div>`;
}

function renderChange(baselineValue, compareValue, metric) {
  const digits = metric === 'cls' ? 3 : 0;
  if (!Number.isFinite(baselineValue) || !Number.isFinite(compareValue)) {
    return '<div class="change neutral"><strong>-</strong><small>-</small></div>';
  }

  const diff = compareValue - baselineValue;
  const improvementPercent = baselineValue === 0 ? null : ((baselineValue - compareValue) / baselineValue) * 100;
  const unit = metricUnits[metric];
  const className = changeClass(baselineValue, compareValue);
  const label = diff === 0 ? '持平' : diff < 0 ? '減少' : '多出';
  const value = timeMetrics.has(metric)
    ? `${fmt(Math.abs(diff) / 1000, 2)} 秒`
    : `${fmt(Math.abs(diff), digits)} ${escapeHtml(unit)}`;

  const detail = diff === 0
    ? '持平'
    : diff < 0
      ? `改善 ${fmt(Math.abs(improvementPercent), 1)}%`
      : `退步 ${improvementPercent === null ? '-' : fmt(Math.abs(improvementPercent), 1)}%`;
  const rawUnit = metric === 'cls' ? 'score' : unit;

  return `
    <div class="change ${className}">
      <strong>${label} ${value}</strong>
      <small>${detail} · ${fmt(baselineValue, digits)} → ${fmt(compareValue, digits)} ${escapeHtml(rawUnit)}</small>
    </div>`;
}

function renderMetricName(metric, label) {
  const tooltip = metricTooltips[metric];
  return `
    <span class="metric-name">
      ${escapeHtml(label)}
      <button
        class="tooltip-trigger"
        type="button"
        aria-label="${escapeHtml(`${label} 說明`)}"
        data-tooltip-title="${escapeHtml(label)}"
        data-tooltip-meaning="${escapeHtml(tooltip.meaning)}"
        data-tooltip-improvements="${escapeHtml(tooltip.improvements)}"
      >?</button>
    </span>
    <small>${escapeHtml(metricHints[metric])}</small>`;
}

function renderTargetMetricTables(summary, targets) {
  return targets
    .map((target) => {
      const rows = Object.entries(metricLabels)
        .map(([metric, label]) => {
          const digits = metric === 'cls' ? 3 : 0;
          const item = summary[target.id]?.[metric] || {};
          return `
            <tr>
              <th scope="row">${renderMetricName(metric, label)}</th>
              <td>${fmt(item.median ?? null, digits)}</td>
              <td>${fmt(item.p75 ?? null, digits)}</td>
              <td>${fmt(item.min ?? null, digits)}</td>
              <td>${fmt(item.max ?? null, digits)}</td>
            </tr>`;
        })
        .join('');

      return `
        <article class="target-panel">
          <div class="target-panel-header">
            <h3>${escapeHtml(target.label)}</h3>
            <span>${escapeHtml(target.id)}</span>
          </div>
          <a href="${escapeHtml(target.url)}" target="_blank" rel="noreferrer">${escapeHtml(target.url)}</a>
          <div class="table-wrap">
            <table class="target-table">
              <thead>
                <tr>
                  <th scope="col">指標</th>
                              <th scope="col">median</th>
                  <th scope="col">p75</th>
                  <th scope="col">min</th>
                  <th scope="col">max</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </article>`;
    })
    .join('');
}

function renderTargetMetricHeader() {
  return `
    <tr>
      <th scope="col">指標</th>
      <th scope="col">median</th>
      <th scope="col">p75</th>
      <th scope="col">min</th>
      <th scope="col">max</th>
    </tr>`;
}

function renderComparisonTargetOptions(targets, selectedTargetId) {
  return targets
    .map((target) => `<option value="${escapeHtml(target.id)}"${target.id === selectedTargetId ? ' selected' : ''}>${escapeHtml(target.label)}</option>`)
    .join('');
}

function renderMetricRows(summary, targets, baselineTarget) {
  return Object.entries(metricLabels)
    .map(([metric, label]) => {
      const digits = metric === 'cls' ? 3 : 0;
      const oldSummary = summary.old || {};
      const newSummary = summary.new || {};
      const oldMedian = oldSummary[metric]?.median ?? null;
      const newMedian = newSummary[metric]?.median ?? null;
      const oldP75 = oldSummary[metric]?.p75 ?? null;
      const newP75 = newSummary[metric]?.p75 ?? null;
      const delta = improvement(oldMedian, newMedian, metric);

      return `
        <tr>
          <th scope="row">${renderMetricName(metric, label)}</th>
          <td>${fmt(oldMedian, digits)}</td>
          <td>${fmt(newMedian, digits)}</td>
          <td>${renderDelta(delta)}</td>
          <td>${fmt(oldP75, digits)}</td>
          <td>${fmt(newP75, digits)}</td>
        </tr>`;
    })
    .join('');
}

function renderSummaryCards(summary, targets, baselineTarget) {
  const featured = ['lcp', 'tbt', 'transferKB', 'requestCount'];
  const hasComparison = targets.length > 1;
  const primaryTarget = hasComparison
    ? targets.find((target) => target.id === 'new' && target.id !== baselineTarget.id)
      || targets.find((target) => target.id !== baselineTarget.id)
      || baselineTarget
    : targets[0];

  return featured
    .map((metric) => {
      const digits = metric === 'cls' ? 3 : 0;
      const primarySummary = summary[primaryTarget?.id] || {};
      const baselineSummary = summary[baselineTarget?.id] || {};
      const primaryValue = primarySummary[metric]?.median ?? null;
      const baselineValue = baselineSummary[metric]?.median ?? null;
      const delta = hasComparison ? improvement(baselineValue, primaryValue, metric) : null;
      const className = hasComparison ? scoreClass(delta) : 'neutral';
      const body = hasComparison
        ? `${escapeHtml(baselineTarget.label)} ${fmt(baselineValue, digits)} → ${escapeHtml(primaryTarget.label)} ${fmt(primaryValue, digits)} ${escapeHtml(metricUnits[metric])}`
        : `${escapeHtml(primaryTarget?.label || 'Target')} median ${fmt(primaryValue, digits)} ${escapeHtml(metricUnits[metric])}`;

      return `
        <article class="summary-card ${className}">
          <span>${escapeHtml(metricLabels[metric])}</span>
          <strong>${hasComparison ? (delta === null ? '-' : `${fmt(delta, 1)}%`) : fmt(primaryValue, digits)}</strong>
          <small>${body}</small>
        </article>`;
    })
    .join('');
}

function renderTargetList(targets, baselineTarget) {
  return targets
    .map((target) => {
      const baselineText = target.id === baselineTarget?.id ? ' · baseline' : '';
      return `<li>${escapeHtml(target.label)} <small>${escapeHtml(target.id)}${baselineText}</small></li>`;
    })
    .join('');
}

function describeInvalidReason(reason) {
  if (/FCP/i.test(reason)) return 'FCP 缺失或為 0，可能是頁面未完成有效繪製或量測失敗。';
  if (/LCP/i.test(reason)) return 'LCP 缺失或為 0，可能是首屏主要內容沒有被 PerformanceObserver 捕捉。';
  if (/DOMContentLoaded/i.test(reason)) return 'DOMContentLoaded 缺失或為 0，可能是 navigation timing 資料不完整。';
  if (/Load Event/i.test(reason)) return 'Load Event 缺失或為 0，可能是頁面載入事件未正常回報。';
  if (/Transfer Size/i.test(reason)) return 'Transfer Size 缺失或為 0，可能是網路事件沒有完整收集。';
  if (/Request Count/i.test(reason)) return 'Request Count 過低，通常代表頁面沒有正常載入或請求收集不完整。';
  return reason;
}

function renderQualityCards(targets, quality) {
  return targets
    .map((target) => {
      const item = quality[target.id] || createQualityBucket();
      const invalidDetails = item.invalidRuns.length
        ? `<ul class="invalid-list">${item.invalidRuns
          .map((run) => `<li><strong>Run #${escapeHtml(run.run)}</strong><span>${run.reasons.map(describeInvalidReason).map(escapeHtml).join('</span><span>')}</span></li>`)
          .join('')}</ul>`
        : '<small>No invalid runs</small>';

      return `
        <article class="quality-card ${item.invalid > 0 ? 'warn' : 'ok'}">
          <span>${escapeHtml(target.label)}</span>
          <strong>${item.valid}/${item.total}</strong>
          <small>invalid ${item.invalid}</small>
          ${invalidDetails}
        </article>`;
    })
    .join('');
}

function escapeScriptJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function renderMethodDialogRows() {
  return Object.entries(metricLabels)
    .map(([metric, label]) => {
      const method = metricTestMethods[metric];
      return `
        <article class="method-item">
          <h3>${escapeHtml(label)} <span>${escapeHtml(metricUnits[metric])}</span></h3>
          <dl>
            <div>
              <dt>資料來源</dt>
              <dd>${escapeHtml(method.source)}</dd>
            </div>
            <div>
              <dt>測試方法</dt>
              <dd>${escapeHtml(method.method)}</dd>
            </div>
            <div>
              <dt>注意事項</dt>
              <dd>${escapeHtml(method.note)}</dd>
            </div>
          </dl>
        </article>`;
    })
    .join('');
}

async function renderHtml(raw, summary, quality) {
  const generatedAt = new Date().toISOString();
  const targets = getTargets(raw);
  const baselineTarget = getBaselineTarget(targets);
  const hasComparison = targets.length > 1;
  const compareTarget = getCompareTarget(targets, baselineTarget);
  const reportData = {
    project: raw.project,
    generatedAt,
    createdAt: raw.createdAt,
    device: raw.device,
    options: raw.options,
    targets,
    baselineTargetId: baselineTarget?.id || null,
    compareTargetId: compareTarget?.id || null,
    samples: raw.samples || [],
    summary,
    quality,
    metricLabels,
    metricHints,
    metricTooltips,
    metricUnits,
    scoreWeights,
    scoreThresholds
  };
  const runsWarning = Number(raw.options.runs) < 5
    ? '<p class="notice">目前每個 target 跑不到 5 次，適合快速 review；正式結論建議跑 5 到 10 次以上。</p>'
    : '';
  const comparisonNote = hasComparison
    ? '<p>指標比較可自行選擇 baseline 與 compare target；差異顯示 compare target 減去 baseline。這份報告的指標都是越低越好，所以負值代表改善，正值代表變差。</p>'
    : '<p>目前只有一個 target，報告會呈現該網站的 median 與 p75，不計算改善幅度。</p>';
  const styles = await readFile(path.join(root, 'scripts/report/styles.css'), 'utf8');
  const clientScript = (await readFile(path.join(root, 'scripts/report/client.js'), 'utf8'))
    .replace('__REPORT_DATA__', escapeScriptJson(reportData));

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>效能測試報告</title>
  <style>${styles}</style>
</head>
<body>
  <main>
    <header>
      <h1>效能測試報告</h1>
      <div class="report-toolbar">
        <ul class="meta">
          <li>Network: ${escapeHtml(raw.options.network)}</li>
          <li>Cache: ${escapeHtml(raw.options.cache)}</li>
          <li>CPU: ${escapeHtml(raw.options.cpu)}x</li>
          <li>Runs: ${escapeHtml(raw.options.runs)}</li>
          <li>Device: ${escapeHtml(raw.device.name)} ${escapeHtml(raw.device.width)}x${escapeHtml(raw.device.height)}</li>
        </ul>
        <button class="text-button" type="button" id="open-method-dialog">測試方法</button>
      </div>
      ${runsWarning}
    </header>

    <section aria-labelledby="quality-title">
      <h2 id="quality-title">樣本品質</h2>
      <div class="quality-grid">
        ${renderQualityCards(targets, quality)}
      </div>
    </section>

    <section aria-labelledby="target-results-title" data-export-name="target-results">
      <div class="section-heading">
        <h2 id="target-results-title">Target 量測結果</h2>
        <div class="section-actions">
          <button class="text-button" type="button" data-export-section="target-results">匯出目前區塊 PNG</button>
        </div>
      </div>
      <div class="target-panel">
        <div class="comparison-controls">
          <div class="field">
            <label for="metric-target">Target</label>
            <select id="metric-target">
              ${renderComparisonTargetOptions(targets, targets[0]?.id)}
            </select>
          </div>
          <button class="text-button" type="button" id="copy-target-prompt">複製 Target Prompt</button>
        </div>
        <div class="target-panel-header">
          <h3 id="metric-target-title"></h3>
          <span id="metric-target-id"></span>
        </div>
        <a id="metric-target-url" href="#" target="_blank" rel="noreferrer"></a>
        <div class="target-score-panel">
          <article class="score-card">
            <span>綜合分數</span>
            <strong id="target-score-value">-</strong>
            <small id="target-score-detail">依使用者體感權重計算，滿分 100。</small>
          </article>
          <article class="weight-card">
            <h4>權重表</h4>
            <div class="weight-grid" id="target-weight-grid"></div>
            <small>分數以 median 指標換算，數值越低越好；門檻用於快速判讀，正式優化仍需搭配 raw runs。</small>
          </article>
        </div>
        <div class="table-wrap">
          <table class="target-table">
            <thead>${renderTargetMetricHeader()}</thead>
            <tbody id="target-metric-body"></tbody>
          </table>
        </div>
      </div>
    </section>

    <section aria-labelledby="metrics-title" data-export-name="metric-comparison">
      <div class="section-heading">
        <h2 id="metrics-title">指標比較</h2>
        <div class="section-actions">
          <button class="text-button" type="button" id="copy-comparison-prompt">複製比較 Prompt</button>
          <button class="text-button" type="button" data-export-section="metric-comparison">匯出目前區塊 PNG</button>
        </div>
      </div>
      ${hasComparison ? `
      <div class="review-panel">
        <div class="comparison-controls">
          <div class="field">
            <label for="baseline-target">Baseline target</label>
            <select id="baseline-target">
              ${renderComparisonTargetOptions(targets, baselineTarget?.id)}
            </select>
          </div>
          <div class="field">
            <label for="compare-target">Compare target</label>
            <select id="compare-target">
              ${renderComparisonTargetOptions(targets, compareTarget?.id)}
            </select>
          </div>
        </div>
        <div class="summary-grid" id="summary-grid"></div>
        <div class="table-wrap">
          <table class="comparison-table">
            <thead>
              <tr>
                <th scope="col">指標</th>
                <th scope="col">Baseline median</th>
                <th scope="col">Compare median</th>
                <th scope="col">差異</th>
                <th scope="col">Baseline p75</th>
                <th scope="col">Compare p75</th>
              </tr>
            </thead>
            <tbody id="comparison-body"></tbody>
          </table>
        </div>
      </div>` : `
      <div class="summary-grid" id="summary-grid"></div>
      <p class="comparison-empty">目前只有一個 target，沒有可比較的對象。</p>`}
    </section>

    <section class="notes" aria-labelledby="notes-title">
      <h2 id="notes-title">判讀方式</h2>
      ${comparisonNote}
      <p>正式判讀以 valid runs 的 median 為主；差異也是用 median 計算，p75 用來觀察較差情境下是否穩定。</p>
      <p>Invalid runs 不納入 median / p75 / min / max 統計。</p>
            <p>差異公式：compare median - baseline median。時間、傳輸量、請求數和 CLS 都是越低越好。</p>
    </section>

    <footer>
      Raw created at ${escapeHtml(raw.createdAt)} · HTML generated at ${escapeHtml(generatedAt)}
    </footer>
  </main>
  <dialog id="method-dialog" aria-labelledby="method-dialog-title">
    <div class="dialog-shell">
      <div class="dialog-header">
        <h2 id="method-dialog-title">各指標測試方法</h2>
        <button class="dialog-close" type="button" aria-label="關閉測試方法">&times;</button>
      </div>
      <div class="method-list">
        ${renderMethodDialogRows()}
      </div>
    </div>
  </dialog>
  <div class="tooltip-layer" id="metric-tooltip" role="tooltip" aria-hidden="true"></div>
  <script>${clientScript}</script>
</body>
</html>`;
}

function openInBrowser(filePath) {
  const commandByPlatform = {
    darwin: 'open',
    win32: 'start',
    linux: 'xdg-open'
  };
  const command = commandByPlatform[platform()];

  if (!command) {
    console.warn(`Auto-open is not supported on ${platform()}. Open manually: ${filePath}`);
    return;
  }

  const args = platform() === 'win32' ? ['', filePath] : [filePath];
  const child = spawn(command, args, {
    detached: true,
    shell: platform() === 'win32',
    stdio: 'ignore'
  });

  child.unref();
}

const raw = await loadLatestRaw();
const { summary, quality } = summarize(raw);
const outputPath = path.join(resultsDir, 'latest-report.html');

await writeFile(outputPath, `${await renderHtml(raw, summary, quality)}\n`);

console.log(`HTML report written: ${outputPath}`);

if (shouldOpen) {
  openInBrowser(outputPath);
  console.log(`Opened in browser: ${outputPath}`);
}
