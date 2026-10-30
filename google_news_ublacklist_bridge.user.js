// ==UserScript==
// @name         Google - uBlacklist compatibility bridge
// @namespace    https://github.com/usernomom/personal-adblock-filterlist
// @author       nobody
// @description  Restore real Google result destinations so uBlacklist can filter opaque /goto results reliably, including Safari/iOS layouts.
// @license      MIT
// @version      13.3.0
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_news_ublacklist_bridge.user.js
// @updateURL    https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_news_ublacklist_bridge.user.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

/*
 * BEHAVIOUR SPEC - exactly what this script does, by rule ID. Update it in
 * the same change as any code change; rules change only on the owner's
 * request.
 *
 * UB-1 Opaque results. When a result links through an opaque Google /goto
 *      URL, its real destination is found and a hidden proxy link to it
 *      (a.UBFage inside span[data-ub-google-source-proxy]) is prepended to
 *      the result, so uBlacklist can match the destination. Sources, in
 *      order: a destination URL in Google's embedded result data, a
 *      destination URL displayed in the result or held in its data-curl or
 *      data-surl attribute (video results; one URL per result), then, for a
 *      single-result root or the primary or nested link of a multi-result
 *      module: (1) the result's own page data: its domain in Google's inline
 *      result data, else the host ending a thumbnail's alt text ("<query>
 *      from <host>", profile cards; one host per result, never Google);
 *      (2) the host learned for the result's site name ("Site · qualifier"
 *      line); (3) once the page has been parsed, the built-in site list
 *      KNOWN_SITES (Instagram, Facebook, X, YouTube, TikTok, LinkedIn,
 *      Pinterest, Threads, Reddit; owner-approved 2026-10-30); else the
 *      result is released (UB-4). A site name is learned, when the name
 *      matches the host, from results whose destination the page shows
 *      (displayed or data-curl URL, direct link, inline domain, thumbnail
 *      host) and from Google inline entries that name exactly one
 *      non-Google host besides images (strings of up to 30 characters).
 *      Learned and inferred hosts drop a leading www. or m.; a name seen
 *      with unrelated hosts is never used, and list hosts are never stored.
 *      Learned names persist across pages under one bounded storage key. A
 *      qualifier adds a path only where KNOWN_SITES marks it as certainly a
 *      handle: Instagram lowercase username -> /<handle>/, X @handle ->
 *      /<handle>, TikTok @handle -> /@<handle>, Reddit r/<name> ->
 *      /r/<name>/; anything else is host-only. Inferred proxies carry
 *      data-ub-google-bridge-inferred = their source (inline-data, page-host,
 *      site-name, site-list, with -path when a path was added). Whole-site
 *      rules (*://*.<domain>/*) and handle or subreddit rules therefore
 *      match name-only results once their domain or site name is known;
 *      exact-host rules for www. or m. and other exact-path rules do not.
 * UB-2 Direct results. A result whose external links all point to one host
 *      gets a proxy with the best of those URLs, unless uBlacklist's own
 *      readable URL is already as good.
 * UB-3 One proxy per result. Result hrefs are never rewritten, and the
 *      bridge ignores its own proxies and uBlacklist's changes.
 * UB-4 Result firewall. On the Web, News, Videos and Forums tabs (never
 *      Images or other tabs), results uBlacklist classifies stay hidden
 *      until uBlacklist has processed them, on desktop and mobile alike;
 *      attaching a bridge proxy never reveals a result on its own, and
 *      there is no timer that reveals an unprocessed result. A result that
 *      links only through /goto and has no source above once the page has
 *      been parsed (or, for results added later, at once) is released:
 *      marked data-ub-google-bridge-unresolved and shown without waiting
 *      for uBlacklist, on every tab including News and Top stories, since
 *      uBlacklist may never mark a root it cannot read a URL from. Results
 *      uBlacklist blocks are hidden when it hides blocked results.
 * UB-5 Gap collapse. When uBlacklist hides blocked results, result slots
 *      whose results are all blocked are hidden.
 * UB-6 No network. The bridge makes no network request of any kind (no
 *      /goto resolution); it reads only the page and its own storage.
 * Test marker: html[data-ub-google-bridge-version] = @version.
 */

