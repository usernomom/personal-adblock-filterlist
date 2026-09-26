const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'google_news_ublacklist_bridge.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');

function createHarness({
    html,
    wjd = {},
    gmRequest = () => null,
    url = 'https://www.google.com/search?q=bridge-regression',
    userAgent = '',
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
    assert.match(source, /^\/\/ @version\s+13\.2\.0$/m);
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

test('dynamic opaque result stays quarantined after provisional uBlacklist classification until bridge resolution', async () => {
    const goto = '/goto?url=opaque-more-results';
    const target = 'https://www.linkedin.com/in/example/';
    const requests = [];
    let resolveRequest = null;
    const h = createHarness({
        html: '<div id="rso"></div>',
        gmRequest(details) {
            requests.push(details.url);
            resolveRequest = () => details.onload({ finalUrl: target, status: 200 });
            return { abort() {} };
        },
    });

    const root = h.document.createElement('div');
    root.id = 'late-result';
    root.className = 'Ww4FFb vt6azd';
    root.innerHTML = `<a class="UBFage" href="${goto}"><h3>Late opaque result</h3></a>`;
    h.document.getElementById('rso').appendChild(root);

    await new Promise((resolve) => h.window.requestAnimationFrame(resolve));
    root.setAttribute('data-ub-result', '1');

    assert.equal(
        h.window.getComputedStyle(root).display,
        'none',
        'provisional uBlacklist processing must not release an opaque result before its real destination is bridged',
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(requests.length, 1);
    assert.equal(requests[0], `https://www.google.com${goto}`);
    assert.equal(typeof resolveRequest, 'function');

    resolveRequest();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) =>
        h.window.requestAnimationFrame(() => h.window.requestAnimationFrame(resolve)),
    );

    const proxy = root.querySelector(':scope > [data-ub-google-source-proxy] a');
    assert.ok(proxy);
    assert.equal(proxy.href, target);
    assert.notEqual(
        h.window.getComputedStyle(root).display,
        'none',
        'allowed result should release after the bridge has resolved its destination',
    );
    h.close();
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

test('opaque fallback follows redirects normally and accepts onloadend responseURL', async () => {
    const goto = '/goto?url=opaque-worldnews';
    const target = 'https://www.reddit.com/r/worldnews/comments/test/post/';
    const requests = [];
    const h = createHarness({
        html:
            '<div id="worldnews" class="Ww4FFb vt6azd">' +
            `<a class="UBFage" href="${goto}">Reddit · r/worldnews</a>` +
            '</div>',
        gmRequest(details) {
            requests.push(details);
            setTimeout(() => details.onloadend({ responseURL: target, status: 200 }), 0);
            return { abort() {} };
        },
    });

    await new Promise((resolve) => setTimeout(resolve, 180));

    const proxy = h.document.querySelector('#worldnews > [data-ub-google-source-proxy] a');
    assert.ok(proxy);
    assert.equal(proxy.href, target);
    assert.equal(requests.length, 1);
    assert.equal('redirect' in requests[0], false, 'portable fallback must not request manual redirects');
    h.close();
});

test('ordinary opaque fallback retries up to five total attempts', async () => {
    const goto = '/goto?url=opaque-retry';
    const target = 'https://www.reddit.com/r/worldnews/comments/retry/post/';
    let attempts = 0;
    const h = createHarness({
        html:
            '<div id="retry" class="Ww4FFb vt6azd">' +
            `<a class="UBFage" href="${goto}">Reddit · r/worldnews</a>` +
            '</div>',
        gmRequest(details) {
            attempts += 1;
            const currentAttempt = attempts;
            setTimeout(() => {
                if (currentAttempt < 5) details.onerror({});
                else details.onloadend({ responseURL: target, status: 200 });
            }, 0);
            return { abort() {} };
        },
    });

    await new Promise((resolve) => setTimeout(resolve, 950));

    const proxy = h.document.querySelector('#retry > [data-ub-google-source-proxy] a');
    assert.ok(proxy, 'fifth bounded attempt should still recover the result');
    assert.equal(proxy.href, target);
    assert.equal(attempts, 5);
    h.close();
});

test('Violentmonkey response hash artifact is stripped from bridge proxy', async () => {
    const goto = '/goto?url=opaque-vmxhr';
    const clean = 'https://www.reddit.com/r/worldnews/comments/hash/post/';
    const h = createHarness({
        html:
            '<div id="vmxhr" class="Ww4FFb vt6azd">' +
            `<a class="UBFage" href="${goto}">Reddit · r/worldnews</a>` +
            '</div>',
        gmRequest(details) {
            setTimeout(() => details.onload({ finalUrl: `${clean}#VMxhrAbCdEf`, status: 200 }), 0);
            return { abort() {} };
        },
    });

    await new Promise((resolve) => setTimeout(resolve, 180));

    const proxy = h.document.querySelector('#vmxhr > [data-ub-google-source-proxy] a');
    assert.ok(proxy);
    assert.equal(proxy.href, clean);
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
