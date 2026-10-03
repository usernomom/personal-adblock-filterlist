const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../full-suite-support.mjs');
const script = { file: 'new.user.js', name: 'New script', version: '2' };

test('Neon verification fails when the changed script has no installed record', async () => {
  const { verifyNeonScript } = await load();
  await assert.rejects(verifyNeonScript(script, {
    installedInNeon: async () => [],
    installIntoNeon: async () => 'Install',
  }), /new\.user\.js.*not installed/);
});

test('Neon verification rejects an outdated installed version after update', async () => {
  const { verifyNeonScript } = await load();
  await assert.rejects(verifyNeonScript(script, {
    installedInNeon: async () => [{ name: script.name, lines: [script.name, '1'] }],
    installIntoNeon: async () => 'Update',
  }), /expected 2/);
});

test('Neon verification reports a verified installed version', async () => {
  const { verifyNeonScript } = await load();
  assert.equal(await verifyNeonScript(script, {
    installedInNeon: async () => [{ name: script.name, lines: [script.name, '2'] }],
    installIntoNeon: async () => 'Update',
  }), 'new.user.js: 2 installed (Update)');
});

test('script batches attempt every path and include successes and failures in the error', async () => {
  const { runScriptBatch } = await load();
  const attempts = [];
  await assert.rejects(runScriptBatch([
    { file: 'first.user.js' }, { file: 'second.user.js' }, { file: 'third.user.js' },
  ], async item => {
    attempts.push(item.file);
    if (item.file !== 'third.user.js') throw new Error('device unavailable');
    return 'third.user.js verified';
  }), error => {
    assert.match(error.message, /first\.user\.js: FAIL device unavailable/);
    assert.match(error.message, /second\.user\.js: FAIL device unavailable/);
    assert.match(error.message, /third\.user\.js: PASS third\.user\.js verified/);
    return true;
  });
  assert.deepEqual(attempts, ['first.user.js', 'second.user.js', 'third.user.js']);
});

test('successful and empty script batches report all results', async () => {
  const { runScriptBatch } = await load();
  assert.deepEqual(await runScriptBatch([{ file: 'one.user.js' }, { file: 'two.user.js' }],
    async item => item.file + ' verified'), ['one.user.js verified', 'two.user.js verified']);
  assert.deepEqual(await runScriptBatch([], async () => { throw new Error('unexpected'); }), []);
});
