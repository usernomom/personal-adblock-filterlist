const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const load = () => import('../full-suite-support.mjs');
const expected = 'Google - uBlacklist compatibility bridge, 13.3.2';
const fast = { attempts: 5, delayMs: 0 };

/** Run the real polling expression against a fake confirm page. */
function pageEvaluator(document, log = []) {
  return async expression => {
    log.push(expression);
    return vm.runInNewContext(expression, { document });
  };
}

const readyDocument = (clicks, label = 'Reinstall') => ({
  body: { innerText: `Re-installing script\n${expected}` },
  querySelectorAll: () => [{ disabled: false, innerText: label, click: () => clicks.push(label) }],
});

test('install polling reports a page without a body as not ready instead of throwing', async () => {
  const { installPageExpression } = await load();
  const result = vm.runInNewContext(installPageExpression(expected), {
    document: { body: null, querySelectorAll: () => assert.fail('must not look for buttons without a body') },
  });
  assert.equal(result ?? null, null);
});

test('install polling clicks the install button once the page is ready', async () => {
  const { clickInstallButton, installPageExpression } = await load();
  const clicks = [];
  const label = await clickInstallButton(
    pageEvaluator(readyDocument(clicks)), expected, fast);
  assert.equal(label, 'Reinstall');
  assert.deepEqual(clicks, ['Reinstall']);
  assert.match(installPageExpression(expected), /13\.3\.2/);
});

test('a first poll that throws is retried and the ready page is clicked', async () => {
  const { clickInstallButton } = await load();
  const clicks = [];
  let calls = 0;
  const label = await clickInstallButton(async expression => {
    calls += 1;
    if (calls === 1) throw new Error("DevTools evaluation threw: TypeError: Cannot read properties of null (reading 'innerText')");
    return pageEvaluator(readyDocument(clicks))(expression);
  }, expected, fast);
  assert.equal(label, 'Reinstall');
  assert.equal(calls, 2);
  assert.deepEqual(clicks, ['Reinstall']);
});

test('a first poll that sees a null body is retried and the ready page is clicked', async () => {
  const { clickInstallButton } = await load();
  const clicks = [];
  const documents = [{ body: null, querySelectorAll: () => [] }, readyDocument(clicks, 'Install')];
  const label = await clickInstallButton(
    expression => pageEvaluator(documents.shift() ?? documents[0])(expression), expected, fast);
  assert.equal(label, 'Install');
  assert.deepEqual(clicks, ['Install']);
});

test('a page that never becomes ready fails at the deadline with the real error text', async () => {
  const { clickInstallButton } = await load();
  let calls = 0;
  await assert.rejects(clickInstallButton(async () => {
    calls += 1;
    throw new Error('DevTools evaluation threw: TypeError: boom from the page');
  }, expected, fast), error => {
    assert.ok(error.message.includes(expected), error.message);
    assert.match(error.message, /boom from the page/);
    return true;
  });
  assert.equal(calls, fast.attempts);
});

test('a page that never offers the expected version fails at the deadline', async () => {
  const { clickInstallButton } = await load();
  const clicks = [];
  await assert.rejects(clickInstallButton(pageEvaluator({
    body: { innerText: 'Installing something else' },
    querySelectorAll: () => [{ disabled: false, innerText: 'Install', click: () => clicks.push('x') }],
  }), expected, fast), /never offered/);
  assert.deepEqual(clicks, []);
});
