const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'google_news_ublacklist_bridge.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');

function nextTask() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function createHarness({ html, wjd = {}, captureTimers = false }) {
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
    window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
        return {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 390,
            bottom: 120,
            width: 390,
            height: 120,
            toJSON() { return this; },
        };
    };

    const timers = [];
    if (captureTimers) {
        let timerId = 0;
        window.setTimeout = (callback, ms) => {
            const timer = { id: ++timerId, callback, ms, cleared: false };
            timers.push(timer);
            return timer.id;
        };
        window.clearTimeout = id => {
            const timer = timers.find(item => item.id === id);
            if (timer) timer.cleared = true;
        };
    }

    window.W_jd = wjd;
    window.GM_xmlhttpRequest = () => null;
    window.eval(source);

    return {
        dom,
        window,
        document: window.document,
        api: window.__UB_GOOGLE_BRIDGE__,
        timers,
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
    assert.match(source, /^\/\/ @version\s+13\.1\.0$/m);
});

test('opaque regular Google result is shielded before proxy classification', () => {
    const goto = '/goto?url=opaque-yahoo';
    const h = createHarness({
        html:
            `<div id="result" class="Ww4FFb vt6azd" data-ub-result="1">` +
            `<a href="${goto}"><h3>Yahoo Finance</h3></a></div>`,
        wjd: mapping(goto, 'https://finance.yahoo.com/article'),
    });

    const root = h.document.getElementById('result');
    const style = h.document.querySelector('[data-ub-google-filter-shield-style]');
    assert.ok(style, 'document-start shield style must be installed');
    assert.match(style.textContent, /visibility:\s*hidden\s*!important/);
    assert.ok(style.textContent.includes(':has(a[href*="/goto?"])'));
    assert.equal(root.getAttribute('data-ub-google-filter-pending'), '1');
    assert.equal(root.hasAttribute('data-ub-google-filter-ready'), false);
    assert.ok(root.querySelector('[data-ub-google-source-proxy]'));
    assert.equal(h.api.shieldedCount, 1);
    h.close();
});

test('proxy resolution replaces the unresolved fail-open timer with a fresh classification window', () => {
    const goto = '/goto?url=opaque-timer';
    const h = createHarness({
        html:
            `<div id="result" class="Ww4FFb vt6azd" data-ub-result="1">` +
            `<a href="${goto}"><h3>Timer regression</h3></a></div>`,
        wjd: mapping(goto, 'https://example.com/article'),
        captureTimers: true,
    });

    assert.deepEqual(h.timers.map(timer => timer.ms), [6000, 6000]);
    assert.equal(h.timers[0].cleared, true, 'the unresolved-target timer must be cancelled');
    assert.equal(h.timers[1].cleared, false, 'the post-proxy classification timer must remain armed');
    h.close();
});

test('blocked result leaves bridge shield only after uBlacklist reclassification', async () => {
    const goto = '/goto?url=opaque-blocked';
    const h = createHarness({
        html:
            `<div id="result" class="Ww4FFb vt6azd" data-ub-result="1">` +
            `<a href="${goto}"><h3>Blocked publisher</h3></a></div>`,
        wjd: mapping(goto, 'https://blocked.example/article'),
    });

    const root = h.document.getElementById('result');
    assert.equal(root.getAttribute('data-ub-google-filter-pending'), '1');
    assert.equal(root.hasAttribute('data-ub-google-filter-ready'), false);

    // uBlacklist removes/re-adds its result marker while re-reading the newly
    // inserted proxy URL, then marks the result blocked in the same turn.
    root.removeAttribute('data-ub-result');
    root.setAttribute('data-ub-result', '1');
    root.setAttribute('data-ub-block', '1');
    await nextTask();

    assert.equal(root.getAttribute('data-ub-google-filter-ready'), '1');
    assert.equal(root.hasAttribute('data-ub-google-filter-pending'), false);
    assert.equal(root.getAttribute('data-ub-block'), '1');
    assert.equal(h.api.shieldedCount, 0);
    assert.equal(h.api.stats.filterFailOpenReleases, 0);
    h.close();
});

test('unblocked result becomes ready as soon as uBlacklist classifies it', async () => {
    const goto = '/goto?url=opaque-good';
    const h = createHarness({
        html:
            `<div id="result" class="Ww4FFb vt6azd">` +
            `<a href="${goto}"><h3>Useful publisher</h3></a></div>`,
        wjd: mapping(goto, 'https://example.com/article'),
    });

    const root = h.document.getElementById('result');
    assert.equal(root.getAttribute('data-ub-google-filter-pending'), '1');
    root.setAttribute('data-ub-result', '1');
    await nextTask();

    assert.equal(root.getAttribute('data-ub-google-filter-ready'), '1');
    assert.equal(root.hasAttribute('data-ub-google-filter-pending'), false);
    assert.equal(root.hasAttribute('data-ub-block'), false);
    h.close();
});

test('multi-result known container releases parent shield and arms nested result roots', () => {
    const gotoA = '/goto?url=opaque-a';
    const gotoB = '/goto?url=opaque-b';
    const h = createHarness({
        html:
            '<div id="group" class="Ww4FFb vt6azd">' +
            `<div id="a" class="xYkm8c"><a href="${gotoA}"><h3>A</h3></a></div>` +
            `<div id="b" class="xYkm8c"><a href="${gotoB}"><h3>B</h3></a></div>` +
            '</div>',
        wjd: {
            first: [gotoA, 'https://a.example/article'],
            second: [gotoB, 'https://b.example/article'],
        },
    });

    const group = h.document.getElementById('group');
    const a = h.document.getElementById('a');
    const b = h.document.getElementById('b');
    assert.equal(group.getAttribute('data-ub-google-filter-ready'), '1');
    assert.equal(group.hasAttribute('data-ub-google-filter-pending'), false);
    assert.equal(a.getAttribute('data-ub-google-filter-pending'), '1');
    assert.equal(b.getAttribute('data-ub-google-filter-pending'), '1');
    h.close();
});
