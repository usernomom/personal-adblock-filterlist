# Google Result Firewall Design

**Status:** In Review  
**Date:** 2026-09-19  
**Owner:** User (design authority); ChatGPT (document author)  
**Related request:** Eliminate blocked-result flicker on Google Search without reintroducing multi-second whole-page delays.  
**Supersedes:** The previous broad anti-flash shield approach that delayed large parts of Google Search and made Images take several seconds to appear.

## 1. Summary

Introduce a per-result, fail-closed visibility firewall for Google Search results. Instead of showing every result immediately and relying on uBlacklist to hide blocked domains afterward, recognized result roots begin hidden and become visible only after uBlacklist has positively classified them.

The design uses uBlacklist's existing runtime markers as the classification handshake. uBlacklist marks recognized results with `data-ub-result="1"`, then synchronously adds `data-ub-block="1"` when the current ruleset blocks that result. The Google uBlacklist bridge continues to expose exact destination URLs for opaque Google links so uBlacklist can classify them correctly.

The firewall is granular. It does not hide the whole results page, `#rso`, Images, or unrelated Google UI while one result is unresolved. Each result independently transitions from quarantined to allowed or blocked.

## 2. Problem and Context

Google Search increasingly renders result destinations through several link shapes:

- direct external URLs;
- Google `/url?... ` wrappers that can be decoded locally;
- opaque Google `/goto?... ` links whose external destination may need to be recovered from embedded Google data or, as a fallback, through a bounded network request.

The existing bridge exposes these destinations to uBlacklist by creating hidden proxy anchors. That allows uBlacklist to apply the user's blacklist policy to result shapes it otherwise cannot understand.

The remaining defect is timing. A result can become visible before uBlacklist has recognized and classified the result. When that result belongs to a blocked domain, it can appear briefly and then disappear. This is visually distracting and violates the user's requirement that blocked results should never be visible, even transiently.

A previous anti-flash attempt solved the flicker by gating too broad a portion of the page. That made otherwise valid content, especially Images, appear several seconds late. The new design must remove blocked-result flicker without restoring that page-level latency.

Source inspection of uBlacklist confirms a usable positive classification signal. Its filter:

1. discovers a result root;
2. extracts the URL;
3. sets `data-ub-result="1"`;
4. immediately evaluates the ruleset;
5. adds `data-ub-block="1"` if blocked;
6. on relevant URL mutation, removes the old result state and re-adds/re-judges the result.

This means the firewall does not need to infer uBlacklist completion from timing or create an independent blacklist oracle.

## 3. Goals and Non-Goals

### Goals

- **G-001:** Prevent blocked Google Search result roots from becoming visibly painted before uBlacklist classification.
- **G-002:** Preserve normal perceived load speed for allowed ordinary results.
- **G-003:** Keep classification authority in uBlacklist; do not duplicate or fork the user's blacklist rules into the userscript.
- **G-004:** Preserve exact-host behavior, including distinctions such as `youtube.com` versus `music.youtube.com`.
- **G-005:** Preserve the existing bridge's direct-link, `/url`, embedded-data, and bounded `/goto` resolution paths.
- **G-006:** Preserve existing Google interface-cleanup behavior, including video-autoplay suppression and unrelated module cleanup.
- **G-007:** Fail closed for unresolved or unclassified result roots rather than introducing a timer that eventually reveals them.

### Non-Goals

- **NG-001:** Do not replace uBlacklist as the user's domain-policy engine.
- **NG-002:** Do not maintain a second blacklist inside `google_interface_cleanup.user.js` or the bridge.
- **NG-003:** Do not hide the entire results page while classification is pending.
- **NG-004:** Do not restore the previous broad anti-flash shield.
- **NG-005:** Do not guarantee compatibility with arbitrary future Google DOM structures that no implemented selector recognizes; such structures must instead fail closed where they match the firewall's protected result classes.
- **NG-006:** Do not change Google video-autoplay policy or unrelated cleanup heuristics as part of this work.

## 4. User / Operator Scenarios

