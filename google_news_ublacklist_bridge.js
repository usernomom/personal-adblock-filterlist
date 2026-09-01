// ==UserScript==
// @name         Google - uBlacklist compatibility bridge
// @namespace    https://github.com/usernomom/personal-adblock-filterlist
// @author       nobody
// @description  Expose Google result URLs that uBlacklist cannot reliably parse, including Top Stories and rich social/profile results.
// @license      MIT
// @version      5
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
    const DEFAULT_RESULT_SELECTOR =
        `${UBLACKLIST_RESULT_SELECTOR}, ${LEGACY_RESULT_SELECTOR}`;
    const OPAQUE_LINK_SELECTOR = 'a[href*="/goto?url="]';
    const HEADING_SELECTOR =
        '[role="heading"][aria-level="3"], h3, .GkAmnd';
    const PROXY_WRAPPER_SELECTOR =
        ':scope > [data-ub-google-source-proxy]';
    const RICH_RESULT_ATTRIBUTE = 'data-ub-google-rich-result';
    const DISPLAYED_DOMAIN_RE =
        /(?:[\p{L}\p{N}][\p{L}\p{N}_-]*\.)+\p{L}{2,}/u;
    const PLATFORM_RULES = [
        {
            pattern: /\bLinkedIn\s*[·•]\s*/i,
            url: 'https://www.linkedin.com/',
        },
        {
            pattern: /\bInstagram\s*[·•]\s*/i,
            url: 'https://www.instagram.com/',
        },
        {
            pattern: /\bYouTube\s*[·•]\s*/i,
            url: 'https://www.youtube.com/',
        },
        {
            pattern: /\bFacebook\s*[·•]\s*/i,
            url: 'https://www.facebook.com/',
        },
        {
            pattern: /(?:^|[\s\n])X\s*[·•]\s*/i,
            url: 'https://x.com/',
        },
        {
            pattern: /\bReddit\s*[·•]\s*/i,
            url: 'https://www.reddit.com/',
        },
    ];

    let scanScheduled = false;
    const opaqueRetryAt = new WeakMap();

    function isElement(node) {
        return Boolean(node && node.nodeType === 1);
    }

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
            return isGoogleHost(new URL(normalized).hostname) ?
                '' :
                normalized;
        } catch (_) {
            return '';
        }
    }

    function addProxy(root, sourceURL, kind) {
        if (!isElement(root)) return false;

        const source = isExternalTarget(sourceURL);
        if (!source) return false;

        const existing = root.querySelector(PROXY_WRAPPER_SELECTOR);
        if (existing) {
            const proxy = existing.querySelector(
                'a[data-ub-google-source-proxy-anchor]'
            );
            if (proxy && proxy.href !== source) {
                proxy.href = source;
            }
            return true;
        }

        const wrapper = document.createElement('span');
        wrapper.hidden = true;
        wrapper.setAttribute('aria-hidden', 'true');
        wrapper.setAttribute('data-ub-google-source-proxy', kind);

        // Match uBlacklist's current Google URL selectors.
        wrapper.className = 'yuRUbf';

        const proxy = document.createElement('a');
        proxy.href = source;
        proxy.className = 'UBFage';
        proxy.tabIndex = -1;
        proxy.setAttribute('aria-hidden', 'true');
        proxy.setAttribute(
            'data-ub-google-source-proxy-anchor',
            kind
        );

        if (kind === 'news') {
            proxy.setAttribute('data-ub-news-source-proxy', '');
        }

        wrapper.appendChild(proxy);
        root.prepend(wrapper);
        return true;
    }

    function sourceOriginFromFavicon(card) {
        for (const img of card.querySelectorAll(
            'img[src*="faviconV2?url="]'
        )) {
            try {
                const source =
                    new URL(img.src, location.href)
                        .searchParams.get('url');

                if (source) {
                    return `${new URL(source).origin}/`;
                }
            } catch (_) {}
        }

        return '';
    }

    function sourceOriginFromGoogleData(card) {
        const link = card.querySelector(OPAQUE_LINK_SELECTOR);
        if (!link) return '';

        let token = '';
        try {
            token =
                new URL(link.href, location.href)
                    .searchParams.get('url') || '';
        } catch (_) {}

        if (!token) return '';

        for (const script of document.scripts) {
            const text = script.textContent || '';
            let position = text.indexOf(token);

            while (position !== -1) {
                const nearby = text.slice(position, position + 20000);
                const match =
                    nearby.match(
                        /faviconV2\?url\\u003d(https?:\/\/[^\\"&,]+)/
                    ) ||
                    nearby.match(
                        /faviconV2\?url=(https?:\/\/[^"'&,]+)/
                    );

                if (match) {
                    try {
                        return `${new URL(match[1]).origin}/`;
                    } catch (_) {}
                }

                position =
                    text.indexOf(
                        token,
                        position + token.length
                    );
            }
        }

        return '';
    }

    function bridgeNewsCard(card) {
        if (!isElement(card)) return;

        const source =
            sourceOriginFromFavicon(card) ||
            sourceOriginFromGoogleData(card);

        if (source) {
            addProxy(card, source, 'news');
        }
    }

    function displayedDomainURL(root) {
        const text =
            root.querySelector('.ob9lvb')?.textContent || '';
        const match = DISPLAYED_DOMAIN_RE.exec(text);
        return match ? `https://${match[0]}/` : '';
    }

    function builtInDirectURL(root) {
        const anchor = root.querySelector(
            '.UBFage, a[role="presentation"]'
        );
        if (!anchor) return '';

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

    function platformRuleFromText(text) {
        for (const rule of PLATFORM_RULES) {
            if (rule.pattern.test(text)) {
                return rule;
            }
        }

        return null;
    }

    function platformRuleNearLink(link) {
        let node = link;

        for (let depth = 0;
            isElement(node) && depth < 9;
            depth += 1, node = node.parentElement) {

            const text =
                node.innerText ||
                node.textContent ||
                '';

            if (text.length > 1600) {
                continue;
            }

            const rule = platformRuleFromText(text);
            if (rule) {
                return { rule, context: node };
            }
        }

        return null;
    }

    function countPlatformLabels(text) {
        let count = 0;

        for (const rule of PLATFORM_RULES) {
            if (rule.pattern.test(text)) {
                count += 1;
            }
        }

        return count;
    }

    function findSemanticResultRoot(seed, rule) {
        const viewportWidth =
            window.innerWidth ||
            document.documentElement.clientWidth ||
            390;
        const maxHeight = Math.max(
            (window.innerHeight || 800) * 0.9,
            520
        );

        let best = null;

        for (let node = seed;
            isElement(node) &&
                node !== document.body &&
                node !== document.documentElement;
            node = node.parentElement) {

            const text =
                node.innerText ||
                node.textContent ||
                '';

            if (!rule.pattern.test(text)) {
                continue;
            }

            const rect = node.getBoundingClientRect();
            const headingCount =
                node.querySelectorAll(HEADING_SELECTOR).length;
            const platformCount =
                countPlatformLabels(text);

            const resultSized =
                rect.width >= viewportWidth * 0.68 &&
                rect.height >= 56 &&
                rect.height <= maxHeight;

            if (
                resultSized &&
                headingCount <= 1 &&
                platformCount <= 1
            ) {
                best = node;
                continue;
            }

            if (
                best &&
                (
                    headingCount > 1 ||
                    platformCount > 1 ||
                    rect.height > maxHeight
                )
            ) {
                break;
            }
        }

        return best;
    }

    function primaryResultURL(root) {
        const heading = root.querySelector(HEADING_SELECTOR);

        if (heading) {
            const anchor =
                heading.closest('a[href]') ||
                [...root.querySelectorAll('a[href]')]
                    .find((candidate) =>
                        candidate.contains(heading)
                    );

            if (anchor) {
                const source = isExternalTarget(
                    anchor.getAttribute('href') ||
                    anchor.href
                );

                if (source) return source;
            }
        }

        for (const anchor of root.querySelectorAll('a[href]')) {
            if (
                anchor.hasAttribute(
                    'data-ub-google-source-proxy-anchor'
                ) ||
                anchor.getAttribute('aria-hidden') === 'true'
            ) {
                continue;
            }

            const source = isExternalTarget(
                anchor.getAttribute('href') ||
                anchor.href
            );

            if (source) return source;
        }

        const platform = platformRuleFromText(
            root.innerText ||
            root.textContent ||
            ''
        );

        return platform?.url || '';
    }

    function bridgeDefaultResult(root) {
        if (
            !isElement(root) ||
            root.closest(NEWS_CARD_SELECTOR)
        ) {
            return;
        }

        if (builtInCanResolve(root)) {
            return;
        }

        const source = primaryResultURL(root);
        if (!source) return;

        root.setAttribute(RICH_RESULT_ATTRIBUTE, '');
        addProxy(root, source, 'default');
    }

    function bridgeOpaquePlatformLink(link) {
        if (
            !isElement(link) ||
            link.closest(NEWS_CARD_SELECTOR) ||
            link.closest(
                '[data-ub-google-source-proxy]'
            )
        ) {
            return;
        }

        const retryAt = opaqueRetryAt.get(link) || 0;
        if (Date.now() < retryAt) return;
        opaqueRetryAt.set(link, Date.now() + 1000);

        const platform = platformRuleNearLink(link);
        if (!platform) return;

        const knownRoot = link.closest(DEFAULT_RESULT_SELECTOR);
        const root =
            knownRoot ||
            findSemanticResultRoot(
                platform.context,
                platform.rule
            );

        if (
            !isElement(root) ||
            root.closest(NEWS_CARD_SELECTOR)
        ) {
            return;
        }

        root.setAttribute(RICH_RESULT_ATTRIBUTE, '');
        addProxy(root, platform.rule.url, 'default');
    }

    function scan() {
        document
            .querySelectorAll(NEWS_CARD_SELECTOR)
            .forEach(bridgeNewsCard);

        document
            .querySelectorAll(DEFAULT_RESULT_SELECTOR)
            .forEach(bridgeDefaultResult);

        document
            .querySelectorAll(OPAQUE_LINK_SELECTOR)
            .forEach(bridgeOpaquePlatformLink);

        if (document.documentElement) {
            document.documentElement.setAttribute(
                'data-ub-google-bridge-version',
                '5'
            );
        }
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

        new MutationObserver(
            scheduleScan
        ).observe(
            document.documentElement,
            {
                childList: true,
                attributes: true,
                attributeFilter: [
                    'data-ub-result',
                    'href'
                ],
                subtree: true
            }
        );

        setTimeout(scan, 100);
        setTimeout(scan, 500);
        setTimeout(scan, 1500);
        setTimeout(scan, 3000);
    }

    if (document.documentElement) {
        start();
    } else {
        document.addEventListener(
            'DOMContentLoaded',
            start,
            { once: true }
        );
    }
})();
