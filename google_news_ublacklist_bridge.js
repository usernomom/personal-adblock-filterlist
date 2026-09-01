// ==UserScript==
// @name         Google - uBlacklist compatibility bridge
// @namespace    https://github.com/usernomom/personal-adblock-filterlist
// @author       nobody
// @description  Expose Google result URLs that uBlacklist cannot reliably parse, including Top Stories and rich social/profile results.
// @license      MIT
// @version      4
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
    const UBLACKLIST_RESULT_SELECTOR = '[data-ub-result]';
    const LEGACY_RESULT_SELECTOR = '.vt6azd, .Ww4FFb';
    const DEFAULT_RESULT_SELECTOR = `${UBLACKLIST_RESULT_SELECTOR}, ${LEGACY_RESULT_SELECTOR}`;
    const PROXY_WRAPPER_SELECTOR = ':scope > [data-ub-google-source-proxy]';
    const DISPLAYED_DOMAIN_RE = /(?:[\p{L}\p{N}][\p{L}\p{N}_-]*\.)+\p{L}{2,}/u;
    const PLATFORM_RULES = [
        [/\bLinkedIn\b/i, ['linkedin.com']],
        [/\bInstagram\b/i, ['instagram.com']],
        [/\bYouTube\b/i, ['youtube.com', 'youtu.be']],
        [/\bFacebook\b/i, ['facebook.com']],
        [/(?:^|[\s·])X(?:\s*\(Twitter\))?(?:[\s·]|$)|\bTwitter\b/i, ['x.com', 'twitter.com']],
        [/\bReddit\b/i, ['reddit.com']],
    ];
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

    function isExternalTarget(rawURL) {
        const normalized = normalizeTargetURL(rawURL);
        if (!normalized) return '';

        try {
            return isGoogleHost(new URL(normalized).hostname) ? '' : normalized;
        } catch (_) {
            return '';
        }
    }

    function addProxy(root, sourceURL, kind) {
        if (!(root instanceof Element) ||
            root.querySelector(PROXY_WRAPPER_SELECTOR)) {
            return false;
        }

        const source = isExternalTarget(sourceURL);
        if (!source) return false;

        const wrapper = document.createElement('span');
        wrapper.hidden = true;
        wrapper.setAttribute('aria-hidden', 'true');
        wrapper.setAttribute('data-ub-google-source-proxy', kind);

        // Match both current default-result URL selectors:
        //   mobile:  .UBFage
        //   desktop: :is(.yuRUbf, .xe8e1b) a
        wrapper.className = 'yuRUbf';

        const proxy = document.createElement('a');
        proxy.href = source;
        proxy.className = 'UBFage';
        proxy.tabIndex = -1;
        proxy.setAttribute('aria-hidden', 'true');
        proxy.setAttribute('data-ub-google-source-proxy-anchor', kind);

        // Preserve the original marker used by the new-tab userscript.
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

    function platformHostsForRoot(root) {
        const text = root?.innerText || root?.textContent || '';
        for (const [pattern, hosts] of PLATFORM_RULES) {
            if (pattern.test(text)) return hosts;
        }
        return [];
    }

    function hostnameMatches(hostname, suffixes) {
        const host = hostname.toLowerCase();
        return suffixes.some((suffix) =>
            host === suffix || host.endsWith(`.${suffix}`)
        );
    }

    function sourceURLFromGoogleDataByPlatform(root) {
        const hostSuffixes = platformHostsForRoot(root);
        if (!hostSuffixes.length) return '';

        for (const link of root.querySelectorAll('a[href*="/goto?url="]')) {
            let token = '';
            try {
                token = new URL(link.href, location.href).searchParams.get('url') || '';
            } catch (_) {}
            if (!token) continue;

            for (const script of document.scripts) {
                const text = script.textContent || '';
                let position = text.indexOf(token);

                while (position !== -1) {
                    const nearby = text
                        .slice(position, position + 24000)
                        .replace(/\\u003d/g, '=')
                        .replace(/\\u0026/g, '&')
                        .replace(/\\u002f/gi, '/')
                        .replace(/\\\//g, '/');

                    for (const match of nearby.matchAll(/https?:\/\/[^"'\\\s,\]\)<>]+/g)) {
                        try {
                            const candidate = new URL(match[0].replace(/[.;]+$/, ''));
                            if (hostnameMatches(candidate.hostname, hostSuffixes)) {
                                return candidate.href;
                            }
                        } catch (_) {}
                    }

                    position = text.indexOf(token, position + token.length);
                }
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

    function displayedDomainURL(root) {
        const text = root.querySelector('.ob9lvb')?.textContent || '';
        const match = DISPLAYED_DOMAIN_RE.exec(text);
        return match ? `https://${match[0]}/` : '';
    }

    function builtInDirectURL(root) {
        const anchor = root.querySelector('.UBFage, a[role="presentation"]');
        if (!anchor) return '';

        // uBlacklist currently accepts this branch only when the literal href
        // attribute starts with http(s). A relative Google redirect is therefore
        // not usable by the built-in parser.
        const raw = anchor.getAttribute('href') || '';
        if (!/^https?:\/\//.test(raw)) return '';

        return isExternalTarget(raw);
    }

    function builtInCanResolve(root) {
        return Boolean(
            builtInDirectURL(root) ||
            displayedDomainURL(root)
        );
    }

    function primaryResultURL(root) {
        const heading = root.querySelector(
            '[role="heading"][aria-level="3"], h3, .GkAmnd'
        );

        if (heading) {
            const anchor = heading.closest('a[href]') ||
                [...root.querySelectorAll('a[href]')]
                    .find((candidate) => candidate.contains(heading));

            if (anchor) {
                const source = isExternalTarget(
                    anchor.getAttribute('href') || anchor.href
                );
                if (source) return source;
            }
        }

        // Rich/profile cards can use unusual heading markup. Fall back to the
        // first real external navigation target in the result container.
        for (const anchor of root.querySelectorAll('a[href]')) {
            if (
                anchor.hasAttribute('data-ub-google-source-proxy-anchor') ||
                anchor.getAttribute('aria-hidden') === 'true'
            ) {
                continue;
            }

            const source = isExternalTarget(
                anchor.getAttribute('href') || anchor.href
            );
            if (source) return source;
        }

        return sourceURLFromGoogleDataByPlatform(root);
    }

    function bridgeDefaultResult(root) {
        if (!(root instanceof Element) ||
            root.closest(NEWS_CARD_SELECTOR) ||
            root.querySelector(PROXY_WRAPPER_SELECTOR)) {
            return;
        }

        // Presence of .ob9lvb alone is NOT enough. uBlacklist's domainToURL
        // fallback only works when that text actually contains a domain such as
        // example.com. New Google social/profile cards instead show labels like
        // "Instagram · intel", which produce a null URL and therefore no button.
        if (builtInCanResolve(root)) {
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
            attributes: true,
            attributeFilter: ['data-ub-result'],
            subtree: true
        });

        // Cover ordering differences between Macaque and the Safari extension.
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
