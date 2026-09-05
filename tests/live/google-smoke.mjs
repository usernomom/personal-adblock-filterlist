const DEBUG_HOST = 'http://127.0.0.1:9223';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const MOBILE_VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };
const DESKTOP_VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
const TIMEOUT_MS = 20000;

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
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  fail(`Timed out waiting for ${description}`, { last });
}

async function emulate(client, { userAgent, viewport }) {
  await client.send('Network.setUserAgentOverride', { userAgent });
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await client.send('Emulation.setTouchEmulationEnabled', {
    enabled: viewport.mobile,
    maxTouchPoints: viewport.mobile ? 5 : 1,
  });
}

async function navigate(client, url) {
  await client.send('Page.navigate', { url });
  await waitFor(
    client,
    `document.readyState === 'complete' && location.href.startsWith(${JSON.stringify(url.split('?')[0])})`,
    `navigation to ${url}`,
  );
  await waitFor(
    client,
    `Array.from(document.querySelectorAll('style')).some(s => (s.textContent || '').includes('[data-google-cleanup-hidden]'))`,
    'Google cleanup userscript to become active; install/update the canonical .user.js in Violentmonkey if this fails',
  );
  await new Promise(resolve => setTimeout(resolve, 900));
}

function assertVisible(record, label) {
  if (!record) fail(`${label}: expected element was not found`);
  if (record.hiddenReason) fail(`${label}: element was hidden by cleanup`, record);
  if (record.display === 'none' || record.visibility === 'hidden' || record.opacity === '0') {
    fail(`${label}: element is not computed-visible`, record);
  }
  if (!(record.width > 0 && record.height > 0)) fail(`${label}: element has no visible rectangle`, record);
}

function assertCleanupHidden(record, reason, label) {
  if (!record) fail(`${label}: expected hidden element was not found`);
  if (record.hiddenReason !== reason) fail(`${label}: wrong cleanup reason`, record);
  if (record.display !== 'none' || record.width !== 0 || record.height !== 0) {
    fail(`${label}: cleanup marker exists but the smallest audited element is still visible`, record);
  }
}

const recordExpression = elementExpression => `(() => {
  const el = ${elementExpression};
  if (!el) return null;
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName,
    text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 180),
    hiddenReason: el.getAttribute('data-google-cleanup-hidden'),
    display: s.display,
    visibility: s.visibility,
    opacity: s.opacity,
    width: r.width,
    height: r.height
  };
})()`;

async function runCase(client, name, url, auditExpression, verify) {
  await navigate(client, url);
  const result = await evaluate(client, auditExpression);
  verify(result);
  console.log(`PASS ${name}`);
  return result;
}

const scriptSource = await (await import('node:fs/promises')).readFile(
  new URL('../../google_interface_cleanup.user.js', import.meta.url),
  'utf8',
);
const versionMatch = scriptSource.match(/^\/\/ @version\s+(.+)$/m);
if (!versionMatch) fail('Local userscript has no @version metadata');
const expectedVersion = versionMatch[1].trim();

