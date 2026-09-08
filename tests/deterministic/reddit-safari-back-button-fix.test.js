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

function makeDom(url) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url,
        runScripts: 'outside-only',
    });
    dom.window.GM = { log() {} };
    dom.window.eval(source);
    return dom;
}

test('canonical Reddit userscript packaging is installable and versioned', () => {
    const bytes = fs.readFileSync(scriptPath);
    const sentinel = Buffer.from('// ==UserScript==', 'utf8');
    assert.equal(bytes.subarray(0, sentinel.length).compare(sentinel), 0);
    assert.match(source, /^\/\/ @name\s+Reddit Safari Back Button Fix$/m);
    assert.match(source, /^\/\/ @namespace\s+local\.reddit\.safari\.backfix$/m);
    assert.match(source, /^\/\/ @version\s+1\.3\.2-macaque-clean$/m);

    const raw = 'https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js';
    assert.ok(source.includes(`// @downloadURL  ${raw}`));
    assert.ok(source.includes(`// @updateURL    ${raw}`));
    assert.doesNotThrow(() => new vm.Script(source, { filename: scriptPath }));
});

test('new jsc_token challenge URL is scrubbed at document-start', () => {
    const dom = makeDom('https://www.reddit.com/r/intelstock/new/?solution=89111fce729830d289111fce729830d2&js_challenge=1&jsc_token=7afd7253fec22262ff1c52b1703fe9ec088008e32a9a28a4a467a1c958c1ba3e&jsc_orig_r=');
    assert.equal(dom.window.location.href, 'https://www.reddit.com/r/intelstock/new/');
    dom.window.close();
});

test('legacy token and duplicate challenge parameters are still removed', () => {
    const dom = makeDom('https://www.reddit.com/r/test/?solution=a&js_challenge=1&token=old&jsc_token=new&solution=b&jsc_orig_r=&keep=yes');
    assert.equal(dom.window.location.href, 'https://www.reddit.com/r/test/?keep=yes');
    dom.window.close();
});

test('unrelated Reddit query parameters are preserved', () => {
    const dom = makeDom('https://www.reddit.com/r/test/new/?sort=new&jsc_token=x&foo=bar');
    assert.equal(dom.window.location.href, 'https://www.reddit.com/r/test/new/?sort=new&foo=bar');
    dom.window.close();
});

test('client-side pushState and replaceState cannot add challenge parameters', () => {
    const dom = makeDom('https://www.reddit.com/r/test/');

    dom.window.history.pushState({ one: 1 }, '', '/r/test/new/?js_challenge=1&jsc_token=x&keep=1');
    assert.equal(dom.window.location.href, 'https://www.reddit.com/r/test/new/?keep=1');

    dom.window.history.replaceState({ two: 2 }, '', '/r/test/new/?solution=x&token=y&jsc_orig_r=&keep=2');
    assert.equal(dom.window.location.href, 'https://www.reddit.com/r/test/new/?keep=2');
    dom.window.close();
});

test('ordinary Reddit URLs are left unchanged', () => {
    const url = 'https://www.reddit.com/r/test/new/?sort=new#anchor';
    const dom = makeDom(url);
    assert.equal(dom.window.location.href, url);
    dom.window.close();
});
