import { readFile } from 'node:fs/promises';
import { defaultTargetPath } from './paths.mjs';

export async function loadTargetConfig(targetPath = defaultTargetPath) {
  let config;

  try {
    config = JSON.parse(await readFile(targetPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`No target config found at ${targetPath}. Create target.json or pass --target-file.`);
    }
    throw error;
  }

  return normalizeTargetConfig(config);
}

export function normalizeTargetConfig(config) {
  if (!Array.isArray(config.targets) || config.targets.length < 1) {
    throw new Error('Target config must include at least one target.');
  }

  const targetIds = new Set();

  for (const target of config.targets) {
    if (!target.id || !target.label || !target.url) {
      throw new Error('Each target must include id, label, and url.');
    }
    if (targetIds.has(target.id)) {
      throw new Error(`Duplicate target id: "${target.id}".`);
    }
    targetIds.add(target.id);
  }

  return {
    project: config.project || 'Website Performance Benchmark',
    targets: config.targets
  };
}
