import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { profilesPath } from './paths.mjs';
import { readFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

export async function runDoctor(options = {}) {
  const profile = JSON.parse(await readFile(profilesPath, 'utf8'));
  const chromePath = options.chromePath || process.env.CHROME_PATH || profile.defaults.chromePath;
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

  const launchCheck = await checkHeadlessChrome(chromePath);
  checks.push(launchCheck);

  return {
    ready: checks.every((check) => check.ok),
    chromePath,
    checks
  };
}

async function checkHeadlessChrome(chromePath) {
  const port = 9222 + Math.floor(Math.random() * 1000);
  const profileDir = await mkdtemp(path.join(tmpdir(), 'mobile-perf-doctor-'));
  let child;
  let stderr = '';

  try {
    child = spawn(chromePath, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--headless=new',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank'
    ], {
      stdio: ['ignore', 'ignore', 'pipe']
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    await waitForChrome(port, 15000);

    return {
      name: 'Headless Chrome CDP',
      ok: true,
      detail: `http://127.0.0.1:${port}/json/version`
    };
  } catch (error) {
    const exitDetail = child && child.exitCode !== null
      ? ` Chrome exited with code ${child.exitCode}.`
      : '';
    const stderrDetail = stderr.trim()
      ? ` stderr: ${stderr.trim().slice(0, 1000)}`
      : '';
    return {
      name: 'Headless Chrome CDP',
      ok: false,
      detail: `${error.message}.${exitDetail}${stderrDetail}`.trim()
    };
  } finally {
    if (child) await stopChrome(child);
    await rm(profileDir, { recursive: true, force: true });
  }
}

async function waitForChrome(port, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await httpJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error('Chrome remote debugging endpoint did not start in time.');
}

async function stopChrome(child) {
  if (child.exitCode !== null || child.signalCode) return;

  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(3000).then(() => false)
  ]);

  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(1000)
    ]);
  }
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
