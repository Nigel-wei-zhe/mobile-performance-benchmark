import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const profile = JSON.parse(await readFile(new URL('../config/profiles.json', import.meta.url), 'utf8'));
const chromePath = process.env.CHROME_PATH || profile.defaults.chromePath;

const checks = [];

checks.push({
  name: 'Node.js >= 22',
  ok: Number(process.versions.node.split('.')[0]) >= 22,
  detail: process.version
});

try {
  await access(chromePath, constants.X_OK);
  checks.push({ name: 'Chrome executable', ok: true, detail: chromePath });
} catch {
  checks.push({ name: 'Chrome executable', ok: false, detail: chromePath });
}

try {
  const { stdout } = await execFileAsync(chromePath, ['--version'], { timeout: 5000 });
  checks.push({ name: 'Chrome version', ok: true, detail: stdout.trim() });
} catch (error) {
  checks.push({ name: 'Chrome version', ok: false, detail: error.message });
}

for (const check of checks) {
  console.log(`${check.ok ? 'OK ' : 'ERR'} ${check.name}: ${check.detail}`);
}

if (checks.some((check) => !check.ok)) {
  process.exitCode = 1;
}
