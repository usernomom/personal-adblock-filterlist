// ==UserScript==
// @name         Reddit Safari Back Button Fix
// @namespace    local.reddit.safari.backfix
// @version      1.3.4-macaque-clean
// @description  Escape Reddit back/forward history traps in Safari, including current JS-challenge URLs.
// @match        https://reddit.com/*
// @match        https://*.reddit.com/*
// @run-at       document-start
// @grant        GM.log
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js
// @updateURL    https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js
// ==/UserScript==

(() => {
    'use strict';

    const TAG = '[reddit-safari-backfix]';
    const STATE_VERSION = '1.3.4-macaque-clean';

    const CONFIG = Object.freeze({
        minMsBetweenActions: 1200,
        maxActionsPerTab: 4,
        closeFallbackDelayMs: 350,
        closeBlockedFallback: 'forward',
        forwardDelayMs: 80,
    });

    const KEYS = Object.freeze({
        actionCount: '__reddit_backfix_action_count__',
        lastActionAt: '__reddit_backfix_last_action_at__',
        normalRedditSeen: '__reddit_backfix_normal_reddit_seen__',
        lastTrapUrl: '__reddit_backfix_last_trap_url__',
        stateVersion: '__reddit_backfix_state_version__',
    });

    const CHALLENGE_PARAMS = Object.freeze([
        'solution',
        'js_challenge',
        'token',
        'jsc_token',
        'jsc_orig_r',
    ]);

    function log(event, details = {}) {
        try {
            if (typeof GM !== 'undefined' && GM && typeof GM.log === 'function') {
                GM.log(TAG, event, details);
            }
        } catch (_) {
            // Diagnostics must never affect navigation.
        }
    }

    function ssGetString(key, fallback = '') {
        try {
            const value = sessionStorage.getItem(key);
            return value == null ? fallback : value;
        } catch (_) {
            return fallback;
        }
    }

    function ssSetString(key, value) {
        try {
            sessionStorage.setItem(key, String(value));
        } catch (_) {
            // Storage failures are non-fatal.
        }
    }

    function ssGetNumber(key, fallback = 0) {
        const value = Number(ssGetString(key, ''));
        return Number.isFinite(value) ? value : fallback;
    }

    function ssSetNumber(key, value) {
        ssSetString(key, Number(value));
    }

    function isRedditHost(hostname) {
        const host = String(hostname || '').toLowerCase();
        return host === 'reddit.com' || host.endsWith('.reddit.com');
    }

    function isTopWindow() {
        try {
            return window.top === window.self;
        } catch (_) {
            return false;
        }
    }

    function navType() {
        try {
            const entry = performance.getEntriesByType('navigation')[0];
            return entry && typeof entry.type === 'string' ? entry.type : '';
        } catch (_) {
            return '';
        }
    }

    function hasChallengeParams(rawUrl) {
        try {
            const url = new URL(String(rawUrl), location.href);
            if (!isRedditHost(url.hostname)) return false;
            return CHALLENGE_PARAMS.some(name => url.searchParams.has(name));
        } catch (_) {
            return false;
        }
    }

    function cleanUrl(rawUrl) {
        try {
            const url = new URL(String(rawUrl), location.href);
            if (!isRedditHost(url.hostname)) return String(rawUrl);

            for (const name of CHALLENGE_PARAMS) {
                url.searchParams.delete(name);
            }

            if (url.origin === location.origin) {
                return `${url.pathname}${url.search}${url.hash}`;
            }
            return url.href;
        } catch (_) {
            return String(rawUrl);
        }
    }

    function handleCloseBlocked(reason) {
        log('still-open-after-window-close', {
            reason,
            fallback: CONFIG.closeBlockedFallback,
            href: location.href,
        });

        if (CONFIG.closeBlockedFallback === 'stay') return;

        if (CONFIG.closeBlockedFallback === 'aboutblank') {
            try {
                location.replace('about:blank');
            } catch (error) {
                log('aboutblank-failed', { error: String(error) });
            }
            return;
        }

        setTimeout(() => {
            try {
                history.forward();
                log('history-forward', { reason });
            } catch (error) {
                log('history-forward-failed', { error: String(error) });
            }
        }, CONFIG.forwardDelayMs);
    }

    function actOnTrap(reason) {
        const now = Date.now();
        const nextCount = ssGetNumber(KEYS.actionCount, 0) + 1;
        const cleaned = cleanUrl(location.href);

        ssSetNumber(KEYS.actionCount, nextCount);
        ssSetNumber(KEYS.lastActionAt, now);
        ssSetString(KEYS.lastTrapUrl, location.href);

        log('trap-action', {
            reason,
            count: nextCount,
            before: location.href,
            cleaned,
        });

        try {
            history.replaceState(history.state, '', cleaned);
        } catch (error) {
            log('replaceState-failed', { error: String(error) });
        }

        try {
            window.close();
        } catch (error) {
            log('window-close-failed', { error: String(error) });
        }

        // Safari normally blocks window.close() for a tab it did not open via script.
        // The known-working Macaque strategy therefore always schedules the fallback.
        setTimeout(() => {
            handleCloseBlocked(reason);
        }, CONFIG.closeFallbackDelayMs);
    }

    if (!isTopWindow() || !isRedditHost(location.hostname)) return;

    // A Safari tab can survive userscript upgrades for months. Reset only the
    // bounded-action bookkeeping when this script version first runs in the tab,
    // so stale counters from an older build cannot disable the repaired logic.
    if (ssGetString(KEYS.stateVersion, '') !== STATE_VERSION) {
        ssSetNumber(KEYS.actionCount, 0);
        ssSetNumber(KEYS.lastActionAt, 0);
        ssSetString(KEYS.lastTrapUrl, '');
        ssSetString(KEYS.normalRedditSeen, '');
        ssSetString(KEYS.stateVersion, STATE_VERSION);
    }

    const initialHref = location.href;
    const initialHadChallenge = hasChallengeParams(initialHref);

    function runTrapCheck(trigger, { persisted = false, traversalHint = false } = {}) {
        const navigationType = navType();
        const now = Date.now();
        const actionCount = ssGetNumber(KEYS.actionCount, 0);
        const lastActionAt = ssGetNumber(KEYS.lastActionAt, 0);
        const normalRedditSeen = ssGetString(KEYS.normalRedditSeen, '');
        const underActionCap = actionCount < CONFIG.maxActionsPerTab;
        const outsideThrottle = lastActionAt === 0 || now - lastActionAt >= CONFIG.minMsBetweenActions;
        const shortHistory = history.length <= 2;
        const isBackForward = navigationType === 'back_forward';
        const isTraversal = persisted || traversalHint || isBackForward;
        const currentHasChallenge = hasChallengeParams(location.href);
        const restoredChallengeDocument = persisted && initialHadChallenge;
        const challengeTraversal = isTraversal && (currentHasChallenge || restoredChallengeDocument);
        const legacyShortHistoryTrap = isBackForward && shortHistory;

        if (!isTraversal) {
            ssSetString(KEYS.normalRedditSeen, cleanUrl(location.href));
        }

        log('trap-check', {
            trigger,
            href: location.href,
            initialHref,
            initialHadChallenge,
            navigationType,
            historyLength: history.length,
            persisted,
            traversalHint,
            actionCount,
            lastActionAt,
            normalRedditSeen,
            underActionCap,
            outsideThrottle,
            shortHistory,
            isBackForward,
            currentHasChallenge,
            restoredChallengeDocument,
            challengeTraversal,
            legacyShortHistoryTrap,
        });

        if (!underActionCap || !outsideThrottle) return;

        // Current Reddit can leave more than two history entries, so a challenge-
        // bearing traversal is poisoned regardless of total history length.
        if (challengeTraversal) {
            actOnTrap(
                persisted
                    ? 'pageshow-bfcache-challenge'
                    : traversalHint
                      ? 'popstate-challenge'
                      : 'back_forward-challenge',
            );
            return;
        }

        // Preserve the previously working generic Safari/Macaque escape for the
        // original short-history trap even when the visible URL looks normal.
        if (legacyShortHistoryTrap) {
            actOnTrap('back_forward-short-history');
        }
    }

    // Fresh non-BFCache back/forward traversals recreate the document, so the
    // document-start check handles them.
    runTrapCheck('document-start');

    // WebKit BFCache restores resume the old document instead of rerunning the
    // userscript. The original event listeners survive and pageshow is the signal
    // that the poisoned history entry has become active again.
    addEventListener(
        'pageshow',
        event => {
            if (!event.persisted) return;
            runTrapCheck('pageshow', { persisted: true });
        },
        true,
    );

    // Same-document history traversals do not create a new document or fire a
    // BFCache restore. Catch only challenge-bearing popstate entries to avoid
    // interfering with ordinary Reddit SPA navigation.
    addEventListener(
        'popstate',
        () => {
            if (!hasChallengeParams(location.href)) return;
            runTrapCheck('popstate', { traversalHint: true });
        },
        true,
    );
})();
