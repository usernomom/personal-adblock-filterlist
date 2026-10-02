// ==UserScript==
// @name         Google interface cleanup
// @description  Remove unwanted Google result modules and unsolicited video autoplay.
// @license      MIT
// @version      140.0.15
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_interface_cleanup.user.js
// @updateURL    https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_interface_cleanup.user.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @run-at       document-start
// ==/UserScript==

/*
 * BEHAVIOUR SPEC - exactly what this script does, by rule ID. Update it in
 * the same change as any code change; rules change only on the owner's
 * request.
 *
 * GC-1 Video autoplay. On search pages every video loses autoplay and is
 *      paused whenever it starts playing, unless the user clicked (or pressed
 *      Enter/Space on) that video or a small container holding at most 3
 *      videos. That permission ends when the video pauses, ends or empties.
 * GC-2 Explicit vertical pages. When the URL has a udm or tbm parameter,
 *      earlier hides other than GC-8 are undone and only GC-1, GC-5 and
 *      GC-8 apply.
 * GC-3 Result modules (All results). Each top-level block of the results
 *      areas (#rso, #botstuff, #bres, and Google's asynchronously loaded
 *      result slots) is hidden, marked with its reason, when it is:
 *      generic-section - a g-section-with-header section without News,
 *        Forums or knowledge-panel content (the whole block if the block is
 *        only that section);
 *      recipe-cluster - recipe cluster data;
 *      social-profiles - "social media presence" data;
 *      products - a product viewer group;
 *      non-news-cluster - a news-cluster card with no link to the News tab
 *        (an embedded cluster hides only that cluster and its title:
 *        embedded-news-cluster);
 *      question-accordion - no News/Forums links, no Google-search links,
 *        at least 2 progress bars and 2 buttons;
 *      unwanted-vertical - links to Google verticals udm=2, 7, vids, 28, 39
 *        or 54 and no Forums link (an Images-only block carrying other
 *        knowledge-panel data is kept);
 *      query-refinement - no News/Forums links, no knowledge-panel data, no
 *        external links, and at least 2 Google-search links.
 *      Blocks containing #bres are skipped.
 * GC-4 Visual digest. Visual-digest news-article, social-media and web
 *      results are hidden (the whole block when they are all of its text).
 * GC-5 Search suggestions. The search box's suggestion controller is
 *      removed, on all search pages.
 * GC-6 Must stay visible: ordinary organic results, results linking to the
 *      News tab, Forums results and knowledge panels. Destination-domain
 *      filtering is not this script's job (uBlacklist is).
 * GC-7 Timing. Runs at page start and every 0.3 s.
 * GC-8 Related searches ("People also search for"). On every search page,
 *      explicit vertical tabs included, the outermost element inside a
 *      results area (#rso, #botstuff, #bres or an asynchronously loaded
 *      query context) whose links are all Google searches for queries other
 *      than the current one, covering at least 2 distinct such queries, with
 *      no knowledge-panel data in or around it and no navigation landmark,
 *      is hidden
 *      (related-searches). A News or Forums link counts as such a search
 *      only when the page is already on that tab. The rest of a mixed block
 *      stays visible.
 * Test marker: #google-interface-cleanup-style[data-google-cleanup-version]
 * = @version; each hidden block carries data-google-cleanup-hidden=reason.
 */

