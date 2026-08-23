// ==UserScript==
// @name         Open paywalled articles through archive.ph
// @namespace    https://github.com/usernomom/personal-adblock-filterlist
// @author       nobody
// @description  Opens supported article links through archive.ph without interfering with uBlacklist
// @version      9
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/paywall_redirect_archive.js
// @match        http://*/*
// @match        https://*/*
// @exclude      https://archive.ph/*
// @exclude      https://archive.is/*
// @exclude      https://archive.today/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const ARCHIVE_PREFIX = 'https://archive.ph/newest/';

    /*
     * Handles URLs opened from Safari's address bar, bookmarks, Mail,
     * Messages, native apps, or pages where the source link was inaccessible.
     */
    const REDIRECT_DIRECT_NAVIGATIONS = true;

    function isArchiveURL(url) {
        const hostname = url.hostname.toLowerCase();

        return [
            'archive.ph',
            'archive.is',
            'archive.today'
        ].includes(hostname);
    }

    function isSupportedURL(url) {
        if (!['http:', 'https:'].includes(url.protocol)) {
            return false;
        }

        const hostname = url.hostname.toLowerCase();
        const pathname = url.pathname;

        // Wall Street Journal
        if (hostname === 'www.wsj.com') {
            return pathname !== '/';
        }

        // Toronto Star
        if (hostname === 'www.thestar.com') {
            return pathname !== '/';
        }

        // Financial Times articles
        if (
            hostname === 'ft.com' ||
            hostname === 'www.ft.com' ||
            hostname.endsWith('.ft.com')
        ) {
            return pathname.startsWith('/content/');
        }

        // Bloomberg articles
        if (
            hostname === 'bloomberg.com' ||
            hostname.endsWith('.bloomberg.com')
        ) {
            return pathname.includes('/articles/');
        }

        // Haaretz
        if (
            hostname === 'haaretz.com' ||
            hostname.endsWith('.haaretz.com')
        ) {
            return true;
        }

        // The Economist
        if (
            hostname === 'economist.com' ||
            hostname.endsWith('.economist.com')
        ) {
            return true;
        }

        return false;
    }

    function makeArchiveURL(input) {
        const url = input instanceof URL
            ? new URL(input.href)
            : new URL(input, location.href);

        // Remove tracking parameters and page fragments.
        url.search = '';
        url.hash = '';

        return ARCHIVE_PREFIX + url.href;
    }

    /*
     * Direct-navigation fallback.
     *
     * This does not apply when a link on a webpage is intercepted below.
     * It applies only when Safari has already navigated directly to the
     * publisher URL through another route.
     */
    const currentURL = new URL(location.href);

    if (
        REDIRECT_DIRECT_NAVIGATIONS &&
        !isArchiveURL(currentURL) &&
        isSupportedURL(currentURL)
    ) {
        location.replace(makeArchiveURL(currentURL));
        return;
    }

    function findAnchor(event) {
        for (const node of event.composedPath()) {
            if (node instanceof HTMLAnchorElement) {
                return node;
            }
        }

        return null;
    }

    /*
     * Retrieve the publisher URL.
     *
     * Once a link has been temporarily rewritten, its original URL is retained
     * in data-archive-original-href.
     */
    function getOriginalURL(anchor) {
        if (!(anchor instanceof HTMLAnchorElement)) {
            return null;
        }

        const storedURL = anchor.dataset.archiveOriginalHref;
        const rawURL = storedURL || anchor.getAttribute('href');

        if (
            !rawURL ||
            rawURL.startsWith('#') ||
            rawURL.toLowerCase().startsWith('javascript:')
        ) {
            return null;
        }

        try {
            return new URL(rawURL, location.href);
        } catch {
            return null;
        }
    }

    /*
     * Rewrite one link only after the user interacts with it.
     *
     * Nothing is rewritten during page loading, so uBlacklist continues to
     * see and match the original publisher URL.
     */
    function prepareAnchor(anchor) {
        const originalURL = getOriginalURL(anchor);

        if (
            !originalURL ||
            isArchiveURL(originalURL) ||
            !isSupportedURL(originalURL)
        ) {
            return null;
        }

        const archiveURL = makeArchiveURL(originalURL);

        if (!anchor.dataset.archiveOriginalHref) {
            anchor.dataset.archiveOriginalHref = originalURL.href;
        }

        anchor.href = archiveURL;

        return archiveURL;
    }

    /*
     * Prepare the link early enough for:
     *
     * - ordinary taps
     * - long-press menus on iOS
     * - right-click menus
     * - mouse clicks
     * - keyboard navigation
     *
     * Unlike the previous version, this happens only after interaction.
     */
    for (const eventName of [
        'touchstart',
        'pointerdown',
        'mousedown',
        'contextmenu',
        'focusin'
    ]) {
        document.addEventListener(
            eventName,
            (event) => {
                const anchor = findAnchor(event);

                if (anchor) {
                    prepareAnchor(anchor);
                }
            },
            true
        );
    }

    /*
     * Final navigation guard.
     *
     * This prevents websites from overriding the rewritten href with their
     * own JavaScript navigation handlers.
     */
    function handleNavigation(event) {
        const anchor = findAnchor(event);

        if (!anchor) {
            return;
        }

        const archiveURL = prepareAnchor(anchor);

        if (!archiveURL) {
            /*
             * The link may already have been prepared by touchstart or
             * pointerdown.
             */
            const originalURL = getOriginalURL(anchor);

            if (!originalURL || !isSupportedURL(originalURL)) {
                return;
            }

            const preparedURL = makeArchiveURL(originalURL);

            event.preventDefault();
            event.stopImmediatePropagation();

            openArchiveURL(event, anchor, preparedURL);
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        openArchiveURL(event, anchor, archiveURL);
    }

    function openArchiveURL(event, anchor, archiveURL) {
        const openInNewTab =
            event.type === 'auxclick' ||
            event.button === 1 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            (
                anchor.target &&
                anchor.target.toLowerCase() !== '_self'
            );

        if (openInNewTab) {
            const target =
                anchor.target &&
                anchor.target.toLowerCase() !== '_self'
                    ? anchor.target
                    : '_blank';

            const newWindow = window.open(archiveURL, target);

            // Fallback if Safari blocks the new window.
            if (!newWindow) {
                location.assign(archiveURL);
            }

            return;
        }

        location.assign(archiveURL);
    }

    document.addEventListener('click', handleNavigation, true);
    document.addEventListener('auxclick', handleNavigation, true);
})();