(() => {
    'use strict';

    const VERSION = '13.3.0';
    const WJD_EVENT = '__UB_GOOGLE_WJD_UPDATE__';
    const SEARCH_PARAMS = new URLSearchParams(location.search);
    const IS_NEWS_TAB = SEARCH_PARAMS.get('tbm') === 'nws';
    const IS_IMAGES_TAB =
        ['2', 'imgs'].includes(SEARCH_PARAMS.get('udm')) ||
        SEARCH_PARAMS.get('tbm') === 'isch';
    const IS_MOBILE_LAYOUT = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    // Mirrors uBlacklist's built-in Google "Web" SERPINFO excludeRegex. The
    // firewall may only quarantine roots that some active uBlacklist rule
    // actually classifies on the current tab, or they can never be released.
    const IS_WEB_TAB = !/[?&](udm=(?!14|web(&|$))|tbm=(?!&|$))/.test(location.search);
    const IS_FORUMS_TAB = /[?&]udm=(18|forums)(&|$)/.test(location.search);
    const IS_VIDEOS_TAB = /[?&]udm=(7|vids)(&|$)/.test(location.search);
    const NEWS_CARD_SELECTOR = '[data-news-cluster-id]';
    const VISUAL_DIGEST_VIDEO_SELECTOR = '[data-attrid="VisualDigestVideoResult"]';
    const KNOWN_ROOT_SELECTOR = `.vt6azd, .Ww4FFb, .sHEJob, ${NEWS_CARD_SELECTOR}, ${VISUAL_DIGEST_VIDEO_SELECTOR}, .eejeod`;
    const OPAQUE_LINK_SELECTOR = 'a[href*="/goto?"]';
    const DIRECT_OR_WRAPPED_LINK_SELECTOR = 'a[href^="http://"], a[href^="https://"], a[href^="//"], a[href*="/url?"]';
    const UBLACKLIST_NATIVE_URL_SELECTOR = '.UBFage, a[role="presentation"]';
    const HEADING_SELECTOR = '[role="heading"][aria-level="3"], h3, .GkAmnd';
    const NESTED_RESULT_SELECTOR = '.xYkm8c';
    const COLLAPSIBLE_SLOT_SELECTOR = '.Rb7Fnd, .dRzkFf';
    const PROXY_WRAPPER_SELECTOR = ':scope > [data-ub-google-source-proxy]';
    const BRIDGE_ROOT_ATTRIBUTE = 'data-ub-google-bridge-root';
    const UNRESOLVED_ATTRIBUTE = 'data-ub-google-bridge-unresolved';
    const INFERRED_ATTRIBUTE = 'data-ub-google-bridge-inferred';
    // Each result root holds Google's "About this result" control, whose
    // jsdata names the result's inline data entry.
    const RESULT_ENTRY_JSDATA_PREFIX = 'l7Bhpb;_;';
    const SITE_HOSTS_KEY = 'siteHosts';
    const SITE_HOSTS_LIMIT = 500;
    const SITE_NAME_MAX_LENGTH = 60;
    // Last resort for name-only cards of these sites, approved by the owner on
    // 2026-10-30. Hosts verified that day by following each home page's
    // redirects (desktop user agent). handle/path: the qualifier shapes that
    // are certainly a profile handle, and that profile's URL path.
    const KNOWN_SITES = [
        { name: 'instagram', host: 'www.instagram.com', handle: /^([a-z0-9._]{1,30})$/, path: (h) => `/${h}/` },
        { name: 'facebook', host: 'www.facebook.com' },
        { name: 'x', host: 'x.com', handle: /^@([A-Za-z0-9_]{1,15})$/, path: (h) => `/${h}` },
        { name: 'youtube', host: 'www.youtube.com' },
        { name: 'tiktok', host: 'www.tiktok.com', handle: /^@([a-z0-9._]{2,24})$/, path: (h) => `/@${h}` },
        { name: 'linkedin', host: 'www.linkedin.com' },
        { name: 'pinterest', host: 'www.pinterest.com' },
        { name: 'threads', host: 'www.threads.com' },
        { name: 'reddit', host: 'www.reddit.com', handle: /^r\/([A-Za-z0-9_]{2,21})(?:\s|$)/, path: (h) => `/r/${h}/` },
    ];
    const gotoMap = new Map();
    const pendingByGoto = new Map();
    const pendingRootByLink = new WeakMap();
    const inlineDomainByEntry = new Map();
    const inlineDomainByGoto = new Map();
    const unresolvedRoots = new Map();
    const siteHosts = loadSiteHosts();
    let retryingUnresolved = false;
    let retryUnresolvedAgain = false;
    const scannedScripts = new WeakSet();
    const scannedComments = new WeakSet();
    const stats = {
        proxyAdds: 0,
        inferredProxies: 0,
        observerCallbacks: 0,
        observedAddedNodes: 0,
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
            const root = pendingRootByLink.get(link);
            if (root?.isConnected) {
                if (bridgeResolvedRoot(root, sourceURL) && link?.isConnected && canInferForLink(link)) {
                    learnSiteHost(root, sourceURL);
                }
            }
            else if (link?.isConnected) bridgeResolvedLink(link, sourceURL);
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

    function isHostShaped(value) {
        const host = String(value || '').toLowerCase();
        return host.length <= 253 &&
            /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(host) &&
            !isGoogleHost(host);
    }

    function base64UrlBytes(value) {
        const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), '='));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    // Reads one protobuf varint; returns [value, next position] or null.
    function readVarint(bytes, pos) {
        let value = 0;
        for (let shift = 0; shift < 70 && pos < bytes.length; shift += 7) {
            const byte = bytes[pos++];
            value += (byte & 0x7f) * 2 ** shift;
            if (!(byte & 0x80)) return [value, pos];
        }
        return null;
    }

    // Returns the first length-delimited payload of field `field`, or null.
    // Only varint and length-delimited fields are understood; anything else,
    // or any out-of-bounds length, ends the search.
    function protobufField(bytes, field) {
        let pos = 0;
        while (bytes && pos < bytes.length) {
            const tag = readVarint(bytes, pos);
            if (!tag) return null;
            pos = tag[1];
            const wireType = tag[0] % 8;
            if (wireType === 0) {
                const value = readVarint(bytes, pos);
                if (!value) return null;
                pos = value[1];
            } else if (wireType === 2) {
                const length = readVarint(bytes, pos);
                if (!length || length[1] + length[0] > bytes.length) return null;
                const start = length[1];
                pos = start + length[0];
                if (Math.floor(tag[0] / 8) === field) return bytes.subarray(start, pos);
            } else {
                return null;
            }
        }
        return null;
    }

    // Google's inline entry for a web result carries a base64url protobuf at
    // [22][12] whose field 3.11.2 is the result's registrable domain
    // (2026-10-30 iPhone capture). Anything else yields ''.
    function inlineDomainOf(entry) {
        try {
            const blob = Array.isArray(entry) ? entry[22]?.[12] : null;
            if (typeof blob !== 'string' || !blob || blob.length > 65536) return '';
            const domainBytes = [3, 11, 2].reduce(
                (bytes, field) => protobufField(bytes, field),
                base64UrlBytes(blob),
            );
            if (!domainBytes || domainBytes.length > 253) return '';
            const domain = String.fromCharCode(...domainBytes).toLowerCase();
            return isHostShaped(domain) ? domain : '';
        } catch (_) {
            return '';
        }
    }

    function captureInlineDomains(data) {
        let added = false;
        for (const [entryKey, entry] of Object.entries(data)) {
            const domain = inlineDomainOf(entry);
            if (!domain) {
                learnFromEntry(entry);
                continue;
            }
            if (inlineDomainByEntry.get(entryKey) !== domain) {
                inlineDomainByEntry.set(entryKey, domain);
                added = true;
            }
            const gotoKey = typeof entry[17] === 'string' ? normalizeGoto(entry[17]) : '';
            if (gotoKey && inlineDomainByGoto.get(gotoKey) !== domain) {
                inlineDomainByGoto.set(gotoKey, domain);
                added = true;
            }
        }
        if (added) retryUnresolved();
    }

    function processWjdData(data) {
        if (!data || typeof data !== 'object') return;
        captureInlineDomains(data);
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
        if (root.matches(VISUAL_DIGEST_VIDEO_SELECTOR) || !root.matches(KNOWN_ROOT_SELECTOR)) {
            root.classList.add('vt6azd');
        }
        root.setAttribute(BRIDGE_ROOT_ATTRIBUTE, '1');
        return true;
    }

    // inferredSource names how a destination was inferred rather than read
    // ('inline-data', 'site-name', with '-path' when a subreddit path was added).
    function addProxyOnce(root, sourceURL, kind = 'default', inferredSource = '') {
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
        if (inferredSource) {
            wrapper.setAttribute(INFERRED_ATTRIBUTE, inferredSource);
            stats.inferredProxies += 1;
        }

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

    function rootForDirectLink(link) {
        const known = link.closest(KNOWN_ROOT_SELECTOR);
        const nested = link.closest(NESTED_RESULT_SELECTOR);
        if (nested && nested !== known && (!known || known.contains(nested))) {
            return nested;
        }
        return known || semanticResultRoot(link);
    }

    function nativeReadableURL(root) {
        if (!isElement(root)) return '';
        for (const anchor of root.querySelectorAll(UBLACKLIST_NATIVE_URL_SELECTOR)) {
            if (anchor.closest('[data-ub-google-source-proxy]')) continue;
            const source = externalURL(anchor.getAttribute('href') || anchor.href);
            if (source) return source;
        }
        return '';
    }


    function displayedResultURL(link, root) {
        const seen = new Set();
        const candidates = [];
        const addText = (value) => {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            if (text && !seen.has(text)) {
                seen.add(text);
                candidates.push(text);
            }
        };

        for (const scope of [link, root]) {
            if (!isElement(scope)) continue;
            scope.querySelectorAll('cite, span, div').forEach((node) => {
                const text = String(node.textContent || '').trim();
                if (/^https?:\/\//i.test(text)) addText(text);
            });

        }

        for (const text of candidates) {
            const match = text.match(/https?:\/\/[^\s<>"'…]+/i);
            if (!match) continue;
            const source = externalURL(match[0].replace(/[),.;:]+$/g, ''));
            if (source) return source;
        }
        return '';
    }

    function directExternalTargets(root) {
        if (!isElement(root)) return [];
        return [...root.querySelectorAll(DIRECT_OR_WRAPPED_LINK_SELECTOR)]
            .filter((anchor) => !anchor.closest('[data-ub-google-source-proxy]'))
            .map((anchor) => externalURL(anchor.getAttribute('href') || anchor.href))
            .filter(Boolean);
    }

    function registerDirectLink(link) {
        if (!isElement(link) || link.closest('[data-ub-google-source-proxy]')) return;

        const source = externalURL(link.getAttribute('href') || link.href);
        if (!source) return;

        const root = rootForDirectLink(link);
        if (!root) return;

        const targets = directExternalTargets(root);
        const hosts = new Set(targets.map(hostnameOf).filter(Boolean));
        if (hosts.size !== 1) return;

        const best = pickBestURL(targets);
        if (!best) return;
        learnSiteHost(root, best);

        if (link.matches(UBLACKLIST_NATIVE_URL_SELECTOR) || root.querySelector(PROXY_WRAPPER_SELECTOR)) return;
        const native = nativeReadableURL(root);
        if (native && !betterURL(best, native)) return;

        addProxyOnce(root, best, 'direct');
    }

    // ---- Site names: "Site · qualifier" lines, learned site-name hosts ----

    function siteNameKey(value) {
        return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // The site line is the root's first text outside headings and the bridge's
    // own proxy. It is found by text, not by class: Google uses div.GkAmnd on
    // web results and div.Aozhyc on video results.
    function siteLine(root) {
        if (!isElement(root)) return null;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const text = String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
            if (!text) continue;
            const parent = node.parentElement;
            if (parent?.closest('h1, h2, h3, h4, h5, h6, [role="heading"], script, style, [data-ub-google-source-proxy]')) {
                continue;
            }
            const [name, ...rest] = text.split(/\s·\s/);
            const key = siteNameOf(name);
            return key ? { name: key, qualifier: rest.join(' · ').trim() } : null;
        }
        return null;
    }

    function siteNameOf(text) {
        const key = siteNameKey(text);
        return key && key.length <= SITE_NAME_MAX_LENGTH && /\p{L}/u.test(key) && !/[/›]|:\/\//.test(key)
            ? key
            : '';
    }

    // The learned and inferred host drops a leading www. or m., so it does not
    // depend on which of a site's cards was seen first and has the same
    // domain-level form as Google's inline data domains.
    function siteOriginOf(url) {
        try {
            const parsed = new URL(url);
            if (!/^https?:$/.test(parsed.protocol)) return '';
            const host = parsed.hostname.toLowerCase().replace(/^(?:www|m)\.(?=[^.]+\.[^.]+)/, '');
            return isHostShaped(host) ? `${parsed.protocol}//${host}` : '';
        } catch (_) {
            return '';
        }
    }

    // A learned pair must look related: the host contains the compacted name
    // or one of its words of four or more letters. This keeps titles and
    // comment counts from being learned as site names.
    function siteNameMatchesHost(name, host) {
        const compactHost = host.replace(/[^a-z0-9]/g, '');
        const compactName = name.replace(/[^\p{L}\p{N}]/gu, '');
        if (compactName && compactHost.includes(compactName)) return true;
        return name.split(/[^\p{L}\p{N}]+/u).some((word) => word.length >= 4 && compactHost.includes(word));
    }

    function isValidSiteHostEntry(entry) {
        if (!Array.isArray(entry) || entry.length !== 2) return false;
        const [name, origin] = entry;
        if (typeof name !== 'string' || !name || name.length > SITE_NAME_MAX_LENGTH) return false;
        if (origin === '') return true;
        if (typeof origin !== 'string') return false;
        try {
            const url = new URL(origin);
            return url.origin === origin && /^https?:$/.test(url.protocol) && isHostShaped(url.hostname);
        } catch (_) {
            return false;
        }
    }

    function loadSiteHosts() {
        const map = new Map();
        try {
            if (typeof GM_getValue !== 'function') return map;
            const raw = GM_getValue(SITE_HOSTS_KEY, '[]');
            const entries = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!Array.isArray(entries)) return map;
            for (const entry of entries.slice(-SITE_HOSTS_LIMIT)) {
                if (isValidSiteHostEntry(entry)) map.set(entry[0], entry[1]);
            }
        } catch (_) {}
        return map;
    }

    function saveSiteHosts() {
        try {
            if (typeof GM_setValue === 'function') GM_setValue(SITE_HOSTS_KEY, JSON.stringify([...siteHosts]));
        } catch (_) {}
    }

    function rememberSiteHost(name, origin) {
        siteHosts.delete(name);
        siteHosts.set(name, origin);
        while (siteHosts.size > SITE_HOSTS_LIMIT) siteHosts.delete(siteHosts.keys().next().value);
    }

    // Learns name -> origin from a root whose destination the page shows.
    // Same host: keep. One host a subdomain of the other: keep the parent.
    // Unrelated hosts: the name becomes ambiguous ('') and is never used.
    function learnSiteHost(root, url) {
        const line = siteLine(root);
        if (line) learnSitePair(line.name, url);
    }

    function learnSitePair(name, url) {
        const origin = siteOriginOf(url);
        if (!origin || !siteNameMatchesHost(name, hostnameOf(origin))) return;

        const known = siteHosts.get(name);
        let next = origin;
        if (known === '') return;
        if (known) {
            const knownBase = hostnameOf(known);
            const newBase = hostnameOf(origin);
            if (knownBase === newBase || newBase.endsWith(`.${knownBase}`)) next = known;
            else if (!knownBase.endsWith(`.${newBase}`)) next = '';
        }
        rememberSiteHost(name, next);
        if (next === known) return;
        saveSiteHosts();
        if (next) retryUnresolved();
    }

    // A Google inline entry (for example a carousel post) whose strings name
    // exactly one non-Google host, image URLs aside, teaches each of its short
    // strings that matches that host as a site name ("Billboard" with
    // www.billboard.com). Entry layout varies, so all strings are read; only
    // strings of up to 30 characters are taken as names.
    function learnFromEntry(entry) {
        if (!entry || typeof entry !== 'object') return;
        const strings = [];
        const collect = (node, depth) => {
            if (strings.length >= 400 || depth > 12) return;
            if (typeof node === 'string') strings.push(node);
            else if (Array.isArray(node)) for (const item of node) collect(item, depth + 1);
            else if (node && typeof node === 'object') for (const item of Object.values(node)) collect(item, depth + 1);
        };
        collect(entry, 0);
        const origins = new Set();
        const names = [];
        for (const value of strings) {
            if (value.length > 2048) continue;
            if (/^https?:\/\//i.test(value)) {
                const url = externalURL(value);
                if (url && !isImageURL(url)) origins.add(siteOriginOf(url));
            } else if (isHostShaped(value)) {
                origins.add(siteOriginOf(`https://${value}`));
            } else if (value.length <= 30) {
                const name = siteNameOf(value);
                if (name) names.push(name);
            }
        }
        origins.delete('');
        if (origins.size !== 1) return;
        const [origin] = origins;
        for (const name of new Set(names)) learnSitePair(name, origin);
    }

    // ---- Resolving opaque results without any request ----

    function knownSiteFor(origin) {
        const host = hostnameOf(origin);
        return KNOWN_SITES.find((site) => {
            const siteHost = hostnameOf(siteOriginOf(`https://${site.host}`));
            return host === siteHost || host.endsWith(`.${siteHost}`);
        }) || null;
    }

    // A profile thumbnail's alt reads "<query> from <host>"; only the last
    // token is read, so the query text and the interface language do not matter.
    function thumbnailOrigin(root) {
        const origins = new Set();
        for (const image of root.querySelectorAll('img[alt]')) {
            if (image.closest('[data-ub-google-source-proxy]')) continue;
            const alt = String(image.getAttribute('alt') || '').trim();
            if (!alt || alt.length > 512) continue;
            const host = alt.slice(alt.lastIndexOf(' ') + 1).toLowerCase();
            if (host !== alt.toLowerCase() && isHostShaped(host)) origins.add(siteOriginOf(`https://${host}`));
        }
        origins.delete('');
        return origins.size === 1 ? [...origins][0] : '';
    }

    // Video results carry their destination in data-curl or data-surl.
    function pageDataURL(root) {
        if (!isElement(root)) return '';
        const urls = new Set();
        for (const node of root.querySelectorAll('[data-curl], [data-surl]')) {
            if (node.closest('[data-ub-google-source-proxy]')) continue;
            for (const name of ['data-curl', 'data-surl']) {
                const url = externalURL(node.getAttribute(name) || '');
                if (url) urls.add(url);
            }
        }
        return urls.size === 1 ? [...urls][0] : '';
    }

    // Single-result roots, or the primary or nested link of a multi-result
    // module; other links of a module say nothing about the root as a whole.
    function canInferForLink(link) {
        const known = link.closest(KNOWN_ROOT_SELECTOR);
        if (!known) return false;
        const isSingleResultCard = known.matches(NEWS_CARD_SELECTOR) || known.matches(VISUAL_DIGEST_VIDEO_SELECTOR);
        const gotoCount = uniqueGotoCount(known);
        if (!gotoCount) return false;
        return isSingleResultCard || gotoCount === 1 ||
            isPrimaryNestedLink(link) || Boolean(link.closest(NESTED_RESULT_SELECTOR));
    }

    function inlineDataDomain(root, key) {
        const entryKeys = new Set();
        for (const node of root.querySelectorAll(`[jsdata^="${RESULT_ENTRY_JSDATA_PREFIX}"]`)) {
            entryKeys.add(node.getAttribute('jsdata').slice(RESULT_ENTRY_JSDATA_PREFIX.length));
        }
        if (entryKeys.size === 1) {
            const domain = inlineDomainByEntry.get([...entryKeys][0]);
            if (domain) return domain;
        }
        return inlineDomainByGoto.get(key) || '';
    }

    // Order: the card's own page data (inline domain, thumbnail host), the
    // learned site-name map, then, once the page has been parsed, the built-in
    // site list. A qualifier adds a path only where KNOWN_SITES says it is
    // certainly a handle of that site.
    function inferDestination(link, key, root) {
        if (!canInferForLink(link)) return null;
        const line = siteLine(root);
        const inline = inlineDataDomain(root, key);
        const thumbnail = inline ? '' : thumbnailOrigin(root);
        const learned = line ? siteHosts.get(line.name) : '';
        const listed = line && document.readyState !== 'loading'
            ? KNOWN_SITES.find((site) => site.name === line.name)
            : null;
        let origin = '';
        let source = '';
        if (inline) [origin, source] = [`https://${inline}`, 'inline-data'];
        else if (thumbnail) [origin, source] = [thumbnail, 'page-host'];
        else if (learned) [origin, source] = [learned, 'site-name'];
        else if (listed) [origin, source] = [siteOriginOf(`https://${listed.host}`), 'site-list'];
        if (!origin) return null;
        const site = knownSiteFor(origin);
        const handle = site?.handle && line ? line.qualifier.match(site.handle) : null;
        const learnFrom = source === 'inline-data' || source === 'page-host';
        return handle
            ? { url: `${origin}${site.path(handle[1])}`, source: `${source}-path`, learnFrom }
            : { url: `${origin}/`, source, learnFrom };
    }

    function markUnresolved(root) {
        if (document.readyState !== 'loading') root.setAttribute(UNRESOLVED_ATTRIBUTE, '1');
    }

    function forgetUnresolved(root) {
        unresolvedRoots.delete(root);
        root.removeAttribute(UNRESOLVED_ATTRIBUTE);
    }

    // Returns true once the root has a proxy.
    function resolveWithoutRequest(link, key, root) {
        if (root.querySelector(PROXY_WRAPPER_SELECTOR)) {
            forgetUnresolved(root);
            return true;
        }
        const inferred = inferDestination(link, key, root);
        if (inferred && bridgeResolvedRoot(root, inferred.url, inferred.source)) {
            if (inferred.learnFrom) learnSiteHost(root, inferred.url);
            return true;
        }
        return false;
    }

    function registerUnresolved(link, key, root) {
        if (!root || nativeReadableURL(root)) return;
        if (resolveWithoutRequest(link, key, root)) return;
        let links = unresolvedRoots.get(root);
        if (!links) {
            links = new Set();
            unresolvedRoots.set(root, links);
        }
        links.add(link);
        markUnresolved(root);
    }

    // Runs whenever a new domain or site name is learned, and once when the
    // document has been parsed, after which remaining roots are released.
    function retryUnresolved() {
        if (retryingUnresolved) {
            retryUnresolvedAgain = true;
            return;
        }
        retryingUnresolved = true;
        try {
            do {
                retryUnresolvedAgain = false;
                for (const [root, links] of [...unresolvedRoots]) {
                    if (!root.isConnected) {
                        unresolvedRoots.delete(root);
                        continue;
                    }
                    for (const link of links) {
                        if (!link.isConnected) continue;
                        const key = normalizeGoto(link.getAttribute('href') || link.href);
                        if (key && resolveWithoutRequest(link, key, root)) break;
                    }
                }
            } while (retryUnresolvedAgain);
        } finally {
            retryingUnresolved = false;
        }
    }

    function releaseUnresolvedAfterParse() {
        retryUnresolved();
        for (const root of unresolvedRoots.keys()) {
            if (root.isConnected) root.setAttribute(UNRESOLVED_ATTRIBUTE, '1');
        }
    }

    function firewallRootSelector() {
        if (IS_IMAGES_TAB) return '';
        // Each branch lists only roots that uBlacklist's built-in SERPINFO
        // (or ublacklist_serpinfo.yml) classifies on that tab. Other tabs get
        // no firewall: an unclassifiable root would otherwise stay hidden forever.
        if (IS_NEWS_TAB) return NEWS_CARD_SELECTOR;
        if (IS_VIDEOS_TAB) return IS_MOBILE_LAYOUT ? '.Ww4FFb' : '.vt6azd';
        if (IS_FORUMS_TAB) {
            return IS_MOBILE_LAYOUT ? '.vt6azd, .Ww4FFb' : '.vt6azd:not(.g-blk), .Ww4FFb';
        }
        if (!IS_WEB_TAB) return '';
        const ordinary = IS_MOBILE_LAYOUT
            ? '.vt6azd:not(:has(.xYkm8c)), .Ww4FFb:not(:has(.xYkm8c))'
            : '.vt6azd:not(.g-blk):not(:has(.xYkm8c)), .Ww4FFb:not(:has(.xYkm8c))';
        return [
            ordinary,
            NESTED_RESULT_SELECTOR,
            '.sHEJob',
            NEWS_CARD_SELECTOR,
            VISUAL_DIGEST_VIDEO_SELECTOR,
            '.eejeod',
        ].join(', ');
    }

    function installResultFirewallStyle() {
        if (document.querySelector('[data-ub-google-result-firewall-style]')) return;
        const roots = firewallRootSelector();
        const style = document.createElement('style');
        style.setAttribute('data-ub-google-result-firewall-style', VERSION);
        // A root whose destination the page does not reveal is released
        // (data-ub-google-bridge-unresolved) and left to uBlacklist's own reading.
        style.textContent = roots ? `
:is(${roots}):not([data-ub-result]):not([${UNRESOLVED_ATTRIBUTE}]),
[data-ub-hide-blocked-results] :is(${roots})[data-ub-block] {
    display: none !important;
}` : '';
        (document.head || document.documentElement).appendChild(style);
    }

    function installGapCollapseStyle() {
        if (document.querySelector('[data-ub-google-gap-style]')) return;
        const style = document.createElement('style');
        style.setAttribute('data-ub-google-gap-style', VERSION);
        style.textContent = `
html[data-ub-hide-blocked-results] :is(${COLLAPSIBLE_SLOT_SELECTOR}):has([data-ub-block]:not([data-ub-preserve-space])):not(:has([data-ub-result]:not([data-ub-block]))):not(:has([${BRIDGE_ROOT_ATTRIBUTE}]:not([data-ub-block]))) {
    display: none !important;
}`;
        (document.head || document.documentElement).appendChild(style);
    }

    // Returns true when the root has a proxy afterwards.
    function bridgeResolvedRoot(root, sourceURL, inferredSource = '') {
        if (!isElement(root)) return false;
        const kind = root.matches(NEWS_CARD_SELECTOR)
            ? 'news'
            : (root.matches(VISUAL_DIGEST_VIDEO_SELECTOR) ? 'visual-digest-video' : 'default');
        addProxyOnce(root, sourceURL, kind, inferredSource);
        const hasProxy = Boolean(root.querySelector(PROXY_WRAPPER_SELECTOR));
        if (hasProxy) forgetUnresolved(root);
        return hasProxy;
    }

    function bridgeResolvedLink(link, sourceURL) {
        if (!isElement(link) || link.closest('[data-ub-google-source-proxy]')) return false;
        const root = rootForOpaqueLink(link);
        if (!root) return false;
        const resolved = bridgeResolvedRoot(root, sourceURL);
        if (resolved && canInferForLink(link)) learnSiteHost(root, sourceURL);
        return resolved;
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
        const bridgeRoot = rootForOpaqueLink(link);
        links.add(link);
        if (bridgeRoot) pendingRootByLink.set(link, bridgeRoot);

        const displayed = displayedResultURL(link, bridgeRoot) || pageDataURL(bridgeRoot);
        if (displayed) {
            maybeSetGoto(key, displayed);
            return;
        }
        registerUnresolved(link, key, bridgeRoot);
    }

    function bridgeSubtree(root) {
        if (!isElement(root) || root.closest('[data-ub-google-source-proxy]')) return;
        if (root.matches(OPAQUE_LINK_SELECTOR)) registerOpaqueLink(root);
        root.querySelectorAll(OPAQUE_LINK_SELECTOR).forEach(registerOpaqueLink);
        if (root.matches(DIRECT_OR_WRAPPED_LINK_SELECTOR)) registerDirectLink(root);
        root.querySelectorAll(DIRECT_OR_WRAPPED_LINK_SELECTOR).forEach(registerDirectLink);
    }

    function scanInitialDocument() {
        scanEmbeddedData(document);
        document.querySelectorAll(OPAQUE_LINK_SELECTOR).forEach(registerOpaqueLink);
        document.querySelectorAll(DIRECT_OR_WRAPPED_LINK_SELECTOR).forEach(registerDirectLink);
        document.documentElement?.setAttribute('data-ub-google-bridge-version', VERSION);
    }

    function prunePendingLinks() {
        for (const [key, links] of pendingByGoto) {
            for (const link of links) {
                const root = pendingRootByLink.get(link);
                if (!link.isConnected && !root?.isConnected) links.delete(link);
            }
            if (!links.size) pendingByGoto.delete(key);
        }
        for (const root of unresolvedRoots.keys()) {
            if (!root.isConnected) unresolvedRoots.delete(root);
        }
    }

    function start() {

        installResultFirewallStyle();
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
        // Google's inline result data follows the result HTML, so unresolved
        // roots are released only once the document has been parsed.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', releaseUnresolvedAfterParse, { once: true });
        }

        const observer = new MutationObserver((records) => {
            stats.observerCallbacks += 1;
            for (const record of records) {
                if (record.type === 'attributes') {
                    const target = record.target;
                    if (isElement(target) && !target.closest('[data-ub-google-source-proxy]')) {
                        bridgeSubtree(target);
                    }
                    continue;
                }
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
            attributes: true,
            attributeFilter: ['href'],
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