(() => {
    'use strict';

    const VERSION = '140.0.15';
    const CLEANUP_INTERVAL_MS = 300;
    const UNWANTED_UDM = new Set(['2', '7', 'vids', '28', '39', '54']);
    const RELATED_SEARCHES = 'related-searches';
    const RESULT_SCOPES = '#rso, #botstuff, #bres, [data-async-context^="query:"]';
    const KNOWLEDGE_SELECTOR = [
        '.kp-wholepage',
        '[data-kpid]',
        '[data-mcpr]',
        '[data-attrid="title"]',
        '[data-attrid="subtitle"]',
        '[data-attrid^="kc:"]',
        '[data-attrid^="lab/fact/"]',
    ].join(',');
    const stats = {
        scans: 0,
        hidden: 0,
        reasons: {},
    };
    // Ordinary destination-domain filtering belongs to uBlacklist + the bridge, not this script.
    const manuallyAllowedVideos = new WeakSet();
    const instrumentedVideos = new WeakSet();

    function mediaScopeForInteraction(target) {
        if (!(target instanceof Element)) return null;
        if (target.tagName === 'VIDEO') return target;

        let node = target;
        while (node && node !== document.body && node !== document.documentElement) {
            const videos = node.querySelectorAll?.('video');
            if (videos?.length && videos.length <= 3) return node;
            if (node.matches?.('#rso, #botstuff, #bres')) break;
            node = node.parentElement;
        }
        return null;
    }

    function noteMediaIntent(event) {
        if (!event.isTrusted) return;
        const scope = mediaScopeForInteraction(event.target);
        if (!scope) return;

        if (scope.tagName === 'VIDEO') {
            manuallyAllowedVideos.add(scope);
            return;
        }
        for (const video of scope.querySelectorAll('video')) manuallyAllowedVideos.add(video);
    }

    function disableVideoAutoplay(video) {
        if (!video || video.tagName !== 'VIDEO') return;
        if (video.autoplay) video.autoplay = false;
        if (video.hasAttribute('autoplay')) video.removeAttribute('autoplay');
    }

    function pauseUnauthorizedVideo(video) {
        if (!video || video.tagName !== 'VIDEO' || manuallyAllowedVideos.has(video)) return;
        try {
            video.pause();
        } catch (_) {
            // A hostile/custom media implementation should not break cleanup.
        }
    }

    function blockUnauthorizedVideoPlayback(event) {
        const video = event.target;
        if (!video || video.tagName !== 'VIDEO') return;
        disableVideoAutoplay(video);
        pauseUnauthorizedVideo(video);
    }

    function revokeManualPlayback(event) {
        const video = event.target;
        if (video?.tagName === 'VIDEO') manuallyAllowedVideos.delete(video);
    }

    function instrumentVideo(video) {
        if (!video || video.tagName !== 'VIDEO' || instrumentedVideos.has(video)) return;
        instrumentedVideos.add(video);
        video.addEventListener('play', blockUnauthorizedVideoPlayback, true);
        video.addEventListener('playing', blockUnauthorizedVideoPlayback, true);
        video.addEventListener('timeupdate', blockUnauthorizedVideoPlayback, true);
        video.addEventListener('pause', revokeManualPlayback, true);
        video.addEventListener('ended', revokeManualPlayback, true);
        video.addEventListener('emptied', revokeManualPlayback, true);
    }

    function sanitizeVideo(video) {
        if (!video || video.tagName !== 'VIDEO') return;
        instrumentVideo(video);
        disableVideoAutoplay(video);
        if (!video.paused) pauseUnauthorizedVideo(video);
    }

    function sanitizeVideoTree(node) {
        if (!(node instanceof Element)) return;
        if (node.tagName === 'VIDEO') sanitizeVideo(node);
        for (const video of node.querySelectorAll('video')) sanitizeVideo(video);
    }

    function enforceVideoAutoplayGuard() {
        for (const video of document.querySelectorAll('video')) sanitizeVideo(video);
    }

    function startVideoAutoplayGuard() {
        if (document.documentElement) sanitizeVideoTree(document.documentElement);

        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    sanitizeVideo(mutation.target);
                    continue;
                }
                for (const node of mutation.addedNodes) sanitizeVideoTree(node);
            }
        });
        observer.observe(document, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['autoplay'],
        });
    }

    document.addEventListener('click', noteMediaIntent, true);
    document.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') noteMediaIntent(event);
    }, true);
    document.addEventListener('play', blockUnauthorizedVideoPlayback, true);
    document.addEventListener('playing', blockUnauthorizedVideoPlayback, true);
    document.addEventListener('timeupdate', blockUnauthorizedVideoPlayback, true);
    startVideoAutoplayGuard();

    const hiddenStyle = document.createElement('style');
    hiddenStyle.id = 'google-interface-cleanup-style';
    hiddenStyle.dataset.googleCleanupVersion = VERSION;
    hiddenStyle.textContent = '[data-google-cleanup-hidden] { display: none !important; }';
    const styleParent = document.head || document.documentElement;
    if (styleParent) {
        styleParent.appendChild(hiddenStyle);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            (document.head || document.documentElement)?.appendChild(hiddenStyle);
        }, { once: true });
    }

    function hide(node, reason) {
        if (!node) return false;

        const firstHide = !node.dataset.googleCleanupHidden;
        node.dataset.googleCleanupHidden = reason;
        node.style.setProperty('display', 'none', 'important');

        if (firstHide) {
            stats.hidden += 1;
            stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
        }
        return firstHide;
    }

    function parseURL(anchor) {
        try {
            return new URL(anchor.href, location.href);
        } catch (_) {
            return null;
        }
    }

    function isGoogleHost(hostname) {
        return hostname === 'google.com' ||
            hostname.startsWith('google.') ||
            hostname.includes('.google.');
    }

    function linksFor(root) {
        return [...root.querySelectorAll('a[href]')]
            .map(parseURL)
            .filter(Boolean);
    }

    function hasNewsRoute(root) {
        return linksFor(root).some(url => url.searchParams.get('tbm') === 'nws');
    }

    function hasForumRoute(root) {
        return linksFor(root).some(url => {
            const udm = url.searchParams.get('udm');
            return udm === '18' || udm === 'forums';
        });
    }

    function hasUnwantedVertical(root) {
        return linksFor(root).some(url => UNWANTED_UDM.has(url.searchParams.get('udm')));
    }

    function externalDestinationCount(root) {
        return linksFor(root).filter(url =>
            /^https?:$/.test(url.protocol) && !isGoogleHost(url.hostname)
        ).length;
    }

    function googleQueryLinkCount(root) {
        return linksFor(root).filter(url =>
            isGoogleHost(url.hostname) &&
            url.pathname === '/search' &&
            url.searchParams.has('q')
        ).length;
    }

    function hasKnowledgeSemantics(root) {
        return root.matches?.(KNOWLEDGE_SELECTOR) || Boolean(root.querySelector(KNOWLEDGE_SELECTOR));
    }

    function hasProtectedImageSemantics(root) {
        const attrids = [...root.querySelectorAll('[data-attrid]')]
            .map(node => node.getAttribute('data-attrid'))
            .filter(Boolean);
        return attrids.some(attrid => attrid !== 'images universal');
    }

    function hideEmbeddedNewsClusters(root) {
        let removed = false;
        const contents = root.querySelectorAll('[data-attrid^="lab/cluster/content/"]');

        for (const content of contents) {
            if (hasNewsRoute(content)) continue;
            if (!content.querySelector('[data-news-cluster-id], atx-attribution')) continue;

            const attrid = content.getAttribute('data-attrid');
            const suffix = attrid.slice('lab/cluster/content/'.length);
            const expectedTitle = `lab/cluster/title/${suffix}`;
            const title = [...root.querySelectorAll('[data-attrid^="lab/cluster/title/"]')]
                .find(node => node.getAttribute('data-attrid') === expectedTitle);

            removed = hide(content, 'embedded-news-cluster') || removed;
            if (title) hide(title, 'embedded-news-cluster-title');
        }

        return removed;
    }

    function visibleText(node) {
        return (node?.innerText || '').replace(/\s+/g, ' ').trim();
    }

    function hideGenericSections(root) {
        const rootText = visibleText(root);
        for (const section of root.querySelectorAll('g-section-with-header')) {
            if (hasNewsRoute(section) || hasForumRoute(section) || hasKnowledgeSemantics(section)) continue;

            const sectionText = visibleText(section);
            if (sectionText && sectionText === rootText) {
                hide(root, 'generic-section');
                return true;
            }
            hide(section, 'generic-section');
        }
        return false;
    }

    function classifyTopLevel(root) {
        if (!root) return;
        if (root.dataset.googleCleanupHidden) {
            hide(root, root.dataset.googleCleanupHidden);
            return;
        }
        if (root.querySelector('#bres')) return;

        if (hideGenericSections(root)) return;

        if (root.querySelector('[data-attrid*="RecipeCluster"]')) {
            hide(root, 'recipe-cluster');
            return;
        }

        if (root.querySelector('[data-attrid*="social media presence"]')) {
            hide(root, 'social-profiles');
            return;
        }

        if (root.querySelector('product-viewer-group')) {
            hide(root, 'products');
            return;
        }

        const newsCluster = root.querySelector('[data-news-cluster-id]');
        const realNews = hasNewsRoute(root);

        if (newsCluster && !realNews) {
            if (!hideEmbeddedNewsClusters(root)) {
                hide(root, 'non-news-cluster');
            }
            return;
        }

        const external = externalDestinationCount(root);
        const queryLinks = googleQueryLinkCount(root);
        const progressbars = root.querySelectorAll('[role="progressbar"]').length;
        const buttons = root.querySelectorAll('button,[role="button"]').length;

        if (!realNews &&
            !hasForumRoute(root) &&
            queryLinks === 0 &&
            progressbars >= 2 &&
            buttons >= 2) {
            hide(root, 'question-accordion');
            return;
        }

        if (!hasForumRoute(root) && hasUnwantedVertical(root)) {
            const urls = linksFor(root);
            const hasImageVertical = urls.some(url => url.searchParams.get('udm') === '2');
            const hasOtherUnwantedVertical = urls.some(url => {
                const udm = url.searchParams.get('udm');
                return udm && udm !== '2' && UNWANTED_UDM.has(udm);
            });

            if (!hasImageVertical || hasOtherUnwantedVertical || !hasProtectedImageSemantics(root)) {
                hide(root, 'unwanted-vertical');
                return;
            }
        }

        if (!realNews &&
            !hasForumRoute(root) &&
            !hasKnowledgeSemantics(root) &&
            external === 0 &&
            queryLinks >= 2) {
            hide(root, 'query-refinement');
        }
    }

    function normalizedQuery(value) {
        return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function verticalRoute(url) {
        if (url.searchParams.get('tbm') === 'nws') return 'news';
        const udm = url.searchParams.get('udm');
        return udm === '18' || udm === 'forums' ? 'forums' : null;
    }

    function isOtherQueryLink(url, currentQuery) {
        const route = verticalRoute(url);
        return isGoogleHost(url.hostname) &&
            url.pathname === '/search' &&
            url.searchParams.has('q') &&
            normalizedQuery(url.searchParams.get('q')) !== currentQuery &&
            (!route || route === verticalRoute(new URL(location.href)));
    }

    function isRelatedSearchesOnly(node, currentQuery) {
        if (node.matches('[role="navigation"]') || node.querySelector('[role="navigation"]')) return false;
        if (hasKnowledgeSemantics(node)) return false;
        const urls = linksFor(node);
        return urls.length > 0 && urls.every(url => isOtherQueryLink(url, currentQuery));
    }

    function hideRelatedSearches() {
        const currentQuery = normalizedQuery(new URL(location.href).searchParams.get('q'));
        for (const scope of document.querySelectorAll(RESULT_SCOPES)) {
            for (const anchor of scope.querySelectorAll('a[href]')) {
                if (anchor.closest(RESULT_SCOPES) !== scope) continue;
                if (anchor.closest('[data-google-cleanup-hidden]')) continue;
                const knowledge = anchor.closest(KNOWLEDGE_SELECTOR);
                if (knowledge && scope.contains(knowledge)) continue;
                const url = parseURL(anchor);
                if (!url || !isOtherQueryLink(url, currentQuery)) continue;

                let module = null;
                for (let node = anchor.parentElement; node && node !== scope; node = node.parentElement) {
                    if (!isRelatedSearchesOnly(node, currentQuery)) break;
                    module = node;
                }
                if (!module) continue;

                const queries = new Set(linksFor(module).map(link => normalizedQuery(link.searchParams.get('q'))));
                if (queries.size >= 2) hide(module, RELATED_SEARCHES);
            }
        }
    }

    function resultRoots() {
        const roots = new Set();
        for (const region of document.querySelectorAll('#rso, #botstuff, #bres')) {
            for (const child of region.children) roots.add(child);
        }

        const asyncSearchContexts = document.querySelectorAll(
            '[data-async-type="arc"][data-async-rclass="search"] > [data-async-context^="query:"]'
        );
        for (const context of asyncSearchContexts) {
            for (const child of context.children) {
                if (!(child instanceof HTMLElement) || !child.getClientRects().length) continue;

                const visibleChildren = [...child.children].filter(node =>
                    node instanceof HTMLElement && node.getClientRects().length
                );
                if (visibleChildren.length < 2) continue;

                for (const slot of visibleChildren) roots.add(slot);
            }
        }

        return [...roots];
    }

    function structuralCleanup() {
        stats.scans += 1;
        for (const root of resultRoots()) classifyTopLevel(root);
    }

    function isExplicitVerticalPage() {
        const params = new URL(location.href).searchParams;
        return params.has('udm') || params.has('tbm');
    }

    function restoreCleanupHides() {
        for (const node of document.querySelectorAll('[data-google-cleanup-hidden]')) {
            if (node.dataset.googleCleanupHidden === RELATED_SEARCHES) continue;
            node.style.removeProperty('display');
            delete node.dataset.googleCleanupHidden;
        }
    }

    function removeSearchSuggestions() {
        for (const node of document.querySelectorAll('form[action="/search"] > div > div[jscontroller]')) {
            node.removeAttribute('jscontroller');
        }
    }

    function hideVisualDigest() {
        const selectors = [
            '[data-attrid="VisualDigestNewsArticleResult"]',
            '[data-attrid="VisualDigestSocialMediaResult"]',
            '[data-attrid="VisualDigestWebResult"]',
        ];
        for (const node of document.querySelectorAll(selectors.join(','))) {
            const region = node.closest('#rso, #botstuff, #bres');
            let root = node;
            while (region && root.parentElement && root.parentElement !== region) {
                root = root.parentElement;
            }

            const fullSlot = region &&
                root.parentElement === region &&
                visibleText(node) &&
                visibleText(node) === visibleText(root);
            hide(fullSlot ? root : node, 'visual-digest');
        }
    }

    function cleanup() {
        enforceVideoAutoplayGuard();

        if (isExplicitVerticalPage()) {
            restoreCleanupHides();
            removeSearchSuggestions();
            hideRelatedSearches();
            return;
        }

        structuralCleanup();
        removeSearchSuggestions();
        hideVisualDigest();
        hideRelatedSearches();
    }

    window.__GOOGLE_INTERFACE_CLEANUP__ = {
        version: VERSION,
        get stats() {
            return {
                scans: stats.scans,
                hidden: stats.hidden,
                reasons: { ...stats.reasons },
            };
        },
        run: cleanup,
    };

    cleanup();
    setInterval(cleanup, CLEANUP_INTERVAL_MS);
})();
