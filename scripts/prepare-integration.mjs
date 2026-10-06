import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const source = resolve(process.argv[2] ?? '../embedded-postgres');
const pin = JSON.parse(readFileSync('.github/upstream.json', 'utf8'));
const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
if (process.env.CI && actual !== pin.commit) throw new Error('Integration CLI source does not match the reviewed upstream commit');
mkdirSync('.local', { recursive: true });
const path = resolve('.local', `embedded-postgres${process.platform === 'win32' ? '.exe' : ''}`);
execFileSync('go', ['build', '-trimpath', '-o', path, './cmd/embedded-postgres'], { cwd: source, stdio: 'inherit', env: { ...process.env, CGO_ENABLED: '0' } });
const values = { EMBEDDED_POSTGRES_CLI: path, EP_TEST_VERSION: pin.postgresVersion };
if (process.env.CI) {
  const target = {
    linux: { x64: 'x86_64-unknown-linux-gnu', arm64: 'aarch64-unknown-linux-gnu' },
    darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
    win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'x86_64-pc-windows-msvc' },
  }[process.platform]?.[process.arch];
  if (!target) throw new Error('Unsupported CI target');
  const archive = resolve('.local/postgres.tar.gz');
  const binaries = resolve('.local/pg');
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', [join(source, 'scripts/fetch-postgres.py'), pin.postgresVersion, target, archive], { cwd: source, stdio: 'inherit' });
  mkdirSync(binaries, { recursive: true });
  // Git Bash's GNU tar treats a drive-letter archive path as a remote host.
  execFileSync('tar', ['-xzf', 'postgres.tar.gz', '-C', 'pg', '--strip-components=1'], { cwd: resolve('.local'), stdio: 'inherit' });
  values.EP_TEST_BINARIES = binaries;
}
writeFileSync('.local/integration-env.json', JSON.stringify(values, null, 2) + '\n');
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
console.log(`Built CLI from ${actual}. Set EMBEDDED_POSTGRES_CLI=${path}`);
