'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

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
    assert.match(source, /^\/\/ @version\s+2$/m);
    assert.match(source, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\/usernomom\/personal-adblock-filterlist\/main\/google_open_results_new_tab\.js$/m);
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
