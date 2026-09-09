// ==UserScript==
// @name         Reddit Safari Back Button Fix
// @namespace    local.reddit.safari.backfix
// @version      1.4.7-macaque-clean
// @description  Close or escape Reddit's short Safari Back-history trap without interfering with ordinary navigation.
// @match        https://reddit.com/*
// @match        https://*.reddit.com/*
// @run-at       document-start
// @grant        GM.log
// @grant        GM_log
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js
// @updateURL    https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js
// ==/UserScript==

(() => {
    'use strict';

    const CONFIG = Object.freeze({
        debug: false,
        maxHistoryLengthForTrap: 2,
        tryCloseTabFirst: true,
        closeBlockedFallback: 'forward',
        closeFallbackDelayMs: 350,
        forwardFallbackDelayMs: 80,
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

    function shouldTreatAsTrap() {
        return (
            isTopWindow() &&
            isRedditHost(location.hostname) &&
            navType() === 'back_forward' &&
            historyLength() <= CONFIG.maxHistoryLengthForTrap
        );
    }

    function tryForwardNoOp() {
        setTimeout(() => {
            try {
                history.forward();
            } catch (error) {
                log('history.forward failed', String(error));
            }
        }, CONFIG.forwardFallbackDelayMs);
    }

    function handleCloseBlocked() {
        if (CONFIG.closeBlockedFallback === 'forward') {
            tryForwardNoOp();
            return;
        }
        if (CONFIG.closeBlockedFallback === 'aboutblank') {
            try {
                location.replace('about:blank');
            } catch (error) {
                log('about:blank fallback failed', String(error));
            }
        }
    }

    function actOnTrap() {
        const now = Date.now();
        if (actionCount >= CONFIG.maxActionsPerTab) return;
        if (now - lastActionAt < CONFIG.minMsBetweenActions) return;

        actionCount += 1;
        lastActionAt = now;
        replaceChallengeUrlWithCleanUrl();

        if (!CONFIG.tryCloseTabFirst) {
            handleCloseBlocked();
            return;
        }

        try {
            window.close();
        } catch (error) {
            log('window.close failed', String(error));
        }

        setTimeout(handleCloseBlocked, CONFIG.closeFallbackDelayMs);
    }

    function main() {
        if (!shouldTreatAsTrap()) return;
        actOnTrap();
    }

    main();
    addEventListener('pageshow', main, true);
})();
