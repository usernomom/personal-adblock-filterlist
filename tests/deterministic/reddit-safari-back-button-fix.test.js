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
        beforeScript = () => {},
    } = options;

    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url,
        runScripts: 'outside-only',
    });

    const calls = {
        close: 0,
        forward: 0,
        replaceState: [],
        timers: [],
    };

    dom.window.performance.getEntriesByType = type =>
        type === 'navigation' ? [{ type: navigationType }] : [];

    let currentHistoryLength = historyLength;
    Object.defineProperty(dom.window.history, 'length', {
        configurable: true,
        get: () => currentHistoryLength,
    });

    const originalReplaceState = dom.window.history.replaceState.bind(dom.window.history);
    dom.window.history.replaceState = (state, title, nextUrl) => {
        calls.replaceState.push(nextUrl);
        return originalReplaceState(state, title, nextUrl);
    };

    dom.window.close = () => {
        calls.close += 1;
    };
    dom.window.history.forward = () => {
        calls.forward += 1;
    };
    dom.window.Date.now = () => now;
    dom.window.setTimeout = (fn, delay) => {
        calls.timers.push({ fn, delay });
        return calls.timers.length;
    };

    beforeScript(dom.window);
    dom.window.eval(source);
    return { dom, calls, setHistoryLength: value => { currentHistoryLength = value; } };
}

function runNextTimer(h) {
    const timer = h.calls.timers.shift();
    assert.ok(timer, 'expected a pending timer');
    timer.fn();
    return timer.delay;
}

test('Reddit Safari Back userscript packaging is stable and canonical', () => {
    const bytes = fs.readFileSync(scriptPath);
    const sentinel = Buffer.from('// ==UserScript==', 'utf8');
    assert.equal(bytes.subarray(0, sentinel.length).compare(sentinel), 0);
    assert.match(source, /^\/\/ @version\s+1\.4\.12-macaque-clean$/m);
    const raw = 'https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js';
    assert.ok(source.includes(`// @downloadURL  ${raw}`));
    assert.ok(source.includes(`// @updateURL    ${raw}`));
    assert.ok(source.includes("escapeDelayMs: 500"));
    assert.ok(source.includes('maxHistoryLengthForTrap: 2'));
    assert.doesNotThrow(() => new vm.Script(source, { filename: scriptPath }));
});

test('ordinary Reddit navigation is untouched', () => {
    const h = makeDom('https://www.reddit.com/r/test/', {
        navigationType: 'navigate',
        historyLength: 2,
    });
    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.forward, 0);
    assert.deepEqual(h.calls.timers, []);
    assert.equal(h.dom.window.document.documentElement.getAttribute('data-reddit-safari-backfix-version'), '1.4.12-macaque-clean');
    h.dom.window.close();
});

test('short back_forward trap schedules in-tab escape without closing another Safari tab', () => {
    const h = makeDom('https://www.reddit.com/r/test/', {
        navigationType: 'back_forward',
        historyLength: 2,
    });

    assert.equal(h.calls.close, 0);
    assert.equal(h.dom.window.document.documentElement.getAttribute('data-reddit-safari-backfix-action'), 'blank-replace');
    assert.equal(h.calls.forward, 0);
    assert.equal(h.calls.timers.length, 1);
    assert.equal(h.calls.timers[0].delay, 500);
    assert.equal(h.calls.forward, 0);
    h.dom.window.close();
});

test('Safari back-forward cache restore handles a short history when navigation type remains navigate', () => {
    const h = makeDom('https://www.reddit.com/r/test/', {
        navigationType: 'navigate',
        historyLength: 2,
    });
    assert.equal(h.calls.close, 0);
    h.dom.window.dispatchEvent(new h.dom.window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.timers[0].delay, 500);
    assert.equal(h.calls.forward, 0);
    h.dom.window.close();
});

