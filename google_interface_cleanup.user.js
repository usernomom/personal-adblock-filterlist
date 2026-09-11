// ==UserScript==
// @name         Google interface cleanup
// @description  Remove unwanted Google result modules, standalone YouTube results, and unsolicited video autoplay.
// @license      MIT
// @version      140.0.11
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_interface_cleanup.user.js
// @updateURL    https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_interface_cleanup.user.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '140.0.11';
    const CLEANUP_INTERVAL_MS = 300;
    const UNWANTED_UDM = new Set(['2', '7', 'vids', '28', '39', '54']);
    const stats = {
        scans: 0,
        hidden: 0,
        reasons: {},
    };
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

    function isYouTubeHost(hostname) {
        return hostname === 'youtube.com' ||
            hostname.endsWith('.youtube.com') ||
            hostname === 'youtu.be' ||
            hostname === 'youtube-nocookie.com' ||
            hostname.endsWith('.youtube-nocookie.com');
    }

    function linksFor(root) {
        return [...root.querySelectorAll('a[href]')]
            .map(parseURL)
            .filter(Boolean);
    }

    function resolveExternalDestination(url) {
        if (!isGoogleHost(url.hostname)) return url;
        if (url.pathname !== '/url' && url.pathname !== '/goto') return url;

        for (const key of ['url', 'q']) {
            const rawTarget = url.searchParams.get(key);
            if (!rawTarget) continue;
            try {
                const target = new URL(rawTarget, location.href);
                if (/^https?:$/.test(target.protocol)) return target;
            } catch (_) {
                // Opaque Google redirect tokens cannot be resolved client-side.
            }
        }
        return url;
    }

    function hasOnlyYouTubeExternalDestinations(root) {
        const destinations = linksFor(root)
            .map(resolveExternalDestination)
            .filter(url => /^https?:$/.test(url.protocol) && !isGoogleHost(url.hostname));
        return destinations.length > 0 && destinations.every(url => isYouTubeHost(url.hostname));
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
        const selector = [
            '.kp-wholepage',
            '[data-kpid]',
            '[data-mcpr]',
            '[data-attrid="title"]',
            '[data-attrid="subtitle"]',
            '[data-attrid^="kc:"]',
            '[data-attrid^="lab/fact/"]',
        ].join(',');
        return root.matches?.(selector) || Boolean(root.querySelector(selector));
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
            hasOnlyYouTubeExternalDestinations(root)) {
            hide(root, 'youtube-result');
            return;
        }

        if (!realNews &&
            !hasForumRoute(root) &&
            !hasKnowledgeSemantics(root) &&
            external === 0 &&
            queryLinks >= 2) {
            hide(root, 'query-refinement');
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
            return;
        }

        structuralCleanup();
        removeSearchSuggestions();
        hideVisualDigest();
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
