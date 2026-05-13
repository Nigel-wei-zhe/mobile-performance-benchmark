import path from 'node:path';

export const root = path.resolve(new URL('..', import.meta.url).pathname);
export const resultsDir = path.join(root, 'results');
export const defaultTargetPath = path.join(root, 'target.json');
export const profilesPath = path.join(root, 'config/profiles.json');
