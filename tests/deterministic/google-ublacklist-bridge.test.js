const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'google_news_ublacklist_bridge.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');

function createHarness({ html, wjd = {} }) {
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
    window.GM_xmlhttpRequest = () => null;
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
    assert.match(source, /^\/\/ @version\s+13\.1\.3$/m);
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
