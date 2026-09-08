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
    assert.match(source, /^\/\/ @version\s+13\.1\.2$/m);
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
    assert.match(style.textContent, /display:\s*none\s*!important/);
    assert.equal(style.textContent.includes(':has(a[href*="/goto?"])'), false);
    assert.equal(root.getAttribute('data-ub-google-filter-pending'), '1');
    assert.equal(root.hasAttribute('data-ub-google-filter-ready'), false);
    assert.ok(root.querySelector('[data-ub-google-source-proxy]'));
    assert.equal(h.api.shieldedCount, 1);
    h.close();
});

test('aggregate parent is not implicitly hidden when nested results own the opaque links', () => {
    const gotoA = '/goto?url=opaque-video-a';
    const gotoB = '/goto?url=opaque-video-b';
    const h = createHarness({
        html:
            '<div id="module" class="Ww4FFb vt6azd">' +
            '<div role="heading" aria-level="2">Videos</div>' +
            `<div id="a" class="sHEJob"><a href="${gotoA}"><h3>Video A</h3></a></div>` +
            `<div id="b" class="sHEJob"><a href="${gotoB}"><h3>Video B</h3></a></div>` +
            '</div>',
        wjd: {
            a: [gotoA, 'https://video-a.example/watch'],
            b: [gotoB, 'https://video-b.example/watch'],
        },
    });

    const module = h.document.getElementById('module');
    const a = h.document.getElementById('a');
    const b = h.document.getElementById('b');
    const style = h.document.querySelector('[data-ub-google-filter-shield-style]');

    assert.equal(module.hasAttribute('data-ub-google-filter-pending'), false);
    assert.equal(module.hasAttribute('data-ub-google-filter-ready'), false);
    assert.equal(style.textContent.includes(':has('), false);
    assert.equal(a.getAttribute('data-ub-google-filter-pending'), '1');
    assert.equal(b.getAttribute('data-ub-google-filter-pending'), '1');
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

test('unmapped ordinary result reaches network fallback without throwing', async () => {
    const goto = '/goto?url=opaque-unmapped';
    const h = createHarness({
        html:
            `<div id="result" class="Ww4FFb vt6azd">` +
            `<a href="${goto}"><h3>Unmapped publisher</h3></a></div>`,
        wjd: {},
        captureTimers: true,
    });

    const fallbackTimer = h.timers.find(timer => timer.ms === 120);
    assert.ok(fallbackTimer, 'regular unresolved result should schedule the 120ms network fallback');
    assert.equal(h.document.getElementById('result').getAttribute('data-ub-google-filter-pending'), '1');
    assert.doesNotThrow(() => fallbackTimer.callback());
    await nextTask();
    h.close();
});
test('ordinary result sitelinks stay coupled to the parent card', async () => {
    const mainGoto = '/goto?url=opaque-reddit-main';
    const childGoto = '/goto?url=opaque-reddit-child';
    const h = createHarness({
        html:
            '<div id="group" class="Ww4FFb vt6azd">' +
            `<a id="main" href="${mainGoto}"><h3>Codex coding tools by OpenAI</h3></a>` +
            `<div id="sitelinks"><h3><a id="child" href="${childGoto}">Is Codex really that impressive?</a></h3></div>` +
            '</div>',
        wjd: {
            main: [mainGoto, 'https://www.reddit.com/r/codex/'],
            child: [childGoto, 'https://www.reddit.com/r/codex/comments/example'],
        },
    });

    const group = h.document.getElementById('group');
    const child = h.document.getElementById('child');
    assert.equal(group.getAttribute('data-ub-google-filter-pending'), '1');
    assert.equal(child.closest('[data-ub-google-filter-pending]'), group);
    assert.equal(h.document.querySelectorAll('[data-ub-google-filter-pending]').length, 1);

    const proxy = group.querySelector(':scope > [data-ub-google-source-proxy] a');
    assert.ok(proxy, 'parent result should receive one proxy URL');
    assert.equal(proxy.href, 'https://www.reddit.com/r/codex/');
    assert.equal(group.querySelectorAll('[data-ub-google-source-proxy]').length, 1);

    group.setAttribute('data-ub-result', '1');
    await nextTask();
    assert.equal(group.getAttribute('data-ub-google-filter-ready'), '1');
    assert.equal(group.hasAttribute('data-ub-google-filter-pending'), false);
    assert.equal(h.api.shieldedCount, 0);
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
