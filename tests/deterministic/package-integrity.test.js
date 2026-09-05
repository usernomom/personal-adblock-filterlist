const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const {
    repoRoot,
    createHarness,
} = require('../helpers/google-cleanup-harness');

const sourcePath = path.join(repoRoot, 'google_interface_cleanup.js');
const installPath = path.join(repoRoot, 'google_interface_cleanup.user.js');

function read(file) {
    return fs.readFileSync(file, 'utf8');
}

function metadataVersion(source) {
    const match = source.match(/^\/\/ @version\s+(.+)$/m);
    assert.ok(match, 'userscript metadata must contain @version');
    return match[1].trim();
}

test('.js and .user.js copies are content-identical', () => {
    assert.equal(read(sourcePath), read(installPath));
});

test('installable userscript starts at byte 0 with the metadata sentinel', () => {
    const bytes = fs.readFileSync(installPath);
    const sentinel = Buffer.from('// ==UserScript==', 'utf8');
    assert.equal(bytes.subarray(0, sentinel.length).compare(sentinel), 0);
});

test('metadata URLs target the canonical stable .user.js path', () => {
    const source = read(installPath);
    const expected =
        'https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_interface_cleanup.user.js';
    assert.ok(source.includes(`// @downloadURL  ${expected}`));
    assert.ok(source.includes(`// @updateURL    ${expected}`));
});

test('metadata version matches runtime and live-install version markers', () => {
    const source = read(installPath);
    const h = createHarness({ scriptSource: source });
    const expected = metadataVersion(source);
    const marker = h.document.getElementById('google-interface-cleanup-style');
    assert.equal(h.api.version, expected);
    assert.ok(marker, 'userscript must expose the cleanup style marker for live install verification');
    assert.equal(marker.dataset.googleCleanupVersion, expected);
    h.close();
});

for (const file of [sourcePath, installPath]) {
    test(`${path.basename(file)} parses as valid JavaScript`, () => {
        assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }));
    });
}
