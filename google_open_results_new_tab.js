// ==UserScript==
// @name         Google search - open results in new tabs
// @namespace    https://github.com/usernomom/personal-adblock-filterlist
// @author       nobody
// @description  Open Google Search result links in new tabs while preserving uBlacklist and archive.ph link handling.
// @license      MIT
// @version      4
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_open_results_new_tab.js
// @updateURL    https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_open_results_new_tab.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const REDDIT_CHILD_MARKER = '__rbf_google_child';

    function isGoogleHost(hostname) {
        const host = String(hostname || '').toLowerCase();
        return host === 'google.com' || host.endsWith('.google.com') || /(^|\.)google\.[a-z.]+$/.test(host);
    }

    function isRedditHost(hostname) {
        const host = String(hostname || '').toLowerCase();
        return host === 'reddit.com' || host.endsWith('.reddit.com');
    }

    function externalDestination(rawHref) {
        try {
            const url = new URL(String(rawHref || ''), location.href);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
            if (!isGoogleHost(url.hostname)) return url;
            if (url.pathname !== '/url' && url.pathname !== '/goto') return null;

            for (const key of ['url', 'q']) {
                const rawTarget = url.searchParams.get(key);
                if (!rawTarget) continue;
                try {
                    const target = new URL(rawTarget, location.href);
                    if ((target.protocol === 'http:' || target.protocol === 'https:') && !isGoogleHost(target.hostname)) {
                        return target;
                    }
                } catch (_) {}
            }
        } catch (_) {}
        return null;
    }

    function bridgedDestination(anchor) {
        for (
            let node = anchor.parentElement;
            node && node !== document.body && node !== document.documentElement;
            node = node.parentElement
        ) {
            const proxies = node.querySelectorAll('a[data-ub-google-source-proxy-anchor][href]');
            if (!proxies.length) continue;
            if (proxies.length !== 1) return null;
            return externalDestination(proxies[0].getAttribute('href') || proxies[0].href);
        }
        return null;
    }

    function addRedditChildFragment(url) {
        const marker = `${REDDIT_CHILD_MARKER}=1`;
        const current = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
        const parts = current ? current.split('&').filter(Boolean) : [];
        if (!parts.includes(marker)) parts.push(marker);
        url.hash = parts.join('&');
    }

    function markRedditChild(anchor) {
        let original;
        try {
            original = new URL(anchor.getAttribute('href') || anchor.href, location.href);
        } catch (_) {
            return false;
        }

        const direct = externalDestination(original.href);
        const classified = direct && isRedditHost(direct.hostname) ? direct : bridgedDestination(anchor);
        if (!classified || !isRedditHost(classified.hostname)) return false;

        // The uBlacklist bridge is only a classification hint. Its hidden proxy
        // is not guaranteed to be a canonical navigation URL. Keep Google's own
        // /goto or /url intact and carry provenance in the fragment, which
        // survives the HTTP redirect without being sent to Reddit's server.
        if (isGoogleHost(original.hostname) && (original.pathname === '/goto' || original.pathname === '/url')) {
            addRedditChildFragment(original);
            anchor.href = original.href;
            return true;
        }

        if (direct && isRedditHost(direct.hostname)) {
            addRedditChildFragment(direct);
            anchor.href = direct.href;
            return true;
        }

        return false;
    }

    function findAnchor(event) {
        for (const node of event.composedPath()) {
            if (node instanceof HTMLAnchorElement) {
                return node;
            }
        }
        return null;
    }

    function isUsableHref(anchor) {
        const raw = anchor.getAttribute('href');
        return Boolean(
            raw &&
            !raw.startsWith('#') &&
            !raw.toLowerCase().startsWith('javascript:')
        );
    }

    function isSearchResult(anchor) {
        if (!(anchor instanceof HTMLAnchorElement) || !isUsableHref(anchor)) {
            return false;
        }

        // Ignore the hidden source-domain anchors inserted for uBlacklist.
        if (
            anchor.hidden ||
            anchor.getAttribute('aria-hidden') === 'true' ||
            anchor.hasAttribute('data-ub-news-source-proxy')
        ) {
            return false;
        }

        // Standard organic results: the clickable result link owns the heading.
        if (anchor.querySelector('h3, [role="heading"][aria-level="3"]')) {
            return true;
        }

        // Mobile Top Stories / news cards use Google redirect links and do not
        // consistently contain an h3, but are individually identified by this root.
        if (anchor.closest('[data-news-cluster-id]')) {
            return true;
        }

        return false;
    }

    function prepare(anchor) {
        if (!isSearchResult(anchor)) {
            return false;
        }

        anchor.target = '_blank';

        const rel = new Set(
            (anchor.getAttribute('rel') || '')
                .split(/\s+/)
                .filter(Boolean)
        );
        rel.delete('noopener');
        rel.delete('noreferrer');
        rel.add('opener');
        anchor.setAttribute('rel', [...rel].join(' '));

        // For Reddit results, carry an explicit child-tab marker without
        // replacing Google's own redirect URL.
        markRedditChild(anchor);

        return true;
    }

    function archiveScriptHasPrepared(anchor) {
        if (anchor.hasAttribute('data-archive-original-href')) {
            return true;
        }

        try {
            const host = new URL(anchor.href, location.href).hostname.toLowerCase();
            return ['archive.ph', 'archive.is', 'archive.today'].includes(host);
        } catch (_) {
            return false;
        }
    }

    // Set target early enough for taps, long-press menus, mouse clicks and
    // keyboard activation. Event delegation automatically handles dynamically
    // inserted Google results without a MutationObserver.
    for (const eventName of [
        'touchstart',
        'pointerdown',
        'mousedown',
        'contextmenu',
        'focusin'
    ]) {
        window.addEventListener(
            eventName,
            (event) => {
                const anchor = findAnchor(event);
                if (anchor) {
                    prepare(anchor);
                }
            },
            true
        );
    }

    // Google sometimes handles a result click in JavaScript and navigates the
    // current tab itself. For an ordinary left/touch click, stop Google's later
    // click handlers while leaving the browser's default anchor action intact.
    // Do not intercept a link already rewritten by the archive.ph userscript;
    // that script deliberately owns its final navigation.
    window.addEventListener(
        'click',
        (event) => {
            const anchor = findAnchor(event);

            if (!anchor || !prepare(anchor)) {
                return;
            }

            if (
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey &&
                !archiveScriptHasPrepared(anchor)
            ) {
                event.stopImmediatePropagation();
            }
        },
        true
    );
})();
