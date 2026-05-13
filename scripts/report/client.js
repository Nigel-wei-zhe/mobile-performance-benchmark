const reportData = __REPORT_DATA__;
const tooltipLayer = document.getElementById('metric-tooltip');
const methodDialog = document.getElementById('method-dialog');
const openMethodDialog = document.getElementById('open-method-dialog');
const closeMethodDialog = methodDialog.querySelector('.dialog-close');
const metricTargetSelect = document.getElementById('metric-target');
const metricTargetTitle = document.getElementById('metric-target-title');
const metricTargetId = document.getElementById('metric-target-id');
const metricTargetUrl = document.getElementById('metric-target-url');
const targetMetricBody = document.getElementById('target-metric-body');
const targetScoreValue = document.getElementById('target-score-value');
const targetScoreDetail = document.getElementById('target-score-detail');
const targetWeightGrid = document.getElementById('target-weight-grid');
const copyTargetPromptButton = document.getElementById('copy-target-prompt');
const copyComparisonPromptButton = document.getElementById('copy-comparison-prompt');
const baselineSelect = document.getElementById('baseline-target');
const compareSelect = document.getElementById('compare-target');
const comparisonBody = document.getElementById('comparison-body');
const summaryGrid = document.getElementById('summary-grid');
let activeTrigger = null;

function hideTooltip() {
  activeTrigger = null;
  tooltipLayer.classList.remove('is-visible');
  tooltipLayer.setAttribute('aria-hidden', 'true');
}

function showTooltip(trigger) {
  activeTrigger = trigger;
  tooltipLayer.innerHTML = '<b>' + trigger.dataset.tooltipTitle + '</b>' +
    '<strong>這是什麼</strong><span>' + trigger.dataset.tooltipMeaning + '</span>' +
    '<strong>改善方向</strong><span>' + trigger.dataset.tooltipImprovements + '</span>';

  const rect = trigger.getBoundingClientRect();
  const gap = 10;
  const layerWidth = Math.min(320, window.innerWidth - 48);
  const estimatedHeight = 178;
  const x = Math.min(Math.max(24, rect.left + rect.width / 2 - layerWidth / 2), window.innerWidth - layerWidth - 24);
  const belowY = rect.bottom + gap;
  const aboveY = rect.top - estimatedHeight - gap;
  const y = belowY + estimatedHeight < window.innerHeight ? belowY : Math.max(16, aboveY);

  tooltipLayer.style.setProperty('--tooltip-x', x + 'px');
  tooltipLayer.style.setProperty('--tooltip-y', y + 'px');
  tooltipLayer.classList.add('is-visible');
  tooltipLayer.setAttribute('aria-hidden', 'false');
}

function bindTooltipTriggers() {
  for (const trigger of document.querySelectorAll('.tooltip-trigger')) {
    if (trigger.dataset.tooltipBound === 'true') continue;
    trigger.dataset.tooltipBound = 'true';
    trigger.addEventListener('mouseenter', () => showTooltip(trigger));
    trigger.addEventListener('focus', () => showTooltip(trigger));
    trigger.addEventListener('mouseleave', hideTooltip);
    trigger.addEventListener('blur', hideTooltip);
  }
}

window.addEventListener('scroll', () => activeTrigger && showTooltip(activeTrigger), { passive: true });
window.addEventListener('resize', hideTooltip);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideTooltip();
});

openMethodDialog.addEventListener('click', () => methodDialog.showModal());
closeMethodDialog.addEventListener('click', () => methodDialog.close());
methodDialog.addEventListener('click', (event) => {
  if (event.target === methodDialog) methodDialog.close();
});

function formatValue(value, digits = 0) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '-';
}

function formatMetricValue(metric, value) {
  const digits = metric === 'cls' ? 3 : 0;
  if (!Number.isFinite(value)) return '-';
  const unit = reportData.metricUnits[metric];
  const formatted = formatValue(value, digits);
  if (metric === 'cls') return formatted;
  return formatted + ' ' + unit;
}

function getImprovement(baselineValue, compareValue, metric) {
  if (!Number.isFinite(baselineValue) || !Number.isFinite(compareValue) || baselineValue === 0) return null;
  return ((baselineValue - compareValue) / baselineValue) * 100;
}

