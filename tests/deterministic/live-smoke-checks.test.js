const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { youtubeMusicDelegation } = require('../live/smoke-checks.mjs');

const smokeSource = fs.readFileSync(path.join(__dirname, '..', 'live', 'google-smoke.mjs'), 'utf8');

// Shapes read live on 2026-10-30 (reports/neon-rerun.json): Google now serves
// the YouTube Music result as a native a.UBFage link that uBlacklist reads
// itself, so the bridge adds nothing.
const NATIVE = {
    source: 'https://music.youtube.com/search?q=%23spatialaudio',
    nativeLink: true,
    proxy: null,
    cleanupReason: null,
    bridgeRoot: null,
    uBlacklistProcessed: '1',
};
const PROXIED = {
    source: 'https://music.youtube.com/watch?v=abc',
    nativeLink: false,
    proxy: 'https://music.youtube.com/watch?v=abc',
    cleanupReason: null,
    bridgeRoot: '1',
    uBlacklistProcessed: '1',
};

test('YouTube Music check passes on a native uBlacklist link or a bridge proxy to music.youtube.com', () => {
    assert.equal(youtubeMusicDelegation(NATIVE), 'native');
    assert.equal(youtubeMusicDelegation(PROXIED), 'proxy');
});

test('YouTube Music check fails when neither path carries music.youtube.com, or Cleanup or uBlacklist is wrong', () => {
    assert.throws(() => youtubeMusicDelegation(null), /was not found/);
    assert.throws(() => youtubeMusicDelegation({ ...NATIVE, nativeLink: false }), /neither/);
    assert.throws(() => youtubeMusicDelegation({ ...PROXIED, proxy: 'https://www.youtube.com/' }), /neither/);
    assert.throws(() => youtubeMusicDelegation({ ...NATIVE, cleanupReason: 'domain' }), /Cleanup/);
    assert.throws(() => youtubeMusicDelegation({ ...NATIVE, uBlacklistProcessed: null }), /did not process/);
});

test('Neon smoke suite: Videos related searches tolerate an unserved module, and no /goto case pretends to test the bridge', () => {
    const videosCase = smokeSource.slice(smokeSource.indexOf('checks.run("Mobile related searches on Videos"'));
    assert.match(videosCase.slice(0, videosCase.indexOf('});')), /requireModule: false/);
    assert.doesNotMatch(smokeSource, /make no \/goto requests/);
    assert.doesNotMatch(smokeSource, /Network\.requestWillBeSent/);
    assert.match(smokeSource, /youtubeMusicDelegation\(/);
});