### US-001 — Blocked ordinary result

A normal Google Search result belongs to a domain blocked by uBlacklist.

Expected behavior: the result root never becomes visibly rendered. It begins quarantined, uBlacklist recognizes it, adds `data-ub-result` and `data-ub-block`, and the firewall keeps it hidden.

### US-002 — Allowed ordinary result

A normal result belongs to an allowed domain.

Expected behavior: it begins quarantined, uBlacklist recognizes it, adds `data-ub-result` without `data-ub-block`, and the firewall releases it immediately. The added latency should be no more than the classification/rendering interval itself, not an arbitrary fixed timeout.

### US-003 — Opaque `/goto` result with embedded mapping

Google renders an opaque destination but the bridge finds its real target in Google-provided embedded data.

Expected behavior: the result remains quarantined until the exact destination is exposed to uBlacklist. uBlacklist classifies it and the firewall either releases or keeps it hidden.

### US-004 — Opaque `/goto` result requiring network fallback

The exact destination is not available from embedded data and the bridge uses its bounded network fallback.

Expected behavior: only that result remains quarantined while resolution is in progress. Other results continue through their own independent classification path.

### US-005 — Dynamically inserted result

Google lazy-loads or replaces a result after the initial render.

Expected behavior: the result is quarantined by CSS before it can become visibly painted, then follows the same bridge -> uBlacklist -> release/block flow.

### US-006 — Result URL changes after initial classification

Google mutates the link of an already classified result.

Expected behavior: uBlacklist removes the prior result state and re-evaluates the root. The firewall must not reveal stale state during the reclassification window.

### US-007 — Vertical / Images page

The user opens a Google vertical such as Images.

Expected behavior: no page-wide quarantine is introduced. Only result shapes explicitly covered by the result firewall participate. The prior multi-second Images regression must not return.

### US-008 — Classification infrastructure fails

A candidate result never obtains a usable external destination or uBlacklist never marks it as a recognized result.

Expected behavior: that result remains hidden. The system must not reveal it after a timeout merely to avoid an empty slot.

## 5. Requirements

### Functional

- **FR-001:** The bridge MUST install the firewall styling at `document-start` as early as the userscript environment permits.
- **FR-002:** The firewall MUST hide only recognized/protected Google result-root shapes that have not yet reached a valid released state.
- **FR-003:** A result MUST become eligible for visibility only when uBlacklist has marked the result root with `data-ub-result="1"`.
- **FR-004:** A result with `data-ub-block` MUST remain hidden.
- **FR-005:** A result with `data-ub-result="1"` and no `data-ub-block` MAY be released immediately.
- **FR-006:** There MUST be no fail-open timer that reveals a still-unclassified result.
- **FR-007:** The bridge MUST continue to expose exact external destinations without rewriting the user's visible result link.
- **FR-008:** Direct external URLs MUST continue to avoid unnecessary network resolution.
- **FR-009:** Google `/url` wrappers MUST continue to resolve locally where possible.
- **FR-010:** Google `/goto` results MUST continue to prefer embedded mapping data before network fallback.
- **FR-011:** Network fallback MUST remain bounded and deduplicated as in the existing bridge.
- **FR-012:** One unresolved result MUST NOT delay independent allowed results.
- **FR-013:** Dynamic insertion and `href` mutation MUST cause affected result roots to be reprocessed.
- **FR-014:** The firewall MUST coexist with uBlacklist's own blocked-result CSS rather than replace it.
- **FR-015:** Existing Google interface cleanup and autoplay-blocking behavior MUST remain functionally unchanged.

### Non-Functional

- **NFR-001:** Ordinary allowed direct results should become visible within no more than one rendering cycle after uBlacklist classification.
- **NFR-002:** Blocked or unresolved protected result roots must have zero observable visible frames in instrumented timing tests.
- **NFR-003:** The design must avoid whole-page polling, whole-page visibility gates, and fixed multi-second release delays.
- **NFR-004:** The firewall CSS and observer logic must remain narrowly scoped to Google Search result structures already handled by the bridge.
- **NFR-005:** Failure behavior must be deterministic and fail closed.
- **NFR-006:** Deterministic tests must cover state transitions rather than rely only on visual manual verification.
- **NFR-007:** Live verification must include at least one desktop Chromium/Neon path and the user's Safari/Macaque path when feasible because userscript injection timing differs by environment.

