'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'google_open_results_new_tab.js');
const source = fs.readFileSync(scriptPath, 'utf8');

function makeDom() {
    const dom = new JSDOM(
        '<!doctype html><html><body><a id="result" href="https://example.com/" rel="nofollow noopener noreferrer"><h3>Example</h3></a></body></html>',
        { url: 'https://www.google.com/search?q=example', runScripts: 'outside-only' },
    );
    dom.window.eval(source);
    return dom;
}

test('Google new-tab userscript is valid and versioned', () => {
    assert.match(source, /^\/\/ @version\s+6$/m);
    assert.match(source, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\/usernomom\/personal-adblock-filterlist\/main\/google_open_results_new_tab\.js$/m);
    assert.ok(source.includes("addEventListener('load', depart, { once: true })"));
    assert.equal(source.includes('RETURN_NAV_DELAY_MS'), false);
    assert.doesNotThrow(() => new vm.Script(source, { filename: scriptPath }));
});

test('organic result uses an opener-linked new tab', () => {
    const dom = makeDom();
    const anchor = dom.window.document.getElementById('result');
    anchor.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true, composed: true }));

    assert.equal(anchor.target, '_blank');
    const rel = new Set(anchor.rel.split(/\s+/).filter(Boolean));
    assert.ok(rel.has('nofollow'));
    assert.ok(rel.has('opener'));
    assert.equal(rel.has('noopener'), false);
    assert.equal(rel.has('noreferrer'), false);
    dom.window.close();
});

test('ordinary Reddit click is opened synchronously with window.open', () => {
    const dom = new JSDOM(
        '<!doctype html><html><body><div id="root"><span hidden><a data-ub-google-source-proxy-anchor="default" href="https://www.reddit.com/r/codex/"></a></span><a id="result" href="/goto?url=opaque"><h3>Reddit</h3></a></div></body></html>',
        { url: 'https://www.google.com/search?q=codex+reddit', runScripts: 'outside-only' },
    );
    const opens = [];
    dom.window.open = (...args) => {
        opens.push(args);
        return {};
    };
    dom.window.eval(source);

    const anchor = dom.window.document.getElementById('result');
    const event = new dom.window.MouseEvent('click', {
        bubbles: true,
        composed: true,
        cancelable: true,
        button: 0,
    });
    anchor.dispatchEvent(event);

    assert.equal(opens.length, 1);
    const opened = new URL(opens[0][0]);
    assert.equal(opened.hostname, 'www.google.com');
    assert.equal(opened.pathname, '/search');
    assert.equal(opened.searchParams.get('q'), '__rbf_return_sentinel__');
    assert.ok(opened.searchParams.get('__rbf_return_sentinel'));
    const sentinelFragment = new URLSearchParams(opened.hash.slice(1));
    const target = new URL(sentinelFragment.get('__rbf_target'));
    assert.equal(target.hostname, 'www.google.com');
    assert.equal(target.pathname, '/goto');
    assert.equal(target.searchParams.get('url'), 'opaque');
    assert.equal(target.hash, '#__rbf_google_child=1');
    assert.equal(opens[0][1], '_blank');
    assert.equal(event.defaultPrevented, true);
    dom.window.close();
});

test('Google return sentinel arms and closes on BFCache restore after committed load', () => {
    const id = 'sentinel-bfcache';
    const target = 'https://www.google.com/goto?url=opaque#__rbf_google_child=1';
    const sentinel = new URL('https://www.google.com/search');
    sentinel.searchParams.set('q', '__rbf_return_sentinel__');
    sentinel.searchParams.set('__rbf_return_sentinel', id);
    const fragment = new URLSearchParams();
    fragment.set('__rbf_target', target);
    sentinel.hash = fragment.toString();

    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: sentinel.href,
        runScripts: 'outside-only',
        virtualConsole,
    });
    let closes = 0;
    dom.window.close = () => {
        closes += 1;
    };
    dom.window.eval(source);

    const key = `__rbf_return_sentinel__:${id}`;
    assert.equal(dom.window.sessionStorage.getItem(key), 'armed');
    assert.equal(closes, 0);

    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: false }));
    assert.equal(closes, 0);
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true }));
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(closes, 1);
    assert.equal(dom.window.sessionStorage.getItem(key), null);

    dom.window.close = () => {};
    dom.window.document.close();
});

test('rebuilt Google return sentinel closes immediately from its stored arm', () => {
    const id = 'sentinel-rebuilt';
    const target = 'https://www.reddit.com/r/codex/#__rbf_google_child=1';
    const sentinel = new URL('https://www.google.com/search');
    sentinel.searchParams.set('q', '__rbf_return_sentinel__');
    sentinel.searchParams.set('__rbf_return_sentinel', id);
    const fragment = new URLSearchParams();
    fragment.set('__rbf_target', target);
    sentinel.hash = fragment.toString();

    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: sentinel.href,
        runScripts: 'outside-only',
    });
    const key = `__rbf_return_sentinel__:${id}`;
    dom.window.sessionStorage.setItem(key, 'armed');
    const timers = [];
    let closes = 0;
    dom.window.setTimeout = (fn, delay) => {
        timers.push({ fn, delay });
        return timers.length;
    };
    dom.window.close = () => {
        closes += 1;
    };
    dom.window.eval(source);

    assert.equal(closes, 1);
    assert.deepEqual(timers, []);
    assert.equal(dom.window.sessionStorage.getItem(key), null);

    dom.window.close = () => {};
    dom.window.document.close();
});

test('opaque Reddit result keeps Google redirect even if bridge proxy path is malformed', () => {
    const dom = new JSDOM(
        '<!doctype html><html><body><div id="root"><span hidden><a data-ub-google-source-proxy-anchor="default" href="https://www.reddit.com/r/codex/:H/"></a></span><a id="result" href="/goto?url=opaque"><h3>Reddit</h3></a></div></body></html>',
        { url: 'https://www.google.com/search?q=codex+reddit', runScripts: 'outside-only' },
    );
    dom.window.eval(source);
    const anchor = dom.window.document.getElementById('result');
    anchor.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true, composed: true }));

    const url = new URL(anchor.href);
    assert.equal(url.hostname, 'www.google.com');
    assert.equal(url.pathname, '/goto');
    assert.equal(url.searchParams.get('url'), 'opaque');
    assert.equal(url.hash, '#__rbf_google_child=1');
    assert.equal(anchor.href.includes('/r/codex/:H/'), false);
    dom.window.close();
});
