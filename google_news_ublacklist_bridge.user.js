// ==UserScript==
// @name         Google - uBlacklist compatibility bridge
// @namespace    https://github.com/usernomom/personal-adblock-filterlist
// @author       nobody
// @description  Restore real Google result destinations so uBlacklist can filter opaque /goto results reliably, including Safari/iOS layouts.
// @license      MIT
// @version      13.3.5
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_news_ublacklist_bridge.user.js
// @updateURL    https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_news_ublacklist_bridge.user.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @run-at       document-start
// @grant        GM_deleteValue
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
 *      order, all bound to the result itself: a destination URL in Google's
 *      embedded result data, a destination URL displayed in the result or
 *      held in its data-curl or data-surl attribute (one URL per result; it
 *      replaces a host-only URL from the data when it has a path or query);
 *      then, for a single-result root or the primary or nested link of a
 *      multi-result module, the result's inline entry (tied by its jsdata
 *      key, else its /goto token): its [22][12] domain, else the one plain
 *      host it names; else the host in a thumbnail alt of Google's form
 *      "<q> <word> <host>", where <q> is the page's query. Once the page has
 *      been parsed: the built-in site list KNOWN_SITES (Instagram, Facebook,
 *      X, YouTube, TikTok, LinkedIn, Pinterest, Threads, Reddit;
 *      owner-approved 2026-10-30) for those names; for other names, the
 *      domain learned on this page; else the result is released (UB-4). A
 *      name is learned, in page memory only, from a result resolved by one
 *      of the result-bound sources above (embedded data, displayed or
 *      data-curl URL, inline domain or host, thumbnail host) whose site line
 *      ("Site · qualifier") names it, when the compacted name equals the
 *      host's registrable label (the label left of the public suffix; a
 *      two-letter TLD after co, com, org, net, gov, ac or edu is a two-level
 *      suffix; names under four characters must match exactly). Listed names
 *      are never learned. The learned value is the registrable domain; a name
 *      seen with two registrable domains on one page is dropped. A qualifier
 *      adds a path only where KNOWN_SITES marks it as certainly a handle:
 *      Instagram lowercase username -> /<handle>/, X @handle -> /<handle>,
 *      TikTok @handle -> /@<handle>, Reddit r/<name> -> /r/<name>/; anything
 *      else is host-only. Inferred hosts drop a leading www. or m. Inferred
 *      proxies carry data-ub-google-bridge-inferred = their source
 *      (inline-data, inline-host, page-host, site-list, site-name, with -path
 *      when a path was added). Whole-site rules (*://*.<domain>/*) and
 *      handle or subreddit rules therefore match name-only results; exact-host
 *      rules for www. or m. and other exact-path rules do not.
 *      Embedded data is tied to a /goto link by its url= token alone; other
 *      parameters, such as the gsessionid Google has appended to result
 *      hrefs but not to its data since 2026-10-30, are ignored. A URL on a
 *      Google host (google.*, gstatic, googleapis, googleusercontent) is
 *      never a destination; its url, q or imgrefurl parameter is read
 *      instead, and gives nothing unless it is an http(s) URL off those
 *      hosts. When that names only a site, as the faviconV2 URL in a news
 *      card's inline entry does (owner-approved 2026-10-30), it is a site
 *      address: it gives that origin, host exactly as Google wrote it (www.
 *      and m. kept), and only to a data record that holds a single /goto
 *      token; a record naming two or more results gives none of them a site
 *      address, and any deeper URL for the result wins over it. The favicon
 *      img in the page is never read (Google fills it in lazily).
 *      Accepted limit (owner 2026-10-30): Google's separate News tab
 *      (tbm=nws) names no site for its cards, only the publisher's display
 *      name, so its cards from unlisted publishers are released unresolved
 *      and uBlacklist cannot block them there; the All tab is unaffected.
 * UB-2 Direct results. A result whose external links all point to one host
 *      gets a proxy with the best of those URLs, unless uBlacklist's own
 *      readable URL is already as good.
 * UB-3 One proxy per result. Result hrefs are never rewritten, and the
 *      bridge ignores its own proxies and uBlacklist's changes.
 * UB-4 Result firewall. On the Web, News, Videos and Forums tabs (never
 *      Images or other tabs), results uBlacklist classifies stay hidden
 *      until uBlacklist has processed them, on desktop and mobile alike;
 *      attaching a bridge proxy never reveals a result on its own. Every
 *      result that links through /goto without a uBlacklist-readable link is
 *      also quarantined (data-ub-google-bridge-quarantine, on the result and
 *      on the firewall root holding it) when the bridge first sees it,
 *      before it can paint, on every tab but Images, whatever uBlacklist has
 *      marked: uBlacklist 10.1.2 marks every matched root data-ub-result and
 *      judges a /goto href as no URL, so its mark alone would show the
 *      result before its destination is known. When a proxy is written the
 *      result stays quarantined until uBlacklist has re-judged it: if
 *      uBlacklist had marked it, until uBlacklist writes data-ub-result on
 *      it again (its re-judgement, made in the animation frame after the
 *      change); otherwise for two animation frames plus 100 ms, after which
 *      the firewall hides it until uBlacklist marks it. A result with no destination is released (marked
 *      data-ub-google-bridge-unresolved, which the firewall exempts, on the
 *      result and on its firewall root) only once no more data can come for
 *      it: its inline entry (jsdata key) has been processed and neither
 *      KNOWN_SITES nor a learned name gives a host; or, without an entry
 *      key, 500 ms after the later of the window load event and first
 *      sight. At the latest it is released 4 s after first sight, so nothing
 *      stays hidden for good. A released result that resolves later is
 *      quarantined again until uBlacklist has re-judged it; if uBlacklist
 *      then blocks a result that was visible while unresolved, it is marked
 *      data-ub-google-bridge-exposed="1". Visible means rendered, not under
 *      a display:none ancestor (checkVisibility(), else a non-empty client
 *      rect list), checked at its release, on the next animation frame, and
 *      then in the frame after any DOM change (child list, or style, class,
 *      hidden, data-google-cleanup-hidden or quarantine attributes; at most
 *      once per frame, never while nothing changes), while it is still
 *      released and not blocked; a result hidden for that whole time, such
 *      as one inside a block another script hides, is never marked. A
 *      firewall root whose results
 *      resolve inside it, without a proxy of its own, is released when none
 *      of them is quarantined. Results uBlacklist blocks are hidden when it
 *      hides blocked results.
 * UB-5 Gap collapse. When uBlacklist hides blocked results, result slots
 *      whose results are all blocked are hidden.
 * UB-6 No requests. The bridge itself requests nothing (no /goto
 *      resolution) and stores nothing: it reads only the page, and on load
 *      deletes the learned-site key 13.3.0 stored. (Its page-context W_jd
 *      hook could make the page's CSP report an inline script; untested.)
 * UB-7 One result per root. An element holding more than one result (two
 *      disjoint result units - uBlacklist or bridge roots, nested .xYkm8c
 *      results, Google visual-digest *Result blocks - or one unit plus links
 *      of its own outside it; decided by structure, never layout) is never a
 *      bridge root or proxy owner: a link inside it is bridged on the
 *      innermost unit holding it, else on the largest subtree around it that
 *      holds no unit, and that root's destination comes only from its own
 *      content. When uBlacklist would judge such a container on an inner
 *      result's URL (its first .UBFage / a[role=presentation] with an
 *      absolute href, else its first .ob9lvb, lies inside an inner unit),
 *      the bridge prepends one hidden, empty span[data-ub-google-container-proxy]
 *      holding an a.UBFage without href, an empty span.ob9lvb and an empty
 *      cite, which uBlacklist reads as no URL; so blocking one result never
 *      hides the others.
 * Test marker: html[data-ub-google-bridge-version] = @version.
 */

(() => {
    'use strict';

    const VERSION = '13.3.5';
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
    const QUARANTINE_ATTRIBUTE = 'data-ub-google-bridge-quarantine';
    const EXPOSED_ATTRIBUTE = 'data-ub-google-bridge-exposed';
    // One result each: uBlacklist and bridge roots, nested results, and the
    // results of Google's visual digest (social post, video, image).
    const RESULT_UNIT_SELECTOR =
        `${KNOWN_ROOT_SELECTOR}, ${NESTED_RESULT_SELECTOR}, [${BRIDGE_ROOT_ATTRIBUTE}], ` +
        '[data-attrid^="VisualDigest"][data-attrid$="Result"]';
    const RESULT_LINK_SELECTOR = `${OPAQUE_LINK_SELECTOR}, ${DIRECT_OR_WRAPPED_LINK_SELECTOR}`;
    const CONTAINER_PROXY_ATTRIBUTE = 'data-ub-google-container-proxy';
    // uBlacklist re-judges a changed result in the next animation frame; the
    // quarantine waits two frames plus this margin.
    const VERDICT_MARGIN_MS = 100;
    const NO_ENTRY_RELEASE_MS = 500;
    const QUARANTINE_CAP_MS = 4000;
    // Each result root holds Google's "About this result" control, whose
    // jsdata names the result's inline data entry.
    const RESULT_ENTRY_JSDATA_PREFIX = 'l7Bhpb;_;';
    // 13.3.0 stored learned site names under this key; 13.3.1 deletes it.
    const LEGACY_SITE_HOSTS_KEY = 'siteHosts';
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
    const inlineHostByEntry = new Map();
    const inlineHostByGoto = new Map();
    const processedEntryKeys = new Set();
    // Unresolved root -> { links, settled, entryKeys }.
    const unresolvedRoots = new Map();
    const quarantinedOnce = new WeakSet();
    const verdictScheduled = new WeakSet();
    // Root -> observer epoch when its proxy was written while uBlacklist had
    // already judged it; the next data-ub-result write on it is the verdict.
    const awaitingVerdict = new Map();
    let observerEpoch = 0;
    const exposedRoots = new WeakSet();
    // Released roots not rendered yet; see noteExposure.
    const unseenReleased = new Set();
    let unseenFrame = 0;
    // Attribute changes that can show a hidden root: inline style, classes,
    // hidden, the cleanup userscript's hide marker, and the bridge's own
    // quarantine (its firewall rule hides a quarantined ancestor).
    const VISIBILITY_ATTRIBUTES = ['style', 'class', 'hidden', 'data-google-cleanup-hidden', QUARANTINE_ATTRIBUTE];
    const waitingForLoad = new Set();
    let windowLoaded = false;
    // Learned site name -> https://<registrable domain>, or '' when dropped.
    // Page memory only.
    const siteHosts = new Map();
    let retryingUnresolved = false;
    let retryUnresolvedAgain = false;
    const scannedScripts = new WeakSet();
    const scannedComments = new WeakSet();
    const stats = {
        inlineEntries: 0,
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
            host === 'googleapis.com' || host.endsWith('.googleapis.com') ||
            host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com');
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

    // A /goto link's key is its url= token alone: Google appends other
    // parameters, such as the page's gsessionid (2026-10-30), to result hrefs
    // but not to the /goto strings of its data. The token is kept raw, so a
    // '+' in it is not read as a space.
    function gotoKey(search) {
        const token = /[?&]url=([^&#]*)/.exec(search);
        return token ? `/goto?url=${token[1]}` : `/goto${search}`;
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
            return gotoKey(url.search);
        } catch (_) {
            return value.startsWith('/goto?') ? gotoKey(value.slice(5).split('#')[0]) : '';
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

    // A site address is a URL on a Google host whose url, q or imgrefurl
    // parameter names only a site, such as the faviconV2 favicon URL in a
    // news card's inline entry: it says which site a record is about, not
    // where one of its links goes.
    function isSiteAddress(raw, target) {
        try {
            return isGoogleHost(new URL(cleanEscapes(raw).trim(), location.href).hostname) && !isDeepURL(target);
        } catch (_) {
            return false;
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
                (isSiteAddress(value, target) ? out.sites : out.urls).push(target);
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
        const out = { gotos: new Set(), urls: [], sites: [], abouts: [], count: 0 };
        collectTree(node, out);
        if (!out.gotos.size) return false;

        // A site address binds only a record that holds one /goto token.
        let best = pickBestURL(out.gotos.size === 1 ? [...out.urls, ...out.sites] : out.urls);
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

    // The one plain host an inline entry names (a bare host string such as
    // "www.billboard.com", lowercase, not a file name), or '' when it names
    // none or several, URL hosts included.
    function inlineHostOf(entry) {
        const strings = [];
        const collect = (node, depth) => {
            if (strings.length >= 400 || depth > 12) return;
            if (typeof node === 'string') strings.push(node);
            else if (Array.isArray(node)) for (const item of node) collect(item, depth + 1);
            else if (node && typeof node === 'object') for (const item of Object.values(node)) collect(item, depth + 1);
        };
        collect(entry, 0);
        const plain = new Set();
        const all = new Set();
        for (const value of strings) {
            if (value.length > 2048) continue;
            if (/^https?:\/\//i.test(value)) {
                const url = externalURL(value);
                if (url && !isImageURL(url)) all.add(siteOriginOf(url));
            } else if (
                value === value.toLowerCase() && isHostShaped(value) &&
                !/\.(?:png|jpe?g|gif|webp|svg|js|css|json|html?|php|mp4|pdf)$/.test(value)
            ) {
                const origin = siteOriginOf(`https://${value}`);
                plain.add(origin);
                all.add(origin);
            }
        }
        all.delete('');
        plain.delete('');
        return plain.size === 1 && all.size === 1 ? [...plain][0] : '';
    }

    function captureInlineDomains(data) {
        let added = false;
        const remember = (map, key, value) => {
            if (!key || !value || map.get(key) === value) return;
            map.set(key, value);
            added = true;
        };
        for (const [entryKey, entry] of Object.entries(data)) {
            try {
                const gotoKey = typeof entry[17] === 'string' ? normalizeGoto(entry[17]) : '';
                const domain = inlineDomainOf(entry);
                remember(inlineDomainByEntry, entryKey, domain);
                remember(inlineDomainByGoto, gotoKey, domain);
                const host = domain ? '' : inlineHostOf(entry);
                remember(inlineHostByEntry, entryKey, host);
                remember(inlineHostByGoto, gotoKey, host);
            } catch (_) {}
        }
        if (added) retryUnresolved();
    }

    // Each entry key is processed once, whichever path delivers it first
    // (document-start hook, page-context trampoline, inline script text).
    function processWjdData(data) {
        if (!data || typeof data !== 'object') return;
        const fresh = {};
        for (const [key, entry] of Object.entries(data)) {
            if (!entry || typeof entry !== 'object' || processedEntryKeys.has(key)) continue;
            if (Array.isArray(entry) && !entry.length) continue;
            processedEntryKeys.add(key);
            stats.inlineEntries += 1;
            fresh[key] = entry;
        }
        if (!Object.keys(fresh).length) return;
        captureInlineDomains(fresh);
        for (const entry of Object.values(fresh)) {
            try {
                mapContainer(entry);
                scanDataTree(entry);
            } catch (_) {}
        }
        settleRootsWithProcessedEntries();
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
                        try { processWjdData({ [prop]: value }); } catch (_) {}
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
                        try { processWjdData(value); } catch (_) {}
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

    // ---- Multi-result containers ----
    // An element holds more than one result when it holds two disjoint result
    // units, or one unit plus links of its own outside it. Structure only:
    // layout is unreadable while the firewall hides a root.
    function isMultiResult(element) {
        if (!isElement(element)) return false;
        let units = 0;
        for (const unit of element.querySelectorAll(RESULT_UNIT_SELECTOR)) {
            const above = unit.parentElement.closest(RESULT_UNIT_SELECTOR);
            if (above && above !== element && element.contains(above)) continue;
            units += 1;
            if (units > 1) return true;
        }
        if (!units) return false;
        for (const link of element.querySelectorAll(RESULT_LINK_SELECTOR)) {
            if (link.closest('[data-ub-google-source-proxy]')) continue;
            const unit = link.closest(RESULT_UNIT_SELECTOR);
            if (!unit || unit === element || !element.contains(unit)) return true;
        }
        return false;
    }

    // The root of the one result a link belongs to inside candidate: the
    // innermost result unit holding the link, else the largest subtree around
    // the link that holds no result unit.
    function singleResultRoot(link, candidate) {
        if (!isElement(candidate) || !isMultiResult(candidate)) return candidate || null;
        const unit = link.closest(RESULT_UNIT_SELECTOR);
        if (unit && unit !== candidate && candidate.contains(unit)) return singleResultRoot(link, unit);
        let own = null;
        for (let node = link; node && node !== candidate; node = node.parentElement) {
            if (node.querySelector(RESULT_UNIT_SELECTOR)) break;
            own = node;
        }
        return own;
    }

    // The node uBlacklist's mobile Web rule reads a root's URL from: the
    // first .UBFage / a[role=presentation] when its href is absolute, else
    // the first .ob9lvb.
    function uBlacklistURLNode(root) {
        const anchor = root.querySelector(UBLACKLIST_NATIVE_URL_SELECTOR);
        if (anchor && /^https?:\/\//i.test(anchor.getAttribute('href') || '')) return anchor;
        return root.querySelector('.ob9lvb');
    }

    // A multi-result container that uBlacklist would judge on one inner
    // result's URL gets an inert first child it reads as no URL, so blocking
    // that result never hides the others.
    function neutralizeContainer(container) {
        if (container.querySelector(`:scope > [${CONTAINER_PROXY_ATTRIBUTE}]`) || !isMultiResult(container)) return;
        const node = uBlacklistURLNode(container);
        if (!node) return;
        const unit = node.closest(RESULT_UNIT_SELECTOR);
        if (!unit || unit === container || !container.contains(unit)) return;
        const wrapper = document.createElement('span');
        wrapper.hidden = true;
        wrapper.setAttribute('aria-hidden', 'true');
        wrapper.setAttribute(CONTAINER_PROXY_ATTRIBUTE, '1');
        wrapper.className = 'yuRUbf';
        const anchor = document.createElement('a');
        anchor.className = 'UBFage';
        anchor.tabIndex = -1;
        anchor.setAttribute('aria-hidden', 'true');
        const domain = document.createElement('span');
        domain.className = 'ob9lvb';
        wrapper.append(anchor, domain, document.createElement('cite'));
        container.prepend(wrapper);
    }

    function neutralizeContainersAround(element) {
        for (
            let node = element?.closest?.(KNOWN_ROOT_SELECTOR);
            node;
            node = node.parentElement?.closest(KNOWN_ROOT_SELECTOR)
        ) {
            neutralizeContainer(node);
        }
    }

    // inferredSource names how a destination was inferred rather than read
    // ('inline-data', 'site-name', with '-path' when a subreddit path was added).
    function addProxyOnce(root, sourceURL, kind = 'default', inferredSource = '') {
        if (!isElement(root)) return false;
        const source = externalURL(sourceURL);
        if (!source) return false;

        const existing = root.querySelector(PROXY_WRAPPER_SELECTOR);
        if (existing || isMultiResult(root)) return false;

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
        neutralizeContainersAround(root.parentElement);
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
        if (isMultiResult(known)) {
            neutralizeContainersAround(known);
            return singleResultRoot(link, known);
        }
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
        return known || singleResultRoot(link, semanticResultRoot(link));
    }

    function rootForDirectLink(link) {
        const known = link.closest(KNOWN_ROOT_SELECTOR);
        if (isMultiResult(known)) {
            neutralizeContainersAround(known);
            return singleResultRoot(link, known);
        }
        const nested = link.closest(NESTED_RESULT_SELECTOR);
        if (nested && nested !== known && (!known || known.contains(nested))) {
            return nested;
        }
        return known || singleResultRoot(link, semanticResultRoot(link));
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

    // The registrable domain of a host and its label: the label left of the
    // public suffix, where a two-letter TLD after co, com, org, net, gov, ac
    // or edu is a two-level suffix (bbc.co.uk -> bbc).
    function registrableDomain(host) {
        const labels = String(host || '').toLowerCase().split('.');
        const suffix = labels.length >= 3 && /^[a-z]{2}$/.test(labels.at(-1)) &&
            /^(?:co|com|org|net|gov|ac|edu)$/.test(labels.at(-2)) ? 2 : 1;
        if (labels.length < suffix + 1) return null;
        const domain = labels.slice(-(suffix + 1)).join('.');
        return isHostShaped(domain) ? { domain, label: labels.at(-(suffix + 1)) } : null;
    }

    // Learns name -> registrable domain, in page memory, from a result a
    // result-bound source resolved. Listed names are never learned; the
    // compacted name must equal the registrable label (names under four
    // characters exactly); a second registrable domain drops the name.
    function learnSiteHost(root, url) {
        const line = siteLine(root);
        if (line) learnSitePair(line.name, url);
    }

    function learnSitePair(name, url) {
        if (KNOWN_SITES.some((site) => site.name === name)) return;
        let reg;
        try {
            reg = registrableDomain(new URL(url).hostname);
        } catch (_) {
            return;
        }
        if (!reg) return;
        const matches = name.length < 4
            ? name === reg.label
            : name.replace(/[^\p{L}\p{N}]/gu, '') === reg.label.replace(/[^a-z0-9]/g, '');
        if (!matches) return;
        const origin = `https://${reg.domain}`;
        const known = siteHosts.get(name);
        if (known === origin || known === '') return;
        siteHosts.set(name, known === undefined ? origin : '');
        if (known === undefined) retryUnresolved();
    }

    function clearLegacyStorage() {
        try {
            if (typeof GM_deleteValue === 'function') GM_deleteValue(LEGACY_SITE_HOSTS_KEY);
        } catch (_) {}
    }

    // ---- Resolving opaque results without any request ----

    function knownSiteFor(origin) {
        const host = hostnameOf(origin);
        return KNOWN_SITES.find((site) => {
            const siteHost = hostnameOf(siteOriginOf(`https://${site.host}`));
            return host === siteHost || host.endsWith(`.${siteHost}`);
        }) || null;
    }

    function normalizedText(value) {
        return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // A profile thumbnail's alt follows Google's template "<q> from <host>":
    // it starts with the page's query and exactly two tokens follow, the last
    // being the host. The middle word is not checked, so the interface
    // language does not matter.
    function thumbnailOrigin(root) {
        const query = normalizedText(SEARCH_PARAMS.get('q'));
        if (!query) return '';
        const origins = new Set();
        for (const image of root.querySelectorAll('img[alt]')) {
            if (image.closest('[data-ub-google-source-proxy]')) continue;
            const alt = normalizedText(image.getAttribute('alt'));
            if (alt.length > 512 || !alt.startsWith(`${query} `)) continue;
            const rest = alt.slice(query.length + 1).split(' ');
            if (rest.length === 2 && isHostShaped(rest[1])) origins.add(siteOriginOf(`https://${rest[1]}`));
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

    // The value a result's inline entry gives: tied by the root's single
    // jsdata entry key first, else by the link's /goto token.
    function entryKeysOf(root) {
        const entryKeys = new Set();
        for (const node of root.querySelectorAll(`[jsdata^="${RESULT_ENTRY_JSDATA_PREFIX}"]`)) {
            entryKeys.add(node.getAttribute('jsdata').slice(RESULT_ENTRY_JSDATA_PREFIX.length));
        }
        return entryKeys;
    }

    function inlineValue(root, key, byEntry, byGoto) {
        const entryKeys = entryKeysOf(root);
        if (entryKeys.size === 1) {
            const value = byEntry.get([...entryKeys][0]);
            if (value) return value;
        }
        return byGoto.get(key) || '';
    }

    // Order: result-bound page data (inline domain, inline plain host,
    // thumbnail host); once no more data can come for the root (settled),
    // KNOWN_SITES for its names, else the name learned on this page. A qualifier adds a path only
    // where KNOWN_SITES says it is certainly a handle of that site.
    function inferDestination(link, key, root, settled) {
        if (!canInferForLink(link)) return null;
        const line = siteLine(root);
        const inline = inlineValue(root, key, inlineDomainByEntry, inlineDomainByGoto);
        const inlineHost = inline ? '' : inlineValue(root, key, inlineHostByEntry, inlineHostByGoto);
        const thumbnail = inline || inlineHost ? '' : thumbnailOrigin(root);
        const listed = line ? KNOWN_SITES.find((site) => site.name === line.name) : null;
        let origin = '';
        let source = '';
        if (inline) [origin, source] = [`https://${inline}`, 'inline-data'];
        else if (inlineHost) [origin, source] = [inlineHost, 'inline-host'];
        else if (thumbnail) [origin, source] = [thumbnail, 'page-host'];
        else if (settled && listed) [origin, source] = [siteOriginOf(`https://${listed.host}`), 'site-list'];
        else if (settled && line && siteHosts.get(line.name)) [origin, source] = [siteHosts.get(line.name), 'site-name'];
        if (!origin) return null;
        const site = knownSiteFor(origin);
        const handle = site?.handle && line ? line.qualifier.match(site.handle) : null;
        const learnFrom = source === 'inline-data' || source === 'inline-host' || source === 'page-host';
        return handle
            ? { url: `${origin}${site.path(handle[1])}`, source: `${source}-path`, learnFrom }
            : { url: `${origin}/`, source, learnFrom };
    }

    // ---- Quarantine (UB-4) ----

    function firewallRootOf(element) {
        return element.parentElement?.closest(KNOWN_ROOT_SELECTOR) || null;
    }

    function quarantineElement(element) {
        if (IS_IMAGES_TAB || element.hasAttribute(UNRESOLVED_ATTRIBUTE) || quarantinedOnce.has(element)) return;
        quarantinedOnce.add(element);
        element.setAttribute(QUARANTINE_ATTRIBUTE, '1');
        setTimeout(() => capQuarantine(element), QUARANTINE_CAP_MS);
    }

    // At first sight of an opaque link: its result and the firewall root
    // holding it, unless already resolved or released.
    function quarantine(root, link) {
        if (!root.querySelector(PROXY_WRAPPER_SELECTOR)) quarantineElement(root);
        const firewallRoot = link.closest(KNOWN_ROOT_SELECTOR);
        if (firewallRoot && firewallRoot !== root && !firewallRoot.querySelector(PROXY_WRAPPER_SELECTOR)) {
            quarantineElement(firewallRoot);
        }
    }

    // Rendered: not under a display:none ancestor. checkVisibility() is
    // Safari 17.4+; older engines give a box list only to a rendered element.
    function isRendered(element) {
        if (typeof element.checkVisibility === 'function') return element.checkVisibility();
        return element.getClientRects().length > 0;
    }

    // A released root counts as exposed once it renders while still released
    // and not blocked. Returns true when it no longer needs watching.
    function noteExposure(element) {
        if (!element.isConnected || !element.hasAttribute(UNRESOLVED_ATTRIBUTE)) return true;
        if (element.hasAttribute('data-ub-block')) return true;
        if (!isRendered(element)) return false;
        exposedRoots.add(element);
        return true;
    }

    function checkUnseenReleased() {
        unseenFrame = 0;
        for (const element of unseenReleased) if (noteExposure(element)) unseenReleased.delete(element);
    }

    // A released root not rendered at release is checked on the next frame,
    // then only in the frame after a DOM mutation (a cleanup script may show
    // its hidden block later), at most once per frame. No mutation, no frame
    // callback: a page left open with a hidden root stays idle.
    function scheduleUnseenCheck() {
        if (unseenReleased.size && !unseenFrame) unseenFrame = requestAnimationFrame(checkUnseenReleased);
    }

    function markReleased(element) {
        element.setAttribute(UNRESOLVED_ATTRIBUTE, '1');
        element.removeAttribute(QUARANTINE_ATTRIBUTE);
        if (noteExposure(element)) return;
        unseenReleased.add(element);
        scheduleUnseenCheck();
    }

    // An outer firewall root without a proxy of its own is released once
    // none of the results inside it is quarantined.
    function liftFirewallRoot(firewallRoot) {
        if (!firewallRoot || !firewallRoot.hasAttribute(QUARANTINE_ATTRIBUTE)) return;
        if (firewallRoot.querySelector(PROXY_WRAPPER_SELECTOR)) return;
        if (firewallRoot.querySelector(`[${QUARANTINE_ATTRIBUTE}]`)) return;
        markReleased(firewallRoot);
    }

    function capQuarantine(element) {
        if (!element.isConnected || !element.hasAttribute(QUARANTINE_ATTRIBUTE)) return;
        if (unresolvedRoots.has(element)) settleRoot(element);
        if (!element.hasAttribute(QUARANTINE_ATTRIBUTE)) return;
        awaitingVerdict.delete(element);
        if (element.querySelector(PROXY_WRAPPER_SELECTOR)) element.removeAttribute(QUARANTINE_ATTRIBUTE);
        else markReleased(element);
    }

    function liftAfterVerdict(root) {
        awaitingVerdict.delete(root);
        root.removeAttribute(QUARANTINE_ATTRIBUTE);
        liftFirewallRoot(firewallRootOf(root));
    }

    // A proxy was written: the root stays quarantined until uBlacklist has
    // re-judged it. uBlacklist 10.1.2 re-judges a marked root whose URL
    // changed by removing and setting data-ub-result again, with data-ub-block,
    // in one animation-frame callback; that write is the signal. A root it
    // has not marked yet is judged with the proxy when first marked, and the
    // firewall hides it until then, so it waits two frames plus a margin.
    function awaitVerdict(root) {
        forgetUnresolved(root);
        if (!quarantinedOnce.has(root) || verdictScheduled.has(root)) return;
        verdictScheduled.add(root);
        root.setAttribute(QUARANTINE_ATTRIBUTE, '1');
        if (root.hasAttribute('data-ub-result')) {
            awaitingVerdict.set(root, observerEpoch);
            return;
        }
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => liftAfterVerdict(root), VERDICT_MARGIN_MS)));
    }

    // Releases a root on itself and on each firewall root holding one of its
    // links that has no proxy of its own (a thread card's outer root).
    function release(root, record) {
        markReleased(root);
        for (const link of record.links) {
            const firewallRoot = link.closest(KNOWN_ROOT_SELECTOR);
            if (firewallRoot && firewallRoot !== root) liftFirewallRoot(firewallRoot);
        }
    }

    function forgetUnresolved(root) {
        unresolvedRoots.delete(root);
        waitingForLoad.delete(root);
        root.removeAttribute(UNRESOLVED_ATTRIBUTE);
    }

    // Returns true once the root has a proxy.
    function resolveWithoutRequest(link, key, root) {
        if (root.querySelector(PROXY_WRAPPER_SELECTOR)) {
            awaitVerdict(root);
            return true;
        }
        const settled = unresolvedRoots.get(root)?.settled === true;
        const inferred = inferDestination(link, key, root, settled);
        if (inferred && bridgeResolvedRoot(root, inferred.url, inferred.source)) {
            if (inferred.learnFrom) learnSiteHost(root, inferred.url);
            return true;
        }
        return false;
    }

    function resolveRoot(root, record) {
        for (const link of record.links) {
            if (!link.isConnected) continue;
            const key = normalizeGoto(link.getAttribute('href') || link.href);
            if (key && resolveWithoutRequest(link, key, root)) return true;
        }
        return false;
    }

    function entriesProcessed(record) {
        return record.entryKeys.size > 0 && [...record.entryKeys].every((key) => processedEntryKeys.has(key));
    }

    function registerUnresolved(link, key, root) {
        if (!root || nativeReadableURL(root)) return;
        if (resolveWithoutRequest(link, key, root)) return;
        let record = unresolvedRoots.get(root);
        const isNew = !record;
        if (isNew) {
            record = { links: new Set(), settled: false, entryKeys: entryKeysOf(root) };
            unresolvedRoots.set(root, record);
        }
        record.links.add(link);
        if (record.settled) {
            release(root, record);
            return;
        }
        if (!isNew) return;
        if (record.entryKeys.size === 0) {
            if (windowLoaded) setTimeout(() => settleRoot(root), NO_ENTRY_RELEASE_MS);
            else waitingForLoad.add(root);
        } else if (entriesProcessed(record)) {
            settleRoot(root);
        }
    }

    // No more data can come for the root: it may use the site list and
    // learned names; if nothing resolves it, it is released.
    function settleRoot(root) {
        const record = unresolvedRoots.get(root);
        if (!record || record.settled) return;
        record.settled = true;
        waitingForLoad.delete(root);
        if (!root.isConnected) {
            unresolvedRoots.delete(root);
            return;
        }
        if (!resolveRoot(root, record)) release(root, record);
    }

    function settleRootsWithProcessedEntries() {
        for (const [root, record] of [...unresolvedRoots]) {
            if (!record.settled && entriesProcessed(record)) settleRoot(root);
        }
    }

    // Runs whenever new data or a new site name arrives.
    function retryUnresolved() {
        if (retryingUnresolved) {
            retryUnresolvedAgain = true;
            return;
        }
        retryingUnresolved = true;
        try {
            do {
                retryUnresolvedAgain = false;
                for (const [root, record] of [...unresolvedRoots]) {
                    if (!root.isConnected) {
                        unresolvedRoots.delete(root);
                        continue;
                    }
                    resolveRoot(root, record);
                }
            } while (retryUnresolvedAgain);
        } finally {
            retryingUnresolved = false;
        }
    }

    function onWindowLoad() {
        windowLoaded = true;
        for (const root of [...waitingForLoad]) setTimeout(() => settleRoot(root), NO_ENTRY_RELEASE_MS);
        waitingForLoad.clear();
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
        // A quarantined root is hidden whatever uBlacklist has marked.
        style.textContent = IS_IMAGES_TAB ? '' : (roots ? `
[${QUARANTINE_ATTRIBUTE}],
:is(${roots}):not([data-ub-result]):not([${UNRESOLVED_ATTRIBUTE}]),
[data-ub-hide-blocked-results] :is(${roots})[data-ub-block] {
    display: none !important;
}` : `
[${QUARANTINE_ATTRIBUTE}] {
    display: none !important;
}`);
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
        if (hasProxy) awaitVerdict(root);
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

        // A URL the result displays or holds in data-curl/data-surl may be
        // deeper than the host-only site its data named: it competes first.
        const bridgeRoot = rootForOpaqueLink(link);
        const displayed = displayedResultURL(link, bridgeRoot) || pageDataURL(bridgeRoot);
        if (displayed && gotoMap.has(key)) maybeSetGoto(key, displayed);

        const mapped = gotoMap.get(key);
        if (mapped) {
            if (bridgeRoot && !nativeReadableURL(bridgeRoot)) quarantine(bridgeRoot, link);
            bridgeResolvedLink(link, mapped);
            return;
        }

        let links = pendingByGoto.get(key);
        if (!links) {
            links = new Set();
            pendingByGoto.set(key, links);
        }
        links.add(link);
        if (bridgeRoot) pendingRootByLink.set(link, bridgeRoot);
        if (bridgeRoot && !nativeReadableURL(bridgeRoot)) quarantine(bridgeRoot, link);

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

        clearLegacyStorage();
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
        // A result without an inline entry key can still be resolved by data
        // loaded with the page; it is released 500 ms after the load event.
        if (document.readyState === 'complete') windowLoaded = true;
        else window.addEventListener('load', onWindowLoad, { once: true });

        const observer = new MutationObserver((records) => {
            stats.observerCallbacks += 1;
            observerEpoch += 1;
            for (const record of records) {
                if (record.type === 'attributes') {
                    const target = record.target;
                    if (record.attributeName === 'data-ub-result') {
                        // UB-4: uBlacklist's verdict on a proxy written earlier.
                        if (target.hasAttribute('data-ub-result') && awaitingVerdict.get(target) < observerEpoch) {
                            liftAfterVerdict(target);
                        }
                        continue;
                    }
                    if (record.attributeName === 'data-ub-block') {
                        // UB-4: a result shown while unresolved and later blocked.
                        if (target.hasAttribute('data-ub-block') && exposedRoots.has(target)) {
                            target.setAttribute(EXPOSED_ATTRIBUTE, '1');
                        }
                        continue;
                    }
                    // Observed only to re-check unseen released roots below.
                    if (VISIBILITY_ATTRIBUTES.includes(record.attributeName)) continue;
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
            scheduleUnseenCheck();
        });

        observer.observe(document.documentElement, {
            childList: true,
            attributes: true,
            attributeFilter: ['href', 'data-ub-result', 'data-ub-block', ...VISIBILITY_ATTRIBUTES],
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
        get learnedSites() { return Object.fromEntries(siteHosts); },
        resolveGoto(value) { return gotoMap.get(normalizeGoto(value)) || ''; },
    };
    if (document.documentElement) start();
    else new MutationObserver((_, observer) => {
        if (!document.documentElement) return;
        observer.disconnect();
        start();
    }).observe(document, { childList: true, subtree: true });
})();
