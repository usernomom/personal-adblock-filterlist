const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'google_news_ublacklist_bridge.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');

const MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const SITE_HOSTS_KEY = 'siteHosts';

// Persistent GM storage shared across harnesses, like one userscript's
// storage across page loads.
function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
        set(key, value) { values.set(key, value); },
        siteHosts() { return JSON.parse(values.get(SITE_HOSTS_KEY) || '[]'); },
    };
}

// Trimmed from the 2026-10-30 iPhone Safari capture
// (q=cast iron seasoning reddit): a name-only organic card carries only the
// "Site · qualifier" line, a comments/age line and the heading, all inside one
// /goto anchor. A cited card shows its host in the same span.ob9lvb slot.
function organicCard({ id, goto, site, meta = '30+ comments · 8 years ago', title = 'Result title' }) {
    return `<div id="${id}" class="Ww4FFb vt6azd">` +
        `<a class="UBFage" href="${goto}" ping="/url?sa=t&amp;source=web&amp;url=${goto.split('url=')[1]}">` +
        '<div data-snf="tyjmbc"><div class="kb0PBd cvP2Ce">' +
        '<span class="fJCbT"><img class="XNo5Ab" src="data:image/png;base64,iVBORw0KGgo=" alt=""></span>' +
        `<div class="GkAmnd ZaCDgb RES9jf">${site.replace(/ · /g, '&nbsp;·&nbsp;')}</div>` +
        `<span class="nC62wb VndCse ob9lvb" role="text">${meta}</span></div>` +
        `<div class="F0FGWb" aria-level="3" role="heading"><div role="link"><span>${title}</span></div></div>` +
        '</div></a></div>';
}