function getChangeClass(baselineValue, compareValue) {
  if (!Number.isFinite(baselineValue) || !Number.isFinite(compareValue)) return 'neutral';
  if (compareValue < baselineValue) return 'good';
  if (compareValue === baselineValue) return 'neutral';
  return 'bad';
}

function scoreClass(delta) {
  if (delta === null) return 'neutral';
  if (delta >= 15) return 'good';
  if (delta >= 0) return 'ok';
  return 'bad';
}

function renderDelta(delta) {
  const width = delta === null ? 0 : Math.min(Math.abs(delta), 100);
  const label = delta === null
    ? '-'
    : delta > 0
      ? '改善 ' + formatValue(delta, 1) + '%'
      : delta < 0
        ? '增加 ' + formatValue(Math.abs(delta), 1) + '%'
        : '0.0%';
  return '<div class="delta ' + scoreClass(delta) + '">' +
    '<span>' + label + '</span>' +
    '<i style="--bar-width: ' + width + '%"></i>' +
  '</div>';
}

function renderChange(baselineValue, compareValue, metric) {
  const digits = metric === 'cls' ? 3 : 0;
  if (!Number.isFinite(baselineValue) || !Number.isFinite(compareValue)) {
    return '<div class="change neutral"><strong>-</strong><small>-</small></div>';
  }

  const diff = compareValue - baselineValue;
  const improvementPercent = baselineValue === 0 ? null : ((baselineValue - compareValue) / baselineValue) * 100;
  const timeMetrics = new Set(['fcp', 'lcp', 'tbt', 'domContentLoaded', 'loadEvent']);
  const label = diff === 0 ? '持平' : diff < 0 ? '減少' : '多出';
  const value = timeMetrics.has(metric)
    ? formatValue(Math.abs(diff) / 1000, 2) + ' 秒'
    : formatValue(Math.abs(diff), digits) + ' ' + escapeHtml(reportData.metricUnits[metric]);
  const detail = diff === 0
    ? '持平'
    : diff < 0
      ? '改善 ' + formatValue(Math.abs(improvementPercent), 1) + '%'
      : '退步 ' + (improvementPercent === null ? '-' : formatValue(Math.abs(improvementPercent), 1)) + '%';
  const rawUnit = metric === 'cls' ? 'score' : reportData.metricUnits[metric];

  return '<div class="change ' + getChangeClass(baselineValue, compareValue) + '">' +
    '<strong>' + label + ' ' + value + '</strong>' +
    '<small>' + detail + ' · ' + formatValue(baselineValue, digits) + ' → ' + formatValue(compareValue, digits) + ' ' + escapeHtml(rawUnit) + '</small>' +
  '</div>';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function metricHeading(metric, label) {
  const tooltip = reportData.metricTooltips[metric];
  return '<span class="metric-name">' + escapeHtml(label) +
    '<button class="tooltip-trigger" type="button" aria-label="' + escapeHtml(label + ' 說明') + '"' +
    ' data-tooltip-title="' + escapeHtml(label) + '"' +
    ' data-tooltip-meaning="' + escapeHtml(tooltip.meaning) + '"' +
    ' data-tooltip-improvements="' + escapeHtml(tooltip.improvements) + '">?</button></span>' +
    '<small>' + escapeHtml(reportData.metricHints[metric]) + '</small>';
}

function findTarget(targetId) {
  return reportData.targets.find((target) => target.id === targetId) || reportData.targets[0];
}

function metricStatsLines(targetId) {
  const targetSummary = reportData.summary[targetId] || {};
  return Object.entries(reportData.metricLabels).map(([metric, label]) => {
    const item = targetSummary[metric] || {};
    const unit = reportData.metricUnits[metric];
    const digits = metric === 'cls' ? 3 : 0;
    return '- ' + label + ' (' + unit + '): median=' + formatValue(item.median, digits) + ', p75=' + formatValue(item.p75, digits) + ', min=' + formatValue(item.min, digits) + ', max=' + formatValue(item.max, digits);
  }).join('\\n');
}

function targetRunLines(targetId) {
  const rows = reportData.samples.filter((sample) => sample.target?.id === targetId);
  if (!rows.length) return 'No raw run samples available.';
  return rows.map((sample) => {
    const metrics = sample.metrics || {};
    return '- Run #' + sample.run + ': FCP=' + formatValue(metrics.fcp) + 'ms, LCP=' + formatValue(metrics.lcp) + 'ms, TBT=' + formatValue(metrics.tbt) + 'ms, CLS=' + formatValue(metrics.cls, 3) + ', DOMContentLoaded=' + formatValue(metrics.domContentLoaded) + 'ms, Load=' + formatValue(metrics.loadEvent) + 'ms, Transfer=' + formatValue(metrics.transferKB) + 'KB, Requests=' + formatValue(metrics.requestCount);
  }).join('\\n');
}

function qualityLines(targetId) {
  const item = reportData.quality[targetId] || { total: 0, valid: 0, invalid: 0, invalidRuns: [] };
  const invalid = item.invalidRuns?.length
    ? item.invalidRuns.map((run) => '- Run #' + run.run + ': ' + run.reasons.join('; ')).join('\\n')
    : '- None';
  return 'Total runs: ' + item.total + '\\nValid runs: ' + item.valid + '\\nInvalid runs: ' + item.invalid + '\\nInvalid details:\\n' + invalid;
}

function benchmarkContextLines() {
  const device = reportData.device || {};
  const options = reportData.options || {};
  return [
    'Project: ' + (reportData.project || 'Performance Benchmark'),
    'Report generated at: ' + (reportData.generatedAt || '-'),
    'Benchmark created at: ' + (reportData.createdAt || '-'),
    'Device: ' + (device.name || '-') + ' ' + (device.width || '-') + 'x' + (device.height || '-') + ', DPR ' + (device.deviceScaleFactor || '-'),
    'Network: ' + (options.network || '-'),
    'Cache: ' + (options.cache || '-'),
    'CPU slowdown: ' + (options.cpu || '-') + 'x',
    'Configured runs: ' + (options.runs || '-')
  ].join('\\n');
}

function metricMeaningLines() {
  return Object.entries(reportData.metricLabels).map(([metric, label]) => {
    const tooltip = reportData.metricTooltips[metric] || {};
    return '- ' + label + ': ' + (tooltip.meaning || '') + ' Improvement hints: ' + (tooltip.improvements || '');
  }).join('\\n');
}

function buildTargetPrompt(targetId) {
  const target = findTarget(targetId);
  return [
    'You are a senior mobile web performance engineer.',
    '',
    'Analyze only the selected target below. Do not compare it with any other target. Propose prioritized optimization directions based only on this benchmark data.',
    '',
    'Return the analysis in Traditional Chinese with these sections:',
    '1. Data quality assessment',
    '2. Key performance findings',
    '3. Likely bottlenecks',
    '4. Prioritized optimization plan',
    '5. Metrics to re-check after fixes',
    '',
    'Benchmark context:',
    benchmarkContextLines(),
    '',
    'Selected target:',
    'Target ID: ' + target.id,
    'Target label: ' + target.label,
    'URL: ' + target.url,
    '',
    'Sample quality:',
    qualityLines(target.id),
    '',
    'Target metric summary:',
    metricStatsLines(target.id),
    '',
    'Raw run samples:',
    targetRunLines(target.id),
    '',
    'Metric meanings and common optimization levers:',
    metricMeaningLines()
  ].join('\\n');
}

function comparisonMetricLines(baselineId, compareId) {
  const baselineSummary = reportData.summary[baselineId] || {};
  const compareSummary = reportData.summary[compareId] || {};
  return Object.entries(reportData.metricLabels).map(([metric, label]) => {
    const digits = metric === 'cls' ? 3 : 0;
    const unit = reportData.metricUnits[metric];
    const baselineMetric = baselineSummary[metric] || {};
    const compareMetric = compareSummary[metric] || {};
    const improvement = getImprovement(baselineMetric.median, compareMetric.median, metric);
    const improvementText = improvement === null ? '-' : formatValue(improvement, 1) + '%';
    return '- ' + label + ' (' + unit + '): baseline median=' + formatValue(baselineMetric.median, digits) + ', compare median=' + formatValue(compareMetric.median, digits) + ', improvement=' + improvementText + ', baseline p75=' + formatValue(baselineMetric.p75, digits) + ', compare p75=' + formatValue(compareMetric.p75, digits);
  }).join('\\n');
}

function buildComparisonPrompt(baselineId, compareId) {
  const baselineTarget = findTarget(baselineId);
  const compareTarget = findTarget(compareId);
  return [
    'You are a senior mobile web performance engineer.',
    '',
    'Compare the selected benchmark targets below. Focus on improvements, regressions, trade-offs, and likely optimization directions. Base your analysis only on this benchmark data.',
    '',
    'Return the analysis in Traditional Chinese with these sections:',
    '1. Data quality assessment for both targets',
    '2. Biggest improvements and regressions',
    '3. Likely causes behind the differences',
    '4. Prioritized optimization plan',
    '5. Metrics to re-check after fixes',
    '',
    'Benchmark context:',
    benchmarkContextLines(),
    '',
    'Baseline target:',
    'Target ID: ' + baselineTarget.id,
    'Target label: ' + baselineTarget.label,
    'URL: ' + baselineTarget.url,
    '',
    'Compare target:',
    'Target ID: ' + compareTarget.id,
    'Target label: ' + compareTarget.label,
    'URL: ' + compareTarget.url,
    '',
    'Baseline sample quality:',
    qualityLines(baselineTarget.id),
    '',
    'Compare sample quality:',
    qualityLines(compareTarget.id),
    '',
    'Comparison metric summary:',
    comparisonMetricLines(baselineTarget.id, compareTarget.id),
    '',
    'Baseline raw run samples:',
    targetRunLines(baselineTarget.id),
    '',
    'Compare raw run samples:',
    targetRunLines(compareTarget.id),
    '',
    'Metric meanings and common optimization levers:',
    metricMeaningLines()
  ].join('\\n');
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

async function copyPrompt(button, text) {
  if (!button) return;
  const originalText = button.textContent;
  try {
    await copyText(text);
    button.textContent = '已複製';
  } catch (error) {
    button.textContent = '複製失敗';
    console.error(error);
  } finally {
    window.setTimeout(() => { button.textContent = originalText; }, 1400);
  }
}

function getInlineStyles() {
  return Array.from(document.styleSheets).map((sheet) => {
    try {
      return Array.from(sheet.cssRules || []).map((rule) => rule.cssText).join('');
    } catch {
      return '';
    }
  }).join('');
}

function syncFormValues(source, clone) {
  const sourceControls = source.querySelectorAll('input, textarea, select');
  const cloneControls = clone.querySelectorAll('input, textarea, select');
  sourceControls.forEach((control, index) => {
    const clonedControl = cloneControls[index];
    if (!clonedControl) return;
    if (control.tagName === 'SELECT') clonedControl.value = control.value;
    else if (control.type === 'checkbox' || control.type === 'radio') clonedControl.checked = control.checked;
    else clonedControl.value = control.value;
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(value) {
  return String(value || 'section')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

async function exportSectionPng(section, button) {
  if (!section || !button) return;
  const originalText = button.textContent;
  button.textContent = '匯出中...';
  button.disabled = true;

  try {
    const rect = section.getBoundingClientRect();
    const width = Math.ceil(Math.max(section.scrollWidth, rect.width));
    const height = Math.ceil(Math.max(section.scrollHeight, rect.height));
    const clone = section.cloneNode(true);
    syncFormValues(section, clone);
    clone.classList.add('exporting-section');
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    clone.style.width = width + 'px';
    clone.style.minHeight = height + 'px';

    const serialized = new XMLSerializer().serializeToString(clone);
    const css = getInlineStyles();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (width + 40) + '" height="' + (height + 40) + '">' +
      '<foreignObject x="0" y="0" width="100%" height="100%">' +
      '<div xmlns="http://www.w3.org/1999/xhtml">' +
      '<style>' + css + '</style>' + serialized +
      '</div></foreignObject></svg>';

    const image = new Image();
    const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = svgUrl;
    });

    const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((width + 40) * scale);
    canvas.height = Math.ceil((height + 40) * scale);
    const context = canvas.getContext('2d');
    context.scale(scale, scale);
    context.fillStyle = getComputedStyle(document.body).backgroundColor || '#f7f8fa';
    context.fillRect(0, 0, width + 40, height + 40);
    context.drawImage(image, 0, 0);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG export failed.');
    const filename = safeFilename(section.dataset.exportName) + '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png';
    downloadBlob(blob, filename);
    button.textContent = '已匯出';
  } catch (error) {
    console.error(error);
    button.textContent = '匯出失敗';
  } finally {
    window.setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1400);
  }
}

function bindExportButtons() {
  for (const button of document.querySelectorAll('[data-export-section]')) {
    if (button.dataset.exportBound === 'true') continue;
    button.dataset.exportBound = 'true';
    button.addEventListener('click', () => exportSectionPng(button.closest('section'), button));
  }
}

function metricScore(metric, value) {
  const threshold = reportData.scoreThresholds[metric];
  if (!threshold || !Number.isFinite(value)) return null;
  if (value <= threshold.good) return 100;
  if (value >= threshold.poor) return 0;
  return Math.max(0, Math.min(100, ((threshold.poor - value) / (threshold.poor - threshold.good)) * 100));
}

function targetScore(targetId) {
  const targetSummary = reportData.summary[targetId] || {};
  let weightedTotal = 0;
  let weightTotal = 0;
  const details = [];

  for (const [metric, weight] of Object.entries(reportData.scoreWeights)) {
    const value = targetSummary[metric]?.median;
    const score = metricScore(metric, value);
    details.push({ metric, weight, value, score });
    if (score === null) continue;
    weightedTotal += score * weight;
    weightTotal += weight;
  }

  return {
    score: weightTotal ? Math.round(weightedTotal / weightTotal) : null,
    details
  };
}

function renderWeightGrid(scoreDetails) {
  if (!targetWeightGrid) return;
  targetWeightGrid.innerHTML = scoreDetails.map((item) => {
    const label = reportData.metricLabels[item.metric] || item.metric;
    const unit = reportData.metricUnits[item.metric] || '';
    const digits = item.metric === 'cls' ? 3 : 0;
    const scoreText = item.score === null ? '-' : formatValue(item.score, 0);
    const valueText = Number.isFinite(item.value) ? formatValue(item.value, digits) + ' ' + unit : '-';
    const threshold = reportData.scoreThresholds[item.metric] || {};
    const goodText = Number.isFinite(threshold.good) ? formatValue(threshold.good, digits) + ' ' + unit : '-';
    const poorText = Number.isFinite(threshold.poor) ? formatValue(threshold.poor, digits) + ' ' + unit : '-';
    const basis = '給分依據：' + label + ' <= ' + goodText + ' 為 100 分，>= ' + poorText + ' 為 0 分，中間依數值線性換算。此指標權重為 ' + item.weight + '%。';
    return '<div class="weight-item">' +
      '<b><span>' + escapeHtml(label) + ' · ' + item.weight + '%</span>' +
      '<button class="tooltip-trigger" type="button" aria-label="' + escapeHtml(label + ' 給分依據') + '"' +
      ' data-tooltip-title="' + escapeHtml(label + ' 給分依據') + '"' +
      ' data-tooltip-meaning="' + escapeHtml(basis) + '"' +
      ' data-tooltip-improvements="目前 median：' + escapeHtml(valueText) + '；子分數：' + escapeHtml(scoreText) + '/100。">?</button></b>' +
      '<span>score ' + scoreText + ' · median ' + escapeHtml(valueText) + '</span>' +
    '</div>';
  }).join('');
}

function renderTargetResults() {
  if (!metricTargetSelect || !targetMetricBody) return;

  const target = findTarget(metricTargetSelect.value);
  const targetSummary = reportData.summary[target.id] || {};
  metricTargetTitle.textContent = target.label;
  metricTargetId.textContent = target.id;
  metricTargetUrl.textContent = target.url;
  metricTargetUrl.href = target.url;

  const scoreResult = targetScore(target.id);
  if (targetScoreValue) targetScoreValue.textContent = scoreResult.score === null ? '-' : scoreResult.score + '/100';
  if (targetScoreDetail) targetScoreDetail.textContent = '依 LCP、TBT、FCP、CLS 與資源成本加權，滿分 100。';
  renderWeightGrid(scoreResult.details);

  targetMetricBody.innerHTML = Object.entries(reportData.metricLabels).map(([metric, label]) => {
    const item = targetSummary[metric] || {};
    return '<tr>' +
      '<th scope="row">' + metricHeading(metric, label) + '</th>' +
      '<td>' + escapeHtml(formatMetricValue(metric, item.median)) + '</td>' +
      '<td>' + escapeHtml(formatMetricValue(metric, item.p75)) + '</td>' +
      '<td>' + escapeHtml(formatMetricValue(metric, item.min)) + '</td>' +
      '<td>' + escapeHtml(formatMetricValue(metric, item.max)) + '</td>' +
    '</tr>';
  }).join('');

  bindTooltipTriggers();
}

function renderSummary() {
  if (!summaryGrid) return;

  const featured = ['lcp', 'tbt', 'transferKB', 'requestCount'];
  const hasComparison = Boolean(baselineSelect && compareSelect);
  const baselineId = hasComparison ? baselineSelect.value : metricTargetSelect?.value;
  const compareId = hasComparison ? compareSelect.value : baselineId;
  const baselineTarget = findTarget(baselineId);
  const compareTarget = findTarget(compareId);
  const baselineSummary = reportData.summary[baselineId] || {};
  const compareSummary = reportData.summary[compareId] || {};

  summaryGrid.innerHTML = featured.map((metric) => {
    const digits = metric === 'cls' ? 3 : 0;
    const baselineValue = baselineSummary[metric]?.median;
    const compareValue = compareSummary[metric]?.median;
    const delta = hasComparison && baselineId !== compareId ? getImprovement(baselineValue, compareValue, metric) : null;
    const className = hasComparison ? getChangeClass(baselineValue, compareValue) : 'neutral';
    const value = hasComparison
      ? delta === null
        ? '-'
        : compareValue < baselineValue
          ? '改善 ' + formatValue(Math.abs(delta), 1) + '%'
          : compareValue > baselineValue
            ? '+' + formatValue(compareValue - baselineValue, digits) + ' ' + reportData.metricUnits[metric]
            : '持平'
      : formatValue(compareValue, digits);
    const body = hasComparison
      ? escapeHtml(baselineTarget.label) + ' ' + formatValue(baselineValue, digits) + ' → ' + escapeHtml(compareTarget.label) + ' ' + formatValue(compareValue, digits) + ' ' + escapeHtml(reportData.metricUnits[metric])
      : escapeHtml(compareTarget.label) + ' median ' + formatValue(compareValue, digits) + ' ' + escapeHtml(reportData.metricUnits[metric]);

    return '<article class="summary-card ' + className + '">' +
      '<span>' + escapeHtml(reportData.metricLabels[metric]) + '</span>' +
      '<strong>' + value + '</strong>' +
      '<small>' + body + '</small>' +
    '</article>';
  }).join('');
}

function renderComparison() {
  if (!baselineSelect || !compareSelect || !comparisonBody) return;

  const baselineId = baselineSelect.value;
  const compareId = compareSelect.value;
  const baselineSummary = reportData.summary[baselineId] || {};
  const compareSummary = reportData.summary[compareId] || {};

  comparisonBody.innerHTML = Object.entries(reportData.metricLabels).map(([metric, label]) => {
    const baselineMetric = baselineSummary[metric] || {};
    const compareMetric = compareSummary[metric] || {};
    return '<tr>' +
      '<th scope="row">' + metricHeading(metric, label) + '</th>' +
      '<td>' + escapeHtml(formatMetricValue(metric, baselineMetric.median)) + '</td>' +
      '<td>' + escapeHtml(formatMetricValue(metric, compareMetric.median)) + '</td>' +
      '<td>' + renderChange(baselineMetric.median, compareMetric.median, metric) + '</td>' +
      '<td>' + escapeHtml(formatMetricValue(metric, baselineMetric.p75)) + '</td>' +
      '<td>' + escapeHtml(formatMetricValue(metric, compareMetric.p75)) + '</td>' +
    '</tr>';
  }).join('');

  renderSummary();
  bindTooltipTriggers();
}

bindExportButtons();

if (copyTargetPromptButton) {
  copyTargetPromptButton.addEventListener('click', () => {
    const targetId = metricTargetSelect?.value || reportData.targets[0]?.id;
    copyPrompt(copyTargetPromptButton, buildTargetPrompt(targetId));
  });
}

if (copyComparisonPromptButton) {
  copyComparisonPromptButton.addEventListener('click', () => {
    const baselineId = baselineSelect?.value || reportData.baselineTargetId || reportData.targets[0]?.id;
    const compareId = compareSelect?.value || reportData.compareTargetId || baselineId;
    copyPrompt(copyComparisonPromptButton, buildComparisonPrompt(baselineId, compareId));
  });
}

if (metricTargetSelect) {
  metricTargetSelect.addEventListener('change', () => {
    renderTargetResults();
    if (!baselineSelect || !compareSelect) renderSummary();
  });
  renderTargetResults();
}

if (baselineSelect && compareSelect) {
  baselineSelect.addEventListener('change', renderComparison);
  compareSelect.addEventListener('change', renderComparison);
  renderComparison();
} else {
  renderSummary();
}
