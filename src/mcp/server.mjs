#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';
import { defaultTargetPath, profilesPath, resultsDir, root } from '../paths.mjs';
import {
  buildComparison,
  getBaselineTarget,
  getCompareTarget,
  getTargets,
  listRawResults,
  loadLatestRaw,
  loadRawResult,
  metricLabels,
  metricUnits,
  summarize,
  writeMarkdownReport
} from '../reporting.mjs';
import { loadTargetConfig, normalizeTargetConfig } from '../target-config.mjs';
import { runDoctor } from '../doctor.mjs';

const execFileAsync = promisify(execFile);
const protocolVersion = '2025-11-25';

const tools = [
  {
    name: 'doctor',
    description: 'Check local Node.js and Chrome requirements for mobile benchmark runs.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        chromePath: {
          type: 'string',
          description: 'Optional Chrome executable path. Defaults to CHROME_PATH or config/profiles.json.'
        }
      }
    }
  },
  {
    name: 'list_results',
    description: 'List raw benchmark result files in the results directory.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: 'summarize_latest_result',
    description: 'Read latest raw benchmark data and return targets, quality, and metric summary.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        rawPath: {
          type: 'string',
          description: 'Optional absolute path to a raw benchmark JSON file.'
        }
      }
    }
  },
  {
    name: 'compare_targets',
    description: 'Compare two targets from a raw benchmark result using median and p75 metrics.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        rawPath: { type: 'string' },
        baselineId: { type: 'string' },
        compareId: { type: 'string' }
      }
    }
  },
  {
    name: 'generate_markdown_report',
    description: 'Generate latest-report.md and latest-summary.csv from a raw benchmark result.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        rawPath: { type: 'string' }
      }
    }
  },
  {
    name: 'generate_html_report',
    description: 'Generate results/latest-report.html from the latest raw benchmark result.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: 'run_benchmark',
    description: 'Run a mobile performance benchmark for one URL. This launches local Chrome and writes raw results.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        project: { type: 'string' },
        url: {
          type: 'string',
          description: 'URL to benchmark. Required for the npx MCP flow.'
        },
        id: {
          type: 'string',
          description: 'Target id used with url. Defaults to "target".'
        },
        label: {
          type: 'string',
          description: 'Target label used with url. Defaults to the URL hostname.'
        },
        runs: { type: 'integer', minimum: 1, default: 5 },
        network: { type: 'string', enum: ['fast4g', 'slow4g'], default: 'fast4g' },
        cache: { type: 'string', enum: ['cold', 'warm'], default: 'cold' },
        cpu: { type: 'number', minimum: 1, default: 4 },
        settleMs: { type: 'number', minimum: 0, default: 3000 },
        timeoutMs: { type: 'number', minimum: 1000, default: 600000 },
        chromePath: {
          type: 'string',
          description: 'Optional Chrome executable path. Defaults to CHROME_PATH or config/profiles.json.'
        }
      }
    }
  }
];

const prompts = [
  {
    name: 'analyze_latest_result',
    description: 'Create a Traditional Chinese analysis prompt for the latest benchmark result.',
    arguments: []
  },
  {
    name: 'compare_targets',
    description: 'Create a Traditional Chinese comparison prompt for two target ids.',
    arguments: [
      { name: 'baselineId', description: 'Baseline target id', required: false },
      { name: 'compareId', description: 'Compare target id', required: false }
    ]
  }
];

const resources = [
  {
    uri: 'benchmark://config/profiles',
    name: 'Benchmark profiles',
    mimeType: 'application/json',
    description: 'Device, network, and default benchmark settings.'
  },
  {
    uri: 'benchmark://targets/current',
    name: 'Current benchmark targets',
    mimeType: 'application/json',
    description: 'Targets from project target.json.'
  },
  {
    uri: 'benchmark://latest/raw',
    name: 'Latest raw result',
    mimeType: 'application/json',
    description: 'Latest raw benchmark samples.'
  },
  {
    uri: 'benchmark://latest/summary',
    name: 'Latest summary',
    mimeType: 'application/json',
    description: 'Latest summarized metrics and sample quality.'
  }
];

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on('line', async (line) => {
  if (!line.trim()) return;

  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    writeMessage({
      jsonrpc: '2.0',
      id: null,
      error: makeError(-32700, `Parse error: ${error.message}`)
    });
    return;
  }

  if (Array.isArray(message)) {
    const responses = (await Promise.all(message.map(handleMessage))).filter(Boolean);
    if (responses.length) writeMessage(responses);
    return;
  }

  const response = await handleMessage(message);
  if (response) writeMessage(response);
});

async function handleMessage(message) {
  if (!message || message.jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id: message?.id ?? null,
      error: makeError(-32600, 'Invalid JSON-RPC request.')
    };
  }

  if (message.method?.startsWith('notifications/')) return null;

  try {
    const result = await dispatch(message.method, message.params || {});
    if (message.id === undefined) return null;
    return {
      jsonrpc: '2.0',
      id: message.id,
      result
    };
  } catch (error) {
    console.error(error.stack || error.message);
    return {
      jsonrpc: '2.0',
      id: message.id,
      error: makeError(-32603, error.message)
    };
  }
}

async function dispatch(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion,
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        },
        serverInfo: {
          name: 'mobile-performance-benchmark',
          version: '1.0.0'
        }
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools };
    case 'tools/call':
      return callTool(params.name, params.arguments || {});
    case 'resources/list':
      return { resources };
    case 'resources/read':
      return readResource(params.uri);
    case 'prompts/list':
      return { prompts };
    case 'prompts/get':
      return getPrompt(params.name, params.arguments || {});
    default:
      throw new Error(`Unsupported MCP method: ${method}`);
  }
}

