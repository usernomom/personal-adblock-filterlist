'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'reddit_safari_back_button_fix.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');

function makeDom(url, options = {}) {
    const {
        navigationType = 'navigate',
        historyLength = 2,
        now = 10_000,
        stored = {},
        immediateTimers = true,
    } = options;

    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url,
        runScripts: 'outside-only',
    });

    const calls = {
        close: 0,
        back: 0,
        forward: 0,
        timers: [],
        logs: [],
    };

    for (const [key, value] of Object.entries(stored)) {
        dom.window.sessionStorage.setItem(key, String(value));
    }

    dom.window.GM = {
        log(...args) {
            calls.logs.push(args);
        },
    };

    dom.window.performance.getEntriesByType = type =>
        type === 'navigation' ? [{ type: navigationType }] : [];

    Object.defineProperty(dom.window.history, 'length', {
        configurable: true,
        get: () => historyLength,
    });

    dom.window.close = () => {
        calls.close += 1;
    };

    dom.window.history.back = () => {
        calls.back += 1;
    };

    dom.window.history.forward = () => {
        calls.forward += 1;
    };

    dom.window.Date.now = () => now;

    dom.window.setTimeout = (fn, delay) => {
        calls.timers.push(delay);
        if (immediateTimers) fn();
        return calls.timers.length;
    };

    dom.window.eval(source);
    return { dom, calls };
}

function storageSnapshot(h) {
    const out = {};
    for (let i = 0; i < h.dom.window.sessionStorage.length; i += 1) {
        const key = h.dom.window.sessionStorage.key(i);
        out[key] = h.dom.window.sessionStorage.getItem(key);
    }
    return out;
}

function closeHarness(h) {
    h.dom.window.close = () => {};
    h.dom.window.document.close();
}

test('canonical Reddit userscript packaging is installable and versioned', () => {
    const bytes = fs.readFileSync(scriptPath);
    const sentinel = Buffer.from('// ==UserScript==', 'utf8');
    assert.equal(bytes.subarray(0, sentinel.length).compare(sentinel), 0);
    assert.match(source, /^\/\/ @name\s+Reddit Safari Back Button Fix$/m);
    assert.match(source, /^\/\/ @namespace\s+local\.reddit\.safari\.backfix$/m);
    assert.match(source, /^\/\/ @version\s+1\.3\.5-macaque-clean$/m);

    const raw = 'https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js';
    assert.ok(source.includes(`// @downloadURL  ${raw}`));
    assert.ok(source.includes(`// @updateURL    ${raw}`));
    assert.doesNotThrow(() => new vm.Script(source, { filename: scriptPath }));
});

test('observed Safari challenge navigate is recorded but not mistaken for normal Reddit', () => {
    const url = 'https://www.reddit.com/r/intelstock/new/?solution=bec6449f2b5fee12bec6449f2b5fee12&js_challenge=1&jsc_token=7afd7253fec22262ff1c52b1703fe9ec2e159b907dba7828afc4abb6390a88bd&jsc_orig_r=';
    const h = makeDom(url, { navigationType: 'navigate', historyLength: 2 });

    assert.equal(h.dom.window.location.href, url);
    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.back, 0);
    assert.equal(h.calls.forward, 0);
    assert.equal(h.dom.window.sessionStorage.getItem('__reddit_backfix_pending_target__'), '/r/intelstock/new');
    assert.equal(h.dom.window.sessionStorage.getItem('__reddit_backfix_armed_target__'), '');
    assert.equal(h.dom.window.sessionStorage.getItem('__reddit_backfix_normal_reddit_seen__'), '');
    closeHarness(h);
});

