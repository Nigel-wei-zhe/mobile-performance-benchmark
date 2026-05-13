import { resultsDir } from '../src/paths.mjs';
import { loadLatestRaw, writeMarkdownReport } from '../src/reporting.mjs';

const raw = await loadLatestRaw();
const { markdownPath, csvPath } = await writeMarkdownReport(raw, resultsDir);

console.log(`Report written: ${markdownPath}`);
console.log(`CSV written: ${csvPath}`);