async function callTool(name, args) {
  switch (name) {
    case 'doctor':
      return jsonToolResult(await runDoctor({ chromePath: args.chromePath }));
    case 'list_results':
      return jsonToolResult(await listRawResults());
    case 'summarize_latest_result':
      return jsonToolResult(await summarizeResult(args.rawPath));
    case 'compare_targets':
      return jsonToolResult(await compareTargets(args));
    case 'generate_markdown_report': {
      const raw = args.rawPath ? await loadRawResult(args.rawPath) : await loadLatestRaw();
      return jsonToolResult(await writeMarkdownReport(raw, resultsDir));
    }
    case 'generate_html_report':
      return toolResult(await runNodeScript('scripts/generate-html-report.mjs', []));
    case 'run_benchmark':
      return jsonToolResult(await runBenchmark(args));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function readResource(uri) {
  switch (uri) {
    case 'benchmark://config/profiles':
      return resourceContent(uri, await readFile(profilesPath, 'utf8'));
    case 'benchmark://targets/current':
      return resourceContent(uri, JSON.stringify(await loadTargetConfig(defaultTargetPath), null, 2));
    case 'benchmark://latest/raw':
      return resourceContent(uri, JSON.stringify(await loadLatestRaw(), null, 2));
    case 'benchmark://latest/summary':
      return resourceContent(uri, JSON.stringify(await summarizeResult(), null, 2));
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}

async function getPrompt(name, args) {
  switch (name) {
    case 'analyze_latest_result': {
      const result = await summarizeResult();
      return promptResult('Analyze this mobile web benchmark result in Traditional Chinese.', result);
    }
    case 'compare_targets': {
      const comparison = await compareTargets(args);
      return promptResult('Compare these mobile web benchmark targets in Traditional Chinese.', comparison);
    }
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}

async function summarizeResult(rawPath) {
  const raw = rawPath ? await loadRawResult(rawPath) : await loadLatestRaw();
  const targets = getTargets(raw);
  const baselineTarget = getBaselineTarget(targets);
  const compareTarget = getCompareTarget(targets, baselineTarget);
  const { summary, quality } = summarize(raw);

  return {
    project: raw.project,
    createdAt: raw.createdAt,
    device: raw.device,
    options: raw.options,
    targets,
    baselineTargetId: baselineTarget?.id || null,
    compareTargetId: compareTarget?.id || null,
    metricLabels,
    metricUnits,
    summary,
    quality
  };
}

async function compareTargets(args) {
  const raw = args.rawPath ? await loadRawResult(args.rawPath) : await loadLatestRaw();
  return buildComparison(raw, args.baselineId, args.compareId);
}

async function runBenchmark(args) {
  let tempDir;
  const scriptArgs = [];

  if (!args.url) {
    throw new Error('run_benchmark requires url. The npx MCP entry does not read target.json.');
  }

  const targetConfig = normalizeTargetConfig({
    project: args.project,
    targets: [
      {
        id: args.id || 'target',
        label: args.label || hostnameLabel(args.url),
        url: args.url
      }
    ]
  });
  tempDir = await mkdtemp(path.join(tmpdir(), 'mobile-perf-mcp-'));
  const targetPath = path.join(tempDir, 'target.json');
  await writeFile(targetPath, `${JSON.stringify(targetConfig, null, 2)}\n`);
  scriptArgs.push('--target-file', targetPath);

  scriptArgs.push(
    '--runs', String(args.runs ?? 5),
    '--network', String(args.network || 'fast4g'),
    '--cache', String(args.cache || 'cold'),
    '--cpu', String(args.cpu ?? 4),
    '--settleMs', String(args.settleMs ?? 3000)
  );

  if (args.chromePath) {
    scriptArgs.push('--chromePath', args.chromePath);
  }

  try {
    const output = await runNodeScript('scripts/run-benchmark.mjs', scriptArgs, args.timeoutMs ?? 600000);
    const raw = await loadLatestRaw();
    return {
      output,
      latestRawPath: path.join(resultsDir, 'latest-raw.json'),
      result: await summarizeResultForRaw(raw)
    };
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

function hostnameLabel(url) {
  try {
    return new URL(url).hostname || 'Target';
  } catch {
    return 'Target';
  }
}

async function summarizeResultForRaw(raw) {
  const targets = getTargets(raw);
  const { summary, quality } = summarize(raw);
  return {
    project: raw.project,
    createdAt: raw.createdAt,
    options: raw.options,
    targets,
    summary,
    quality
  };
}

async function runNodeScript(scriptPath, args, timeout = 120000) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [path.join(root, scriptPath), ...args], {
    cwd: root,
    timeout,
    maxBuffer: 20 * 1024 * 1024
  });

  return [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
}

function promptResult(prefix, data) {
  return {
    description: prefix,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `${prefix}\n\nData:\n${JSON.stringify(data, null, 2)}`
        }
      }
    ]
  };
}

function toolResult(text) {
  return {
    content: [
      {
        type: 'text',
        text: text || 'OK'
      }
    ]
  };
}

function jsonToolResult(value) {
  return toolResult(JSON.stringify(value, null, 2));
}

function resourceContent(uri, text) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text
      }
    ]
  };
}

function makeError(code, message) {
  return {
    code,
    message
  };
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