test('challenge -> clean Reddit -> challenge navigate is recognized as the Safari zombie return', () => {
    const challenge1 = makeDom(
        'https://www.reddit.com/r/intelstock/new/?solution=first&js_challenge=1&jsc_token=token1&jsc_orig_r=',
        { navigationType: 'navigate', historyLength: 2 },
    );
    const afterChallenge = storageSnapshot(challenge1);
    closeHarness(challenge1);

    const cleanReddit = makeDom('https://www.reddit.com/r/intelstock/new/', {
        navigationType: 'navigate',
        historyLength: 3,
        stored: afterChallenge,
        now: 12_000,
    });
    assert.equal(cleanReddit.dom.window.sessionStorage.getItem('__reddit_backfix_pending_target__'), '');
    assert.equal(cleanReddit.dom.window.sessionStorage.getItem('__reddit_backfix_armed_target__'), '/r/intelstock/new');
    assert.equal(
        cleanReddit.dom.window.sessionStorage.getItem('__reddit_backfix_normal_reddit_seen__'),
        '/r/intelstock/new/',
    );
    const armedState = storageSnapshot(cleanReddit);
    closeHarness(cleanReddit);

    const zombieReturn = makeDom(
        'https://www.reddit.com/r/intelstock/new/?solution=second&js_challenge=1&jsc_token=token2&jsc_orig_r=',
        {
            navigationType: 'navigate',
            historyLength: 3,
            stored: armedState,
            now: 14_000,
        },
    );

    assert.equal(zombieReturn.dom.window.location.href, 'https://www.reddit.com/r/intelstock/new/');
    assert.equal(zombieReturn.calls.close, 1);
    assert.deepEqual(zombieReturn.calls.timers, [350, 80]);
    assert.equal(zombieReturn.calls.back, 1);
    assert.equal(zombieReturn.calls.forward, 0);
    assert.equal(zombieReturn.dom.window.sessionStorage.getItem('__reddit_backfix_armed_target__'), '');
    closeHarness(zombieReturn);
});

test('current and legacy challenge parameters are all removed when a trap is escaped', () => {
    const h = makeDom(
        'https://www.reddit.com/r/test/?solution=a&js_challenge=1&token=old&jsc_token=new&solution=b&jsc_orig_r=&keep=yes',
        { navigationType: 'back_forward', historyLength: 3 },
    );

    assert.equal(h.dom.window.location.href, 'https://www.reddit.com/r/test/?keep=yes');
    assert.equal(h.calls.close, 1);
    assert.equal(h.calls.back, 1);
    assert.equal(h.calls.forward, 0);
    closeHarness(h);
});
test('a different fresh challenge target does not reuse a stale arm', () => {
    const h = makeDom('https://www.reddit.com/r/other/new/?js_challenge=1&jsc_token=x', {
        navigationType: 'navigate',
        historyLength: 4,
        stored: {
            __reddit_backfix_state_version__: '1.3.5-macaque-clean',
            __reddit_backfix_armed_target__: '/r/intelstock/new',
        },
    });

    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.back, 0);
    assert.equal(h.dom.window.sessionStorage.getItem('__reddit_backfix_pending_target__'), '/r/other/new');
    assert.equal(h.dom.window.sessionStorage.getItem('__reddit_backfix_armed_target__'), '/r/intelstock/new');
    closeHarness(h);
});

test('challenge back_forward is escaped even without an arm', () => {
    const h = makeDom(
        'https://www.reddit.com/r/intelstock/new/?solution=x&js_challenge=1&jsc_token=y&jsc_orig_r=',
        { navigationType: 'back_forward', historyLength: 6 },
    );

    assert.equal(h.dom.window.location.href, 'https://www.reddit.com/r/intelstock/new/');
    assert.equal(h.calls.close, 1);
    assert.equal(h.calls.back, 1);
    assert.equal(h.calls.forward, 0);
    closeHarness(h);
});

test('BFCache pageshow restores an armed challenge and escapes backward', () => {
    const h = makeDom(
        'https://www.reddit.com/r/intelstock/new/?solution=x&js_challenge=1&jsc_token=y&jsc_orig_r=',
        {
            navigationType: 'navigate',
            historyLength: 6,
            stored: {
                __reddit_backfix_state_version__: '1.3.5-macaque-clean',
                __reddit_backfix_armed_target__: '/r/intelstock/new',
            },
        },
    );

    // Because the target is already armed, Safari's misleading navigate is enough.
    assert.equal(h.calls.close, 1);
    assert.equal(h.calls.back, 1);
    closeHarness(h);
});

