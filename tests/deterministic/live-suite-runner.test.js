const test = require('node:test');
const assert = require('node:assert/strict');
const { createSuite } = require('../live/suite-runner.mjs');

test('live suite attempts every case and reports failures together', async () => {
  const suite = createSuite();
  const attempts = [];
  for (const [name,failed] of [['first',true],['second',true],['third',false]]) {
    await suite.run(name,async () => {
      attempts.push(name);
      if (failed) throw new Error(name+' failed');
      return 'verified';
    });
  }
  const report = suite.summary();
  assert.deepEqual(attempts,['first','second','third']);
  assert.equal(report.ok,false);
  assert.deepEqual(report.cases.map(item=>item.status),['fail','fail','pass']);
  assert.deepEqual(report.failures.map(item=>item.name),['first','second']);
  assert.equal(report.cases[2].value,'verified');
});

test('successful suite retains every result and returns success', async () => {
  const suite=createSuite();
  await suite.run('one',async()=>1);
  await suite.run('two',async()=>2);
  assert.equal(suite.summary().ok,true);
  assert.deepEqual(suite.summary().cases.map(item=>item.value),[1,2]);
});
