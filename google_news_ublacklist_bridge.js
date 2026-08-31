// ==UserScript==
// @name         Google - uBlacklist compatibility bridge
// @description  Expose Google result URLs that uBlacklist cannot reliably parse, including Top Stories and rich social/profile results.
// @license      MIT
// @version      2
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_news_ublacklist_bridge.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const NEWS_CARD_SELECTOR = '[data-news-cluster-id]';
    const DEFAULT_RESULT_SELECTOR = '.vt6azd, .Ww4FFb';
    const PROXY_WRAPPER_SELECTOR = ':scope > [data-ub-google-source-proxy]';
    let scanScheduled = false;

    function isGoogleHost(hostname) {
        const host = hostname.toLowerCase();
        return host === 'google.com' ||
            host.endsWith('.google.com') ||
            host === 'google.ca' ||
            host.endsWith('.google.ca') ||
            host === 'google.fr' ||
            host.endsWith('.google.fr') ||
            host === 'google.co.uk' ||
            host.endsWith('.google.co.uk');
    }

    function normalizeTargetURL(rawURL) {
        try {
            const url = new URL(rawURL, location.href);

            if (!['http:', 'https:'].includes(url.protocol)) {
                return '';
            }

            if (isGoogleHost(url.hostname)) {
                for (const key of ['url', 'q']) {
                    const target = url.searchParams.get(key);
                    if (!target) continue;

                    try {
                        const decoded = new URL(target);
                        if (['http:', 'https:'].includes(decoded.protocol)) {
                            return decoded.href;
                        }
                    } catch (_) {}
                }

                // /goto uses an opaque token. The Top Stories-specific path below
                // resolves those through Google's embedded page data instead.
                if (url.pathname === '/goto') {
                    return '';
                }
            }

            return url.href;
        } catch (_) {
            return '';
        }
    }

    function addProxy(root, sourceURL, kind) {
        if (!(root instanceof Element) ||
            root.querySelector(PROXY_WRAPPER_SELECTOR)) {
            return false;
        }

        const source = normalizeTargetURL(sourceURL);
        if (!source) return false;

        const wrapper = document.createElement('span');
        wrapper.hidden = true;
        wrapper.setAttribute('aria-hidden', 'true');
        wrapper.setAttribute('data-ub-google-source-proxy', kind);

        // Match both the current mobile and desktop default-result URL selectors:
        //   mobile:  .UBFage
        //   desktop: :is(.yuRUbf, .xe8e1b) a
        wrapper.className = 'yuRUbf';

        const proxy = document.createElement('a');
        proxy.href = source;
        proxy.className = 'UBFage';
        proxy.tabIndex = -1;
        proxy.setAttribute('aria-hidden', 'true');
        proxy.setAttribute('data-ub-google-source-proxy-anchor', kind);

        // Keep the old marker on news proxies for compatibility with the existing
        // new-tab userscript and any already-installed code that knows this marker.
        if (kind === 'news') {
            proxy.setAttribute('data-ub-news-source-proxy', '');
        }

        wrapper.appendChild(proxy);
        root.prepend(wrapper);
        return true;
    }

    function sourceOriginFromFavicon(card) {
        for (const img of card.querySelectorAll('img[src*="faviconV2?url="]')) {
            try {
                const source = new URL(img.src, location.href).searchParams.get('url');
                if (source) return `${new URL(source).origin}/`;
            } catch (_) {}
        }
        return '';
    }

    function sourceOriginFromGoogleData(card) {
        const link = card.querySelector('a[href*="/goto?url="]');
        if (!link) return '';

        let token = '';
        try {
            token = new URL(link.href, location.href).searchParams.get('url') || '';
        } catch (_) {}
        if (!token) return '';

        for (const script of document.scripts) {
            const text = script.textContent || '';
            let position = text.indexOf(token);

            while (position !== -1) {
                const nearby = text.slice(position, position + 20000);
                const match =
                    nearby.match(/faviconV2\?url\\u003d(https?:\/\/[^\\"&,]+)/) ||
                    nearby.match(/faviconV2\?url=(https?:\/\/[^"'&,]+)/);

                if (match) {
                    try {
                        return `${new URL(match[1]).origin}/`;
                    } catch (_) {}
                }

                position = text.indexOf(token, position + token.length);
            }
        }
        return '';
    }

    function bridgeNewsCard(card) {
        if (!(card instanceof Element) ||
            card.querySelector(PROXY_WRAPPER_SELECTOR)) {
            return;
        }

        const source =
            sourceOriginFromFavicon(card) ||
            sourceOriginFromGoogleData(card);

        if (source) {
            addProxy(card, source, 'news');
        }
    }

    function primaryResultURL(root) {
        const heading = root.querySelector(
            '[role="heading"][aria-level="3"], h3'
        );

        if (!heading) return '';

        let anchor = heading.closest('a[href]');

        if (!anchor || !root.contains(anchor)) {
            anchor = [...root.querySelectorAll('a[href]')]
                .find((candidate) => candidate.contains(heading)) || null;
        }

        if (!anchor) return '';

        return normalizeTargetURL(anchor.getAttribute('href') || anchor.href);
    }

    function bridgeDefaultResult(root) {
        if (!(root instanceof Element) ||
            root.closest(NEWS_CARD_SELECTOR) ||
            root.querySelector(PROXY_WRAPPER_SELECTOR)) {
            return;
        }

        // If the current built-in Google SERPINFO can already recover this result's
        // URL, leave it alone. This bridge is only for the rich-result gap.
        if (
            root.querySelector('.UBFage, a[role="presentation"]') ||
            root.querySelector('.ob9lvb')
        ) {
            return;
        }

        const source = primaryResultURL(root);
        if (!source) return;

        addProxy(root, source, 'default');
    }

    function scan() {
        document.querySelectorAll(NEWS_CARD_SELECTOR).forEach(bridgeNewsCard);
        document.querySelectorAll(DEFAULT_RESULT_SELECTOR).forEach(bridgeDefaultResult);
    }

    function scheduleScan() {
        if (scanScheduled) return;
        scanScheduled = true;
        requestAnimationFrame(() => {
            scanScheduled = false;
            scan();
        });
    }

    function start() {
        scan();

        new MutationObserver(scheduleScan).observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        setTimeout(scan, 100);
        setTimeout(scan, 500);
        setTimeout(scan, 1500);
    }

    if (document.documentElement) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();
