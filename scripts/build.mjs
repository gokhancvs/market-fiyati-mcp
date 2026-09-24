import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
// The deletion target is fixed relative to this script, never taken from argv/cwd.
rmSync(new URL('dist/', root), { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)),
    '-p',
    fileURLToPath(new URL('tsconfig.json', root))
  ],
  { cwd: fileURLToPath(root), stdio: 'inherit' }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
