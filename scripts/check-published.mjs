// Verify an actual npm publication, then test fresh downloads and offline reuse.
// npm run check:published -- VERSION FULL_SOURCE_COMMIT [EVIDENCE_DIRECTORY]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [version, revision, directory = 'published-evidence'] = process.argv.slice(2);
assert.match(version ?? '', /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.match(revision ?? '', /^[0-9a-f]{40}$/);
const evidence = resolve(directory);
mkdirSync(evidence); // Require a fresh evidence directory.
const work = mkdtempSync(join(tmpdir(), 'ep-npm-published-'));
const commands = [];
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('EP_') && key !== 'EMBEDDED_POSTGRES_CLI'));
const registry = 'https://registry.npmjs.org';
const npm = [process.execPath, process.env.npm_execpath];
assert.ok(npm[1], 'run through npm run check:published');
function run(args, label) {
  try {
    const output = execFileSync(args[0], args.slice(1), { cwd: work, env, encoding: 'utf8', timeout: 600_000 });
    writeFileSync(join(evidence, `${label}.log`), output);
    commands.push({ label, exit: 0 });
    return output;
  } catch (error) {
    writeFileSync(join(evidence, `${label}.log`), `${error.stdout ?? ''}\n${error.stderr ?? ''}`);
    commands.push({ label, exit: error.status });
    throw error;
  } finally { writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2)); }
}
async function json(url) {
  // npm can acknowledge publication shortly before all registry endpoints see it.
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (response.status === 404 && attempt < 11) {
      await new Promise(resolve => setTimeout(resolve, 10_000));
      continue;
    }
    assert.ok(response.ok, `${url}: ${response.status}`);
    return response.json();
  }
}
let record;
try {
  const metadata = await json(`${registry}/embedded-postgres-node/${version}`);
  assert.equal(metadata.version, version);
  writeFileSync(join(evidence, 'metadata.json'), JSON.stringify(metadata, null, 2));
  const attestations = await json(`${registry}/-/npm/v1/attestations/embedded-postgres-node@${version}`);
  writeFileSync(join(evidence, 'attestations.json'), JSON.stringify(attestations, null, 2));
  const provenance = attestations.attestations.find(item => item.predicateType === 'https://slsa.dev/provenance/v1');
  assert.ok(provenance, 'missing published provenance');
  const statement = JSON.parse(Buffer.from(provenance.bundle.dsseEnvelope.payload, 'base64'));
  const definition = statement.predicate.buildDefinition;
  const repository = 'https://github.com/fergusstrange/embedded-postgres-node';
  assert.deepEqual(definition.externalParameters.workflow, { ref: `refs/tags/v${version}`, repository, path: '.github/workflows/release.yml' });
  assert.ok(definition.resolvedDependencies.some(item => item.uri === `git+${repository}@refs/tags/v${version}` && item.digest.gitCommit === revision));
  assert.equal(statement.predicate.runDetails.builder.id, 'https://github.com/actions/runner/github-hosted');
  const digest = Buffer.from(metadata.dist.integrity.replace(/^sha512-/, ''), 'base64').toString('hex');
  assert.match(metadata.dist.integrity, /^sha512-/);
  assert.ok(statement.subject.some(item => item.name === `pkg:npm/embedded-postgres-node@${version}` && item.digest.sha512 === digest));
  writeFileSync(join(work, 'package.json'), '{"private":true,"type":"module"}\n');
  const { devDependencies } = JSON.parse(readFileSync('package.json', 'utf8'));
  const options = ['--cache', join(work, 'npm-cache'), '--registry', registry];
  run([...npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', ...options, `embedded-postgres-node@${version}`, `pg@${devDependencies.pg}`], 'npm-install');
  const lock = JSON.parse(readFileSync(join(work, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/embedded-postgres-node'].integrity, metadata.dist.integrity);
  // npm cryptographically verifies both registry signatures and provenance.
  run([...npm, 'audit', 'signatures', ...options], 'npm-signatures');
  copyFileSync('test/fixtures/released-consumer.mjs', join(work, 'released-consumer.mjs'));
  const { postgresVersion } = JSON.parse(readFileSync('.github/upstream.json', 'utf8'));
  run([process.execPath, 'released-consumer.mjs', join(work, 'node_modules/pg'), postgresVersion], 'consumer');
  record = { status: 'passed', version, revision, integrity: metadata.dist.integrity,
    node: process.version, platform: process.platform, arch: process.arch, postgresVersion,
    provenance: statement.predicate.runDetails.metadata.invocationId,
    fixtureSha256: createHash('sha256').update(readFileSync('test/fixtures/released-consumer.mjs')).digest('hex') };
} finally { rmSync(work, { recursive: true, force: true }); }
writeFileSync(join(evidence, 'result.json'), JSON.stringify(record, null, 2));
console.log(`Verified public npm ${version}: signatures, provenance, fresh downloads, SQL, offline reuse and cleanup.`);
