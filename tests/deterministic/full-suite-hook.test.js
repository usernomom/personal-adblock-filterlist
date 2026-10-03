const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'full-suite-hook-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Hook test');
  git('config', 'user.email', 'hook-test@example.invalid');
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'sample.user.js'), '// original\n');
  fs.writeFileSync(path.join(root, 'tests', 'run-full-suite.mjs'),
    "import { writeFileSync } from 'node:fs'; writeFileSync('.git/runner-called', process.argv.slice(2).join(' '));\n");
  git('add', '.');
  git('commit', '-qm', 'baseline');
  const base = git('rev-parse', 'HEAD');
  const hook = path.resolve(__dirname, '../../.githooks/pre-push');
  let shell = 'sh';
  if (process.platform === 'win32') {
    const gitExecutable = execFileSync('where.exe', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    let directory = path.dirname(gitExecutable);
    while (directory !== path.dirname(directory)) {
      const candidate = path.join(directory, 'bin', 'sh.exe');
      if (fs.existsSync(candidate)) { shell = candidate; break; }
      directory = path.dirname(directory);
    }
  }
  const push = (remote = base) => spawnSync(shell, [hook], {
    cwd: root, encoding: 'utf8',
    input: `refs/heads/main ${git('rev-parse', 'HEAD')} refs/heads/main ${remote}\n`,
  });
  return { root, git, push };
}

test('pre-push blocks when the remote commit is unavailable locally', t => {
  const { push } = fixture(t);
  const result = push('1234567890123456789012345678901234567890');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /cannot compare/);
});

test('pre-push blocks a new branch when origin/main cannot establish a baseline', t => {
  const { push } = fixture(t);
  const result = push('0000000000000000000000000000000000000000');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /cannot determine/);
});

test('pre-push refuses untracked source rather than testing a different working tree', t => {
  const { root, git, push } = fixture(t);
  fs.writeFileSync(path.join(root, 'sample.user.js'), '// updated\n');
  git('add', '.'); git('commit', '-qm', 'update');
  fs.writeFileSync(path.join(root, 'untracked.user.js'), '// unrelated\n');
  const result = push();
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /clean tree/);
  assert.equal(fs.existsSync(path.join(root, '.git', 'runner-called')), false);
});

test('pre-push runs the full gate when its own test tooling changes', t => {
  const { root, git, push } = fixture(t);
  fs.writeFileSync(path.join(root, 'tests', 'new.test.js'), '// gate regression\n');
  git('add', '.'); git('commit', '-qm', 'test tooling');
  const result = push();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.existsSync(path.join(root, '.git', 'runner-called')), true);
});

test('pre-push tests a clean userscript commit against the remote commit', t => {
  const { root, git, push } = fixture(t);
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'sample.user.js'), '// updated\n');
  git('add', '.'); git('commit', '-qm', 'update');
  const result = push();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(root, '.git', 'runner-called'), 'utf8'), '--base ' + base);
});