## 6. Constraints

- **C-001:** uBlacklist remains the authoritative blacklist ruleset.
- **C-002:** The userscripts may observe uBlacklist DOM markers but must not depend on undocumented internal JavaScript objects or extension-private APIs.
- **C-003:** The design may depend on the publicly observable attributes `data-ub-result` and `data-ub-block`, verified against the current uBlacklist implementation at design time.
- **C-004:** The solution must run under the existing userscript managers and permissions already used by this repository.
- **C-005:** The solution must not require modifying the uBlacklist extension itself.
- **C-006:** The existing bridge's Google destination-resolution behavior must be preserved unless tests demonstrate a necessary correction.
- **C-007:** The previous broad anti-flash behavior that delayed whole result regions is prohibited.
- **C-008:** No user-visible result may be revealed solely because an arbitrary timeout expired.
- **C-009:** Existing stable userscript installation/update conventions, metadata, versioning, and repository validation remain mandatory.

## 7. Proposed Design

### Architecture

The bridge becomes the coordination point for result readiness, while uBlacklist remains the policy engine.

The browser-visible state is derived from two pieces of information:

1. whether the root is a protected Google result candidate; and
2. whether uBlacklist has positively classified it.

A protected result begins in a quarantined state through CSS. The bridge ensures that uBlacklist sees the exact destination. uBlacklist then marks the root as a recognized result and, when applicable, as blocked. CSS releases only the recognized, non-blocked case.

The firewall therefore separates three concerns cleanly:

- **Google destination recovery:** bridge;
- **blacklist policy judgment:** uBlacklist;
- **pre-paint visibility enforcement:** firewall CSS/state.

No component duplicates the responsibilities of another.

### Components

#### Result firewall stylesheet

Installed at startup by `google_news_ublacklist_bridge.user.js`.

Its job is only to express visibility from result state. The exact selectors must be derived from the bridge's existing root knowledge and regression fixtures, not from a new broad page container selector.

Conceptually:

```css
/* Protected candidate not yet classified */
<protected-result-selector>:not([data-ub-result]) {
    display: none !important;
}

/* Classified and blocked */
<protected-result-selector>[data-ub-block] {
    display: none !important;
}

/* Classified and allowed */
<protected-result-selector>[data-ub-result]:not([data-ub-block]) {
    /* no firewall hide */
}
```

The final implementation may use a dedicated bridge candidate attribute if necessary to prevent over-broad matching. If used, that attribute must be applied synchronously when the bridge identifies a root and must not replace uBlacklist's classification markers.

#### Existing destination bridge

The bridge continues to:

- parse direct external links;
- decode Google `/url` wrappers;
- recover `/goto` mappings from `W_jd`, scripts, comments, and related embedded Google payloads;
- perform deduplicated bounded network fallback when required;
- create exact-destination hidden proxy anchors for uBlacklist;
- preserve the visible Google anchor.

#### uBlacklist classification

No modification is made to uBlacklist.

The firewall treats:

- `data-ub-result="1"` as the positive classification-complete marker for the current extracted result state;
- `data-ub-block="1"` as the blocked decision.

Because uBlacklist removes and reconstructs result state when relevant result data changes, the firewall must tolerate transient removal of `data-ub-result` by returning the root to quarantine until reclassification completes.

#### Existing Google interface cleanup

`google_interface_cleanup.user.js` remains responsible for structural cleanup and autoplay suppression. Ordinary destination blocking remains explicitly outside that script.

### Flow

