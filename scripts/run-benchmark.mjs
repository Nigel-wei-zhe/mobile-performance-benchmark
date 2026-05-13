import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

class CDPClient {
  static async connect(url) {
    const socket = new WebSocket(url);
    const client = new CDPClient(socket);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return client;
  }

  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();

    socket.addEventListener('message', (message) => {
      const payload = JSON.parse(message.data);
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve, reject, timer } = this.pending.get(payload.id);
        clearTimeout(timer);
        this.pending.delete(payload.id);
        if (payload.error) reject(new Error(payload.error.message));
        else resolve(payload.result || {});
        return;
      }

      if (payload.method && this.listeners.has(payload.method)) {
        for (const listener of this.listeners.get(payload.method)) listener(payload.params || {});
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
  }

  waitFor(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(listener);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const listener = (params) => {
        clearTimeout(timer);
        listeners.delete(listener);
        resolve(params);
      };
      if (!this.listeners.has(method)) this.listeners.set(method, new Set());
      const listeners = this.listeners.get(method);
      listeners.add(listener);
    });
  }

  close() {
    this.socket.close();
  }
}

const root = path.resolve(new URL('..', import.meta.url).pathname);
const resultsDir = path.join(root, 'results');
const targetConfig = await loadTargetConfig();
const profiles = JSON.parse(await readFile(path.join(root, 'config/profiles.json'), 'utf8'));

const args = parseArgs(process.argv.slice(2), profiles.defaults);
const device = profiles.device;
const network = profiles.networks[args.network];

if (!network) {
  throw new Error(`Unknown network profile "${args.network}". Available: ${Object.keys(profiles.networks).join(', ')}`);
}

const chromePath = process.env.CHROME_PATH || args.chromePath || profiles.defaults.chromePath;
const port = Number(args.port || 9222 + Math.floor(Math.random() * 1000));
const profileDir = await mkdtemp(path.join(tmpdir(), 'mobile-perf-chrome-'));
let chromeProcess;

