// ==UserScript==
// @name         Google - uBlacklist compatibility bridge
// @namespace    https://github.com/usernomom/personal-adblock-filterlist
// @author       nobody
// @description  Restore real Google result destinations so uBlacklist can filter opaque /goto results reliably, including Safari/iOS layouts.
// @license      MIT
// @version      13
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_news_ublacklist_bridge.js
// @updateURL    https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_news_ublacklist_bridge.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM.xmlhttpRequest
// @grant        unsafeWindow
// @connect      *
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '13';
    const WJD_EVENT = '__UB_GOOGLE_WJD_UPDATE__';
    const KNOWN_ROOT_SELECTOR = '.vt6azd, .Ww4FFb, .sHEJob, [data-news-cluster-id], .eejeod';
    const NEWS_CARD_SELECTOR = '[data-news-cluster-id]';
    const OPAQUE_LINK_SELECTOR = 'a[href*="/goto?"]';
    const HEADING_SELECTOR = '[role="heading"][aria-level="3"], h3, .GkAmnd';
    const NESTED_RESULT_SELECTOR = '.xYkm8c';
    const COLLAPSIBLE_SLOT_SELECTOR = '.Rb7Fnd, .dRzkFf';
    const PROXY_WRAPPER_SELECTOR = ':scope > [data-ub-google-source-proxy]';
    const BRIDGE_ROOT_ATTRIBUTE = 'data-ub-google-bridge-root';

    const gotoMap = new Map();
    const pendingByGoto = new Map();
    const networkFallbacks = new Map();
    const scannedScripts = new WeakSet();
    const scannedComments = new WeakSet();
    const stats = {
        proxyAdds: 0,
        observerCallbacks: 0,
        observedAddedNodes: 0,
        networkFallbacks: 0,
        networkFallbackFailures: 0,
    };

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
            flushPendingForGoto(key, target);
            return true;
        }
        return false;
    }

    function flushPendingForGoto(key, sourceURL) {
        const links = pendingByGoto.get(key);
        if (!links) return;
        pendingByGoto.delete(key);
        for (const link of links) {
            if (link?.isConnected) bridgeResolvedLink(link, sourceURL);
        }
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
    }

    function installDirectWjdHook() {
        try {
            const pageWindow =
                typeof unsafeWindow === 'object' && unsafeWindow
                    ? unsafeWindow
                    : window;
            if (pageWindow.__UB_GOOGLE_WJD_TRAMPOLINE__) return;
            pageWindow.__UB_GOOGLE_WJD_TRAMPOLINE__ = true;
            const store = {};
            if (pageWindow.W_jd && typeof pageWindow.W_jd === 'object') {
                Object.assign(store, pageWindow.W_jd);
                processWjdData(store);
            }
            const proxify = () => new Proxy(store, {
                set(obj, prop, value) {
                    obj[prop] = value;
                    if (typeof prop === 'string' && Array.isArray(value)) {
                        processWjdData({ [prop]: value });
                    }
                    return true;
                }
            });
            let proxy = proxify();
            Object.defineProperty(pageWindow, 'W_jd', {
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
                    if (typeof prop === 'string' && Array.isArray(value)) {
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

    function ensureUBlacklistRoot(root) {
        if (!isElement(root)) return false;
        if (!root.matches(KNOWN_ROOT_SELECTOR)) {
            root.classList.add('vt6azd');
        }
        root.setAttribute(BRIDGE_ROOT_ATTRIBUTE, '1');
        return true;
    }

    function addProxyOnce(root, sourceURL, kind = 'default') {
        if (!isElement(root)) return false;
        const source = externalURL(sourceURL);
        if (!source) return false;

        const existing = root.querySelector(PROXY_WRAPPER_SELECTOR);
        if (existing) return false;

        ensureUBlacklistRoot(root);

        const wrapper = document.createElement('span');
        wrapper.hidden = true;
        wrapper.setAttribute('aria-hidden', 'true');
        wrapper.setAttribute('data-ub-google-source-proxy', kind);
        wrapper.className = 'yuRUbf';

        const proxy = document.createElement('a');
        proxy.className = 'UBFage';
        proxy.tabIndex = -1;
        proxy.setAttribute('aria-hidden', 'true');
        proxy.setAttribute('data-ub-google-source-proxy-anchor', kind);
        proxy.setAttribute('href', source);

        wrapper.appendChild(proxy);
        root.prepend(wrapper);
        stats.proxyAdds += 1;
        return true;
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

    function uniqueGotoCount(root) {
        const keys = new Set();
        for (const anchor of root.querySelectorAll(OPAQUE_LINK_SELECTOR)) {
            const key = normalizeGoto(anchor.getAttribute('href') || anchor.href);
            if (key) keys.add(key);
            if (keys.size > 1) break;
        }
        return keys.size;
    }

    function isPrimaryNestedLink(link) {
        return Boolean(
            link.querySelector(HEADING_SELECTOR) ||
            link.closest('[role="heading"][aria-level="3"], h3')
        );
    }

    function rootForOpaqueLink(link) {
        const known = link.closest(KNOWN_ROOT_SELECTOR);
        if (known && uniqueGotoCount(known) > 1) {
            const nested = link.closest(NESTED_RESULT_SELECTOR);
            if (nested && nested !== known && known.contains(nested)) {
                return nested;
            }
            const semantic = semanticResultRoot(link);
            if (semantic && semantic !== known && known.contains(semantic)) {
                return semantic;
            }
        }
        return known || semanticResultRoot(link);
    }

    function parseLocationHeader(headers) {
        const match = String(headers || '').match(/^location:\s*(.+)$/im);
        return match ? match[1].trim() : '';
    }

    function parseRedirectBody(text) {
        const body = String(text || '');
        if (!/<title>302 moved<\/title>/i.test(body) || !/the document has moved/i.test(body)) {
            return '';
        }
        const match = body.match(/<a\s+href=["']([^"']+)["'][^>]*>here<\/a>/i);
        return match ? match[1] : '';
    }

    function gmRequest(details) {
        const legacy =
            typeof GM_xmlhttpRequest === 'function'
                ? GM_xmlhttpRequest
                : null;
        const modern =
            typeof GM === 'object' && GM
                ? (typeof GM.xmlHttpRequest === 'function'
                    ? GM.xmlHttpRequest.bind(GM)
                    : (typeof GM.xmlhttpRequest === 'function'
                        ? GM.xmlhttpRequest.bind(GM)
                        : null))
                : null;
        const fn = legacy || modern;
        if (!fn) return null;
        try {
            return fn(details);
        } catch (_) {
            return null;
        }
    }

    function resolveGotoViaNetwork(key) {
        if (!key || gotoMap.has(key)) return;
        if (networkFallbacks.has(key)) return;

        const url = `${location.origin}${key}`;
        stats.networkFallbacks += 1;

        const promise = new Promise((resolve) => {
            let settled = false;
            const finish = (response) => {
                if (settled) return;
                settled = true;
                const headerTarget = parseLocationHeader(response?.responseHeaders);
                const finalTarget =
                    response?.finalUrl ||
                    response?.finalURL ||
                    response?.responseURL ||
                    response?.responseUrl ||
                    '';
                const bodyTarget = parseRedirectBody(
                    response?.responseText ||
                    (typeof response?.response === 'string' ? response.response : '')
                );
                const target =
                    externalURL(headerTarget) ||
                    externalURL(finalTarget) ||
                    externalURL(bodyTarget);
                if (target) {
                    maybeSetGoto(key, target);
                    resolve(target);
                } else {
                    stats.networkFallbackFailures += 1;
                    resolve('');
                }
            };
            const fail = () => {
                if (settled) return;
                settled = true;
                stats.networkFallbackFailures += 1;
                resolve('');
            };
            // Last-resort resolver for nested discussion rows. The request is
            // anonymous; some managers still follow Google's redirect to the target.
            const control = gmRequest({
                method: 'GET',
                url,
                anonymous: true,
                nocache: true,
                timeout: 5000,
                responseType: 'text',
                redirect: 'manual',
                onload: finish,
                onerror: fail,
                ontimeout: fail,
                onabort: fail,
            });
            if (!control) fail();
        }).finally(() => {
            networkFallbacks.delete(key);
        });

        networkFallbacks.set(key, promise);
    }

    function scheduleNetworkFallback(link, key) {
        if (!isPrimaryNestedLink(link) && !link.closest(NESTED_RESULT_SELECTOR)) return;
        const known = link.closest(KNOWN_ROOT_SELECTOR);
        if (!known || (uniqueGotoCount(known) <= 1 && !link.closest(NESTED_RESULT_SELECTOR))) return;

        setTimeout(() => {
            if (!gotoMap.has(key) && link.isConnected) {
                resolveGotoViaNetwork(key);
            }
        }, 120);
    }

    function installGapCollapseStyle() {
        if (document.querySelector('[data-ub-google-gap-style]')) return;
        const style = document.createElement('style');
        style.setAttribute('data-ub-google-gap-style', VERSION);
        style.textContent = `
html[data-ub-hide-blocked-results] :is(${COLLAPSIBLE_SLOT_SELECTOR}):has([data-ub-block]:not([data-ub-preserve-space])) {
    display: none !important;
}`;
        (document.head || document.documentElement).appendChild(style);
    }

    function bridgeResolvedLink(link, sourceURL) {
        if (!isElement(link) || link.closest('[data-ub-google-source-proxy]')) return false;
        const root = rootForOpaqueLink(link);
        if (!root) return false;
        const kind = root.matches(NEWS_CARD_SELECTOR) ? 'news' : 'default';
        return addProxyOnce(root, sourceURL, kind);
    }

    function registerOpaqueLink(link) {
        if (!isElement(link) || link.closest('[data-ub-google-source-proxy]')) return;
        const key = normalizeGoto(link.getAttribute('href') || link.href);
        if (!key) return;

        const mapped = gotoMap.get(key);
        if (mapped) {
            bridgeResolvedLink(link, mapped);
            return;
        }

        let links = pendingByGoto.get(key);
        if (!links) {
            links = new Set();
            pendingByGoto.set(key, links);
        }
        links.add(link);
        scheduleNetworkFallback(link, key);
    }

    function bridgeSubtree(root) {
        if (!isElement(root) || root.closest('[data-ub-google-source-proxy]')) return;
        if (root.matches(OPAQUE_LINK_SELECTOR)) registerOpaqueLink(root);
        root.querySelectorAll(OPAQUE_LINK_SELECTOR).forEach(registerOpaqueLink);
    }

    function scanInitialDocument() {
        scanEmbeddedData(document);
        document.querySelectorAll(OPAQUE_LINK_SELECTOR).forEach(registerOpaqueLink);
        document.documentElement?.setAttribute('data-ub-google-bridge-version', VERSION);
    }

    function prunePendingLinks() {
        for (const [key, links] of pendingByGoto) {
            for (const link of links) {
                if (!link.isConnected) links.delete(link);
            }
            if (!links.size) pendingByGoto.delete(key);
        }
    }
    function start() {
        window.addEventListener(WJD_EVENT, (event) => {
            try {
                const detail = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
                processWjdData(detail);
            } catch (_) {}
        });

        // Capture Google's result metadata, but keep uBlacklist integration
        // strictly one-way: the bridge never rewrites result hrefs or reacts
        // to uBlacklist's own mutations.
        installDirectWjdHook();
        installWjdTrampoline();
        installGapCollapseStyle();

        const observer = new MutationObserver((records) => {
            stats.observerCallbacks += 1;
            for (const record of records) {
                for (const node of record.addedNodes) {
                    stats.observedAddedNodes += 1;
                    if (node.nodeType === Node.COMMENT_NODE) {
                        scanComment(node);
                        continue;
                    }
                    if (!isElement(node)) continue;
                    if (node.closest('[data-ub-google-source-proxy]')) continue;

                    if (node.tagName === 'SCRIPT') scanScript(node);
                    scanEmbeddedData(node);
                    bridgeSubtree(node);
                }
            }
            prunePendingLinks();
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });

        scanInitialDocument();
    }

    // Diagnostic surface for development verification. The DOM version marker
    // remains available even when the userscript manager runs in an isolated world.
    window.__UB_GOOGLE_BRIDGE__ = {
        version: VERSION,
        get mapSize() { return gotoMap.size; },
        get pendingCount() {
            let count = 0;
            for (const links of pendingByGoto.values()) count += links.size;
            return count;
        },
        get stats() { return { ...stats }; },
        resolveGoto(value) { return gotoMap.get(normalizeGoto(value)) || ''; },
    };
    if (document.documentElement) start();
    else new MutationObserver((_, observer) => {
        if (!document.documentElement) return;
        observer.disconnect();
        start();
    }).observe(document, { childList: true, subtree: true });
})();
