// ==UserScript==
// @name         Google - uBlacklist compatibility bridge
// @namespace    https://github.com/usernomom/personal-adblock-filterlist
// @author       nobody
// @description  Expose real Google result destinations to uBlacklist when Google hides them behind opaque /goto links.
// @license      MIT
// @version      8
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
    const RESULT_SELECTOR = '[data-ub-result], .vt6azd, .Ww4FFb';
    const OPAQUE_LINK_SELECTOR = 'a[href*="/goto?url="]';
    const HEADING_SELECTOR = '[role="heading"][aria-level="3"], h3, .GkAmnd';
    const PROXY_WRAPPER_SELECTOR = ':scope > [data-ub-google-source-proxy]';
    const PROXY_ANCHOR_SELECTOR = 'a[data-ub-google-source-proxy-anchor]';
    const DISPLAYED_DOMAIN_RE =
        /(?:[\p{L}\p{N}][\p{L}\p{N}_-]*\.)+\p{L}{2,}/u;

    const gotoMap = new Map();
    const scannedScripts = new WeakSet();
    const scannedComments = new WeakSet();
    let scanScheduled = false;

    function isElement(node) {
        return Boolean(node && node.nodeType === Node.ELEMENT_NODE);
    }

    function isGoogleHost(hostname) {
        const host = String(hostname || '').toLowerCase();
        return host === 'google.com' ||
            host.endsWith('.google.com') ||
            host === 'google.ca' ||
            host.endsWith('.google.ca') ||
            host === 'google.fr' ||
            host.endsWith('.google.fr') ||
            host === 'google.co.uk' ||
            host.endsWith('.google.co.uk') ||
            host === 'gstatic.com' ||
            host.endsWith('.gstatic.com') ||
            host === 'googleapis.com' ||
            host.endsWith('.googleapis.com');
    }

    function cleanEscapes(value) {
        return String(value || '')
            .replace(/&amp;/g, '&')
            .replace(/\\u003d/gi, '=')
            .replace(/\\u0026/gi, '&')
            .replace(/\\u002f/gi, '/')
            .replace(/\\\//g, '/');
    }

    function normalizeURL(raw) {
        const value = cleanEscapes(raw).trim();
        if (!value) return '';
        try {
            const url = new URL(value, location.href);
            if (!['http:', 'https:'].includes(url.protocol)) return '';

            if (isGoogleHost(url.hostname)) {
                for (const key of ['url', 'q', 'imgrefurl']) {
                    const target = url.searchParams.get(key);
                    if (!target) continue;
                    try {
                        const decoded = new URL(target);
                        if (
                            ['http:', 'https:'].includes(decoded.protocol) &&
                            !isGoogleHost(decoded.hostname)
                        ) {
                            return decoded.href;
                        }
                    } catch (_) {}
                }
            }
            return url.href;
        } catch (_) {
            return '';
        }
    }

    function externalURL(raw) {
        const normalized = normalizeURL(raw);
        if (!normalized) return '';
        try {
            return isGoogleHost(new URL(normalized).hostname) ? '' : normalized;
        } catch (_) {
            return '';
        }
    }

    function normalizeGoto(raw) {
        let value = cleanEscapes(raw);
        if (!value) return '';
        try {
            if (value.includes('%')) value = decodeURIComponent(value);
        } catch (_) {}
        try {
            const url = new URL(value, location.href);
            if (!isGoogleHost(url.hostname) || url.pathname !== '/goto') return '';
            return `${url.pathname}${url.search}`;
        } catch (_) {
            if (value.startsWith('/goto?')) {
                return value.split('#')[0];
            }
            return '';
        }
    }

    function isImageURL(raw) {
        try {
            const url = new URL(raw);
            return /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i
                .test(url.pathname);
        } catch (_) {
            return false;
        }
    }

    function isDeepURL(raw) {
        try {
            const url = new URL(raw);
            return url.pathname !== '/' || Boolean(url.search);
        } catch (_) {
            return false;
        }
    }

    function pickBestURL(values) {
        const unique = [...new Set(values.map(externalURL).filter(Boolean))];
        if (!unique.length) return '';

        const pages = unique.filter((url) => !isImageURL(url));
        const pool = pages.length ? pages : unique;
        const deep = pool.filter(isDeepURL);
        if (deep.length) {
            deep.sort((a, b) => b.length - a.length);
            return deep[0];
        }
        return pool[0];
    }

    function maybeSetGoto(gotoValue, targetValue) {
        const key = normalizeGoto(gotoValue);
        const target = externalURL(targetValue);
        if (!key || !target) return;

        const existing = gotoMap.get(key);
        if (
            !existing ||
            (!isDeepURL(existing) && isDeepURL(target)) ||
            (
                isDeepURL(existing) &&
                isDeepURL(target) &&
                new URL(existing).origin === new URL(target).origin &&
                target.length > existing.length
            )
        ) {
            gotoMap.set(key, target);
        }
    }

    function collectDirectStrings(node, gotos, urls, abouts) {
        if (!node || typeof node === 'string') return;
        const values = Array.isArray(node) ? node : Object.values(node);
        for (const item of values) {
            if (typeof item !== 'string') continue;
            const value = cleanEscapes(item);
            const gotoKey = normalizeGoto(value);
            if (gotoKey) {
                gotos.push(gotoKey);
                continue;
            }
            const target = externalURL(value);
            if (target) {
                urls.push(target);
                continue;
            }
            if (
                value.includes('/search/about-this-result') &&
                value.includes('req=')
            ) {
                abouts.push(value);
            }
        }
    }

    function targetFromAboutURL(raw) {
        try {
            const url = new URL(cleanEscapes(raw), location.href);
            const req = url.searchParams.get('req');
            if (!req) return '';

            const base64 = decodeURIComponent(req)
                .replace(/-/g, '+')
                .replace(/_/g, '/');
            const padded = base64.padEnd(
                base64.length + ((4 - base64.length % 4) % 4),
                '='
            );
            const binary = atob(padded);
            const match = binary.match(
                /https?:\/\/[^\x00-\x20\x7f-\x9f"'<>]+/
            );
            return match ? externalURL(match[0]) : '';
        } catch (_) {
            return '';
        }
    }

    function collectNestedCandidates(node, urls, abouts, depth = 0) {
        if (!node || depth > 12 || urls.length >= 128) return;

        if (typeof node === 'string') {
            const value = cleanEscapes(node);
            const target = externalURL(value);
            if (target) {
                urls.push(target);
            } else if (
                value.includes('/search/about-this-result') &&
                value.includes('req=')
            ) {
                abouts.push(value);
            }
            return;
        }

        const values = Array.isArray(node) ? node : Object.values(node);
        for (const item of values) {
            collectNestedCandidates(item, urls, abouts, depth + 1);
            if (urls.length >= 128) break;
        }
    }

    function scanDataTree(node) {
        if (!node || typeof node === 'string') return;

        if (Array.isArray(node)) {
            // Known Google W_jd web-result fields. These are Google schema
            // positions, not site/domain special cases.
            const gotoValue =
                typeof node[17] === 'string' ? normalizeGoto(node[17]) : '';
            let structuralTarget =
                node[32]?.[3]?.[0] ||
                node[33]?.[3]?.[0] ||
                node[33]?.[14]?.[7] ||
                node[9]?.['2003']?.[2] ||
                '';

            // Rich-result schemas change. If the usual target field is absent,
            // search only inside this result record for an external destination.
            if (gotoValue && !externalURL(structuralTarget)) {
                const nestedURLs = [];
                const nestedAbouts = [];
                collectNestedCandidates(node, nestedURLs, nestedAbouts);
                structuralTarget = pickBestURL(nestedURLs);
                if (!structuralTarget) {
                    for (const about of nestedAbouts) {
                        structuralTarget = targetFromAboutURL(about);
                        if (structuralTarget) break;
                    }
                }
            }
            if (gotoValue && structuralTarget) {
                maybeSetGoto(gotoValue, structuralTarget);
            }

            // Conservative generic pairing: pair direct sibling values first.
            const gotos = [];
            const urls = [];
            const abouts = [];
            collectDirectStrings(node, gotos, urls, abouts);

            let best = pickBestURL(urls);
            if (!best) {
                for (const about of abouts) {
                    best = targetFromAboutURL(about);
                    if (best) break;
                }
            }
            if (best) {
                for (const key of gotos) maybeSetGoto(key, best);
            }

            for (const item of node) scanDataTree(item);
            return;
        }

        if (typeof node === 'object') {
            for (const value of Object.values(node)) scanDataTree(value);
        }
    }

    function extractBalancedJSONObject(text, markerIndex) {
        const start = text.indexOf('{', markerIndex);
        if (start < 0) return '';

        let depth = 0;
        let quote = '';
        let escaped = false;

        for (let i = start; i < text.length; i += 1) {
            const ch = text[i];

            if (quote) {
                if (escaped) {
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === quote) {
                    quote = '';
                }
                continue;
            }

            if (ch === '"' || ch === "'") {
                quote = ch;
                continue;
            }
            if (ch === '{') depth += 1;
            if (ch === '}') {
                depth -= 1;
                if (depth === 0) return text.slice(start, i + 1);
            }
        }
        return '';
    }

    function scanScript(script) {
        if (!script || scannedScripts.has(script)) return;
        scannedScripts.add(script);

        const text = script.textContent || '';
        if (!text.includes('/goto')) return;

        let pos = 0;
        while ((pos = text.indexOf('var m=', pos)) !== -1) {
            const jsonText = extractBalancedJSONObject(text, pos + 6);
            if (jsonText) {
                try {
                    scanDataTree(JSON.parse(jsonText));
                } catch (_) {}
                pos += jsonText.length;
            } else {
                pos += 6;
            }
        }
    }

    function scanComment(comment) {
        if (!comment || scannedComments.has(comment)) return;
        scannedComments.add(comment);

        const text = comment.nodeValue || '';
        if (!text.includes('/goto')) return;
        const split = text.lastIndexOf('||');
        if (split < 0) return;

        const payload = cleanEscapes(text.slice(split + 2).trim());
        if (!payload.startsWith('[') && !payload.startsWith('{')) return;

        try {
            scanDataTree(JSON.parse(payload));
        } catch (_) {}
    }

    function scanEmbeddedData(root = document) {
        const scope = root?.querySelectorAll ? root : document;
        for (const script of scope.querySelectorAll('script')) scanScript(script);

        try {
            const walker = document.createTreeWalker(
                root === document ? document.documentElement : root,
                NodeFilter.SHOW_COMMENT
            );
            let node;
            while ((node = walker.nextNode())) scanComment(node);
        } catch (_) {}
    }

    function externalURLFromAttributes(root) {
        const nodes = [root, ...root.querySelectorAll('*')].slice(0, 250);
        const candidates = [];

        for (const node of nodes) {
            for (const attr of node.attributes || []) {
                if (!/(?:url|href|lpage|fburl|rw)/i.test(attr.name)) continue;
                const value = attr.value || '';
                if (!value) continue;

                const direct = externalURL(value);
                if (direct) candidates.push(direct);

                if (value.includes('http')) {
                    const decoded = cleanEscapes(value);
                    for (const match of decoded.matchAll(
                        /https?:\/\/[^"'\\\s,\]}<>]+/g
                    )) {
                        const target = externalURL(match[0]);
                        if (target) candidates.push(target);
                    }
                }
            }
        }
        return pickBestURL(candidates);
    }

    function externalURLFromFavicon(root) {
        for (const image of root.querySelectorAll('img[src]')) {
            const current = image.getAttribute('src') || '';
            if (!current) continue;
            try {
                const url = new URL(cleanEscapes(current), location.href);
                for (const value of url.searchParams.values()) {
                    const target = externalURL(value);
                    if (target) return target;
                    if (/^https?%3a/i.test(value)) {
                        const decoded = externalURL(decodeURIComponent(value));
                        if (decoded) return decoded;
                    }
                }
            } catch (_) {}
        }
        return '';
    }

    function displayedDomainURL(root) {
        for (const node of root.querySelectorAll('.ob9lvb, cite')) {
            const match = DISPLAYED_DOMAIN_RE.exec(node.textContent || '');
            if (match) return `https://${match[0]}/`;
        }
        return '';
    }

    function directExternalAnchor(root) {
        for (const anchor of root.querySelectorAll('a[href]')) {
            if (anchor.hasAttribute('data-ub-google-source-proxy-anchor')) {
                continue;
            }
            const raw = anchor.getAttribute('href') || '';
            const gotoKey = normalizeGoto(raw);
            if (gotoKey) continue;
            const target = externalURL(raw);
            if (target) return target;
        }
        return '';
    }

    function mappedGotoURL(root) {
        for (const anchor of root.querySelectorAll(OPAQUE_LINK_SELECTOR)) {
            const key = normalizeGoto(anchor.getAttribute('href') || anchor.href);
            if (key && gotoMap.has(key)) return gotoMap.get(key);
        }
        return '';
    }

    function aboutResultURL(root) {
        for (const anchor of root.querySelectorAll(
            'a[href*="/search/about-this-result"][href*="req="]'
        )) {
            const target = targetFromAboutURL(
                anchor.getAttribute('href') || anchor.href
            );
            if (target) return target;
        }
        return '';
    }

    function sourceURLForRoot(root) {
        return directExternalAnchor(root) ||
            displayedDomainURL(root) ||
            mappedGotoURL(root) ||
            externalURLFromFavicon(root) ||
            aboutResultURL(root) ||
            externalURLFromAttributes(root);
    }

    function builtInCanResolve(root) {
        const mobile = root.querySelector('.UBFage, a[role="presentation"]');
        if (mobile) {
            const raw = mobile.getAttribute('href') || '';
            if (/^https?:\/\//.test(raw) && externalURL(raw)) return true;
        }
        return Boolean(displayedDomainURL(root));
    }

    function addProxy(root, sourceURL, kind) {
        if (!isElement(root)) return false;
        const source = externalURL(sourceURL);
        if (!source) return false;

        let wrapper = root.querySelector(PROXY_WRAPPER_SELECTOR);
        let proxy = wrapper?.querySelector(PROXY_ANCHOR_SELECTOR) || null;

        if (!wrapper) {
            wrapper = document.createElement('span');
            wrapper.hidden = true;
            wrapper.setAttribute('aria-hidden', 'true');
            wrapper.setAttribute('data-ub-google-source-proxy', kind);
            wrapper.className = 'yuRUbf';

            proxy = document.createElement('a');
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
        }

        if (proxy && proxy.getAttribute('href') !== source) {
            proxy.setAttribute('href', source);
        }

        // uBlacklist 10.0.3+ re-evaluates result URLs on href changes.
        if (proxy) {
            queueMicrotask(() => {
                if (proxy.isConnected) proxy.setAttribute('href', source);
            });
        }
        return true;
    }

    function bridgeKnownRoot(root) {
        if (
            !isElement(root) ||
            root.closest(NEWS_CARD_SELECTOR) ||
            builtInCanResolve(root)
        ) {
            return;
        }

        const source = sourceURLForRoot(root);
        if (source) addProxy(root, source, 'default');
    }

    function bridgeNewsCard(card) {
        if (!isElement(card)) return;
        const source = sourceURLForRoot(card);
        if (source) addProxy(card, source, 'news');
    }

    function semanticResultRoot(seed) {
        const viewportWidth =
            window.innerWidth ||
            document.documentElement.clientWidth ||
            390;
        const maxHeight = Math.max(
            (window.innerHeight || 800) * 0.95,
            560
        );

        let best = null;
        for (
            let node = seed;
            isElement(node) &&
                node !== document.body &&
                node !== document.documentElement;
            node = node.parentElement
        ) {
            const rect = node.getBoundingClientRect();
            const text = node.innerText || node.textContent || '';
            const headings = node.querySelectorAll(HEADING_SELECTOR).length;

            const plausible =
                rect.width >= viewportWidth * 0.68 &&
                rect.height >= 56 &&
                rect.height <= maxHeight &&
                text.trim().length >= 10 &&
                text.length <= 2200 &&
                headings <= 1;

            if (plausible) {
                best = node;
                continue;
            }

            if (best && (headings > 1 || rect.height > maxHeight)) break;
        }
        return best;
    }

    function bridgeOpaqueLink(link) {
        if (
            !isElement(link) ||
            link.closest(NEWS_CARD_SELECTOR) ||
            link.closest('[data-ub-google-source-proxy]')
        ) {
            return;
        }

        const root =
            link.closest(RESULT_SELECTOR) ||
            semanticResultRoot(link);
        if (!root || builtInCanResolve(root)) return;

        const key = normalizeGoto(link.getAttribute('href') || link.href);
        const source =
            (key && gotoMap.get(key)) ||
            sourceURLForRoot(root);

        if (source) addProxy(root, source, 'default');
    }

    function scan(root = document) {
        scanEmbeddedData(root);

        document
            .querySelectorAll(NEWS_CARD_SELECTOR)
            .forEach(bridgeNewsCard);

        document
            .querySelectorAll(RESULT_SELECTOR)
            .forEach(bridgeKnownRoot);

        document
            .querySelectorAll(OPAQUE_LINK_SELECTOR)
            .forEach(bridgeOpaqueLink);

        document.documentElement?.setAttribute(
            'data-ub-google-bridge-version',
            '8'
        );
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

        new MutationObserver((records) => {
            for (const record of records) {
                if (record.type === 'childList') {
                    for (const node of record.addedNodes) {
                        if (!isElement(node)) continue;
                        if (node.tagName === 'SCRIPT') scanScript(node);
                        scanEmbeddedData(node);
                    }
                }
            }
            scheduleScan();
        }).observe(document.documentElement, {
            childList: true,
            attributes: true,
            attributeFilter: ['data-ub-result', 'href', 'src'],
            subtree: true,
        });

        [100, 500, 1500, 4000, 8000].forEach((delay) =>
            setTimeout(scan, delay)
        );
    }

    if (document.documentElement) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();
