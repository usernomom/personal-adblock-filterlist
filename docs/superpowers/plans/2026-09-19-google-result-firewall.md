# Google Result Firewall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent uBlacklist-blocked Google Search results from producing any visible frame while preserving normal per-result loading and all existing bridge behavior.

**Architecture:** Install a document-start CSS firewall in `google_news_ublacklist_bridge.user.js` that targets only Google result-root shapes already owned by the bridge / current uBlacklist web-result contract. A protected root is hidden whenever `data-ub-result` is absent and remains hidden when `data-ub-block` is present; `data-ub-result="1"` without `data-ub-block` releases only that root. Destination resolution remains unchanged and uBlacklist remains the sole blacklist-policy authority.

**Tech Stack:** JavaScript userscript, CSS selectors, jsdom + Node test runner, Opera Neon/Chromium DevTools live instrumentation, uBlacklist DOM markers.

**Spec:** `docs/superpowers/specs/2026-09-19-google-result-firewall-design.md`

## Global Constraints

- DO NOT modify `google_interface_cleanup.user.js`; final verification must prove its blob/hash is unchanged from the implementation branch base.
- uBlacklist remains the sole blacklist-policy authority; do not copy blacklist rules into the bridge.
- Use `data-ub-result="1"` as the positive classification-complete handshake and `data-ub-block="1"` as the blocked decision.
- No page-wide gate, no `#rso` gate, no fixed release delay, and no fail-open timer.
- One unresolved root must not delay unrelated roots.
- Preserve direct external, `/url`, embedded `/goto`, bounded/deduplicated network fallback, mixed-domain, YouTube, YouTube Music, News, dynamic insertion, and late-`href` behavior.
- Preserve explicit Images/vertical-page responsiveness; do not quarantine Images-page root classes as part of the ordinary-result firewall.
- The stable bridge package version must increase monotonically from `13.1.7`.
- Live zero-flicker is an acceptance criterion, not an assumption. If desktop live instrumentation sees any blocked visible frame, do not claim success.

## Review Focus

- Ordinary Google result-root selector breadth: knowledge/entity UI and grouped modules must not be quarantined merely because they contain links.
- Mixed-domain modules: the parent module must not become a shared gate when nested results are independently classifiable.
- Reclassification: removing `data-ub-result` from an allowed root must immediately return only that root to quarantine.
- Opaque unresolved results: a stalled/failed `/goto` result must stay hidden without holding independently classified siblings.
- Live timing: blocked roots must record zero visible animation frames, while allowed roots and Images must not acquire a fixed multi-second delay.

---

### Task 1: Deterministic firewall contract

**Files:**
- Modify: `tests/deterministic/google-ublacklist-bridge.test.js`
- Modify: `google_news_ublacklist_bridge.user.js`

**Interfaces:**
- Consumes: existing bridge root constants, uBlacklist's DOM markers `data-ub-result` / `data-ub-block`.
- Produces: an early `data-ub-google-result-firewall-style` stylesheet whose CSS alone maps each protected root to quarantined/allowed/blocked visibility.

- [ ] **Step 1: Replace the obsolete anti-flash-removal expectation with failing firewall state tests**

Add tests that exercise real computed visibility:
```js
test('protected ordinary result is quarantined until uBlacklist classifies it', () => {
    const h = createHarness({
        html: '<div id="result" class="Ww4FFb vt6azd"><a class="UBFage" href="https://example.com/"><h3>Example</h3></a></div>',
    });
    const root = h.document.getElementById('result');
    assert.equal(h.window.getComputedStyle(root).display, 'none');

    root.setAttribute('data-ub-result', '1');
    assert.notEqual(h.window.getComputedStyle(root).display, 'none');

    root.setAttribute('data-ub-block', '1');
    assert.equal(h.window.getComputedStyle(root).display, 'none');

    root.removeAttribute('data-ub-block');
    root.removeAttribute('data-ub-result');
    assert.equal(h.window.getComputedStyle(root).display, 'none');
    h.close();
});
```

Add separate tests for: two sibling results where one remains unresolved and the classified sibling is visible; a mixed-domain parent with nested `.xYkm8c` items where the parent is not the shared quarantine target; a non-result knowledge/entity fixture remaining visible; explicit Images-page-style `.ivg-i` / `.DyfMyc` fixtures not being quarantined by this firewall.

