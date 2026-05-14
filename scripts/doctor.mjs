import { runDoctor } from '../src/doctor.mjs';

const args = parseArgs(process.argv.slice(2));
const result = await runDoctor({ chromePath: args.chromePath });

for (const check of result.checks) {
  console.log(`${check.ok ? 'OK ' : 'ERR'} ${check.name}: ${check.detail}`);
}

if (!result.ready) {
  process.exitCode = 1;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
    options[key] = value;
  }
  return options;
}
