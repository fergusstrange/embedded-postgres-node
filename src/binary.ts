import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { PostgresError, positiveTimeout } from './errors.js';

export type CliPlatform = 'linux-amd64' | 'linux-arm64' | 'darwin-amd64' | 'darwin-arm64' | 'windows-amd64' | 'windows-arm64';
export interface CliRelease {
  /** Exact published v2 tag. There is deliberately no implicit latest release. */
  version: string;
  /** Trusted SHA-256 pins, copied from reviewed upstream release checksums.txt. */
  checksums: Readonly<Partial<Record<CliPlatform, string>>>;
  /** Directory containing VERSION/ASSET, defaulting to upstream GitHub releases. */
  baseUrl?: string;
}

/** Reviewed upstream release; every platform asset was checked against checksums.txt. */
export const DEFAULT_CLI_RELEASE: Readonly<CliRelease> = Object.freeze({
  version: 'v2.0.0-alpha.1',
  checksums: Object.freeze({
    'linux-amd64': '69ef1bd6ca8ec00acf74fe90a5b6204657caa833934aada36591000b90daa7c6',
    'linux-arm64': '9bb6f2febcf3ce92b678c25aa1e06ae2e0a46a728b6da3ef31709aed2a2493a5',
    'darwin-amd64': '0f28163e7f346f444d7b3e790205df22e4e92d88acd2de15bd650fa45b114ffb',
    'darwin-arm64': '97866b33b4a59a5f60a807b55593af162d65f4e4f903696f2c1f638c01de19c0',
    'windows-amd64': '787e744b5c1c8ae88f77a043d0e3400a220e07e9ce4d03a55b9073a97f4cee6e',
    'windows-arm64': '07ee6b62c24c0e1a61a3523cf6331560b8a0f64ab780bb5ee6240541a568364d',
  }),
});

export type CliSource = { path: string } | {
  /** Omit to use this package's reviewed DEFAULT_CLI_RELEASE. */
  release?: CliRelease;
  cacheDir?: string;
  offline?: boolean;
  downloadTimeoutMs?: number;
};

export function cliPlatform(platform: string = process.platform, arch: string = process.arch): CliPlatform {
  const os = platform === 'win32' ? 'windows' : platform;
  const cpu = arch === 'x64' ? 'amd64' : arch;
  if (!['linux', 'darwin', 'windows'].includes(os) || !['amd64', 'arm64'].includes(cpu)) {
    throw new PostgresError('BINARY', 'CLI supports Linux, macOS and Windows on x64 and arm64');
  }
  return `${os}-${cpu}` as CliPlatform;
}

export function cliAsset(target: CliPlatform): string {
  return `embedded-postgres_${target.replace('-', '_')}${target.startsWith('windows-') ? '.exe' : ''}`;
}

async function digest(path: string): Promise<string | undefined> {
  try {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

const maximumBytes = 128 * 1024 * 1024;
function validateUrl(url: URL, allowQuery = false): void {
  if (url.username || url.password || (!allowQuery && url.search) || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)))) {
    throw new PostgresError('CONFIG', 'CLI downloads require HTTPS (HTTP is allowed only for loopback mirrors), without credentials, query or fragment');
  }
}

async function download(url: URL, signal: AbortSignal): Promise<Response> {
  for (let redirects = 0; redirects <= 5; redirects++) {
    validateUrl(url, true); // GitHub's asset CDN uses signed query parameters.
    const response = await fetch(url, { signal, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location) throw new PostgresError('BINARY', 'CLI download redirect has no location');
    url = new URL(location, url);
  }
  throw new PostgresError('BINARY', 'CLI download has too many redirects');
}

/** Explicit source, then EMBEDDED_POSTGRES_CLI, then the package's pinned release. */
export async function resolveCli(source?: CliSource, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new PostgresError('ABORTED', 'CLI resolution aborted');
  source ??= process.env.EMBEDDED_POSTGRES_CLI ? { path: process.env.EMBEDDED_POSTGRES_CLI } : {};
  if ('path' in source) {
    if (!source.path || source.path.includes('\0')) throw new PostgresError('CONFIG', 'cli.path must name an executable');
    const path = resolve(source.path);
    try { await access(path, constants.X_OK); } catch { throw new PostgresError('BINARY', 'Local CLI is missing or not executable'); }
    return path;
  }
  const release = source.release ?? DEFAULT_CLI_RELEASE;
  if (!/^v2\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(release.version)) throw new PostgresError('CONFIG', 'CLI release must be an exact v2 tag');
  const target = cliPlatform();
  const expected = release.checksums[target]?.toLowerCase();
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new PostgresError('CONFIG', 'A trusted SHA-256 checksum is required for this CLI platform');
  const timeout = positiveTimeout(source.downloadTimeoutMs ?? 120_000, 'downloadTimeoutMs');
  let base: URL;
  try { base = new URL(release.baseUrl ?? 'https://github.com/fergusstrange/embedded-postgres/releases/download/'); } catch { throw new PostgresError('CONFIG', 'Invalid CLI release base URL'); }
  validateUrl(base);
  base.pathname = base.pathname.replace(/\/?$/, '/');
  const asset = cliAsset(target);
  const directory = join(resolve(source.cacheDir ?? join(homedir(), '.cache', 'embedded-postgres-node')), release.version, expected);
  const destination = join(directory, asset);
  let temporary: string | undefined;
  try {
    if (await digest(destination) === expected) {
      await chmod(destination, 0o700);
      return destination;
    }
    if (source.offline) throw new PostgresError('BINARY', 'Verified CLI is unavailable in the offline cache');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    temporary = join(directory, `.${asset}.${randomUUID()}.tmp`);
    const downloadSignal = AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]);
    const response = await download(new URL(`${release.version}/${asset}`, base), downloadSignal);
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new PostgresError('BINARY', `CLI download failed (HTTP ${response.status}); verify that the pinned release has been published`);
    }
    if (Number(response.headers.get('content-length')) > maximumBytes) {
      await response.body.cancel();
      throw new PostgresError('BINARY', 'CLI download exceeds 128 MiB');
    }
    const file = await open(temporary, 'wx', 0o700);
    const hash = createHash('sha256');
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > maximumBytes) throw new PostgresError('BINARY', 'CLI download exceeds 128 MiB');
        hash.update(chunk);
        await file.writeFile(chunk);
      }
    } finally { await file.close(); }
    if (hash.digest('hex') !== expected) throw new PostgresError('BINARY', 'CLI checksum mismatch; downloaded binary was not installed');
    // Atomic replacement; concurrent callers install identical verified bytes.
    try { await rename(temporary, destination); } catch (error) {
      if (await digest(destination) !== expected) throw error;
    }
    return destination;
  } catch (error) {
    if (signal?.aborted) throw new PostgresError('ABORTED', 'CLI resolution aborted');
    if (error instanceof PostgresError) throw error;
    if ((error as Error).name === 'TimeoutError') throw new PostgresError('TIMEOUT', 'CLI download deadline exceeded');
    throw new PostgresError('BINARY', 'Unable to resolve CLI binary; check network and cache permissions');
  } finally {
    if (temporary) await rm(temporary, { force: true });
  }
}
