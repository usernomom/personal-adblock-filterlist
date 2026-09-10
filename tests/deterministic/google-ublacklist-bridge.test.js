const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'google_news_ublacklist_bridge.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');

function createHarness({ html, wjd = {}, gmRequest = () => null }) {
    const dom = new JSDOM(
        `<!doctype html><html><head></head><body>${html}</body></html>`,
        {
            url: 'https://www.google.com/search?q=bridge-regression',
            runScripts: 'outside-only',
            pretendToBeVisual: true,
        },
    );
    const { window } = dom;

    Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
        configurable: true,
        get() { return this.textContent || ''; },
        set(value) { this.textContent = value; },
    });

    window.W_jd = wjd;
    window.GM_xmlhttpRequest = gmRequest;
    window.eval(source);

    return {
        window,
        document: window.document,
        api: window.__UB_GOOGLE_BRIDGE__,
        close() { window.close(); },
    };
}

function mapping(goto, target) {
    return { [`entry-${goto}`]: [goto, target] };
}

test('bridge userscript package is installable and valid JavaScript', () => {
    const bytes = fs.readFileSync(scriptPath);
    const sentinel = Buffer.from('// ==UserScript==', 'utf8');
    assert.equal(bytes.subarray(0, sentinel.length).compare(sentinel), 0);
    assert.doesNotThrow(() => new vm.Script(source, { filename: scriptPath }));
    assert.match(source, /^\/\/ @version\s+13\.1\.4$/m);
});

test('ordinary results are never held behind the removed anti-flash shield', () => {
    const goto = '/goto?url=opaque-yahoo';
    const target = 'https://finance.yahoo.com/article';
    const h = createHarness({
        html:
            `<div id="result" class="Ww4FFb vt6azd">` +
            `<a href="${goto}"><h3>Yahoo Finance</h3></a></div>`,
        wjd: mapping(goto, target),
    });

    const root = h.document.getElementById('result');
    const proxy = root.querySelector(':scope > [data-ub-google-source-proxy] a');

    assert.equal(h.document.querySelector('[data-ub-google-filter-shield-style]'), null);
    assert.equal(root.hasAttribute('data-ub-google-filter-pending'), false);
    assert.equal(root.hasAttribute('data-ub-google-filter-ready'), false);
    assert.notEqual(h.window.getComputedStyle(root).display, 'none');
    assert.ok(proxy, 'bridge should still add the real-destination proxy for uBlacklist');
    assert.equal(proxy.href, target);
    assert.equal(h.api.resolveGoto(goto), target);
    h.close();
});

test('anti-flash gating code is absent from the bridge', () => {
    assert.equal(source.includes('data-ub-google-filter-pending'), false);
    assert.equal(source.includes('installFilterShieldStyle'), false);
    assert.equal(source.includes('FILTER_CLASSIFICATION_FAIL_OPEN_MS'), false);
});


test('standalone mobile-style result resolves one opaque goto via network fallback', async () => {
    const goto = '/goto?url=opaque-instagram';
    const target = 'https://www.instagram.com/breakingbad/';
    const requests = [];
    const h = createHarness({
        html:
            '<div id="rso"><div class="MjjYud">' +
            '<div id="instagram" class="Ww4FFb vt6azd">' +
            `<a class="UBFage" href="${goto}">Instagram · breakingbad ` +
            'Breaking Bad (@breakingbad) • Instagram photos and videos</a>' +
            '</div></div></div>',
        gmRequest(details) {
            requests.push(details.url);
            setTimeout(() => details.onload({ finalUrl: target }), 0);
            return { abort() {} };
        },
    });

    await new Promise((resolve) => setTimeout(resolve, 180));

    const root = h.document.getElementById('instagram');
    const proxy = root.querySelector(':scope > [data-ub-google-source-proxy] a');
    assert.equal(requests.length, 1);
    assert.equal(requests[0], `https://www.google.com${goto}`);
    assert.ok(proxy, 'single opaque result should receive a resolved uBlacklist proxy');
    assert.equal(proxy.href, target);
    assert.equal(root.getAttribute('data-ub-google-bridge-root'), '1');
    assert.equal(h.api.resolveGoto(goto), target);
    h.close();
});

test('ordinary multi-result root without nested result semantics does not fan out network fallbacks', async () => {
    const requests = [];
    const h = createHarness({
        html:
            '<div id="rso"><div id="group" class="Ww4FFb vt6azd">' +
            '<a href="/goto?url=opaque-one">One</a>' +
            '<a href="/goto?url=opaque-two">Two</a>' +
            '</div></div>',
        gmRequest(details) {
            requests.push(details.url);
            return null;
        },
    });

    await new Promise((resolve) => setTimeout(resolve, 180));

    assert.deepEqual(requests, []);
    assert.equal(
        h.document.querySelectorAll('#group > [data-ub-google-source-proxy]').length,
        0,
    );
    h.close();
});
