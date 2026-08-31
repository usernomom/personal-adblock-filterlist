// ==UserScript==
// @name         Google search - open results in new tabs
// @namespace    https://github.com/usernomom/personal-adblock-filterlist
// @author       nobody
// @description  Open Google Search result links in new tabs while preserving uBlacklist and archive.ph link handling.
// @license      MIT
// @version      1
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_open_results_new_tab.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

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
        rel.add('noopener');
        anchor.setAttribute('rel', [...rel].join(' '));

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
