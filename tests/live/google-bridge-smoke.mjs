import fs from 'node:fs/promises';

const DEBUG_HOST = 'http://127.0.0.1:9223';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const MOBILE_VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };
const TIMEOUT_MS = 15000;

function fail(message, details) {
  const suffix = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`;
  throw new Error(`${message}${suffix}`);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) fail(`HTTP ${response.status} from ${url}`);
  return response.json();
}

class CdpClient {
  constructor(webSocketDebuggerUrl) {
    this.ws = new WebSocket(webSocketDebuggerUrl);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  close() {
    this.ws.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) fail('Page audit JavaScript threw', result.exceptionDetails);
  return result.result?.value;
}

async function waitFor(client, expression, description, timeoutMs = TIMEOUT_MS) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await evaluate(client, expression);
    if (last) return last;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  fail(`Timed out waiting for ${description}`, { last });
}

const source = await fs.readFile(new URL('../../google_news_ublacklist_bridge.user.js', import.meta.url), 'utf8');
const versionMatch = source.match(/^\/\/ @version\s+(.+)$/m);
if (!versionMatch) fail('Bridge userscript has no @version metadata');
const expectedVersion = versionMatch[1].trim();

const monitor = String.raw`
window.__UB_BRIDGE_LIVE_MONITOR__ = { frames: 0, violations: [] };
(() => {
  const headingSelector = '[role="heading"][aria-level="3"], h3, .GkAmnd';
  const tick = () => {
    const state = window.__UB_BRIDGE_LIVE_MONITOR__;
    state.frames += 1;
    for (const root of document.querySelectorAll('.Ww4FFb, .vt6azd')) {
      const links = [...root.querySelectorAll('a[href*="/goto?"]')];
      const primaries = links.filter(link => link.querySelector(headingSelector));
      if (primaries.length !== 1) continue;
      const style = getComputedStyle(root);
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && root.getBoundingClientRect().height > 0;
      if (visible && !root.hasAttribute('data-ub-google-filter-ready')) {
        state.violations.push({
          frame: state.frames,
          text: (root.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
        });
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

let target;
let client;
try {
  target = await fetchJson(`${DEBUG_HOST}/json/new?about:blank`, { method: 'PUT' });
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');
  await client.send('Network.setUserAgentOverride', { userAgent: MOBILE_UA });
  await client.send('Emulation.setDeviceMetricsOverride', {
    ...MOBILE_VIEWPORT,
    screenWidth: MOBILE_VIEWPORT.width,
    screenHeight: MOBILE_VIEWPORT.height,
  });
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.unsafeWindow = window;\n${source}\n${monitor}`,
  });

  const navigate = async query => {
    const url = `https://www.google.ca/search?q=${encodeURIComponent(query)}`;
    await client.send('Page.navigate', { url });
    await waitFor(client, `document.readyState === 'complete'`, `${query} page load`);
    await waitFor(
      client,
      `document.documentElement?.getAttribute('data-ub-google-bridge-version') === ${JSON.stringify(expectedVersion)}`,
      `${query} bridge ${expectedVersion}`,
    );
    await waitFor(
      client,
      `Boolean(document.querySelector('.Ww4FFb a[href*="/goto?"], .vt6azd a[href*="/goto?"]'))`,
      `${query} opaque Google result roots`,
    );
    await new Promise(resolve => setTimeout(resolve, 500));
  };

  await navigate('codex reddit');
  const codex = await evaluate(client, `(() => {
    const headingSelector = '[role="heading"][aria-level="3"], h3, .GkAmnd';
    const roots = [...document.querySelectorAll('.Ww4FFb, .vt6azd')].filter(root => root.querySelector('a[href*="/goto?"]'));
    const describe = root => {
      const links = [...root.querySelectorAll('a[href*="/goto?"]')];
      const primaries = links.filter(link => link.querySelector(headingSelector));
      return {
        text: (root.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
        gotoCount: links.length,
        primaryCount: primaries.length,
        pending: root.hasAttribute('data-ub-google-filter-pending'),
        ready: root.hasAttribute('data-ub-google-filter-ready'),
        directProxyCount: root.querySelectorAll(':scope > [data-ub-google-source-proxy]').length,
        descendantPendingCount: root.querySelectorAll('[data-ub-google-filter-pending]').length,
      };
    };
    return {
      bridge: window.__UB_GOOGLE_BRIDGE__ && {
        version: window.__UB_GOOGLE_BRIDGE__.version,
        shieldedCount: window.__UB_GOOGLE_BRIDGE__.shieldedCount,
        stats: window.__UB_GOOGLE_BRIDGE__.stats,
      },
      monitor: window.__UB_BRIDGE_LIVE_MONITOR__,
      roots: roots.map(describe),
    };
  })()`);

  const sitelink = codex.roots.find(root => root.gotoCount > 1 && root.primaryCount === 1);
  if (!sitelink) fail('codex reddit: did not find a live ordinary result with sitelinks', codex);
  if (!sitelink.ready || sitelink.pending) fail('codex reddit: sitelink parent did not settle as one result', sitelink);
  if (sitelink.directProxyCount !== 1 || sitelink.descendantPendingCount !== 0) {
    fail('codex reddit: sitelinks were split into independently pending bridge roots', sitelink);
  }
  if (codex.monitor.violations.length) fail('codex reddit: an ordinary result painted before bridge readiness', codex.monitor);
  if (codex.bridge.shieldedCount !== 0 || codex.bridge.stats.filterFailOpenReleases !== 0) {
    fail('codex reddit: bridge did not settle cleanly', codex.bridge);
  }
  console.log('PASS codex reddit sitelink coupling and no-pre-ready-paint');

  await navigate('terafab');
  const terafab = await evaluate(client, `(() => {
    const headingSelector = '[role="heading"][aria-level="3"], h3, .GkAmnd';
    const roots = [...document.querySelectorAll('.Ww4FFb, .vt6azd')].filter(root => root.querySelector('a[href*="/goto?"]'));
    const aggregates = roots.map(root => {
      const links = [...root.querySelectorAll('a[href*="/goto?"]')];
      const primaries = links.filter(link => link.querySelector(headingSelector));
      return {
        root,
        text: (root.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
        primaryCount: primaries.length,
      };
    }).filter(item => item.primaryCount > 1);
    const videos = aggregates.find(item => /^Videos/i.test(item.text));
    const style = document.querySelector('[data-ub-google-filter-shield-style]');
    return {
      videos: videos && {
        text: videos.text,
        primaryCount: videos.primaryCount,
        pending: videos.root.hasAttribute('data-ub-google-filter-pending'),
        ready: videos.root.hasAttribute('data-ub-google-filter-ready'),
        directProxyCount: videos.root.querySelectorAll(':scope > [data-ub-google-source-proxy]').length,
        nestedReadyCount: videos.root.querySelectorAll('[data-ub-google-filter-ready]').length,
      },
      shieldStyle: style ? style.textContent : '',
      bridge: window.__UB_GOOGLE_BRIDGE__ && {
        shieldedCount: window.__UB_GOOGLE_BRIDGE__.shieldedCount,
        stats: window.__UB_GOOGLE_BRIDGE__.stats,
      },
    };
  })()`);

  if (!terafab.videos) fail('terafab: did not find the live Videos aggregate module', terafab);
  if (terafab.videos.pending || terafab.videos.ready || terafab.videos.directProxyCount !== 0) {
    fail('terafab: aggregate parent was incorrectly taken over by the bridge', terafab.videos);
  }
  if (terafab.videos.nestedReadyCount < 1) fail('terafab: nested video results were not bridged', terafab.videos);
  if (terafab.shieldStyle.includes(':has(')) fail('terafab: broad :has() anti-flash selector returned', terafab.shieldStyle);
  if (!/display:\s*none\s*!important/.test(terafab.shieldStyle)) fail('terafab: pending-root collapse style is missing', terafab.shieldStyle);
  if (terafab.bridge.stats.filterFailOpenReleases !== 0) {
    fail('terafab: bridge used the fail-open path during the smoke test', terafab.bridge);
  }
  console.log('PASS terafab aggregate-module isolation');
  console.log(`\nGoogle bridge live smoke: PASS against bridge ${expectedVersion}`);
} finally {
  if (client) client.close();
  if (target?.id) {
    try {
      await fetch(`${DEBUG_HOST}/json/close/${target.id}`);
    } catch (error) {
      console.error(`WARN could not close temporary Neon tab: ${error.message}`);
    }
  }
}
