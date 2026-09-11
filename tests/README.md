# Userscript regression and live testing

The repository uses deterministic jsdom tests for stable behavior, targeted live browser smoke tests where DOM reality matters, and a LAN development server for rapid iPhone/Safari/Macaque iteration.

## Deterministic suite

Install dependencies once, then run:

```powershell
npm ci
npm test
```

The suite executes the canonical `.user.js` packages and checks syntax, metadata, packaging invariants, and behavior. `google_interface_cleanup.user.js` also starts at `document-start`, strips `autoplay` from current and dynamically inserted videos, and pauses playback that lacks active user activation or a recent trusted click/key action. Scroll/touch-start gestures do not grant playback permission. For the two navigation scripts specifically:

- `google_open_results_new_tab.user.js` keeps the original Google-result behavior: prepare recognized result links with `target="_blank"`, add `rel="noopener"`, ignore hidden uBlacklist proxy anchors, suppress Google's later ordinary-click handlers without preventing the browser's default anchor action, and leave archive.ph-owned clicks alone. `google_open_results_new_tab.js` is retained as a content-identical legacy copy.
- `reddit_safari_back_button_fix.user.js` keeps the verified pre-September-8 behavior: ordinary Reddit navigation is untouched; only a top-level `back_forward` navigation with history length at most 2 is treated as the Safari trap; challenge parameters are scrubbed; the script tries `window.close()` first and falls back to `history.forward()` if the tab remains alive.

The published version numbers are intentionally higher than the previously published experimental versions so Macaque/Violentmonkey can update normally. Runtime behavior is the restored, user-verified baseline.

## StopTheMadness compatibility note

As of the StopTheMadness update observed on 2026-09-08, its Google-side behavior interferes with Safari's native Google -> Reddit child-tab Back handling. For the verified iPhone workflow, disable StopTheMadness on Google. Disabling it only on Reddit is not sufficient. No StopTheMadness-specific workaround is built into these userscripts.

## iOS / Macaque LAN development server

For rapid iPhone iteration, do not push every experiment to GitHub. Start the working-tree server instead:

```powershell
npm run serve:userscripts:lan
```

It listens on port `8767` by default. From an iPhone on the same LAN, open a canonical development URL such as:

```text
http://<PC-LAN-IP>:8767/google_open_results_new_tab.user.js
http://<PC-LAN-IP>:8767/reddit_safari_back_button_fix.user.js
```

The server also exposes the corresponding `.meta.js` URL for userscript-manager update checks. Responses use no-cache headers and support GET and HEAD.

The important safety property is that the server rewrites `@downloadURL` and `@updateURL` only in the served response, using the request's host. The working-tree source stays pointed at the stable GitHub `.user.js` URL, so a LAN development URL cannot accidentally be committed or published.

For iPhone-only failures that need telemetry, temporarily instrument the development script to POST newline-oriented JSON/text to:

```text
http://<PC-LAN-IP>:8767/__userscript_log
```

The legacy `POST /__rbf_log` endpoint is also accepted. On Windows the default logs are:

```text
%TEMP%\userscript-live.log
%TEMP%\userscript-http.log
```

If a userscript uses `GM.xmlHttpRequest`/`GM.xmlhttpRequest` for LAN logging, grant/connect the LAN host only in the development instrumentation and remove that instrumentation before publishing. When the user reports a test result, read the live-log tail directly from the PC rather than asking them to paste logs.

Environment overrides are available as `USERSCRIPT_DEV_HOST`, `USERSCRIPT_DEV_PORT`, `USERSCRIPT_LIVE_LOG`, and `USERSCRIPT_HTTP_LOG`.

GitHub remains the canonical persisted source. Before publishing, run the deterministic suite, verify stable GitHub metadata, and commit only the proven implementation.

## Live Google cleanup smoke suite

The Google interface-cleanup suite also has a dedicated live Neon test path. Prerequisites:

- Dedicated Opera Neon automation profile running with DevTools on `127.0.0.1:9223`.
- Violentmonkey enabled in that profile with **Allow User Scripts** enabled.
- The local working-tree `google_interface_cleanup.user.js` installed through the normal userscript install flow.

For an uncommitted cleanup-userscript change:

```powershell
npm run serve:google-userscript
```

Then install/update from:

```text
http://127.0.0.1:8766/google_interface_cleanup.user.js
```

Run the live cleanup suite with:

```powershell
npm run test:live
```

The runner creates only its temporary test tab, exercises fresh Google navigations, verifies the cleanup userscript version against the working tree, and restores tab state during cleanup. It intentionally does not run in GitHub Actions because it depends on the local dedicated Neon profile and current Google markup.