- [ ] **Step 2: Run the focused deterministic file and verify RED**

Run: `node --test tests/deterministic/google-ublacklist-bridge.test.js`

Expected: FAIL because the current bridge installs no per-result firewall and unclassified protected ordinary roots compute visible.

- [ ] **Step 3: Implement the minimal document-start firewall**

In `google_news_ublacklist_bridge.user.js`, bump metadata/runtime version to `13.1.8`. Reuse the existing `NEWS_CARD_SELECTOR`, `VISUAL_DIGEST_VIDEO_SELECTOR`, and `NESTED_RESULT_SELECTOR`, and add page/layout-aware firewall selectors that mirror the current uBlacklist Web result roots while deliberately opting out of explicit Images mode:

```js
const SEARCH_PARAMS = new URLSearchParams(location.search);
const IS_IMAGES_TAB =
    ['2', 'imgs'].includes(SEARCH_PARAMS.get('udm')) ||
    SEARCH_PARAMS.get('tbm') === 'isch';
const IS_MOBILE_LAYOUT = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

function firewallRootSelector() {
    if (IS_IMAGES_TAB) return '';
    const ordinary = IS_MOBILE_LAYOUT
        ? '.vt6azd:not(:has(.xYkm8c)), .Ww4FFb:not(:has(.xYkm8c))'
        : '.vt6azd:not(.g-blk):not(:has(.xYkm8c)), .Ww4FFb:not(:has(.xYkm8c))';
    return [
        ordinary,
        NESTED_RESULT_SELECTOR,
        '.sHEJob',
        NEWS_CARD_SELECTOR,
        VISUAL_DIGEST_VIDEO_SELECTOR,
        '.eejeod',
    ].join(', ');
}

function installResultFirewallStyle() {
    if (document.querySelector('[data-ub-google-result-firewall-style]')) return;
    const roots = firewallRootSelector();
    const style = document.createElement('style');
    style.setAttribute('data-ub-google-result-firewall-style', VERSION);
    style.textContent = roots ? `
:is(${roots}):not([data-ub-result]),
:is(${roots})[data-ub-block] {
    display: none !important;
}` : '';
    (document.head || document.documentElement).appendChild(style);
}
```

Call it before bridge scanning/observer work in `start()`. Do not add a timer, release callback, page-level state, or blacklist lookup. CSS must release on the marker itself, so uBlacklist's synchronous `data-ub-result` -> judgment sequence remains the handshake.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/deterministic/google-ublacklist-bridge.test.js`

Expected: all bridge tests pass, including the new quarantine/allow/block/reclassification/isolation cases.

- [ ] **Step 5: Run the complete deterministic suite**

Run: `npm test`

Expected: every deterministic test passes, including all Google Cleanup and autoplay regressions without changing `google_interface_cleanup.user.js`.

- [ ] **Step 6: Commit Task 1**

```powershell
git add google_news_ublacklist_bridge.user.js tests/deterministic/google-ublacklist-bridge.test.js
git commit -m "Prevent Google blocked-result flicker"
```

### Task 2: Live frame-timing verification

**Files:**
- Modify: `tests/live/google-smoke.mjs`

**Interfaces:**
- Consumes: Task 1's `data-ub-google-result-firewall-style`, bridge version marker, and uBlacklist `data-ub-result` / `data-ub-block` states.
- Produces: repeatable live evidence for zero blocked visible frames, allowed-result release timing, and Images non-regression.

- [ ] **Step 1: Add bridge-version and pre-navigation frame instrumentation**

Read `google_news_ublacklist_bridge.user.js` beside the cleanup script and extract its expected version. Before the Google navigation, use CDP `Page.addScriptToEvaluateOnNewDocument` to install a frame sampler that, on every `requestAnimationFrame`, records protected roots by stable generated id, whether each root is computed-visible, and whether it currently has `data-ub-result` / `data-ub-block`. Keep the monitor observational only; it must not inject or emulate the userscript implementation.

- [ ] **Step 2: Run the live suite against the currently installed pre-change bridge and verify the new check can fail when flicker is present**

Run: `npm run test:live`

