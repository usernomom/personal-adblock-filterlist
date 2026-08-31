// ==UserScript==
// @name         Google news - uBlacklist bridge
// @description  Expose real publisher domains to uBlacklist for Google mobile Top Stories without changing article clicks.
// @license      MIT
// @version      1
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

    const CARD_SELECTOR = '[data-news-cluster-id]';
    const PROXY_SELECTOR = 'a[data-ub-news-source-proxy]';
    let scanScheduled = false;

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

    function bridgeCard(card) {
        if (!(card instanceof Element) ||
            card.querySelector(`:scope > ${PROXY_SELECTOR}`)) {
            return;
        }

        const source =
            sourceOriginFromFavicon(card) ||
            sourceOriginFromGoogleData(card);

        if (!source) return;

        const proxy = document.createElement('a');
        proxy.href = source;
        proxy.hidden = true;
        proxy.tabIndex = -1;
        proxy.setAttribute('aria-hidden', 'true');
        proxy.setAttribute('data-ub-news-source-proxy', '');
        card.prepend(proxy);
    }

    function scan() {
        document.querySelectorAll(CARD_SELECTOR).forEach(bridgeCard);
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