```text
Google inserts / mutates result root
            |
            v
Result matches protected result shape
            |
            v
Firewall quarantine applies
(result hidden before classification)
            |
            v
Bridge inspects destination
       /        |         \
      /         |          \
 direct URL   /url wrapper   /goto opaque
      |          |              |
      |       decode local       |
      |          |       embedded mapping?
      |          |          /        \
      |          |        yes         no
      |          |         |           |
      |          |         |      bounded network
      \__________|_________|___________/
                 |
                 v
Bridge exposes exact destination
to uBlacklist-readable result/proxy
                 |
                 v
uBlacklist recognizes result
and sets data-ub-result
                 |
          +------+------+
          |             |
          v             v
 data-ub-block      no data-ub-block
      present
          |             |
          v             v
 remain hidden      release result
          |             |
          +------+------+ 
                 |
                 v
Later href/result mutation?
          |             |
        yes             no
          |             |
          v             v
uBlacklist removes   stable final
old result state       state
          |
          v
quarantine resumes
until reclassification
```

The essential property is that no page-wide gate exists. Each result moves through the flow independently.

### Interfaces

The design deliberately uses only DOM-level contracts between independently maintained components.

Bridge -> uBlacklist interface:

- hidden proxy anchor with exact external `href`;
- bridge-compatible result-root structure/classes already used today.

uBlacklist -> firewall interface:

- `data-ub-result`: result recognized and judged for the current state;
- `data-ub-block`: judgment is block.

Bridge internal interface:

- existing `gotoMap`, pending-link tracking, direct-link registration, embedded-data scanning, and network fallback.

The firewall must not invoke uBlacklist internals or assume access to extension storage.

### State

A protected result has four conceptual states:

1. **Quarantined / unclassified**
   - protected result root identified;
   - no valid `data-ub-result`;
   - hidden.

2. **Classified allowed**
   - `data-ub-result="1"`;
   - no `data-ub-block`;
   - visible.

3. **Classified blocked**
   - `data-ub-result="1"`;
   - `data-ub-block="1"`;
   - hidden.

4. **Reclassification**
   - prior classification invalidated by mutation;
   - `data-ub-result` removed by uBlacklist;
   - hidden again until a new classification is produced.

No timeout-based fifth state exists.

### Failure / Recovery

If direct URL parsing fails, the result remains quarantined unless another bridge path resolves it.

If embedded mapping is absent for a `/goto` result, the existing bounded network fallback runs.

If network fallback exhausts its attempts, the result remains quarantined.

If uBlacklist is unavailable, disabled, fails to recognize the result, or otherwise never emits `data-ub-result`, the affected protected result remains quarantined.

If a Google DOM change causes a result not to match any protected selector, that is a coverage failure rather than a reason to broaden the firewall blindly. Regression/live tests must detect the new shape and the selector set must be updated deliberately.

Recovery from a future uBlacklist marker change is a compatibility update: tests should fail because classification never transitions to the allowed state, rather than silently failing open.

### Security

The change adds no new credential or account access.

The bridge's existing cross-origin resolution capability remains unchanged. No additional network destinations or broader permissions are introduced.

Fail-closed behavior reduces unintended exposure of blocked result domains during transient classification.

### Compatibility

The design must preserve:

- existing Google domains covered by the userscripts;
- existing uBlacklist bridge proxy behavior;
- direct, `/url`, and `/goto` result resolution;
- mixed-domain modules;
- YouTube and YouTube Music exact-host distinctions;
- News-specific handling;
- dynamic/lazy-loaded results;
- current Google interface cleanup;
- current video-autoplay suppression;
- explicit vertical pages without a page-wide shield.

The implementation must not assume desktop-only Google markup. Existing mobile/Safari fixtures remain relevant and additional fixtures should be added for every protected root shape used by the firewall.

### Operations

The bridge version must be incremented when behavior changes.

Deterministic tests must run before live verification.

Live verification must use a fresh navigation with the actual userscript automatically loaded; manual injection is not acceptable evidence.

Browser test cleanup must restore the original tab set and selection.

The repository remains canonical only after validated changes are committed and pushed.

## 8. Alternatives Considered

### A. Keep current bridge only and tolerate flicker

