'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'google_open_results_new_tab.user.js');
const legacyPath = path.join(repoRoot, 'google_open_results_new_tab.js');
const source = fs.readFileSync(scriptPath, 'utf8');

function makeDom(html) {
    const dom = new JSDOM(html, {
        url: 'https://www.google.com/search?q=example',
        runScripts: 'outside-only',
    });
    dom.window.eval(source);
    return dom;
}

test('Google new-tab userscript packaging is stable and canonical', () => {
    const bytes = fs.readFileSync(scriptPath);
    const sentinel = Buffer.from('// ==UserScript==', 'utf8');
    assert.equal(bytes.subarray(0, sentinel.length).compare(sentinel), 0);
    assert.match(source, /^\/\/ @version\s+7$/m);
    const raw = 'https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_open_results_new_tab.user.js';
    assert.ok(source.includes(`// @downloadURL  ${raw}`));
    assert.ok(source.includes(`// @updateURL    ${raw}`));
    assert.equal(fs.readFileSync(legacyPath, 'utf8'), source);
    assert.doesNotThrow(() => new vm.Script(source, { filename: scriptPath }));
});

test('organic Google result is prepared for native new-tab navigation with noopener', () => {
    const dom = makeDom('<!doctype html><a id="result" href="https://example.com/" rel="nofollow"><h3>Example</h3></a>');
    const anchor = dom.window.document.getElementById('result');
    anchor.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true, composed: true }));

    assert.equal(anchor.target, '_blank');
    const rel = new Set(anchor.rel.split(/\s+/).filter(Boolean));
    assert.ok(rel.has('nofollow'));
    assert.ok(rel.has('noopener'));
    dom.window.close();
});

test('hidden uBlacklist proxy anchors are ignored', () => {
    const dom = makeDom('<!doctype html><a id="proxy" hidden data-ub-news-source-proxy href="https://example.com/"><h3>Hidden</h3></a>');
    const anchor = dom.window.document.getElementById('proxy');
    anchor.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true, composed: true }));
    assert.equal(anchor.target, '');
    dom.window.close();
});

test('ordinary left click suppresses later Google handlers without preventing native anchor action', () => {
    const dom = makeDom('<!doctype html><a id="result" href="https://example.com/"><h3>Example</h3></a>');
    const anchor = dom.window.document.getElementById('result');
    let laterHandlerCalls = 0;
    dom.window.addEventListener('click', () => {
        laterHandlerCalls += 1;
    });

    const event = new dom.window.MouseEvent('click', {
        bubbles: true,
        composed: true,
        cancelable: true,
        button: 0,
    });
    anchor.dispatchEvent(event);

    assert.equal(event.defaultPrevented, false);
    assert.equal(laterHandlerCalls, 0);
    assert.equal(anchor.target, '_blank');
    dom.window.close();
});

test('archive-prepared result is left to the archive userscript click path', () => {
    const dom = makeDom('<!doctype html><a id="result" data-archive-original-href="https://example.com/" href="https://archive.ph/x"><h3>Example</h3></a>');
    const anchor = dom.window.document.getElementById('result');
    let laterHandlerCalls = 0;
    dom.window.addEventListener('click', () => {
        laterHandlerCalls += 1;
    });

    anchor.dispatchEvent(new dom.window.MouseEvent('click', {
        bubbles: true,
        composed: true,
        cancelable: true,
        button: 0,
    }));

    assert.equal(laterHandlerCalls, 1);
    assert.equal(anchor.target, '_blank');
    dom.window.close();
});