test('BFCache pageshow on an ordinary Reddit document is left alone', () => {
    const h = makeDom('https://www.reddit.com/r/test/new/?sort=new', {
        navigationType: 'navigate',
        historyLength: 6,
    });

    const event = new h.dom.window.PageTransitionEvent('pageshow', { persisted: true });
    h.dom.window.dispatchEvent(event);

    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.back, 0);
    assert.equal(h.calls.forward, 0);
    closeHarness(h);
});

test('challenge-bearing popstate escapes backward', () => {
    const h = makeDom('https://www.reddit.com/r/test/', {
        navigationType: 'navigate',
        historyLength: 6,
    });

    h.dom.window.history.replaceState(
        {},
        '',
        '/r/test/?solution=x&js_challenge=1&jsc_token=y&jsc_orig_r=',
    );
    h.dom.window.dispatchEvent(new h.dom.window.PopStateEvent('popstate'));

    assert.equal(h.dom.window.location.href, 'https://www.reddit.com/r/test/');
    assert.equal(h.calls.close, 1);
    assert.equal(h.calls.back, 1);
    assert.equal(h.calls.forward, 0);
    closeHarness(h);
});

test('ordinary back_forward with history longer than two is left alone', () => {
    const url = 'https://www.reddit.com/r/test/new/?sort=new';
    const h = makeDom(url, { navigationType: 'back_forward', historyLength: 3 });

    assert.equal(h.dom.window.location.href, url);
    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.back, 0);
    assert.equal(h.calls.forward, 0);
    closeHarness(h);
});

test('legacy normal-looking short-history back_forward escapes backward', () => {
    const h = makeDom('https://www.reddit.com/r/test/new/', {
        navigationType: 'back_forward',
        historyLength: 2,
    });

    assert.equal(h.calls.close, 1);
    assert.equal(h.calls.back, 1);
    assert.equal(h.calls.forward, 0);
    closeHarness(h);
});

test('1200ms throttle prevents repeated trap actions', () => {
    const h = makeDom('https://www.reddit.com/r/test/?jsc_token=x', {
        navigationType: 'back_forward',
        historyLength: 2,
        now: 10_000,
        stored: {
            __reddit_backfix_state_version__: '1.3.5-macaque-clean',
            __reddit_backfix_action_count__: 1,
            __reddit_backfix_last_action_at__: 9_500,
        },
    });

    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.back, 0);
    assert.equal(h.dom.window.sessionStorage.getItem('__reddit_backfix_action_count__'), '1');
    closeHarness(h);
});

test('upgrade resets stale per-tab action and arm state', () => {
    const h = makeDom('https://www.reddit.com/r/test/?jsc_token=x', {
        navigationType: 'navigate',
        historyLength: 2,
        stored: {
            __reddit_backfix_state_version__: '1.3.4-macaque-clean',
            __reddit_backfix_action_count__: 4,
            __reddit_backfix_last_action_at__: 9_900,
            __reddit_backfix_armed_target__: '/r/test',
        },
    });

    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.back, 0);
    assert.equal(h.dom.window.sessionStorage.getItem('__reddit_backfix_action_count__'), '0');
    assert.equal(h.dom.window.sessionStorage.getItem('__reddit_backfix_armed_target__'), '');
    assert.equal(h.dom.window.sessionStorage.getItem('__reddit_backfix_pending_target__'), '/r/test');
    assert.equal(
        h.dom.window.sessionStorage.getItem('__reddit_backfix_state_version__'),
        '1.3.5-macaque-clean',
    );
    closeHarness(h);
});

test('four-action cap prevents an infinite escape loop', () => {
    const h = makeDom('https://www.reddit.com/r/test/?jsc_token=x', {
        navigationType: 'back_forward',
        historyLength: 2,
        stored: {
            __reddit_backfix_state_version__: '1.3.5-macaque-clean',
            __reddit_backfix_action_count__: 4,
            __reddit_backfix_last_action_at__: 0,
        },
    });

    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.back, 0);
    assert.equal(h.calls.forward, 0);
    closeHarness(h);
});