Rejected because blocked results can become visible before uBlacklist hides them.

### B. Broad page/region anti-flash shield

Previously implemented and rejected. It prevented flicker by delaying too much content, producing multi-second visual latency including delayed Images.

### C. Duplicate the blacklist inside the userscript

Rejected because it creates two policy sources, risks divergence from uBlacklist, complicates updates, and violates the existing architectural separation.

### D. Infer uBlacklist completion with a timer

Rejected because a timeout cannot distinguish “allowed” from “not yet classified” and necessarily fails open under slow or broken conditions.

### E. Build a separate canary/oracle handshake

No longer needed as the primary design. Source inspection shows that uBlacklist already exposes a positive result-recognition marker (`data-ub-result`) plus the block marker (`data-ub-block`).

A canary may still be useful in diagnostics or compatibility testing, but it should not be part of normal result visibility control unless implementation testing proves the real markers insufficient.

### F. Modify/fork uBlacklist

Rejected as unnecessary and operationally expensive. The required classification state is already externally observable.

## 9. Risks and Trade-Offs

### R-001 — Userscript injection timing

A `document-start` userscript still runs within the timing guarantees of its userscript manager. A theoretical browser paint before the manager installs the firewall cannot be ruled out solely from code inspection.

Mitigation: instrument real desktop and Safari/Macaque runs and require zero visible blocked frames before declaring the implementation successful.

### R-002 — Selector coverage

If Google introduces a result structure outside the protected selectors, that shape may bypass quarantine.

Mitigation: derive selectors from current bridge root logic and fixtures; add live audits that enumerate visible result roots and verify each is either protected or deliberately excluded.

### R-003 — False-positive quarantine

An over-broad protected selector could hide non-result UI indefinitely.

Mitigation: do not gate `#rso`, `#botstuff`, generic containers, or whole vertical pages. Keep selectors at result-root granularity and add preservation fixtures.

### R-004 — Allowed opaque-result latency

An allowed result whose destination requires network fallback may remain hidden longer than a direct result.

This is intentional. The design prioritizes “never reveal an unclassified result” over forcing every result to appear immediately.

### R-005 — uBlacklist marker compatibility

The design depends on observable marker names and lifecycle.

Mitigation: deterministic integration tests assert the expected marker contract; failure must be conspicuous and fail closed.

### R-006 — Empty gaps while classification is pending

Per-result quarantine can temporarily leave a blank slot.

This is preferable to whole-page delay and preferable to showing a domain that may be blocked. Existing gap-collapse behavior may be reused where it is structurally safe.

## 10. Rollout / Migration / Rollback

Implementation should proceed behind the existing bridge only; no new script is required unless testing proves separation necessary.

Rollout sequence:

1. Add deterministic firewall state-transition tests that fail against the current bridge.
2. Add the narrow startup firewall CSS/state support.
3. Preserve current bridge resolution logic.
4. Run the full deterministic Google suite.
5. Verify normal allowed direct-result latency.
6. Verify blocked-result zero-frame behavior on desktop.
7. Verify dynamic and opaque-result cases.
8. Verify Images/vertical pages for absence of broad loading delay.
9. Verify Safari/Macaque timing when feasible.
10. Commit and push only after all mandatory acceptance criteria pass.

Rollback is a normal revert of the firewall-specific bridge changes. Existing destination resolution and uBlacklist behavior should remain independently functional.

If live timing tests show that the userscript manager cannot install the quarantine before first paint on a required platform, the implementation must not be presented as solving the zero-flicker requirement. That finding would require a new architectural decision rather than a silent relaxation.

## 11. Acceptance Criteria