// uBlacklist match patterns follow WebExtension match patterns
// (developer.mozilla.org .../Match_patterns): scheme * is http or https, host
// *.example.com is example.com or any subdomain, * in the path is any text.
// uBlacklist's "Block this site" suggests *://*.<registrable domain>/* when
// "block whole sites" is on (its default), else *://<exact host>/*
// (iorate/ublacklist src/scripts/shared/interactive-ruleset.ts).
function matchesUBlacklistPattern(pattern, url) {
    const parts = pattern.match(/^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/);
    if (!parts) throw new Error(`not a match pattern: ${pattern}`);
    const [, scheme, host, pathGlob] = parts;
    const target = new URL(url);
    const schemeOk = scheme === '*' ? /^https?:$/.test(target.protocol) : target.protocol === `${scheme}:`;
    const hostOk = host === '*' ||
        (host.startsWith('*.')
            ? target.hostname === host.slice(2) || target.hostname.endsWith(host.slice(1))
            : target.hostname === host);
    const pathRe = new RegExp(`^${pathGlob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return schemeOk && hostOk && pathRe.test(target.pathname + target.search);
}

function proxyOf(root) {
    return root.querySelector(':scope > [data-ub-google-source-proxy] a');
}

async function settle(h, ms = 50) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await new Promise((resolve) =>
        h.window.requestAnimationFrame(() => h.window.requestAnimationFrame(resolve)),
    );
}

function createHarness({
    html,
    wjd = {},
    gmRequest = () => null,
    url = 'https://www.google.com/search?q=bridge-regression',
    userAgent = '',
    storage = createStorage(),
}) {
    const dom = new JSDOM(
        `<!doctype html><html><head></head><body>${html}</body></html>`,
        {
            url,
            runScripts: 'outside-only',
            pretendToBeVisual: true,
        },
    );
    const { window } = dom;

    if (userAgent) {
        Object.defineProperty(window.navigator, 'userAgent', {
            configurable: true,
            value: userAgent,
        });
    }

    Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
        configurable: true,
        get() { return this.textContent || ''; },
        set(value) { this.textContent = value; },
    });

    // Record every request path a userscript could use; the bridge must use none.
    const requests = [];
    const record = (api) => (details) => {
        requests.push({ api, url: details?.url ?? String(details) });
        return gmRequest(details);
    };
    window.W_jd = wjd;
    window.GM_xmlhttpRequest = record('GM_xmlhttpRequest');
    window.GM = { xmlHttpRequest: record('GM.xmlHttpRequest'), xmlhttpRequest: record('GM.xmlhttpRequest') };
    window.fetch = (input) => { requests.push({ api: 'fetch', url: String(input) }); return new Promise(() => {}); };
    window.navigator.sendBeacon = (target) => { requests.push({ api: 'sendBeacon', url: String(target) }); return true; };
    const nativeOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function open(method, target, ...rest) {
        requests.push({ api: 'XMLHttpRequest', url: String(target) });
        return nativeOpen.call(this, method, target, ...rest);
    };
    window.GM_getValue = (key, fallback) => storage.get(key, fallback);
    window.GM_setValue = (key, value) => storage.set(key, value);
    window.eval(source);

    return {
        window,
        document: window.document,
        api: window.__UB_GOOGLE_BRIDGE__,
        requests,
        storage,
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
    assert.match(source, /^\/\/ @version\s+13\.3\.0$/m);
    assert.match(source, /const VERSION = '13\.3\.0';/);
});

test('bridge has no network request path and no @connect grant', () => {
    const metadata = source.slice(0, source.indexOf('// ==/UserScript=='));
    assert.doesNotMatch(metadata, /@connect/);
    assert.doesNotMatch(metadata, /xmlhttprequest/i);
    for (const pattern of [/GM_xmlhttpRequest/, /GM\.xml[hH]ttpRequest/, /\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/]) {
        assert.doesNotMatch(source, pattern, `bridge source must not contain ${pattern}`);
    }
});

test('protected ordinary result is quarantined until uBlacklist classifies it', () => {
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

    assert.equal(h.window.getComputedStyle(root).display, 'none');
    assert.ok(proxy, 'bridge should still add the real-destination proxy for uBlacklist');
    assert.equal(proxy.href, target);
    assert.equal(h.api.resolveGoto(goto), target);

    h.document.documentElement.setAttribute('data-ub-hide-blocked-results', '1');
    root.setAttribute('data-ub-result', '1');
    assert.notEqual(h.window.getComputedStyle(root).display, 'none');

    root.setAttribute('data-ub-block', '1');
    assert.equal(h.window.getComputedStyle(root).display, 'none');

    root.removeAttribute('data-ub-block');
    root.removeAttribute('data-ub-result');
    assert.equal(h.window.getComputedStyle(root).display, 'none');
    h.close();
});

test('one unresolved result does not delay an independently classified sibling', () => {
    const h = createHarness({
        html:
            '<div id="rso">' +
            '<div id="pending" class="Ww4FFb"><a class="UBFage" href="https://blocked.example/"><h3>Pending</h3></a></div>' +
            '<div id="allowed" class="Ww4FFb" data-ub-result="1"><a class="UBFage" href="https://allowed.example/"><h3>Allowed</h3></a></div>' +
            '</div>',
    });

    assert.notEqual(h.window.getComputedStyle(h.document.getElementById('rso')).display, 'none');
    assert.equal(h.window.getComputedStyle(h.document.getElementById('pending')).display, 'none');
    assert.notEqual(h.window.getComputedStyle(h.document.getElementById('allowed')).display, 'none');
    h.close();
});

test('gap collapse does not hide an allowed sibling inside a shared mobile slot', () => {
    const goto = '/goto?url=opaque-massimo-shared-slot';
    const target = 'https://www.massimodutti.com/ca/men/jackets/leather-n1375';
    const h = createHarness({
        html:
            '<div id="slot" class="Rb7Fnd">' +
            '<div id="massimo" class="Ww4FFb vt6azd">' +
            `<a href="${goto}"><h3>Massimo Dutti</h3></a></div>` +
            '<div id="blocked" class="Ww4FFb vt6azd" data-ub-result="1" data-ub-block="1">' +
            '<a class="UBFage" href="https://blocked.example/"><h3>Blocked sibling</h3></a></div>' +
            '</div>',
        wjd: mapping(goto, target),
        userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 ' +
            '(KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    });

    const html = h.document.documentElement;
    const slot = h.document.getElementById('slot');
    html.setAttribute('data-ub-hide-blocked-results', '1');

    assert.notEqual(
        h.window.getComputedStyle(slot).display,
        'none',
        'a blocked sibling must not collapse the shared slot containing an allowed bridged result',
    );
    h.close();
});

test('mixed-domain module quarantines nested results independently instead of gating the parent', () => {
    const h = createHarness({
        html:
            '<div id="group" class="Ww4FFb">' +
            '<div id="reddit-item" class="xYkm8c"><a class="zReHs" href="https://www.reddit.com/r/Kombucha/">Reddit</a></div>' +
            '<div id="quora-item" class="xYkm8c"><a class="zReHs" href="https://www.quora.com/What-is-kombucha">Quora</a></div>' +
            '</div>',
    });

    const group = h.document.getElementById('group');
    const reddit = h.document.getElementById('reddit-item');
    const quora = h.document.getElementById('quora-item');

    assert.notEqual(h.window.getComputedStyle(group).display, 'none');
    assert.equal(h.window.getComputedStyle(reddit).display, 'none');
    assert.equal(h.window.getComputedStyle(quora).display, 'none');

    reddit.setAttribute('data-ub-result', '1');
    assert.notEqual(h.window.getComputedStyle(reddit).display, 'none');
    assert.equal(h.window.getComputedStyle(quora).display, 'none');
    h.close();
});

test('desktop g-blk knowledge result is not quarantined by the ordinary-result firewall', () => {
    const h = createHarness({
        html:
            '<div id="knowledge" class="vt6azd g-blk" data-kpid="vise:/m/01smm">' +
            '<div>Columbus, Ohio</div><a href="/search?q=Columbus+Ohio">Columbus Ohio</a></div>',
    });

    assert.notEqual(h.window.getComputedStyle(h.document.getElementById('knowledge')).display, 'none');
    h.close();
});

test('mobile ordinary result uses the mobile uBlacklist root contract', () => {
    const h = createHarness({
        html:
            '<div id="mobile-result" class="vt6azd g-blk">' +
            '<a class="UBFage" href="https://example.com/mobile"><h3>Mobile result</h3></a></div>',
        userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 ' +
            '(KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    });

    assert.equal(h.window.getComputedStyle(h.document.getElementById('mobile-result')).display, 'none');
    h.close();
});


test('mobile bridged result stays hidden until uBlacklist classifies it, then follows its verdict', async () => {
    const goto = '/goto?url=opaque-massimo-mobile-race';
    const target = 'https://www.massimodutti.com/ca/men/jackets/leather-n1375';
    const h = createHarness({
        html:
            '<div id="massimo" class="Ww4FFb vt6azd">' +
            `<a href="${goto}"><h3>Massimo Dutti</h3></a></div>` +
            '<div id="direct" class="Ww4FFb vt6azd">' +
            '<a href="https://www.blocked-example.com/page"><h3>Direct blocked</h3></a></div>',
        wjd: mapping(goto, target),
        userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 ' +
            '(KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    });

    const html = h.document.documentElement;
    html.setAttribute('data-ub-hide-blocked-results', '1');
    const massimo = h.document.getElementById('massimo');
    const direct = h.document.getElementById('direct');
    await new Promise((resolve) => setTimeout(resolve, 200));
    await new Promise((resolve) =>
        h.window.requestAnimationFrame(() => h.window.requestAnimationFrame(resolve)),
    );

    for (const root of [massimo, direct]) {
        assert.ok(root.querySelector(':scope > [data-ub-google-source-proxy] a'));
        assert.equal(root.getAttribute('data-ub-google-bridge-root'), '1');
        assert.equal(
            h.window.getComputedStyle(root).display,
            'none',
            'a bridged result must stay hidden while uBlacklist has not judged it yet (slow uBlacklist on iPhone)',
        );
    }

    direct.setAttribute('data-ub-result', '1');
    direct.setAttribute('data-ub-block', '1');
    assert.equal(h.window.getComputedStyle(direct).display, 'none');

    massimo.setAttribute('data-ub-result', '1');
    assert.notEqual(h.window.getComputedStyle(massimo).display, 'none');
    h.close();
});
test('explicit Images page result roots are not quarantined by the ordinary-result firewall', () => {
    const h = createHarness({
        html:
            '<div id="desktop-image" class="ivg-i"><a class="EZAeBe" href="https://images.example/a">A</a></div>' +
            '<div id="mobile-image" class="DyfMyc"><a href="https://images.example/b">B</a></div>',
        url: 'https://www.google.com/search?q=cats&udm=2',
    });

    assert.notEqual(h.window.getComputedStyle(h.document.getElementById('desktop-image')).display, 'none');
    assert.notEqual(h.window.getComputedStyle(h.document.getElementById('mobile-image')).display, 'none');
    h.close();
});

test('uBlacklist show-blocked toggle reveals classified blocked results', () => {
    const h = createHarness({
        html:
            '<div id="blocked" class="Ww4FFb" data-ub-result="1" data-ub-block="1">' +
            '<a class="UBFage" href="https://blocked.example/"><h3>Blocked</h3></a></div>' +
            '<div id="pending" class="Ww4FFb">' +
            '<a class="UBFage" href="https://pending.example/"><h3>Pending</h3></a></div>',
    });
    const html = h.document.documentElement;
    const blocked = h.document.getElementById('blocked');
    const pending = h.document.getElementById('pending');

    html.setAttribute('data-ub-hide-blocked-results', '1');
    assert.equal(h.window.getComputedStyle(blocked).display, 'none');

    html.removeAttribute('data-ub-hide-blocked-results');
    assert.notEqual(h.window.getComputedStyle(blocked).display, 'none');
    assert.equal(h.window.getComputedStyle(pending).display, 'none', 'unclassified results stay quarantined');

    html.setAttribute('data-ub-hide-blocked-results', '1');
    assert.equal(h.window.getComputedStyle(blocked).display, 'none');
    h.close();
});

test('mobile News tab quarantines only news cards, not their unclassified Ww4FFb wrappers', () => {
    const h = createHarness({
        html:
            '<div id="tools" class="Ww4FFb vt6azd"><a href="/search?q=x&tbm=nws&tbs=qdr:h">Past hour</a></div>' +
            '<div id="wrapper" class="Ww4FFb vt6azd">' +
            '<div id="card" data-news-cluster-id="1">' +
            '<a href="https://news.example/story"><div role="heading" aria-level="3">Story</div></a></div></div>',
        url: 'https://www.google.com/search?q=intel+14a&tbm=nws',
        userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 ' +
            '(KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    });
    const card = h.document.getElementById('card');

    assert.notEqual(h.window.getComputedStyle(h.document.getElementById('tools')).display, 'none');
    assert.notEqual(h.window.getComputedStyle(h.document.getElementById('wrapper')).display, 'none');
    assert.equal(h.window.getComputedStyle(card).display, 'none');

    card.setAttribute('data-ub-result', '1');
    assert.notEqual(h.window.getComputedStyle(card).display, 'none');
    h.close();
});

test('tabs without a uBlacklist result rule are not quarantined', () => {
    const h = createHarness({
        html: '<div id="shop" class="Ww4FFb vt6azd"><a href="https://shop.example/item">Item</a></div>',
        url: 'https://www.google.com/search?q=boots&udm=28',
    });
    assert.notEqual(h.window.getComputedStyle(h.document.getElementById('shop')).display, 'none');
    h.close();
});

test('unclassified protected result has no fail-open timer', async () => {
    const h = createHarness({
        html:
            '<div id="result" class="Ww4FFb">' +
            '<a class="UBFage" href="https://example.com/still-pending"><h3>Still pending</h3></a></div>',
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(h.window.getComputedStyle(h.document.getElementById('result')).display, 'none');
    h.close();
});

function hasPendingAttribute(document) {
    return Boolean(document.querySelector('[data-ub-google-bridge-pending], [data-ub-google-news-pending]'));
}

const capture = require('../fixtures/google-mobile-reddit-name-only.json');

// Google's own inline script form, as it stays in the DOM after Google has
// emptied the W_jd values.
function inlineDataScript(entries) {
    return `<script>(function(){var m=${JSON.stringify(entries)};var a=m;` +
        'if(window.W_jd)for(var b in a)window.W_jd[b]=a[b];else window.W_jd=a;})();</script>';
}

test('name-only, News and mixed pages make no requests and leave no result pending', async () => {
    const pages = [
        {
            name: 'All tab, captured name-only web and video results',
            html: `<div id="rso">${capture.webRoot}${capture.videoRoot}</div>${inlineDataScript(capture.entries)}`,
        },
        {
            name: 'All tab, name-only thread card with "More" links',
            html: '<div id="rso"><div id="thread" class="Ww4FFb vt6azd">' +
                organicCard({ id: 'thread-post', goto: '/goto?url=castiron-thread', site: 'Reddit · r/castiron' })
                    .replace(/^<div id="thread-post" class="Ww4FFb vt6azd">/, '').replace(/<\/div>$/, '') +
                '<a class="ddkIM" href="/goto?url=castiron-thread-answer-1"><span class="EJjDE">More</span></a>' +
                '<a class="ddkIM" href="/goto?url=castiron-thread-answer-2"><span class="EJjDE">More</span></a>' +
                '</div></div>',
        },
        {
            name: 'News tab',
            url: 'https://www.google.com/search?q=intel+14a&tbm=nws',
            html: '<div id="rso">' +
                '<div data-news-cluster-id="c1"><a href="/goto?url=news-1"><div>CBC News</div>' +
                '<div role="heading" aria-level="3">Story one</div></a></div>' +
                '<div data-news-cluster-id="c2"><a href="/goto?url=news-2"><div>The Globe and Mail</div>' +
                '<div role="heading" aria-level="3">Story two</div></a></div></div>',
        },
        {
            name: 'mixed page: cited, name-only, metadata-mapped, Top stories and direct results',
            wjd: mapping('/goto?url=mixed-mapped', 'https://finance.yahoo.com/article'),
            html: '<div id="rso">' +
                organicCard({ id: 'cited', goto: '/goto?url=mixed-cited', site: 'Massimo Dutti', meta: 'https://www.massimodutti.com › ca › men' }) +
                organicCard({ id: 'name-only', goto: '/goto?url=mixed-name-only', site: 'Reddit · r/castiron' }) +
                organicCard({ id: 'mapped', goto: '/goto?url=mixed-mapped', site: 'Yahoo Finance', meta: 'Markets' }) +
                '<div data-news-cluster-id="top-1"><a href="/goto?url=mixed-top-story"><div>CBC News</div>' +
                '<div role="heading" aria-level="3">Top story</div></a></div>' +
                '<div class="Ww4FFb vt6azd"><a class="zReHs" href="https://www.youtube.com/watch?v=Ddu89kmaeTk">YouTube · Vacuum Wars</a></div>' +
                '</div>',
        },
    ];

    for (const page of pages) {
        const h = createHarness({ ...page, userAgent: MOBILE_UA });
        await settle(h, 300);
        assert.deepEqual(h.requests, [], `${page.name}: the bridge must make no requests`);
        assert.equal(hasPendingAttribute(h.document), false, `${page.name}: no result may wait on the bridge`);
        h.close();
    }
});

test('captured name-only web result gets its domain from Google inline data, tied by jsdata before token', async () => {
    const h = createHarness({
        userAgent: MOBILE_UA,
        html: `<div id="rso">${capture.webRoot}</div>${inlineDataScript(capture.entries)}`,
    });
    await settle(h);

    const root = h.document.querySelector('#rso > .Ww4FFb');
    const proxy = proxyOf(root);
    assert.ok(proxy, 'the first result ties to its entry by jsdata although its href token differs');
    assert.equal(proxy.href, 'https://reddit.com/r/castiron/');
    assert.equal(proxy.parentElement.getAttribute('data-ub-google-bridge-inferred'), 'inline-data-path');
    assert.equal(h.window.getComputedStyle(root).display, 'none', 'bridged, so it waits for uBlacklist');
    root.setAttribute('data-ub-result', '1');
    assert.notEqual(h.window.getComputedStyle(root).display, 'none');
    h.close();
});

test('inline data captured at document start and tied by token still resolves after Google empties W_jd', async () => {
    const entry = capture.entries[capture.webEntryKey];
    const webRoot = capture.webRoot
        .replace(/ jsdata="l7Bhpb;_;[^"]+"/, '')
        .replace(/\/goto\?url=[A-Za-z0-9_-]+/g, entry[17]);
    const h = createHarness({
        userAgent: MOBILE_UA,
        html: `<div id="rso">${webRoot}</div>`,
        wjd: { [capture.webEntryKey]: entry },
    });
    for (const key of Object.keys(h.window.W_jd)) h.window.W_jd[key] = [];
    await settle(h);

    assert.equal(proxyOf(h.document.querySelector('#rso > .Ww4FFb')).href, 'https://reddit.com/r/castiron/');
    h.close();
});

test('captured video result without an inline domain uses the site name learned from an inline-data card', async () => {
    const storage = createStorage();
    const h = createHarness({
        userAgent: MOBILE_UA,
        storage,
        html: `<div id="rso">${capture.videoRoot}${capture.webRoot}</div>${inlineDataScript(capture.entries)}`,
    });
    await settle(h);

    const video = h.document.querySelector('#rso > .tRkSqb');
    const proxy = proxyOf(video);
    assert.ok(proxy, 'the earlier video card is bridged once a later web card teaches "Reddit"');
    assert.equal(proxy.href, 'https://reddit.com/r/castiron/');
    assert.equal(proxy.parentElement.getAttribute('data-ub-google-bridge-inferred'), 'site-name-path');
    assert.deepEqual(storage.siteHosts(), [['reddit', 'https://reddit.com']]);
    assert.deepEqual(h.requests, []);
    h.close();
});

test('the site-name line is parsed by text, never taken for the heading or the citation', async () => {
    // .GkAmnd (web) is in HEADING_SELECTOR and .Aozhyc (video) is not; the
    // span.ob9lvb citation holds "N comments · age" on forum cards.
    const storage = createStorage({ [SITE_HOSTS_KEY]: JSON.stringify([['reddit', 'https://reddit.com']]) });
    const h = createHarness({
        userAgent: MOBILE_UA,
        storage,
        html: `<div id="rso">${capture.webRoot}${capture.videoRoot}` +
            organicCard({ id: 'heading-site', goto: '/goto?url=heading-site', site: 'Reddit · r/Cooking', title: 'Massimo Dutti · r/notasub' }) +
            '</div>',
    });
    await settle(h);

    const [web, video] = h.document.querySelectorAll('#rso > .Ww4FFb');
    assert.equal(proxyOf(web).href, 'https://reddit.com/r/castiron/');
    assert.equal(proxyOf(video).href, 'https://reddit.com/r/castiron/');
    assert.equal(proxyOf(h.document.getElementById('heading-site')).href, 'https://reddit.com/r/Cooking/');
    assert.deepEqual(storage.siteHosts(), [['reddit', 'https://reddit.com']], 'comment counts are never learned as site names');
    h.close();
});

test('name-only result with no page-revealed destination is released to uBlacklist, not held for the bridge', async () => {
    const h = createHarness({ html: '<div id="rso"></div>', userAgent: MOBILE_UA });
    await settle(h);
    h.document.documentElement.setAttribute('data-ub-hide-blocked-results', '1');

    const holder = h.document.createElement('div');
    holder.innerHTML = organicCard({ id: 'late', goto: '/goto?url=late-name-only', site: 'Reddit · r/castiron' });
    h.document.getElementById('rso').appendChild(holder.firstElementChild);
    await settle(h);

    const root = h.document.getElementById('late');
    assert.equal(proxyOf(root), null, 'nothing on the page reveals this destination');
    assert.equal(hasPendingAttribute(h.document), false);
    assert.notEqual(
        h.window.getComputedStyle(root).display,
        'none',
        'an unresolved result is visible even if uBlacklist never marks a URL-less root',
    );

    root.setAttribute('data-ub-result', '1');
    assert.notEqual(h.window.getComputedStyle(root).display, 'none');
    root.setAttribute('data-ub-block', '1');
    assert.equal(h.window.getComputedStyle(root).display, 'none', 'uBlacklist can still hide it');
    assert.deepEqual(h.requests, []);
    h.close();
});

test('unresolved News-tab and Top stories cards are released whether or not uBlacklist marks them', async () => {
    const newsTab = createHarness({
        url: 'https://www.google.com/search?q=intel+14a&tbm=nws',
        userAgent: MOBILE_UA,
        html: '<div id="rso"><div id="news" data-news-cluster-id="c1">' +
            '<a href="/goto?url=news-unresolved"><div>CBC News</div>' +
            '<div role="heading" aria-level="3">Story</div></a></div></div>',
    });
    await settle(newsTab);
    const card = newsTab.document.getElementById('news');
    assert.equal(hasPendingAttribute(newsTab.document), false);
    assert.notEqual(newsTab.window.getComputedStyle(card).display, 'none');
    newsTab.document.documentElement.setAttribute('data-ub-hide-blocked-results', '1');
    card.setAttribute('data-ub-result', '1');
    card.setAttribute('data-ub-block', '1');
    assert.equal(newsTab.window.getComputedStyle(card).display, 'none');
    newsTab.close();

    const allTab = createHarness({
        userAgent: MOBILE_UA,
        html: '<div id="rso"><div id="story" data-news-cluster-id="top-1">' +
            '<a href="/goto?url=top-story-unresolved"><div>CBC News</div>' +
            '<div role="heading" aria-level="3">Top story</div></a></div></div>',
    });
    await settle(allTab);
    const story = allTab.document.getElementById('story');
    assert.equal(proxyOf(story), null);
    assert.equal(hasPendingAttribute(allTab.document), false);
    assert.notEqual(
        allTab.window.getComputedStyle(story).display,
        'none',
        'the Top stories SERPINFO rule reads only the bridge proxy, so uBlacklist may never mark this card',
    );
    assert.deepEqual(allTab.requests, []);
    allTab.close();
});

test('a site name learned from a cited card on the same page bridges name-only cards of that site', async () => {
    const storage = createStorage();
    const h = createHarness({
        userAgent: MOBILE_UA,
        storage,
        html: '<div id="rso">' +
            organicCard({ id: 'name-only', goto: '/goto?url=massimo-name-only', site: 'Massimo Dutti', meta: 'Leather jackets' }) +
            organicCard({ id: 'cited', goto: '/goto?url=massimo-cited', site: 'Massimo Dutti', meta: 'https://www.massimodutti.com › ca › men' }) +
            '</div>',
    });
    await settle(h);

    const cited = h.document.getElementById('cited');
    const nameOnly = h.document.getElementById('name-only');
    assert.equal(proxyOf(cited).href, 'https://www.massimodutti.com/');
    assert.ok(proxyOf(nameOnly), 'a name-only card earlier on the page is bridged once the name is learned');
    assert.equal(proxyOf(nameOnly).href, 'https://massimodutti.com/');
    assert.equal(proxyOf(nameOnly).parentElement.getAttribute('data-ub-google-bridge-inferred'), 'site-name');
    assert.equal(
        h.window.getComputedStyle(nameOnly).display,
        'none',
        'a bridged name-only card waits for uBlacklist like any other bridged result',
    );
    nameOnly.setAttribute('data-ub-result', '1');
    assert.notEqual(h.window.getComputedStyle(nameOnly).display, 'none');
    assert.deepEqual(storage.siteHosts(), [['massimo dutti', 'https://massimodutti.com']]);

    const holder = h.document.createElement('div');
    holder.innerHTML = organicCard({ id: 'more', goto: '/goto?url=massimo-more', site: 'Massimo Dutti', meta: 'Coats' });
    h.document.getElementById('rso').appendChild(holder.firstElementChild);
    await settle(h);
    assert.equal(proxyOf(h.document.getElementById('more')).href, 'https://massimodutti.com/');
    assert.equal(hasPendingAttribute(h.document), false);
    assert.deepEqual(h.requests, []);
    h.close();
});

test('a site name learned on an earlier page bridges later name-only cards, with r/<name> as a subreddit path', async () => {
    const storage = createStorage();
    const first = createHarness({
        storage,
        html:
            '<div id="group" class="Ww4FFb">' +
            '<div class="xYkm8c"><a class="zReHs" href="https://www.reddit.com/r/Kombucha/">Reddit</a></div>' +
            '<div class="xYkm8c"><a class="zReHs" href="https://www.quora.com/What-is-kombucha">Quora</a></div>' +
            '</div>' +
            organicCard({ id: 'instagram-cited', goto: '/goto?url=instagram-cited', site: 'Instagram', meta: 'https://www.instagram.com › breakingbad' }),
    });
    await settle(first);
    first.close();

    const second = createHarness({
        storage,
        userAgent: MOBILE_UA,
        html: '<div id="rso">' +
            organicCard({ id: 'reddit', goto: '/goto?url=reddit-name-only', site: 'Reddit · r/castiron' }) +
            organicCard({ id: 'instagram', goto: '/goto?url=instagram-name-only', site: 'Instagram · taylorswift', meta: 'Taylor Swift (@taylorswift)' }) +
            organicCard({ id: 'unknown', goto: '/goto?url=unknown-name-only', site: 'Serious Eats', meta: 'Recipes' }) +
            '</div>',
    });
    await settle(second);

    const reddit = proxyOf(second.document.getElementById('reddit'));
    assert.equal(reddit.href, 'https://reddit.com/r/castiron/');
    assert.equal(reddit.parentElement.getAttribute('data-ub-google-bridge-inferred'), 'site-name-path');
    const instagram = proxyOf(second.document.getElementById('instagram'));
    assert.equal(instagram.href, 'https://instagram.com/', 'a handle is not a reliable path, so only the host is used');
    assert.equal(instagram.parentElement.getAttribute('data-ub-google-bridge-inferred'), 'site-name');
    const unknown = second.document.getElementById('unknown');
    assert.equal(proxyOf(unknown), null);
    assert.notEqual(second.window.getComputedStyle(unknown).display, 'none');
    assert.deepEqual(second.requests, []);
    second.close();
});

test('learned site names live under one bounded storage key, oldest out first', async () => {
    const preload = Array.from({ length: 500 }, (_, i) => [`site ${i}`, `https://site${i}.example`]);
    const storage = createStorage({ [SITE_HOSTS_KEY]: JSON.stringify(preload) });
    const h = createHarness({
        storage,
        userAgent: MOBILE_UA,
        html: '<div id="rso">' +
            organicCard({ id: 'cited', goto: '/goto?url=bound-cited', site: 'Massimo Dutti', meta: 'https://www.massimodutti.com › ca' }) +
            organicCard({ id: 'stored', goto: '/goto?url=bound-stored', site: 'Site 499 · Forum', meta: 'Thread' }) +
            '</div>',
    });
    await settle(h);

    const stored = storage.siteHosts();
    assert.deepEqual([...storage.values.keys()], [SITE_HOSTS_KEY]);
    assert.equal(stored.length, 500);
    assert.deepEqual(stored.at(-1), ['massimo dutti', 'https://massimodutti.com']);
    assert.equal(stored.some(([name]) => name === 'site 0'), false, 'the oldest entry is evicted');
    assert.ok(stored.some(([name]) => name === 'site 1'));
    assert.equal(proxyOf(h.document.getElementById('stored')).href, 'https://site499.example/');
    h.close();

    const corrupt = createStorage({ [SITE_HOSTS_KEY]: '{not json' });
    const c = createHarness({
        storage: corrupt,
        userAgent: MOBILE_UA,
        html: organicCard({ id: 'cited', goto: '/goto?url=corrupt-cited', site: 'Massimo Dutti', meta: 'https://www.massimodutti.com › ca' }),
    });
    await settle(c);
    assert.deepEqual(corrupt.siteHosts(), [['massimo dutti', 'https://massimodutti.com']]);
    c.close();
});

test('a site name seen with unrelated hosts is never used, while www. and m. hosts give one domain in any order', async () => {
    const youtubeCards = [
        '<div class="Ww4FFb vt6azd"><a class="zReHs" href="https://m.youtube.com/watch?v=one">YouTube · Vacuum Wars</a></div>',
        '<div class="Ww4FFb vt6azd"><a class="zReHs" href="https://www.youtube.com/watch?v=two">YouTube · Project Farm</a></div>',
    ];
    for (const order of [youtubeCards, [...youtubeCards].reverse()]) {
        const storage = createStorage();
        const h = createHarness({
            storage,
            userAgent: MOBILE_UA,
            html: '<div id="rso">' +
                organicCard({ id: 'globe-a', goto: '/goto?url=globe-a', site: 'The Globe', meta: 'https://www.theglobe.com › news' }) +
                organicCard({ id: 'globe-b', goto: '/goto?url=globe-b', site: 'The Globe', meta: 'https://theglobe.net.au › story' }) +
                organicCard({ id: 'globe-name-only', goto: '/goto?url=globe-name-only', site: 'The Globe · Opinion', meta: 'Column' }) +
                order.join('') +
                organicCard({ id: 'youtube-name-only', goto: '/goto?url=youtube-name-only', site: 'YouTube · Taylor Swift', meta: '2 years ago' }) +
                '</div>',
        });
        await settle(h);

        const globe = h.document.getElementById('globe-name-only');
        assert.equal(proxyOf(globe), null, 'an ambiguous site name must not pick a host');
        assert.notEqual(h.window.getComputedStyle(globe).display, 'none');
        const youtube = proxyOf(h.document.getElementById('youtube-name-only')).href;
        assert.equal(youtube, 'https://youtube.com/', 'the inferred host does not depend on which card came first');
        assert.ok(matchesUBlacklistPattern('*://*.youtube.com/*', youtube));
        assert.deepEqual(
            Object.fromEntries(storage.siteHosts()),
            { 'the globe': '', youtube: 'https://youtube.com' },
            'the conflict is remembered so a later page cannot pick either host',
        );
        h.close();
    }
});

test('a youtube.com whole-site rule matches the bare, www. and m. forms; an exact www. host rule matches only www.', () => {
    for (const url of ['https://youtube.com/', 'https://www.youtube.com/watch?v=1', 'https://m.youtube.com/watch?v=1']) {
        assert.equal(matchesUBlacklistPattern('*://*.youtube.com/*', url), true, url);
    }
    assert.equal(matchesUBlacklistPattern('*://www.youtube.com/*', 'https://www.youtube.com/watch?v=1'), true);
    assert.equal(matchesUBlacklistPattern('*://www.youtube.com/*', 'https://youtube.com/'), false);
    assert.equal(matchesUBlacklistPattern('*://www.youtube.com/*', 'https://m.youtube.com/watch?v=1'), false);
    assert.equal(matchesUBlacklistPattern('*://*.youtube.com/*', 'https://notyoutube.com/'), false);
});

test('malformed inline result data is ignored without throwing', async () => {
    const goto = '/goto?url=malformed-inline';
    const broken = ['', '!!!', 'Ct0BL2dvdG8', 'GgAiAA', 'CgQ', '////', 'Cv____8P'];
    const entries = Object.fromEntries(broken.map((blob, i) => {
        const entry = new Array(33).fill(null);
        entry[17] = goto;
        entry[22] = [...new Array(12).fill(null), blob];
        return [`broken-${i}`, entry];
    }));
    entries['not-an-array'] = { 17: goto, 22: 'x' };
    const h = createHarness({
        userAgent: MOBILE_UA,
        html: '<div id="rso">' +
            organicCard({ id: 'malformed', goto, site: 'Reddit · r/castiron' }) +
            `</div>${inlineDataScript(entries)}`,
        wjd: entries,
    });
    await settle(h);

    const root = h.document.getElementById('malformed');
    assert.equal(proxyOf(root), null);
    assert.notEqual(h.window.getComputedStyle(root).display, 'none');
    h.close();
});


test('mobile opaque result uses its displayed destination URL without any request', async () => {
    const goto = '/goto?url=opaque-massimo-displayed-url';
    let attempts = 0;
    const h = createHarness({
        html:
            '<div id="massimo-displayed" class="Ww4FFb vt6azd">' +
            `<a class="UBFage" href="${goto}"><span>Massimo Dutti</span><span>https://www.massimodutti.com</span><h3>Men\'s Leather Jackets</h3></a>` +
            '</div>',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Mobile',
        gmRequest() {
            attempts += 1;
            return { abort() {} };
        },
    });

    await new Promise((resolve) => setTimeout(resolve, 40));

    const root = h.document.getElementById('massimo-displayed');
    const proxy = root.querySelector(':scope > [data-ub-google-source-proxy] a');
    assert.ok(proxy, 'visible result URL should bridge the result without waiting for /goto resolution');
    assert.equal(proxy.href, 'https://www.massimodutti.com/');
    assert.equal(h.api.resolveGoto(goto), 'https://www.massimodutti.com/');
    assert.equal(attempts, 0, 'the bridge makes no request when the displayed destination is available');
    h.close();
});


test('opaque result does not mistake a snippet URL for the displayed destination', async () => {
    const goto = '/goto?url=opaque-reddit-snippet-url';
    const h = createHarness({
        html:
            '<div id="reddit-snippet" class="Ww4FFb vt6azd">' +
            `<a class="UBFage" href="${goto}"><h3>Reddit</h3><span>Discussion mentions https://www.massimodutti.com in the comments</span></a>` +
            '</div>',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Mobile',
        gmRequest() {
            return { abort() {} };
        },
    });

    await new Promise((resolve) => setTimeout(resolve, 40));

    const root = h.document.getElementById('reddit-snippet');
    assert.equal(root.querySelector(':scope > [data-ub-google-source-proxy] a'), null);
    assert.equal(h.api.resolveGoto(goto), '');
    h.close();
});

test('metadata mapping still resolves a result after Google replaces the original opaque link', async () => {
    const goto = '/goto?url=opaque-massimo-detached-metadata';
    const target = 'https://www.massimodutti.com/ca/men/jackets/leather-n1375';
    const h = createHarness({
        html:
            '<div id="massimo-detached-metadata" class="Ww4FFb vt6azd">' +
            `<a id="massimo-detached-metadata-link" class="UBFage" href="${goto}">Massimo Dutti · Leather jacket</a>` +
            '</div>',
    });

    const root = h.document.getElementById('massimo-detached-metadata');
    h.document.getElementById('massimo-detached-metadata-link').remove();

    h.window.dispatchEvent(new h.window.CustomEvent('__UB_GOOGLE_WJD_UPDATE__', {
        detail: JSON.stringify(mapping(goto, target)),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const proxy = root.querySelector(':scope > [data-ub-google-source-proxy] a');
    assert.ok(proxy, 'the still-connected result root should receive metadata resolution after anchor replacement');
    assert.equal(proxy.href, target);

    h.close();
});

test('direct mobile-style subreddit result with unsupported anchor class gets exact-path proxy', () => {
    const target = 'https://www.reddit.com/r/breakingbad/';
    const h = createHarness({
        html:
            '<div id="rso"><div class="MjjYud">' +
            '<div id="reddit" class="Ww4FFb vt6azd">' +
            '<a class="UBFage" href="https://www.reddit.com/">Reddit</a>' +
            '<a class="zReHs" href="' + target + '">' +
            'Reddit · r/breakingbad 3M+ followers r/breakingbad</a>' +
            '</div></div></div>',
    });

    const root = h.document.getElementById('reddit');
    const proxy = root.querySelector(':scope > [data-ub-google-source-proxy="direct"] a');
    assert.ok(proxy, 'unsupported direct Google anchor should receive a uBlacklist-readable proxy');
    assert.equal(proxy.href, target);
    assert.equal(root.getAttribute('data-ub-google-bridge-root'), '1');
    h.close();
});

test('late href mutation on an unsupported Google anchor is bridged immediately', async () => {
    const target = 'https://www.quora.com/What-is-kombucha';
    const h = createHarness({
        html:
            '<div id="result" class="Ww4FFb vt6azd">' +
            '<a id="late-link" class="zReHs">Quora · What is kombucha?</a>' +
            '</div>',
    });

    const link = h.document.getElementById('late-link');
    link.setAttribute('href', target);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const root = h.document.getElementById('result');
    const proxy = root.querySelector(':scope > [data-ub-google-source-proxy="direct"] a');
    assert.ok(proxy, 'href mutation should trigger the bridge without waiting for unrelated DOM changes');
    assert.equal(proxy.href, target);
    assert.equal(root.getAttribute('data-ub-google-bridge-root'), '1');
    h.close();
});

test('late href mutation in a mixed-domain discussion module bridges only the nested result', async () => {
    const target = 'https://www.quora.com/What-is-kombucha';
    const h = createHarness({
        html:
            '<div id="discussion" class="Ww4FFb vt6azd">' +
            '<div id="reddit-item" class="xYkm8c">' +
            '<a class="zReHs" href="https://www.reddit.com/r/Kombucha/">Reddit</a>' +
            '</div>' +
            '<div id="quora-item" class="xYkm8c">' +
            '<a id="quora-link" class="zReHs">Quora · What is kombucha?</a>' +
            '</div>' +
            '</div>',
    });

    const link = h.document.getElementById('quora-link');
    link.setAttribute('href', target);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const group = h.document.getElementById('discussion');
    const item = h.document.getElementById('quora-item');
    const proxy = item.querySelector(':scope > [data-ub-google-source-proxy="direct"] a');
    assert.ok(proxy, 'nested discussion result should get its own proxy after href mutation');
    assert.equal(proxy.href, target);
    assert.equal(item.getAttribute('data-ub-google-bridge-root'), '1');
    assert.equal(group.querySelector(':scope > [data-ub-google-source-proxy]'), null);
    h.close();
});

test('Google /url wrapper with unsupported anchor class gets exact-path proxy', () => {
    const target = 'https://www.reddit.com/r/betterCallSaul/';
    const wrapped = '/url?q=' + encodeURIComponent(target);
    const h = createHarness({
        html:
            '<div id="result" class="Ww4FFb vt6azd">' +
            '<a class="zReHs" href="' + wrapped + '">Reddit · r/betterCallSaul</a>' +
            '</div>',
    });

    const proxy = h.document.querySelector('#result > [data-ub-google-source-proxy="direct"] a');
    assert.ok(proxy);
    assert.equal(proxy.href, target);
    h.close();
});

test('uBlacklist-native direct URL does not receive a redundant proxy', () => {
    const h = createHarness({
        html:
            '<div id="result" class="Ww4FFb vt6azd">' +
            '<a class="UBFage" href="https://example.com/article"><h3>Example</h3></a>' +
            '</div>',
    });

    assert.equal(h.document.querySelector('[data-ub-google-source-proxy]'), null);
    h.close();
});

test('mixed-domain direct result root is not collapsed into one proxy destination', () => {
    const h = createHarness({
        html:
            '<div id="group" class="Ww4FFb vt6azd">' +
            '<a class="zReHs" href="https://www.reddit.com/r/breakingbad/">Reddit</a>' +
            '<a class="zReHs" href="https://www.instagram.com/breakingbad/">Instagram</a>' +
            '</div>',
    });

    assert.equal(h.document.querySelector('[data-ub-google-source-proxy]'), null);
    h.close();
});

test('ordinary multi-result root without nested result semantics makes no requests and adds no proxy', async () => {
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


test('YouTube result is exposed to uBlacklist through an exact bridge proxy', () => {
    const target = 'https://www.youtube.com/watch?v=Ddu89kmaeTk';
    const h = createHarness({
        html:
            '<div id="rso"><div class="MjjYud">' +
            '<div id="youtube" class="Ww4FFb vt6azd">' +
            '<a class="zReHs" href="' + target + '">YouTube · Vacuum Wars</a>' +
            '</div></div></div>',
    });

    const root = h.document.getElementById('youtube');
    const proxy = root.querySelector(':scope > [data-ub-google-source-proxy="direct"] a');
    assert.ok(proxy, 'YouTube result should receive a uBlacklist-readable exact-destination proxy');
    assert.equal(proxy.href, target);
    assert.equal(root.getAttribute('data-ub-google-bridge-root'), '1');
    h.close();
});

test('YouTube Music keeps its exact host when exposed to uBlacklist', () => {
    const target = 'https://music.youtube.com/playlist?list=spatial-audio';
    const h = createHarness({
        html:
            '<div id="rso"><div class="MjjYud">' +
            '<div id="youtube-music" class="Ww4FFb vt6azd">' +
            '<a class="zReHs" href="' + target + '">YouTube Music · SpatialAudio</a>' +
            '</div></div></div>',
    });

    const root = h.document.getElementById('youtube-music');
    const proxy = root.querySelector(':scope > [data-ub-google-source-proxy="direct"] a');
    assert.ok(proxy, 'YouTube Music should receive a uBlacklist-readable exact-destination proxy');
    assert.equal(proxy.href, target);
    assert.equal(new URL(proxy.href).hostname, 'music.youtube.com');
    assert.equal(root.getAttribute('data-ub-google-bridge-root'), '1');
    h.close();
});
