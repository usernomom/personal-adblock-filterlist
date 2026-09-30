// ==UserScript==
// @name         Reddit Safari Back Button Fix
// @namespace    local.reddit.safari.backfix
// @version      1.4.12-macaque-clean
// @description  Escape Reddit's short Safari Back-history trap without closing other tabs or interfering with ordinary navigation.
// @match        https://reddit.com/*
// @match        https://*.reddit.com/*
// @run-at       document-start
// @grant        GM.log
// @grant        GM_log
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js
// @updateURL    https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js
// ==/UserScript==

/*
 * BEHAVIOUR SPEC - the live-test contract (tests/ios/LIVE_TESTING.md).
 * Each rule is tested exactly as written, by ID; nothing outside it is.
 * Rules change only on the owner's request.
 *
 * RB-1 Back trap escape. When a top-level Reddit page is reached by Back or
 *      Forward (or restored from the back-forward cache, or returned to as
 *      the same history entry) and the tab's history has at most 2 entries,
 *      it sets data-reddit-safari-backfix-action=blank-replace and after
 *      0.5 s replaces the page with about:blank (no new history entry). At
 *      most 4 times per tab, and not within 1.2 s of the previous escape.
 * RB-2 Challenge parameters. Before escaping, the solution, js_challenge,
 *      token and jsc_orig_r parameters are removed from the current URL.
 * RB-3 Must not act on ordinary navigation (first visits, link clicks,
 *      reloads) or on tabs with longer history, and never closes tabs.
 * Test marker: html[data-reddit-safari-backfix-version] = @version.
 */

(() => {
    'use strict';

    const VERSION = '1.4.12-macaque-clean';
    function publishVersion() {
        document.documentElement?.setAttribute('data-reddit-safari-backfix-version', VERSION);
    }
    publishVersion();
    addEventListener('DOMContentLoaded', publishVersion, { once: true });
    addEventListener('pageshow', publishVersion, true);

    const CONFIG = Object.freeze({
        debug: false,
        maxHistoryLengthForTrap: 2,
        escapeDelayMs: 500,
        minMsBetweenActions: 1200,
        maxActionsPerTab: 4,
        cleanChallengeParams: true,
    });

    const CHALLENGE_PARAMS = Object.freeze([
        'solution',
        'js_challenge',
        'token',
        'jsc_orig_r',
    ]);

    const RETURN_MARKER_KEY = 'reddit-safari-backfix-return';
    const ENTRY_ID_KEY = '__redditSafariBackfixEntry';

    function currentEntryId() {
        try {
            const state = history.state;
            if (state !== null && (typeof state !== 'object' || Array.isArray(state) ||
                (Object.getPrototypeOf(state) !== Object.prototype &&
                 Object.getPrototypeOf(state) !== null))) return null;
            if (typeof state?.[ENTRY_ID_KEY] === 'string') return state[ENTRY_ID_KEY];
            const id = globalThis.crypto?.randomUUID?.() ||
                `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            history.replaceState({ ...state, [ENTRY_ID_KEY]: id }, '');
            return id;
        } catch (_) {
            return null;
        }
    }
    // Tag the actual history entry. Session storage alone cannot distinguish
    // Back from a same-path redirect, or from a newly opened tab.
    currentEntryId();
    let lastActionAt = 0;
    let actionCount = 0;

    function log(...parts) {
        if (!CONFIG.debug) return;
        try {
            if (typeof GM !== 'undefined' && GM && typeof GM.log === 'function') {
                GM.log('[reddit-safari-backfix]', ...parts);
                return;
            }
        } catch (_) {}
        try {
            if (typeof GM_log === 'function') {
                GM_log(['[reddit-safari-backfix]', ...parts].join(' '));
            }
        } catch (_) {}
    }

    function isTopWindow() {
        try {
            return window.top === window.self;
        } catch (_) {
            return false;
        }
    }

    function isRedditHost(hostname) {
        const host = String(hostname || '').toLowerCase();
        return host === 'reddit.com' || host.endsWith('.reddit.com');
    }

    function navType() {
        try {
            const entry = performance.getEntriesByType('navigation')[0];
            if (entry && entry.type) return entry.type;
        } catch (_) {}
        try {
            if (performance.navigation && performance.navigation.type === 2) {
                return 'back_forward';
            }
        } catch (_) {}
        return 'navigate';
    }

    function historyLength() {
        try {
            return history.length;
        } catch (_) {
            return 0;
        }
    }

    function rememberDeparture() {
        try {
            sessionStorage.setItem(RETURN_MARKER_KEY, JSON.stringify({
                path: location.pathname, historyLength: historyLength(), entryId: currentEntryId()
            }));
        } catch (_) {}
    }

    function consumeDepartureMarker() {
        try {
            const raw = sessionStorage.getItem(RETURN_MARKER_KEY);
            sessionStorage.removeItem(RETURN_MARKER_KEY);
            if (!raw) return false;
            const prior = JSON.parse(raw);
            const entryId = currentEntryId();
            return entryId !== null && prior.entryId === entryId &&
                prior.path === location.pathname && historyLength() > prior.historyLength;
        } catch (_) {
            return false;
        }
    }

    function cleanUrl(rawUrl) {
        try {
            const url = new URL(String(rawUrl), location.href);
            if (!isRedditHost(url.hostname)) return rawUrl;
            for (const name of CHALLENGE_PARAMS) {
                url.searchParams.delete(name);
            }
            return url.origin === location.origin
                ? `${url.pathname}${url.search}${url.hash}`
                : url.href;
        } catch (_) {
            return rawUrl;
        }
    }

    function hasChallengeParams(rawUrl = location.href) {
        try {
            const url = new URL(String(rawUrl), location.href);
            return CHALLENGE_PARAMS.some(name => url.searchParams.has(name));
        } catch (_) {
            return false;
        }
    }

    function replaceChallengeUrlWithCleanUrl() {
        if (!CONFIG.cleanChallengeParams || !hasChallengeParams()) return false;
        const cleaned = cleanUrl(location.href);
        try {
            history.replaceState(history.state, '', cleaned);
            log('cleaned challenge URL', cleaned);
            return true;
        } catch (error) {
            log('replaceState failed', String(error));
            return false;
        }
    }

    function shouldTreatAsTrap(restoredFromCache = false) {
        return (
            isTopWindow() &&
            isRedditHost(location.hostname) &&
            (navType() === 'back_forward' || restoredFromCache) &&
            historyLength() <= CONFIG.maxHistoryLengthForTrap
        );
    }

    function escapeToBlank() {
        document.documentElement?.setAttribute('data-reddit-safari-backfix-action', 'blank-replace');
        setTimeout(() => {
            try {
                location.replace('about:blank');
            } catch (error) {
                log('location.replace failed', String(error));
            }
        }, CONFIG.escapeDelayMs);
    }

    function actOnTrap() {
        const now = Date.now();
        if (actionCount >= CONFIG.maxActionsPerTab) return;
        if (now - lastActionAt < CONFIG.minMsBetweenActions) return;

        actionCount += 1;
        lastActionAt = now;
        replaceChallengeUrlWithCleanUrl();

        escapeToBlank();
    }

    function main(event) {
        const returnedFromHistory = (event?.type === 'pageshow' && event.persisted === true) ||
            consumeDepartureMarker();
        if (!shouldTreatAsTrap(returnedFromHistory)) return;
        actOnTrap();
    }

    addEventListener('pagehide', rememberDeparture, true);
    main();
    addEventListener('pageshow', main, true);
})();