- **AC-001:** A deterministic blocked-result fixture is hidden before and after `data-ub-result` / `data-ub-block` classification.
- **AC-002:** A deterministic allowed-result fixture begins hidden and becomes visible immediately after `data-ub-result` appears without `data-ub-block`.
- **AC-003:** Removing `data-ub-result` from a previously allowed result returns it to quarantine until reclassification.
- **AC-004:** There is no fail-open timeout in source or tests.
- **AC-005:** Direct external allowed results require no bridge network request.
- **AC-006:** `/url` wrappers continue to resolve locally.
- **AC-007:** Embedded `/goto` mappings continue to classify without network fallback.
- **AC-008:** Network fallback remains bounded, deduplicated, and isolated to affected results.
- **AC-009:** One unresolved result does not keep other independently classified allowed results hidden.
- **AC-010:** Existing mixed-domain, mobile, News, YouTube, YouTube Music, late-`href`, and exact-path bridge regressions remain green.
- **AC-011:** Existing `google_interface_cleanup.user.js` deterministic tests remain green.
- **AC-012:** Existing autoplay behavior remains green.
- **AC-013:** Explicit vertical-page tests show no page-wide gating.
- **AC-014:** Live desktop instrumentation records zero visible frames for blocked protected results.
- **AC-015:** Live allowed ordinary direct results show no fixed multi-second release delay and become visible no later than one rendering cycle after uBlacklist classification.
- **AC-016:** Live Images navigation does not reproduce the prior approximately four-second loading regression.
- **AC-017:** Safari/Macaque verification, when available, records zero visible blocked frames for the tested protected result shapes.
- **AC-018:** If any required platform cannot meet zero-frame blocked-result behavior, the task is reported as not fully accepted rather than weakening the criterion.
- **AC-019:** Stable package metadata/versioning and repository validation pass.
- **AC-020:** Final canonical repository state is clean, committed, and pushed.

## 12. Traceability

| Goal / Requirement | Scenario | Acceptance |
| --- | --- | --- |
| G-001, FR-002..FR-006 | US-001, US-005, US-006, US-008 | AC-001..AC-004, AC-014, AC-017, AC-018 |
| G-002, FR-012, NFR-001, NFR-003 | US-002, US-004, US-007 | AC-009, AC-015, AC-016 |
| G-003, C-001, C-005 | US-001, US-002 | AC-001, AC-002, AC-010 |
| G-004, FR-007 | US-001..US-006 | AC-010 |
| G-005, FR-008..FR-011 | US-003, US-004 | AC-005..AC-010 |
| G-006, FR-015 | US-007 | AC-011, AC-012, AC-016 |
| G-007, FR-006, NFR-005 | US-008 | AC-003, AC-004, AC-018 |
| C-007, C-008 | US-002, US-007, US-008 | AC-004, AC-015, AC-016 |

## 13. Open Questions

None are required before implementation planning.

The remaining uncertainty is empirical rather than a user decision: whether each required userscript manager installs the firewall early enough to achieve the zero-visible-frame acceptance criterion. That is explicitly resolved by implementation-time timing tests, not by weakening the design.

## 14. Decision

**Pending written-spec approval.**

The design direction approved conversationally is:

- per-result fail-closed quarantine;
- uBlacklist remains policy authority;
- `data-ub-result` is the positive classification handshake;
- `data-ub-block` is the blocked state;
- no page-wide gate;
- no fail-open timer;
- no duplicated blacklist;
- no new canary/oracle unless real testing proves the uBlacklist markers insufficient.

Implementation planning must not begin until this written specification is explicitly approved.

## 15. References

- `google_news_ublacklist_bridge.user.js`
- `google_interface_cleanup.user.js`
- `tests/deterministic/google-ublacklist-bridge.test.js`
- `tests/deterministic/google-cleanup.test.js`
- uBlacklist source at commit `0ca455399f97d5d2c978b993dd00b36c23d070e8`:
  - `src/scripts/content-script/constants.ts`
  - `src/scripts/content-script/filter.ts`
  - `src/scripts/content-script/index.ts`
  - `src/scripts/content-script/style-builders.ts`
- Existing repository history:
  - `4e45623` — Delegate Google domain filtering to uBlacklist
  - `2779f9b` — Keep website filtering in uBlacklist bridge
  - prior anti-flash experiment and subsequent revert to avoid multi-second result/Images delay
