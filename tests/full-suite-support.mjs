import { createSuite } from './live/suite-runner.mjs';

export async function verifyNeonScript(script, { installedInNeon, installIntoNeon }) {
  const installed = (await installedInNeon()).find(row => row.name === script.name);
  if (!installed) throw new Error(`${script.file}: not installed in Neon; install it before rerunning the full suite`);
  const button = await installIntoNeon(script);
  const after = (await installedInNeon()).find(row => row.name === script.name);
  if (!after?.lines.includes(script.version)) {
    throw new Error(`${script.file}: Neon shows ${JSON.stringify(after?.lines)} after ${button}, expected ${script.version}`);
  }
  return `${script.file}: ${script.version} installed (${button})`;
}

/** Attempt every script before failing a stage, retaining each path's evidence. */
export async function runScriptBatch(scripts, task) {
  const suite = createSuite();
  for (const script of scripts) await suite.run(script.file, () => task(script));
  const report = suite.summary();
  if (!report.ok) {
    throw new Error(report.cases.map(item =>
      `${item.name}: ${item.status.toUpperCase()} ${item.status === 'pass' ? item.value : item.error}`).join('\n'));
  }
  return report.cases.map(item => item.value);
}
