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


test('autoplay guard starts before page scripts can create media', () => {
    const source = read(canonicalPath);
    assert.ok(source.includes('// @run-at       document-start'));
});

test('autoplay permission is media-scoped rather than a global click grace period', () => {
    const source = read(canonicalPath);
    assert.ok(source.includes('manuallyAllowedVideos'));
    assert.equal(source.includes('navigator.userActivation'), false);
    assert.equal(source.includes('mediaAllowedUntil'), false);
});


test('runtime VERSION constants match userscript metadata', () => {
    const scripts = fs.readdirSync(repoRoot).filter((name) => name.endsWith('.user.js'));
    for (const name of scripts) {
        const source = read(path.join(repoRoot, name));
        const constant = source.match(/^\s*const VERSION = '([^']+)';/m);
        if (!constant) continue;
        assert.equal(constant[1], metadataVersion(source), name);
    }
});

test('every userscript carries a behaviour spec with rule IDs', () => {
    const scripts = fs.readdirSync(repoRoot).filter((name) => name.endsWith('.user.js'));
    for (const name of scripts) {
        const source = read(path.join(repoRoot, name));
        const spec = source.match(/\/\*\s*\n \* BEHAVIOUR SPEC[\s\S]*?\*\//);
        assert.ok(spec, `${name} must have a BEHAVIOUR SPEC block`);
        assert.ok(/^ \* [A-Z]{2}-\d+ /m.test(spec[0]), `${name} spec must number its rules`);
        assert.ok(
            source.indexOf(spec[0]) > source.indexOf('// ==/UserScript=='),
            `${name} spec must follow the metadata block`,
        );
    }
});

test('all root userscripts use the .user.js suffix', () => {
    const offenders = fs.readdirSync(repoRoot)
        .filter((name) => name.endsWith('.js') && !name.endsWith('.user.js'))
        .filter((name) => read(path.join(repoRoot, name)).startsWith('// ==UserScript=='));
    assert.deepEqual(offenders, []);
});
