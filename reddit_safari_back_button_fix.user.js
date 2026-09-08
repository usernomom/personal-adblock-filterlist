// ==UserScript==
// @name         Reddit Safari Back Button Fix
// @namespace    local.reddit.safari.backfix
// @version      1.3.2-macaque-clean
// @description  Prevent Reddit JavaScript challenge URLs from trapping Safari's Back button.
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
    const CHALLENGE_PARAMS = Object.freeze([
        'solution',
        'js_challenge',
        'token',
        'jsc_token',
        'jsc_orig_r',
    ]);

    function isRedditHost(hostname) {
        const host = String(hostname || '').toLowerCase();
        return host === 'reddit.com' || host.endsWith('.reddit.com');
    }

    function log(...parts) {
        try {
            if (typeof GM !== 'undefined' && GM && typeof GM.log === 'function') {
                GM.log(TAG, ...parts);
                return;
            }
        } catch (_) {
            // Ignore userscript-manager logging failures.
        }

        try {
            if (typeof GM_log === 'function') GM_log([TAG, ...parts].join(' '));
        } catch (_) {
            // Logging must never affect navigation.
        }
    }

    function cleanRedditUrl(rawUrl, baseUrl = location.href) {
        try {
            const url = new URL(String(rawUrl), baseUrl);
            if (!isRedditHost(url.hostname)) return rawUrl;

            let changed = false;
            for (const name of CHALLENGE_PARAMS) {
                if (!url.searchParams.has(name)) continue;
                url.searchParams.delete(name);
                changed = true;
            }

            if (!changed) return rawUrl;

            if (url.origin === location.origin) {
                return `${url.pathname}${url.search}${url.hash}`;
            }
            return url.href;
        } catch (_) {
            return rawUrl;
        }
    }

    function scrubCurrentUrl(reason) {
        const before = location.href;
        const cleaned = cleanRedditUrl(before);
        const currentRelative = `${location.pathname}${location.search}${location.hash}`;
        if (cleaned === before || cleaned === currentRelative) return false;

        try {
            history.replaceState(history.state, '', cleaned);
            log('scrubbed challenge URL', reason, cleaned);
            return true;
        } catch (error) {
            log('replaceState failed', reason, String(error));
            return false;
        }
    }

    function wrapHistoryMethod(name) {
        const original = history[name];
        if (typeof original !== 'function') return;

        history[name] = function patchedHistoryMethod(state, title, url) {
            if (url == null) return original.apply(this, arguments);
            const cleaned = cleanRedditUrl(url, location.href);
            return original.call(this, state, title, cleaned);
        };
    }

    // Server-side JS-challenge navigations create a new document. Replacing that
    // entry at document-start prevents the challenge URL from becoming the Safari
    // Back destination while preserving the actual Reddit destination.
    scrubCurrentUrl('document-start');

    // Reddit also mutates history client-side. Sanitize those writes before they
    // can create another challenge-flavoured entry.
    wrapHistoryMethod('pushState');
    wrapHistoryMethod('replaceState');

    const rescrub = event => scrubCurrentUrl(event.type);
    addEventListener('pageshow', rescrub, true);
    addEventListener('popstate', rescrub, true);
    addEventListener('hashchange', rescrub, true);
})();
