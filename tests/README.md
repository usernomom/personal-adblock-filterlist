# Google interface cleanup regression tests

The Google cleanup suite has two layers: deterministic jsdom fixtures for branch coverage and live Google smoke tests in the dedicated Opera Neon automation profile.

## Deterministic suite

Install the test dependency once, then run the full deterministic suite:

```powershell
npm ci
npm test
```

The deterministic tests execute the canonical `google_interface_cleanup.user.js` userscript in jsdom. They cover cleanup classifications, preservation invariants, reason accounting, repeated runs, async result roots, explicit vertical-page behavior, userscript packaging/version consistency, canonical-source integrity, and JavaScript syntax.

Fixtures deliberately use stable structural/semantic signals instead of transient Google CSS class names. `tests/fixtures/columbus-data-kpid.html` reproduces the `data-kpid="vise:/m/01smm"` regression that prompted this suite.

## Live Google smoke suite

Prerequisites:

- Dedicated Opera Neon automation profile running with DevTools on `127.0.0.1:9223`.
- Violentmonkey enabled in that profile with **Allow User Scripts** enabled.
- The local working-tree `google_interface_cleanup.user.js` installed in Violentmonkey through the normal userscript install flow.

For an uncommitted userscript change, serve the local install target:

```powershell
npm run serve:google-userscript
```

Then open this URL in the dedicated Neon profile and accept the normal Violentmonkey install/update prompt:

```text
http://127.0.0.1:8766/google_interface_cleanup.user.js
```

This is the development install path. Do not inject the source manually into a Google page and count that as a live pass.

Run the live suite with:

```powershell
npm run test:live
```

The live runner creates one temporary Neon tab, runs seven fresh Google navigations, and closes only that tab. It tests:

- Columbus, Ohio knowledge/entity content under an iPhone/Safari UA, including the exact `data-kpid="vise:/m/01smm"` invariant.
- Toronto weather/entity content under the mobile UA.
- A live People Also Ask module hidden as `question-accordion`.
- Live video/refinement junk, including an unwanted vertical and query-refinement removal.
- A standalone YouTube result hidden on the normal All tab as `youtube-result`.
- A YouTube result remaining visible on the explicit Videos tab (`udm=7`), with no cleanup-hidden elements on that route.
- A normal desktop web result that must remain visible.

Every live audit checks the smallest relevant DOM element using computed style and bounding rectangles. The runner also requires the userscript's live version marker to match the local working-tree `@version`, so a stale Violentmonkey install fails instead of producing a false pass.

The live suite intentionally does not run in GitHub Actions because it depends on the local authenticated/dedicated Neon profile and current Google markup.
