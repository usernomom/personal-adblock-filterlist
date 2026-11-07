'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'google_recaptcha_audio_solver.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');

// Google's "Verifying your request" check on a signed-out iPhone search,
// as captured live on 2026-11-07 (a direct child of body.srp).
const VERIFYING = `
<div class="yKKqVd">
  <g-loading-icon id="RXmIJc" style="visibility: hidden;"></g-loading-icon>
  <div class="BlvV4c">Verifying your request</div>
  <div class="VIsy6c">You'll be able to continue in a few seconds. Don't refresh this page.</div>
  <div class="Khi4Dc btku5b expUPd sjVJQd" id="GfYR0" role="button" tabindex="0"><div class="niO4u VDgVie SlP8xc">Continue</div></div>
</div>`;

async function load(url, body) {
    const dom = new JSDOM(`<!doctype html><html><body class="srp">${body}</body></html>`, {
        url,
        runScripts: 'outside-only',
    });
    const w = dom.window;
    let now = 1_000_000;
    const timers = [];
    w.Date.now = () => now;
    w.setTimeout = (fn, delay = 0) => {
        timers.push({ fn, at: now + delay });
        return timers.length;
    };
    w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 40 });
    w.eval(source);
    // The script runs at document-start; let the parser finish, as a page would.
    if (w.document.readyState === 'loading') {
        await new Promise(resolve => w.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }

    const advance = ms => {
        const end = now + ms;
        for (;;) {
            timers.sort((a, b) => a.at - b.at);
            const next = timers[0];
            if (!next || next.at > end) break;
            timers.shift();
            now = next.at;
            next.fn();
        }
        now = end;
    };
    const clicks = selector => {
        let count = 0;
        w.document.querySelector(selector).addEventListener('click', () => { count += 1; });
        return () => count;
    };
    return { w, advance, clicks };
}

test('solver package matches Google search pages and keeps its version markers in step', () => {
    assert.match(source, /^\/\/ @version\s+12$/m);
    assert.match(source, /^\s*const VERSION = '12';$/m);
    assert.match(source, /^\/\/ @match\s+https:\/\/\*\.google\.com\/search\*$/m);
    assert.match(source, /^\/\/ @match\s+https:\/\/\*\.google\.ca\/search\*$/m);
    assert.doesNotThrow(() => new vm.Script(source, { filename: scriptPath }));
});

test('taps Continue on the "Verifying your request" check after a short wait, and stops once it is gone', async () => {
    const h = await load('https://www.google.com/search?q=intel+14a+pdk+0.9+substack', VERIFYING);
    const count = h.clicks('#GfYR0');
    const html = h.w.document.documentElement;

    assert.equal(html.getAttribute('data-recaptcha-audio-solver-version'), '12');
    h.advance(1900);
    assert.equal(count(), 0, 'waits a moment, as the page asks');
    h.advance(200);
    assert.equal(count(), 1);
    assert.equal(html.getAttribute('data-google-verify-continue-clicks'), '1');

    h.advance(2000);
    assert.equal(count(), 2, 'taps again while the check is still showing');

    h.w.document.querySelector('.yKKqVd').remove();
    h.advance(20_000);
    assert.equal(count(), 2);
});

test('gives up on a check that never clears', async () => {
    const h = await load('https://www.google.ca/search?q=x', VERIFYING);
    const count = h.clicks('#GfYR0');
    h.advance(10 * 60 * 1000);
    assert.equal(count(), 15);
});

test('leaves other Continue buttons on search pages alone', async () => {
    const h = await load('https://www.google.com/search?q=x',
        '<div><div>Results</div><div id="other" role="button">Continue</div></div>');
    const count = h.clicks('#other');
    h.advance(60_000);
    assert.equal(count(), 0);
    assert.equal(h.w.document.documentElement.hasAttribute('data-google-verify-continue-clicks'), false);
});
