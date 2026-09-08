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
    assert.match(source, /^\/\/ @version\s+1\.3\.3-macaque-clean$/m);

    const raw = 'https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js';
    assert.ok(source.includes(`// @downloadURL  ${raw}`));
    assert.ok(source.includes(`// @updateURL    ${raw}`));
    assert.doesNotThrow(() => new vm.Script(source, { filename: scriptPath }));
});

test('navigate is not treated as a Safari back trap', () => {
    const url = 'https://www.reddit.com/r/intelstock/new/?jsc_token=x&keep=1';
    const h = makeDom(url, { navigationType: 'navigate', historyLength: 2 });

    assert.equal(h.dom.window.location.href, url);
    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.forward, 0);
    assert.equal(
        h.dom.window.sessionStorage.getItem('__reddit_backfix_normal_reddit_seen__'),
        '/r/intelstock/new/?keep=1',
    );
    closeHarness(h);
});

test('back_forward with short history restores the known Macaque escape sequence', () => {
    const h = makeDom(
        'https://www.reddit.com/r/intelstock/new/?solution=89111fce729830d289111fce729830d2&js_challenge=1&jsc_token=7afd7253fec22262ff1c52b1703fe9ec088008e32a9a28a4a467a1c958c1ba3e&jsc_orig_r=',
        { navigationType: 'back_forward', historyLength: 2 },
    );

    assert.equal(h.dom.window.location.href, 'https://www.reddit.com/r/intelstock/new/');
    assert.equal(h.calls.close, 1);
    assert.deepEqual(h.calls.timers, [350, 80]);
    assert.equal(h.calls.forward, 1);
    assert.equal(h.dom.window.sessionStorage.getItem('__reddit_backfix_action_count__'), '1');
    assert.equal(h.dom.window.sessionStorage.getItem('__reddit_backfix_last_action_at__'), '10000');
    assert.equal(
        h.dom.window.sessionStorage.getItem('__reddit_backfix_last_trap_url__'),
        'https://www.reddit.com/r/intelstock/new/?solution=89111fce729830d289111fce729830d2&js_challenge=1&jsc_token=7afd7253fec22262ff1c52b1703fe9ec088008e32a9a28a4a467a1c958c1ba3e&jsc_orig_r=',
    );
    closeHarness(h);
});

test('trap detection does not require challenge parameters', () => {
    const h = makeDom('https://www.reddit.com/r/test/new/?sort=new', {
        navigationType: 'back_forward',
        historyLength: 2,
    });

    assert.equal(h.calls.close, 1);
    assert.equal(h.calls.forward, 1);
    closeHarness(h);
});

test('current and legacy challenge parameters are all removed during trap handling', () => {
    const h = makeDom(
        'https://www.reddit.com/r/test/?solution=a&js_challenge=1&token=old&jsc_token=new&solution=b&jsc_orig_r=&keep=yes',
        { navigationType: 'back_forward', historyLength: 2 },
    );

    assert.equal(h.dom.window.location.href, 'https://www.reddit.com/r/test/?keep=yes');
    closeHarness(h);
});

test('back_forward with history longer than two is left alone', () => {
    const url = 'https://www.reddit.com/r/test/new/?jsc_token=x';
    const h = makeDom(url, { navigationType: 'back_forward', historyLength: 3 });

    assert.equal(h.dom.window.location.href, url);
    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.forward, 0);
    closeHarness(h);
});

test('1200ms throttle prevents repeated trap actions', () => {
    const h = makeDom('https://www.reddit.com/r/test/', {
        navigationType: 'back_forward',
        historyLength: 2,
        now: 10_000,
        stored: {
            __reddit_backfix_state_version__: '1.3.3-macaque-clean',
            __reddit_backfix_action_count__: 1,
            __reddit_backfix_last_action_at__: 9_500,
        },
    });

    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.forward, 0);
    assert.equal(h.dom.window.sessionStorage.getItem('__reddit_backfix_action_count__'), '1');
    closeHarness(h);
});

test('upgrade resets stale per-tab action state before trap detection', () => {
    const h = makeDom('https://www.reddit.com/r/test/?jsc_token=x', {
        navigationType: 'back_forward',
        historyLength: 2,
        stored: {
            __reddit_backfix_state_version__: '1.3.1-macaque-clean',
            __reddit_backfix_action_count__: 4,
            __reddit_backfix_last_action_at__: 9_900,
        },
    });

    assert.equal(h.calls.close, 1);
    assert.equal(h.calls.forward, 1);
    assert.equal(h.dom.window.sessionStorage.getItem('__reddit_backfix_action_count__'), '1');
    assert.equal(
        h.dom.window.sessionStorage.getItem('__reddit_backfix_state_version__'),
        '1.3.3-macaque-clean',
    );
    closeHarness(h);
});
test('four-action cap prevents an infinite escape loop', () => {
    const h = makeDom('https://www.reddit.com/r/test/', {
        navigationType: 'back_forward',
        historyLength: 2,
        stored: {
            __reddit_backfix_state_version__: '1.3.3-macaque-clean',
            __reddit_backfix_action_count__: 4,
            __reddit_backfix_last_action_at__: 0,
        },
    });

    assert.equal(h.calls.close, 0);
    assert.equal(h.calls.forward, 0);
    closeHarness(h);
});
