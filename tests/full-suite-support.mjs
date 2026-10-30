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

/** In-page probe for Violentmonkey's confirm page: clicks Install/Reinstall once `expected` is shown. */
export const installPageExpression = expected => `(() => {
  if (!document.body || !document.body.innerText.includes(${JSON.stringify(expected)})) return null;
  const button = [...document.querySelectorAll('button')].find(b => !b.disabled &&
    /^(Install|Reinstall|Re-install|Update)$/i.test(b.innerText.trim()));
  if (!button) return null;
  button.click();
  return button.innerText.trim();
})()`;

/**
 * Poll the confirm page until the install button is clicked. A thrown evaluation
 * (for example a page that has no body yet) counts as "not ready" and is retried
 * until the deadline; the last real error text is kept for the final failure.
 */
export async function clickInstallButton(evaluate, expected,
  { attempts = 60, delayMs = 250, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const clicked = await evaluate(installPageExpression(expected));
      if (clicked) return clicked;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) await sleep(delayMs);
  }
  throw new Error(`Violentmonkey install page never offered ${expected}${lastError ? ` (last error: ${lastError.message})` : ''}`);
}