test('return marker recognizes Safari Back when navigation type stays navigate and pageshow is not persisted', () => {
    const h = makeDom('https://www.reddit.com/r/test/', {
        navigationType: 'navigate', historyLength: 1,
    });
    h.dom.window.dispatchEvent(new h.dom.window.Event('pagehide'));
    h.setHistoryLength(2);
    h.dom.window.dispatchEvent(new h.dom.window.PageTransitionEvent('pageshow', { persisted: false }));
    assert.equal(h.calls.timers.length, 1);
    assert.equal(h.calls.timers[0].delay, 500);
    assert.equal(h.calls.forward, 0);
    assert.equal(h.calls.close, 0);
    h.dom.window.close();
});

test('longer back_forward history is not treated as the short trap', () => {
    const h = makeDom('https://www.reddit.com/r/test/', {
        navigationType: 'back_forward',
        historyLength: 3,
    });
    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.forward, 0);
    assert.deepEqual(h.calls.timers, []);
    h.dom.window.close();
});

test('challenge parameters are scrubbed before handling a short trap', () => {
    const h = makeDom('https://www.reddit.com/r/test/?solution=x&js_challenge=1&token=y&jsc_orig_r=z&keep=1', {
        navigationType: 'back_forward',
        historyLength: 2,
    });

    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.replaceState.length, 2);
    assert.equal(h.calls.replaceState[1], '/r/test/?keep=1');
    assert.equal(h.dom.window.location.search, '?keep=1');
    h.dom.window.close();
});

test('pageshow re-entry is throttled immediately after the first action', () => {
    const h = makeDom('https://www.reddit.com/r/test/', {
        navigationType: 'back_forward',
        historyLength: 2,
        now: 10_000,
    });
    assert.equal(h.calls.timers.length, 1);
    h.dom.window.dispatchEvent(new h.dom.window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(h.calls.timers.length, 1);
    h.dom.window.close();
});


test('same-path challenge redirect cannot reuse a departure marker from another history entry', () => {
    const h = makeDom('https://www.reddit.com/r/test/?js_challenge=1', {
        historyLength: 2,
        beforeScript(window) {
            window.sessionStorage.setItem('reddit-safari-backfix-return', JSON.stringify({
                path: '/r/test/', historyLength: 1, entryId: 'previous-entry',
            }));
        },
    });
    assert.equal(h.calls.timers.length, 0);
    assert.equal(h.dom.window.document.documentElement.getAttribute('data-reddit-safari-backfix-action'), null);
    assert.notEqual(h.dom.window.history.state.__redditSafariBackfixEntry, 'previous-entry');
    h.dom.window.close();
});

test('restored history entry recognizes Back across document reloads and preserves site state', () => {
    const h = makeDom('https://www.reddit.com/r/test/', {
        beforeScript(window) {
            window.history.replaceState(window.JSON.parse('{"siteValue":42,"__redditSafariBackfixEntry":"restored-entry"}'), '');
            window.sessionStorage.setItem('reddit-safari-backfix-return', JSON.stringify({
                path: '/r/test/', historyLength: 1, entryId: 'restored-entry',
            }));
        },
    });
    assert.equal(h.calls.timers.length, 1);
    assert.equal(h.dom.window.history.state.siteValue, 42);
    assert.equal(h.dom.window.history.state.__redditSafariBackfixEntry, 'restored-entry');
    h.dom.window.close();
});

test('history entry tagging preserves object state and leaves arrays and primitive state intact', () => {
    for (const original of [{siteValue: 42}, ['site'], 'site', 7]) {
        const h = makeDom('https://www.reddit.com/r/test/', {
            beforeScript(window) {
                const state = window.JSON.parse(JSON.stringify(original));
                window.history.replaceState(state, '');
            },
        });
        const state = h.dom.window.history.state;
        if (original && !Array.isArray(original) && typeof original === 'object') {
            assert.equal(state.siteValue, 42);
            assert.equal(typeof state.__redditSafariBackfixEntry, 'string');
        } else {
            assert.deepEqual(state, h.dom.window.JSON.parse(JSON.stringify(original)));
            assert.equal(h.calls.replaceState.length, 1);
        }
        assert.equal(h.calls.timers.length, 0);
        h.dom.window.close();
    }
});