let target;
let client;
try {
  target = await fetchJson(`${DEBUG_HOST}/json/new?about:blank`, { method: 'PUT' });
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');

  const desktopUa = await evaluate(client, 'navigator.userAgent');
  if (!desktopUa) fail('Could not read Neon user agent');

  await emulate(client, { userAgent: MOBILE_UA, viewport: MOBILE_VIEWPORT });

  const assertInstalledVersion = async () => {
    const liveVersion = await evaluate(
      client,
      `document.getElementById('google-interface-cleanup-style')?.dataset.googleCleanupVersion || null`,
    );
    if (liveVersion !== expectedVersion) {
      fail(
        `Live Violentmonkey userscript version ${JSON.stringify(liveVersion)} does not match local working tree ${expectedVersion}. Reinstall the local .user.js through Violentmonkey before running live smoke tests.`,
      );
    }
  };

  await navigate(client, 'https://www.google.com/search?q=Columbus+Ohio');
  await assertInstalledVersion();
  const columbus = await evaluate(
    client,
    recordExpression(`Array.from(document.querySelectorAll('[data-kpid]')).find(el =>
      el.getAttribute('data-kpid') === 'vise:/m/01smm' && el.getBoundingClientRect().height > 100)`),
  );
  assertVisible(columbus, 'Columbus data-kpid knowledge result');
  console.log('PASS Columbus mobile knowledge/entity result');

  const toronto = await runCase(
    client,
    'Toronto mobile weather/entity result',
    'https://www.google.com/search?q=Toronto+weather',
    recordExpression(`Array.from(document.querySelectorAll('[data-kpid]')).find(el =>
      /weather/i.test(el.innerText || '') && el.getBoundingClientRect().height > 40)`),
    result => assertVisible(result, 'Toronto weather/entity result'),
  );
  await assertInstalledVersion();

  const paa = await runCase(
    client,
    'People Also Ask removal',
    'https://www.google.com/search?q=why+is+the+sky+blue',
    recordExpression(`document.querySelector('[data-google-cleanup-hidden="question-accordion"]')`),
    result => assertCleanupHidden(result, 'question-accordion', 'People Also Ask'),
  );
  await assertInstalledVersion();

  const junk = await runCase(
    client,
    'video/refinement junk removal',
    'https://www.google.com/search?q=cats',
    `(() => {
      const candidates = Array.from(document.querySelectorAll('[data-google-cleanup-hidden="unwanted-vertical"]'));
      const el = candidates.find(root => Array.from(root.querySelectorAll('a[href]')).some(a => {
        try {
          const udm = new URL(a.href, location.href).searchParams.get('udm');
          return ['2', '7', 'vids', '28', '39', '54'].includes(udm);
        } catch { return false; }
      }));
      if (!el) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        hiddenReason: el.getAttribute('data-google-cleanup-hidden'),
        display: s.display,
        visibility: s.visibility,
        opacity: s.opacity,
        width: r.width,
        height: r.height,
        queryRefinements: document.querySelectorAll('[data-google-cleanup-hidden="query-refinement"]').length
      };
    })()`,
    result => {
      assertCleanupHidden(result, 'unwanted-vertical', 'Unwanted video/image vertical');
      if (!(result.queryRefinements >= 1)) fail('Expected at least one live query-refinement removal', result);
    },
  );
  await assertInstalledVersion();

  const youtubeAll = await runCase(
    client,
    'YouTube standalone result removal on All',
    'https://www.google.com/search?q=roborock+qrevo+edge+2+review',
    recordExpression(`Array.from(document.querySelectorAll('[data-google-cleanup-hidden="youtube-result"]')).find(root =>
      Array.from(root.querySelectorAll('a[href]')).some(a => {
        try {
          const host = new URL(a.href, location.href).hostname;
          return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
        } catch { return false; }
      }))`),
    result => assertCleanupHidden(result, 'youtube-result', 'Standalone YouTube result on All'),
  );
  await assertInstalledVersion();

  const youtubeVideos = await runCase(
    client,
    'YouTube result preservation on Videos tab',
    'https://www.google.com/search?q=roborock+qrevo+edge+2+review&udm=7',
    recordExpression(`Array.from(document.querySelectorAll('a[href]')).find(a =>
      /YouTube/i.test(a.innerText || '') &&
      a.getBoundingClientRect().width > 0 &&
      a.getBoundingClientRect().height > 0 &&
      !a.closest('[data-google-cleanup-hidden]'))`),
    result => assertVisible(result, 'YouTube result on Videos tab'),
  );
  const videosCleanupHiddenCount = await evaluate(
    client,
    `document.querySelectorAll('[data-google-cleanup-hidden]').length`,
  );
  if (videosCleanupHiddenCount !== 0) {
    fail('Explicit Videos tab should contain no cleanup-hidden elements', { videosCleanupHiddenCount });
  }
  await assertInstalledVersion();

  await emulate(client, { userAgent: desktopUa, viewport: DESKTOP_VIEWPORT });
  const webResult = await runCase(
    client,
    'desktop ordinary web result preservation',
    'https://www.google.com/search?q=OpenAI+API+documentation',
    recordExpression(`Array.from(document.querySelectorAll('a[href]')).find(a =>
      a.querySelector('h3') &&
      /OpenAI/i.test(a.innerText || '') &&
      a.getBoundingClientRect().width > 0 &&
      !a.closest('[data-google-cleanup-hidden]'))`),
    result => assertVisible(result, 'Ordinary external web result'),
  );
  await assertInstalledVersion();

  console.log(`\nLive Google smoke: 7/7 passed against userscript ${expectedVersion}`);
  console.log(JSON.stringify({
    columbus,
    toronto,
    paa,
    junk,
    youtubeAll,
    youtubeVideos,
    webResult,
  }, null, 2));
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