Expected before updating the development bridge installation: either an explicit bridge-version mismatch (`13.1.7` installed vs `13.1.8` working tree) or a blocked-result visible-frame failure. A pass against stale code is a test defect and must be corrected before proceeding.

- [ ] **Step 3: Install the local development bridge through the repository's userscript server**

Run the existing LAN/local userscript server and update the dedicated Neon Violentmonkey profile from the served `google_news_ublacklist_bridge.user.js`. Use the normal userscript installation flow; do not manually inject implementation JavaScript into the page.

- [ ] **Step 4: Verify zero-frame blocked behavior and allowed release timing**

Use a fresh ordinary Google Search navigation containing at least one result that uBlacklist actually marks `data-ub-block`. For every root that ends classified blocked, assert its sampler history contains zero visible frames. For at least one ordinary allowed root, record the first frame with `data-ub-result="1"` and the first visible frame; require visibility on that frame or the immediately following frame.

Expected: blocked visible-frame count = 0; allowed classification-to-visible delta <= 1 animation frame.

- [ ] **Step 5: Verify unresolved-result isolation**

On a controlled/live-compatible opaque result case, confirm a still-unclassified root remains hidden while an independently classified allowed sibling is visible. Do not add a timeout that reveals the unresolved root.

Expected: unresolved root hidden; allowed sibling visible.

- [ ] **Step 6: Verify Images/vertical non-regression**

Navigate freshly to Google Images and verify the firewall does not target the explicit Images-page result roots and does not reproduce the prior multi-second whole-page delay. Record time-to-first-visible image result for diagnostic evidence.

Expected: no page-wide/firewall quarantine of Images-page roots and no approximately four-second delay attributable to this bridge.

- [ ] **Step 7: Run the complete live smoke command with the development bridge installed**

Run: `npm run test:live`

Expected: all existing cleanup/autoplay/YouTube ownership smoke cases remain green, plus the new bridge timing checks.

- [ ] **Step 8: Commit Task 2**

```powershell
git add tests/live/google-smoke.mjs
git commit -m "Verify Google result firewall timing"
```

### Task 3: Final acceptance and canonical persistence

**Files:**
- No production file additions.
- Verify only: `google_interface_cleanup.user.js`, repository metadata, plan/spec, and committed diff.

**Interfaces:**
- Consumes: Tasks 1-2 commits and all acceptance criteria from the spec.
- Produces: verified clean branch ready for canonical integration.

- [ ] **Step 1: Run final deterministic verification**

Run: `npm test`

Expected: complete deterministic suite passes with zero failures.

- [ ] **Step 2: Run final live desktop verification from a fresh navigation**

Run: `npm run test:live`

Expected: zero blocked visible frames, <=1-frame allowed release, no Images regression, and all pre-existing live smoke cases pass.

- [ ] **Step 3: Prove Google Cleanup was untouched**

Run:
```powershell
$base = git merge-base origin/main HEAD
git diff --exit-code $base HEAD -- google_interface_cleanup.user.js
git rev-parse "${base}:google_interface_cleanup.user.js"
git rev-parse HEAD:google_interface_cleanup.user.js
```

Expected: empty diff and identical blob SHAs.

- [ ] **Step 4: Run the internal completeness gate**

Mark every spec acceptance criterion AC-001..AC-020 and every user constraint PASS, N/A with concrete reason, or BLOCKED. In particular: no fail-open timer; no page-wide gate; direct/`/url`/embedded-`/goto`/network fallback/mixed-domain/YouTube/YouTube Music/News/late-`href` regressions green; Google Cleanup unchanged; autoplay tests green; live desktop timing proven; Safari/Macaque explicitly not claimed unless directly verified.

Expected: no mandatory item is failed, silently omitted, or falsely claimed. If a required platform records any blocked visible frame, stop acceptance and report it rather than weakening the criterion.

- [ ] **Step 5: Verify package and repository state**

Run:
```powershell
git status --short
git diff --check
git log --oneline --decorate -5
```

Expected: only intended committed files differ from the implementation base; no uncommitted runtime/test changes; no whitespace errors.

- [ ] **Step 6: Commit any plan-only bookkeeping if still uncommitted, then push the validated canonical branch**

Push only after every prior mandatory gate passes.

Expected: remote canonical state contains the validated commits and the local canonical checkout is clean and synchronized.
