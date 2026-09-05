const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const {
    repoRoot,
    scriptPath,
    createHarness,
} = require('../helpers/google-cleanup-harness');

const canonicalPath = path.join(repoRoot, 'google_interface_cleanup.user.js');
const legacySourcePath = path.join(repoRoot, 'google_interface_cleanup.js');

function read(file) {
    return fs.readFileSync(file, 'utf8');
}

function metadataVersion(source) {
    const match = source.match(/^\/\/ @version\s+(.+)$/m);
    assert.ok(match, 'userscript metadata must contain @version');
    return match[1].trim();
}

test('legacy plain .js copy is absent', () => {
    assert.equal(fs.existsSync(legacySourcePath), false);
});

test('test harness executes the canonical .user.js source', () => {
    assert.equal(scriptPath, canonicalPath);
});

test('installable userscript starts at byte 0 with the metadata sentinel', () => {
    const bytes = fs.readFileSync(canonicalPath);
    const sentinel = Buffer.from('// ==UserScript==', 'utf8');
    assert.equal(bytes.subarray(0, sentinel.length).compare(sentinel), 0);
});

test('metadata URLs target the canonical stable .user.js path', () => {
    const source = read(canonicalPath);
    const expected =
        'https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_interface_cleanup.user.js';
    assert.ok(source.includes(`// @downloadURL  ${expected}`));
    assert.ok(source.includes(`// @updateURL    ${expected}`));
});

test('metadata version matches runtime and live-install version markers', () => {
    const source = read(canonicalPath);
    const h = createHarness({ scriptSource: source });
    const expected = metadataVersion(source);
    const marker = h.document.getElementById('google-interface-cleanup-style');
    assert.equal(h.api.version, expected);
    assert.ok(marker, 'userscript must expose the cleanup style marker for live install verification');
    assert.equal(marker.dataset.googleCleanupVersion, expected);
    h.close();
});

test('canonical .user.js parses as valid JavaScript', () => {
    assert.doesNotThrow(() => new vm.Script(read(canonicalPath), { filename: canonicalPath }));
});
