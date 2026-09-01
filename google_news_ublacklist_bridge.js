// ==UserScript==
// @name         Google - uBlacklist compatibility bridge
// @namespace    https://github.com/usernomom/personal-adblock-filterlist
// @author       nobody
// @description  Restore real Google result destinations so uBlacklist can filter opaque /goto results reliably, including Safari/iOS layouts.
// @license      MIT
// @version      10
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_news_ublacklist_bridge.js
// @updateURL    https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_news_ublacklist_bridge.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '10';
    const WJD_EVENT = '__UB_GOOGLE_WJD_UPDATE__';
    const RESULT_SELECTOR = '[data-ub-result], .vt6azd, .Ww4FFb';
    const NEWS_CARD_SELECTOR = '[data-news-cluster-id]';
    const OPAQUE_LINK_SELECTOR = 'a[href*="/goto?"]';
    const HEADING_SELECTOR = '[role="heading"][aria-level="3"], h3, .GkAmnd';
    const PROXY_WRAPPER_SELECTOR = ':scope > [data-ub-google-source-proxy]';
    const PROXY_ANCHOR_SELECTOR = 'a[data-ub-google-source-proxy-anchor]';
    const TEMP_ROOT_ATTRIBUTE = 'data-ub-google-temp-root';
    const DISPLAYED_DOMAIN_RE = /(?:[\p{L}\p{N}][\p{L}\p{N}_-]*\.)+\p{L}{2,}/u;

    const gotoMap = new Map();
    const scannedScripts = new WeakSet();
    const scannedComments = new WeakSet();
    let scanScheduled = false;

    function isElement(node) {
        return Boolean(node && node.nodeType === Node.ELEMENT_NODE);
    }

    function isGoogleHost(hostname) {
        const host = String(hostname || '').toLowerCase();
        return /(^|\.)google\.[a-z.]+$/.test(host) ||
            host === 'gstatic.com' || host.endsWith('.gstatic.com') ||
            host === 'googleapis.com' || host.endsWith('.googleapis.com');
    }

    function cleanEscapes(value) {
        return String(value || '')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/\\u003d/gi, '=')
            .replace(/\\u0026/gi, '&')
            .replace(/\\u002f/gi, '/')
            .replace(/\\x3d/gi, '=')
            .replace(/\\x26/gi, '&')
            .replace(/\\x2f/gi, '/')
            .replace(/\\\//g, '/');
    }

    function normalizeURL(raw) {
        const value = cleanEscapes(raw).trim();
        if (!value) return '';
        try {
            const url = new URL(value, location.href);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';

            if (isGoogleHost(url.hostname)) {
                for (const key of ['url', 'q', 'imgrefurl']) {
                    const wrapped = url.searchParams.get(key);
                    if (!wrapped) continue;
                    try {
                        const target = new URL(wrapped);
                        if (
                            (target.protocol === 'http:' || target.protocol === 'https:') &&
                            !isGoogleHost(target.hostname)
                        ) {
                            return target.href;
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
        let value = cleanEscapes(raw).trim();
        if (!value) return '';
        try {
            if (/%[0-9a-f]{2}/i.test(value)) value = decodeURIComponent(value);
        } catch (_) {}
        try {
            const url = new URL(value, location.href);
            if (!isGoogleHost(url.hostname) || url.pathname !== '/goto') return '';
            return `${url.pathname}${url.search}`;
        } catch (_) {
            return value.startsWith('/goto?') ? value.split('#')[0] : '';
        }
    }

    function isImageURL(raw) {
        try {
            const url = new URL(raw);
            return /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(url.pathname);
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

    function hostnameOf(raw) {
        try {
            return new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
        } catch (_) {
            return '';
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

    function betterURL(candidate, current) {
        if (!current) return true;
        if (candidate === current) return false;
        try {
            const a = new URL(candidate);
            const b = new URL(current);
            const aDeep = isDeepURL(candidate);
            const bDeep = isDeepURL(current);
            if (aDeep && !bDeep) return true;
            return aDeep && bDeep && a.origin === b.origin && candidate.length > current.length;
        } catch (_) {
            return false;
        }
    }

    function maybeSetGoto(gotoValue, targetValue) {
        const key = normalizeGoto(gotoValue);
        const target = externalURL(targetValue);
        if (!key || !target) return false;
        const current = gotoMap.get(key);
        if (!current || betterURL(target, current)) {
            gotoMap.set(key, target);
            return true;
        }
        return false;
    }

    function targetFromAboutURL(raw) {
        try {
            const url = new URL(cleanEscapes(raw), location.href);
            const req = url.searchParams.get('req');
            if (!req) return '';
            const base64 = decodeURIComponent(req).replace(/-/g, '+').replace(/_/g, '/');
            const padded = base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), '=');
            const binary = atob(padded);
            const match = binary.match(/https?:\/\/[^\x00-\x20\x7f-\x9f"'<>]+/);
            return match ? externalURL(match[0]) : '';
        } catch (_) {
            return '';
        }
    }

    function collectTree(node, out, depth = 0) {
        if (!node || depth > 18 || out.count >= 512) return;
        if (typeof node === 'string') {
            out.count += 1;
            const value = cleanEscapes(node);
            const key = normalizeGoto(value);
            if (key) {
                out.gotos.add(key);
                return;
            }
            const target = externalURL(value);
            if (target) {
                out.urls.push(target);
                return;
            }
            if (value.includes('/search/about-this-result') && value.includes('req=')) {
                out.abouts.push(value);
            }
            return;
        }
        const values = Array.isArray(node) ? node :
            (typeof node === 'object' ? Object.values(node) : []);
        for (const item of values) {
            collectTree(item, out, depth + 1);
            if (out.count >= 512) break;
        }
    }

    function mapContainer(node) {
        const out = { gotos: new Set(), urls: [], abouts: [], count: 0 };
        collectTree(node, out);
        if (!out.gotos.size) return false;

        let best = pickBestURL(out.urls);
        if (!best) {
            for (const about of out.abouts) {
                best = targetFromAboutURL(about);
                if (best) break;
            }
        }
        if (!best) return false;

        if (out.gotos.size > 1) {
            const hosts = new Set(out.urls.map(hostnameOf).filter(Boolean));
            if (hosts.size > 1) return false;
        }

        let changed = false;
        for (const key of out.gotos) changed = maybeSetGoto(key, best) || changed;
        return changed;
    }

    function scanDataTree(node, depth = 0) {
        if (!node || depth > 16 || typeof node === 'string') return;

        if (Array.isArray(node)) {
            const gotoValue = typeof node[17] === 'string' ? normalizeGoto(node[17]) : '';
            const structuralTarget =
                node[32]?.[3]?.[0] ||
                node[33]?.[3]?.[0] ||
                node[33]?.[14]?.[7] ||
                node[9]?.['2003']?.[2] ||
                '';
            if (gotoValue && structuralTarget) maybeSetGoto(gotoValue, structuralTarget);

            // Safari/iOS Google frequently nests the /goto token and real URL in
            // different branches of one W_jd record. Pair within that record,
            // but refuse ambiguous multi-domain containers.
            mapContainer(node);
            for (const item of node) scanDataTree(item, depth + 1);
            return;
        }

        if (typeof node === 'object') {
            for (const value of Object.values(node)) scanDataTree(value, depth + 1);
        }
    }

    function processWjdData(data) {
        if (!data || typeof data !== 'object') return;
        for (const entry of Object.values(data)) {
            if (!entry || typeof entry !== 'object') continue;
            mapContainer(entry);
            scanDataTree(entry);
        }
        scheduleScan();
    }

    function installDirectWjdHook() {
        try {
            if (window.__UB_GOOGLE_WJD_TRAMPOLINE__) return;
            window.__UB_GOOGLE_WJD_TRAMPOLINE__ = true;
            const store = {};
            if (window.W_jd && typeof window.W_jd === 'object') {
                Object.assign(store, window.W_jd);
                processWjdData(store);
            }
            const proxify = () => new Proxy(store, {
                set(obj, prop, value) {
                    obj[prop] = value;
                    if (typeof prop === 'string' && value && typeof value === 'object') {
                        processWjdData({ [prop]: value });
                    }
                    return true;
                }
            });
            let proxy = proxify();
            Object.defineProperty(window, 'W_jd', {
                configurable: true,
                enumerable: true,
                get() { return proxy; },
                set(value) {
                    if (value && typeof value === 'object') {
                        Object.assign(store, value);
                        processWjdData(value);
                        proxy = proxify();
                    }
                }
            });
        } catch (_) {}
    }

    function installWjdTrampoline() {
        if (!document) return;
        const code = `(() => {
            if (window.__UB_GOOGLE_WJD_TRAMPOLINE__) return;
            window.__UB_GOOGLE_WJD_TRAMPOLINE__ = true;
            const emit = (data) => {
                try {
                    const detail = JSON.stringify(data);
                    window.dispatchEvent(new CustomEvent('${WJD_EVENT}', { detail }));
                } catch (_) {}
            };
            const store = {};
            try {
                if (window.W_jd && typeof window.W_jd === 'object') {
                    Object.assign(store, window.W_jd);
                    emit(store);
                }
            } catch (_) {}
            const proxify = () => new Proxy(store, {
                set(obj, prop, value) {
                    obj[prop] = value;
                    if (typeof prop === 'string' && value && typeof value === 'object') {
                        emit({ [prop]: value });
                    }
                    return true;
                }
            });
            let proxy = proxify();
            try {
                Object.defineProperty(window, 'W_jd', {
                    configurable: true,
                    enumerable: true,
                    get() { return proxy; },
                    set(value) {
                        if (value && typeof value === 'object') {
                            Object.assign(store, value);
                            emit(value);
                            proxy = proxify();
                        }
                    }
                });
            } catch (_) {
                try { if (window.W_jd) emit(window.W_jd); } catch (_) {}
            }
        })();`;
        try {
            const script = document.createElement('script');
            script.textContent = code;
            (document.documentElement || document.head)?.appendChild(script);
            script.remove();
        } catch (_) {}
    }

    function extractBalanced(text, startIndex, openChar, closeChar) {
        const start = text.indexOf(openChar, startIndex);
        if (start < 0) return '';
        let depth = 0;
        let quote = '';
        let escaped = false;
        for (let i = start; i < text.length; i += 1) {
            const ch = text[i];
            if (quote) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === quote) quote = '';
                continue;
            }
            if (ch === '"' || ch === "'") {
                quote = ch;
                continue;
            }
            if (ch === openChar) depth += 1;
            else if (ch === closeChar && --depth === 0) return text.slice(start, i + 1);
        }
        return '';
    }

    function scanScript(script) {
        if (!script || scannedScripts.has(script)) return;
        scannedScripts.add(script);
        const text = script.textContent || '';
        if (!text.includes('/goto') && !text.includes('W_jd')) return;

        let pos = 0;
        while ((pos = text.indexOf('var m=', pos)) !== -1) {
            const jsonText = extractBalanced(text, pos + 6, '{', '}');
            if (!jsonText) {
                pos += 6;
                continue;
            }
            try { processWjdData(JSON.parse(jsonText)); } catch (_) {}
            pos += jsonText.length;
        }

        const assignRe = /window\[['"]W_jd['"]\]\[['"]([^'"]+)['"]\]\s*=\s*/g;
        let match;
        while ((match = assignRe.exec(text))) {
            const arrayText = extractBalanced(text, assignRe.lastIndex, '[', ']');
            if (!arrayText) continue;
            try { processWjdData({ [match[1]]: JSON.parse(arrayText) }); } catch (_) {}
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
            const parsed = JSON.parse(payload);
            mapContainer(parsed);
            scanDataTree(parsed);
        } catch (_) {}
    }

    function scanEmbeddedData(root = document) {
        const scope = root?.querySelectorAll ? root : document;
        for (const script of scope.querySelectorAll?.('script') || []) scanScript(script);
        try {
            const walker = document.createTreeWalker(
                root === document ? document.documentElement : root,
                NodeFilter.SHOW_COMMENT
            );
            let node;
            while ((node = walker.nextNode())) scanComment(node);
        } catch (_) {}
    }

    function displayedDomainURL(root) {
        for (const node of root.querySelectorAll('.ob9lvb, cite')) {
            const match = DISPLAYED_DOMAIN_RE.exec(node.textContent || '');
            if (match) return `https://${match[0]}/`;
        }
        return '';
    }

    function externalURLFromAttributes(root) {
        const candidates = [];
        const nodes = [root, ...root.querySelectorAll('*')].slice(0, 300);
        for (const node of nodes) {
            for (const attr of node.attributes || []) {
                const raw = attr.value || '';
                if (!raw) continue;
                const interestingName = /(?:url|href|lpage|fburl|rw|target|dest)/i.test(attr.name);
                const interestingValue = /(?:https?:|https?%3a|\\u002f\\u002f|\\x2f\\x2f)/i.test(raw);
                if (!interestingName && !interestingValue) continue;
                const direct = externalURL(raw);
                if (direct) candidates.push(direct);
                if (raw.includes('http') || /https?%3a/i.test(raw)) {
                    let decoded = cleanEscapes(raw);
                    try { decoded = decodeURIComponent(decoded); } catch (_) {}
                    for (const m of decoded.matchAll(/https?:\/\/[^"'\\\s,\]}<>]+/g)) {
                        const target = externalURL(m[0]);
                        if (target) candidates.push(target);
                    }
                }
            }
        }
        return pickBestURL(candidates);
    }

    function externalURLFromFavicon(root) {
        for (const image of root.querySelectorAll('img[src]')) {
            try {
                const url = new URL(cleanEscapes(image.getAttribute('src') || ''), location.href);
                for (const value of url.searchParams.values()) {
                    const target = externalURL(value);
                    if (target) return target;
                    try {
                        const decoded = externalURL(decodeURIComponent(value));
                        if (decoded) return decoded;
                    } catch (_) {}
                }
            } catch (_) {}
        }
        return '';
    }

    function directExternalAnchor(root) {
        for (const anchor of root.querySelectorAll('a[href]')) {
            if (anchor.hasAttribute('data-ub-google-source-proxy-anchor')) continue;
            const raw = anchor.getAttribute('href') || '';
            if (normalizeGoto(raw)) continue;
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
        for (const anchor of root.querySelectorAll('a[href*="/search/about-this-result"][href*="req="]')) {
            const target = targetFromAboutURL(anchor.getAttribute('href') || anchor.href);
            if (target) return target;
        }
        return '';
    }

    function sourceURLForRoot(root) {
        return mappedGotoURL(root) ||
            directExternalAnchor(root) ||
            externalURLFromAttributes(root) ||
            externalURLFromFavicon(root) ||
            aboutResultURL(root) ||
            displayedDomainURL(root);
    }

    function builtInCanResolve(root) {
        const mobile = root.querySelector('.UBFage, a[role="presentation"]');
        if (mobile) {
            const raw = mobile.getAttribute('href') || '';
            if (/^https?:\/\//.test(raw) && externalURL(raw)) return true;
        }
        return Boolean(displayedDomainURL(root));
    }

    function ensureUBlacklistRoot(root) {
        if (!isElement(root) || root.matches(RESULT_SELECTOR)) return;
        root.classList.add('vt6azd');
        root.setAttribute(TEMP_ROOT_ATTRIBUTE, '1');
        const cleanup = () => {
            if (!root.isConnected) return true;
            if (root.hasAttribute('data-ub-result')) {
                root.classList.remove('vt6azd');
                root.removeAttribute(TEMP_ROOT_ATTRIBUTE);
                return true;
            }
            return false;
        };
        requestAnimationFrame(() => {
            if (!cleanup()) {
                setTimeout(() => {
                    if (!cleanup() && root.isConnected) {
                        root.classList.remove('vt6azd');
                        root.removeAttribute(TEMP_ROOT_ATTRIBUTE);
                    }
                }, 1500);
            }
        });
    }

    function rewriteOpaqueLink(link, sourceURL) {
        if (!isElement(link) || link.closest('[data-ub-google-source-proxy]')) return false;
        const source = externalURL(sourceURL);
        const current = link.getAttribute('href') || '';
        if (!source || !normalizeGoto(current)) return false;
        if (!link.hasAttribute('data-ub-google-original-href')) {
            link.setAttribute('data-ub-google-original-href', current);
        }
        if (link.getAttribute('href') !== source) link.setAttribute('href', source);
        return true;
    }

    function addProxy(root, sourceURL, kind = 'default') {
        if (!isElement(root)) return false;
        const source = externalURL(sourceURL);
        if (!source) return false;
        ensureUBlacklistRoot(root);

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
            proxy.setAttribute('data-ub-google-source-proxy-anchor', kind);
            wrapper.appendChild(proxy);
            root.prepend(wrapper);
        }
        if (proxy && proxy.getAttribute('href') !== source) proxy.setAttribute('href', source);
        if (proxy) queueMicrotask(() => {
            if (proxy.isConnected) proxy.setAttribute('href', source);
        });
        return true;
    }

    function resignalUBlacklist(root) {
        if (!isElement(root) || !root.hasAttribute('data-ub-result')) return;
        const proxy = root.querySelector(PROXY_ANCHOR_SELECTOR);
        const href = proxy?.getAttribute('href') || '';
        if (!href) return;
        queueMicrotask(() => {
            if (proxy.isConnected) proxy.setAttribute('href', href);
        });
    }

    function semanticResultRoot(seed) {
        const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 390;
        const maxHeight = Math.max((window.innerHeight || 800) * 0.95, 620);
        let best = null;
        for (
            let node = seed;
            isElement(node) && node !== document.body && node !== document.documentElement;
            node = node.parentElement
        ) {
            const rect = node.getBoundingClientRect();
            const text = node.innerText || node.textContent || '';
            const headings = node.querySelectorAll(HEADING_SELECTOR).length;
            const plausible =
                rect.width >= viewportWidth * 0.68 &&
                rect.height >= 52 && rect.height <= maxHeight &&
                text.trim().length >= 8 && text.length <= 2600 &&
                headings <= 1;
            if (plausible) best = node;
            else if (best && (headings > 1 || rect.height > maxHeight)) break;
        }
        return best;
    }

    function bridgeOpaqueLink(link) {
        if (!isElement(link) || link.closest(NEWS_CARD_SELECTOR) ||
            link.closest('[data-ub-google-source-proxy]')) return;

        const root = link.closest(RESULT_SELECTOR) || semanticResultRoot(link);
        if (!root) return;
        const key = normalizeGoto(link.getAttribute('href') || link.href);
        const mapped = key && gotoMap.get(key);
        if (mapped) {
            rewriteOpaqueLink(link, mapped);
            addProxy(root, mapped);
            return;
        }
        const source = sourceURLForRoot(root);
        if (source) {
            rewriteOpaqueLink(link, source);
            addProxy(root, source);
        }
    }

    function bridgeKnownRoot(root) {
        if (!isElement(root) || root.closest(NEWS_CARD_SELECTOR)) return;
        if (builtInCanResolve(root)) return;
        const source = sourceURLForRoot(root);
        if (source) addProxy(root, source);
    }

    function bridgeNewsCard(card) {
        if (!isElement(card)) return;
        const source = sourceURLForRoot(card);
        if (source) addProxy(card, source, 'news');
    }

    function scan() {
        scanEmbeddedData(document);
        document.querySelectorAll(NEWS_CARD_SELECTOR).forEach(bridgeNewsCard);
        document.querySelectorAll(RESULT_SELECTOR).forEach(bridgeKnownRoot);
        document.querySelectorAll(OPAQUE_LINK_SELECTOR).forEach(bridgeOpaqueLink);
        document.documentElement?.setAttribute('data-ub-google-bridge-version', VERSION);
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
        window.addEventListener(WJD_EVENT, (event) => {
            try {
                const detail = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
                processWjdData(detail);
            } catch (_) {}
        });
        // @grant none normally runs in the page world. Hook directly when it
        // does, and also inject the event trampoline for Safari managers that
        // isolate userscripts or fall back to an isolated world under CSP.
        installDirectWjdHook();
        installWjdTrampoline();
        scan();

        new MutationObserver((records) => {
            for (const record of records) {
                if (record.type === 'attributes' && record.attributeName === 'data-ub-result') {
                    resignalUBlacklist(record.target);
                }
                if (record.type === 'childList') {
                    for (const node of record.addedNodes) {
                        if (node.nodeType === Node.COMMENT_NODE) scanComment(node);
                        else if (isElement(node)) scanEmbeddedData(node);
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

        [100, 500, 1500, 4000, 8000].forEach((delay) => setTimeout(scan, delay));
    }

    // Small diagnostic surface for verifying the installed version/map without
    // exposing any browsing data outside the page.
    window.__UB_GOOGLE_BRIDGE__ = {
        version: VERSION,
        get mapSize() { return gotoMap.size; },
        resolveGoto(value) { return gotoMap.get(normalizeGoto(value)) || ''; },
        scan,
    };

    if (document.documentElement) start();
    else new MutationObserver((_, observer) => {
        if (!document.documentElement) return;
        observer.disconnect();
        start();
    }).observe(document, { childList: true, subtree: true });
})();
