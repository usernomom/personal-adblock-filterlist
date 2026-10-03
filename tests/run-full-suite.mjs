#!/usr/bin/env node
/**
 * Full regression gate. Every change to a userscript or to adguard-personal.txt
 * must pass this whole run before it is pushed or reported done; the pre-push
 * hook in .githooks runs it automatically.
 *
 * Steps (all run; failures are collected and reported together):
 *   1. Deterministic suite (every tests/deterministic/*.test.js).
 *   2. iphone-safari-toolkit unit suite (the live iPhone harness itself).
 *   3. Install every changed userscript into Violentmonkey in Opera Neon (served
 *      unmodified from this working tree) and verify the installed version.
 *   4. Deploy every changed userscript into Macaque on the iPhone.
 *   5. Live Neon suite (tests/live/google-smoke.mjs).
 *   6. Live iPhone Safari suite (iphone-safari-toolkit tests/ios/google_regression.py).
 *
 * Changed userscripts are the *.user.js files that differ from --base
 * (default origin/main), including uncommitted and untracked ones.
 * Environment: IPHONE_TOOLKIT (default ../iphone-safari-toolkit), PYTHON
 * (default python), NEON_DEBUG_HOST (default http://127.0.0.1:9223).
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolkit = path.resolve(process.env.IPHONE_TOOLKIT || path.join(repo, '..', 'iphone-safari-toolkit'));
const python = process.env.PYTHON || 'python';
const DEBUG_HOST = process.env.NEON_DEBUG_HOST || 'http://127.0.0.1:9223';
const VIOLENTMONKEY = 'chrome-extension://jinjaccalgkegednnccohejagnlnfdag/';
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const base = flag('--base') || 'origin/main';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(command, commandArgs, { cwd = repo, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, USERSCRIPT_REPO: repo },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let output = '';
    if (capture) {
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
    }
    child.on('error', reject);
    child.on('close', code => resolve({ code, output }));
  });
}

async function mustRun(command, commandArgs, options) {
  const { code, output } = await run(command, commandArgs, options);
  if (code !== 0) throw new Error(`${command} ${commandArgs.join(' ')} exited ${code}`);
  return output;
}

const results = [];
async function step(name, task) {
  console.log(`\n=== ${name} ===`);
  try {
    const detail = await task();
    results.push({ name, status: 'pass', detail });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'fail', detail: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function changedUserscripts() {
  const diff = await mustRun('git', ['diff', '--name-only', base], { capture: true });
  const untracked = await mustRun('git', ['ls-files', '--others', '--exclude-standard'], { capture: true });
  const files = new Set(`${diff}\n${untracked}`.split(/\r?\n/).map(line => line.trim())
    .filter(file => /^[^/]+\.user\.js$/.test(file)));
  return [...files].sort();
}

async function metadata(file) {
  const source = await readFile(path.join(repo, file), 'utf8');
  const read = key => source.match(new RegExp(`^// @${key}\\s+(.+)$`, 'm'))?.[1].trim();
  const name = read('name');
  const version = read('version');
  if (!name || !version) throw new Error(`${file} has no @name/@version metadata`);
  return { file, name, version };
}

async function cdp(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('DevTools connection failed')), { once: true });
  });
  let nextId = 0;
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reject(new Error('DevTools evaluation timed out')), 15000);
    ws.addEventListener('message', function handler(event) {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener('message', handler);
      clearTimeout(timer);
      if (message.error || message.result?.exceptionDetails) reject(new Error('DevTools evaluation threw'));
      else resolve(message.result?.result?.value);
    });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  return { evaluate, close: () => ws.close() };
}

const listTargets = async () => (await fetch(`${DEBUG_HOST}/json/list`)).json();
const closeTarget = id => fetch(`${DEBUG_HOST}/json/close/${id}`).catch(() => {});

async function installedInNeon() {
  const target = await (await fetch(`${DEBUG_HOST}/json/new?${VIOLENTMONKEY}options/index.html`, { method: 'PUT' })).json();
  try {
    const page = await cdp(target);
    try {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const rows = await page.evaluate(`[...document.querySelectorAll('.script')]
          .map(row => row.innerText.split('\\n').map(line => line.trim()).filter(Boolean))`);
        if (rows?.length) return rows.map(lines => ({ name: lines[0], lines }));
        await sleep(250);
      }
      throw new Error('Violentmonkey dashboard listed no scripts');
    } finally {
      page.close();
    }
  } finally {
    await closeTarget(target.id);
  }
}

async function installIntoNeon(script) {
  const server = http.createServer(async (request, response) => {
    if (request.url !== `/${script.file}`) { response.writeHead(404); response.end(); return; }
    const body = await readFile(path.join(repo, script.file));
    response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const before = new Set((await listTargets()).map(target => target.id));
  const url = `http://127.0.0.1:${server.address().port}/${script.file}`;
  const opened = await (await fetch(`${DEBUG_HOST}/json/new?${url}`, { method: 'PUT' })).json();
  try {
    let confirm = null;
    for (let attempt = 0; attempt < 60 && !confirm; attempt += 1) {
      confirm = (await listTargets()).find(target => target.url.startsWith(`${VIOLENTMONKEY}confirm/`) &&
        (!before.has(target.id) || target.id === opened.id));
      if (!confirm) await sleep(250);
    }
    if (!confirm) throw new Error(`Violentmonkey did not open its install page for ${script.file}`);
    const page = await cdp(confirm);
    try {
      const expected = `${script.name}, ${script.version}`;
      let clicked = null;
      for (let attempt = 0; attempt < 60 && !clicked; attempt += 1) {
        clicked = await page.evaluate(`(() => {
          if (!document.body.innerText.includes(${JSON.stringify(expected)})) return null;
          const button = [...document.querySelectorAll('button')].find(b => !b.disabled &&
            /^(Install|Reinstall|Re-install|Update)$/i.test(b.innerText.trim()));
          if (!button) return null;
          button.click();
          return button.innerText.trim();
        })()`);
        if (!clicked) await sleep(250);
      }
      if (!clicked) throw new Error(`Violentmonkey install page never offered ${expected}`);
      await sleep(2000);
      return clicked;
    } finally {
      page.close();
    }
  } finally {
    for (const target of await listTargets()) {
      if (target.id === opened.id || (!before.has(target.id) && target.url.startsWith(`${VIOLENTMONKEY}confirm/`))) {
        await closeTarget(target.id);
      }
    }
    server.close();
  }
}

const changed = await Promise.all((await changedUserscripts()).map(metadata));
console.log(`Changed userscripts vs ${base}: ${changed.map(script => `${script.file} ${script.version}`).join(', ') || 'none'}`);

await step('Deterministic suite', () => mustRun(process.execPath,
  ['--test', '--test-reporter=spec', 'tests/deterministic/*.test.js']));

await step('iPhone toolkit unit suite', () => mustRun(python,
  ['-m', 'unittest', 'discover', '-s', 'tests/ios', '-p', 'test_*.py'], { cwd: toolkit }));

await step('Install changed userscripts into Neon (Violentmonkey)', async () => {
  await fetch(`${DEBUG_HOST}/json/version`).catch(() => {
    throw new Error(`Opera Neon DevTools endpoint ${DEBUG_HOST} is not reachable`);
  });
  const report = [];
  for (const script of changed) {
    const installed = (await installedInNeon()).find(row => row.name === script.name);
    if (!installed) { report.push(`${script.file}: not installed in Neon (skipped)`); continue; }
    const button = await installIntoNeon(script);
    const after = (await installedInNeon()).find(row => row.name === script.name);
    if (!after?.lines.includes(script.version)) {
      throw new Error(`${script.file}: Neon shows ${JSON.stringify(after?.lines)} after ${button}, expected ${script.version}`);
    }
    report.push(`${script.file}: ${script.version} installed (${button})`);
  }
  return report;
});

await step('Deploy changed userscripts into Macaque (iPhone)', async () => {
  const report = [];
  for (const script of changed) {
    await mustRun(python, ['tests/ios/iphone.py', 'deploy', script.file], { cwd: toolkit });
    report.push(`${script.file}: ${script.version} deployed`);
  }
  return report;
});

await step('Live Neon suite', () => mustRun(process.execPath, ['tests/live/google-smoke.mjs']));

await step('Live iPhone Safari suite', () => mustRun(python, ['tests/ios/google_regression.py'], { cwd: toolkit }));

const ok = results.every(result => result.status === 'pass');
console.log('\n=== Full suite summary ===');
for (const result of results) {
  console.log(`${result.status.toUpperCase().padEnd(4)} ${result.name}${Array.isArray(result.detail) && result.detail.length ? `\n       ${result.detail.join('\n       ')}` : ''}${result.status === 'fail' ? `\n       ${result.detail}` : ''}`);
}
console.log(ok ? 'FULL SUITE PASSED' : 'FULL SUITE FAILED');
process.exitCode = ok ? 0 : 1;
