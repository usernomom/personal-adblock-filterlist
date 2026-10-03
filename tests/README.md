# Userscript testing

Run the deterministic production-userscript suite with:

~~~powershell
npm ci
npm test
~~~

The jsdom tests in tests/deterministic/ exercise the actual .user.js packages, metadata, and behavior. These tests are useful for fast regressions but do not establish what an installed script does on a current website.

## Full suite: required for every change

Every change to any userscript or to `adguard-personal.txt` must pass the whole suite before it is pushed or called done:

~~~powershell
npm run test:full
~~~

[`tests/run-full-suite.mjs`](run-full-suite.mjs) runs the deterministic suite, the iphone-safari-toolkit unit suite, installs every changed userscript into Violentmonkey in Opera Neon (served unmodified from the working tree, installed version verified), deploys every changed userscript into Macaque on the iPhone, then runs the live Neon suite (`tests/live/google-smoke.mjs`) and the live iPhone Safari suite (`google_regression.py`). All steps and all changed-script deployments run before failures are reported together; any failure fails the run. A changed script missing from either manager is blocking: complete its one-time installation before rerunning. The live suites currently exercise Google behavior; retain the site-specific live verification for changes to other sites. Pass `--base <ref>` to change what counts as changed (default `origin/main`).

It is enforced by tracked Git hooks in `.githooks/`, activated by `npm ci`/`npm install` (`prepare` sets `core.hooksPath`): `pre-commit` runs the deterministic suite for any staged userscript, filter-list or test change, and `pre-push` runs the full suite on exactly the pushed commit whenever the push changes a userscript, the filter list, tests, package files, or hooks. The pushed commit must be checked out with no tracked or untracked changes. Never bypass them with `--no-verify`. If the iPhone or Neon cannot be reached, the change is not done.

Every user-reported regression also gets a live case in the relevant live suite, not only a deterministic test, so the same failure cannot pass the full suite again.

## iPhone troubleshooting

When a problem shows up while browsing, it is troubleshot on the phone with the private [iphone-safari-toolkit](https://github.com/usernomom/iphone-safari-toolkit) (see its README and site notes), against the installed Macaque script on the real site. Each fix adds a deterministic test here and updates the script's `BEHAVIOUR SPEC` comment in the same change. Captured Google DOM is **not** an acceptable physical validation method.

For an already-installed Macaque script, deploy the current working-tree source through the private toolkit rather than using Safari's native `.user.js` interception path:

~~~powershell
Set-Location G:\GitHub\iphone-safari-toolkit
python tests/ios/iphone.py deploy <script.user.js>
~~~

The toolkit updates the existing Macaque record through Remote Manager and fresh-sync verifies the stored source on the phone. If more than one paired iPhone is reachable, pass `--udid <device-udid>`; otherwise use automatic discovery. The repository source remains canonical.

The development server remains available in this production userscript checkout for explicit localhost/LAN serving or temporary development telemetry:

~~~powershell
npm run serve:userscripts:lan
~~~

It serves the working-tree userscript with no-cache headers and rewrites only the served development download/update URLs to the LAN host. Committed source metadata continues to point to canonical GitHub URLs. Do not use this LAN/native-Macaque interception route as the normal edit/update loop; that interception path has produced appended-HTML source corruption. For a genuinely new Macaque script with no installed record, follow the toolkit's documented one-time/manual installation fallback and verify the resulting installed source.

## Desktop live checks

npm run test:live remains a separate Opera Neon / Violentmonkey check for live Google. It requires the configured desktop browser profile and installed scripts. It does not substitute for physical Safari validation.