try {
  await mkdir(resultsDir, { recursive: true });
  chromeProcess = await launchChrome(chromePath, port, profileDir);
  await waitForChrome(port);

  const samples = [];

  for (let run = 1; run <= args.runs; run += 1) {
    for (const target of targetConfig.targets) {
      process.stdout.write(`[${run}/${args.runs}] ${target.label} ${args.network} ${args.cache} ... `);
      const sample = await measureTarget({ port, target, run, device, network, options: args });
      samples.push(sample);
      process.stdout.write(`LCP=${format(sample.metrics.lcp)}ms FCP=${format(sample.metrics.fcp)}ms TBT=${format(sample.metrics.tbt)}ms\n`);
    }
  }

  const payload = {
    project: targetConfig.project,
    createdAt: new Date().toISOString(),
    device,
    options: {
      runs: args.runs,
      network: args.network,
      cache: args.cache,
      cpu: args.cpu,
      settleMs: args.settleMs
    },
    samples
  };

  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/, 'Z');
  const rawPath = path.join(resultsDir, `${stamp}-raw.json`);
  await writeFile(rawPath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(path.join(resultsDir, 'latest-raw.json'), `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`Raw result written: ${rawPath}`);
  console.log('Run `pnpm run report` to generate Markdown and CSV summaries.');
} finally {
  if (chromeProcess) await stopChrome(chromeProcess);
  await rm(profileDir, { recursive: true, force: true });
}

async function loadTargetConfig() {
  const targetPath = path.join(root, 'target.json');
  let config;

  try {
    config = JSON.parse(await readFile(targetPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('No target.json found. Create target.json in the project root before running benchmark.');
    }
    throw error;
  }

  if (!Array.isArray(config.targets) || config.targets.length < 1) {
    throw new Error('target.json must include at least one target.');
  }

  const targetIds = new Set();

  for (const target of config.targets) {
    if (!target.id || !target.label || !target.url) {
      throw new Error('Each target in target.json must include id, label, and url.');
    }
    if (targetIds.has(target.id)) {
      throw new Error(`Duplicate target id in target.json: "${target.id}".`);
    }
    targetIds.add(target.id);
  }

  return {
    project: config.project || 'Website Performance Benchmark',
    targets: config.targets
  };
}

function parseArgs(argv, defaults) {
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
    options[key] = value;
  }

  return {
    ...options,
    runs: Number(options.runs),
    cpu: Number(options.cpu),
    settleMs: Number(options.settleMs),
    cache: String(options.cache || 'cold')
  };
}

async function launchChrome(chromePath, port, userDataDir) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ];

  const child = spawn(chromePath, args, {
    stdio: ['ignore', 'ignore', 'pipe']
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (/DevTools listening/.test(text)) return;
    if (/ERROR|FATAL/i.test(text)) process.stderr.write(text);
  });

  child.once('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`Chrome exited with code ${code}`);
    }
  });

  return child;
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

async function waitForChrome(port) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      await httpJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error('Chrome remote debugging endpoint did not start in time.');
}

async function measureTarget({ port, target, run, device, network, options }) {
  const page = await httpJson(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const cdp = await CDPClient.connect(page.webSocketDebuggerUrl);
  const requests = new Map();

  try {
    cdp.on('Network.requestWillBeSent', (event) => {
      requests.set(event.requestId, {
        url: event.request.url,
        type: event.type,
        status: null,
        mimeType: null,
        encodedDataLength: 0
      });
    });

    cdp.on('Network.responseReceived', (event) => {
      const item = requests.get(event.requestId);
      if (!item) return;
      item.status = event.response.status;
      item.mimeType = event.response.mimeType;
    });

    cdp.on('Network.loadingFinished', (event) => {
      const item = requests.get(event.requestId);
      if (!item) return;
      item.encodedDataLength = event.encodedDataLength || 0;
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpu });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: device.width,
      height: device.height,
      deviceScaleFactor: device.deviceScaleFactor,
      mobile: device.mobile
    });
    await cdp.send('Network.setUserAgentOverride', { userAgent: device.userAgent });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: network.latency,
      downloadThroughput: network.downloadThroughput,
      uploadThroughput: network.uploadThroughput,
      connectionType: 'cellular4g'
    });

    if (options.cache === 'cold') {
      await cdp.send('Network.clearBrowserCache');
      await cdp.send('Network.clearBrowserCookies');
    }

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: metricBootstrap() });
    const loadPromise = cdp.waitFor('Page.loadEventFired', 45000);
    await cdp.send('Page.navigate', { url: target.url });
    await loadPromise.catch(() => undefined);
    await delay(options.settleMs);
    await cdp.send('Runtime.evaluate', {
      expression: 'window.scrollTo(0, Math.floor(document.body.scrollHeight * 0.6));',
      awaitPromise: false
    }).catch(() => undefined);
    await delay(1000);

    const metrics = await collectMetrics(cdp, requests);
    return {
      run,
      target,
      capturedAt: new Date().toISOString(),
      metrics
    };
  } finally {
    await cdp.close();
    await httpJson(`http://127.0.0.1:${port}/json/close/${page.id}`).catch(() => undefined);
  }
}

async function collectMetrics(cdp, requests) {
  const expression = `(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paint = performance.getEntriesByType('paint').reduce((acc, item) => {
      acc[item.name] = item.startTime;
      return acc;
    }, {});
    return {
      nav: {
        domContentLoadedEventEnd: nav.domContentLoadedEventEnd || 0,
        loadEventEnd: nav.loadEventEnd || 0
      },
      paint,
      custom: window.__mobilePerf || {}
    };
  })()`;

  const response = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });

  const value = response.result?.value || {};
  const nav = value.nav || {};
  const custom = value.custom || {};
  const transferBytes = [...requests.values()].reduce((total, item) => total + (item.encodedDataLength || 0), 0);

  return {
    fcp: round(value.paint?.['first-contentful-paint']),
    lcp: round(custom.lcp),
    tbt: round(custom.tbt || 0),
    cls: round(custom.cls || 0, 3),
    domContentLoaded: round(nav.domContentLoadedEventEnd),
    loadEvent: round(nav.loadEventEnd),
    transferKB: round(transferBytes / 1024),
    requestCount: requests.size
  };
}

function metricBootstrap() {
  return `
    window.__mobilePerf = { lcp: 0, cls: 0, tbt: 0 };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__mobilePerf.lcp = entry.startTime;
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (error) {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__mobilePerf.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (error) {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__mobilePerf.tbt += Math.max(0, entry.duration - 50);
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch (error) {}
  `;
}

function httpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || 'GET' }, (res) => {
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

function round(value, digits = 0) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function format(value) {
  return value === null || value === undefined ? '-' : value;
}
