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

    Object.defineProperty(dom.window.history, 'length', {
        configurable: true,
        get: () => historyLength,
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

    dom.window.eval(source);
    return { dom, calls };
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
    assert.match(source, /^\/\/ @version\s+1\.4\.7-macaque-clean$/m);
    const raw = 'https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js';
    assert.ok(source.includes(`// @downloadURL  ${raw}`));
    assert.ok(source.includes(`// @updateURL    ${raw}`));
    assert.ok(source.includes("closeBlockedFallback: 'forward'"));
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
    h.dom.window.close();
});

test('short back_forward trap tries to close first, then falls forward if the tab remains alive', () => {
    const h = makeDom('https://www.reddit.com/r/test/', {
        navigationType: 'back_forward',
        historyLength: 2,
    });

    assert.equal(h.calls.close, 1);
    assert.equal(h.calls.forward, 0);
    assert.equal(h.calls.timers.length, 1);
    assert.equal(runNextTimer(h), 350);
    assert.equal(h.calls.timers.length, 1);
    assert.equal(runNextTimer(h), 80);
    assert.equal(h.calls.forward, 1);
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

    assert.equal(h.calls.close, 1);
    assert.equal(h.calls.replaceState.length, 1);
    assert.equal(h.calls.replaceState[0], '/r/test/?keep=1');
    assert.equal(h.dom.window.location.search, '?keep=1');
    h.dom.window.close();
});

test('pageshow re-entry is throttled immediately after the first action', () => {
    const h = makeDom('https://www.reddit.com/r/test/', {
        navigationType: 'back_forward',
        historyLength: 2,
        now: 10_000,
    });
    assert.equal(h.calls.close, 1);
    h.dom.window.dispatchEvent(new h.dom.window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(h.calls.close, 1);
    h.dom.window.close();
});
