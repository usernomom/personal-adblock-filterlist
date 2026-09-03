// ==UserScript==
// @name         Google interface cleanup
// @description  Remove non-web Google result modules using structural signals instead of UI titles.
// @license      MIT
// @version      140.0.2
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_interface_cleanup.user.js
// @updateURL    https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_interface_cleanup.user.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @run-at       document-end
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '140.0.2';
    const CLEANUP_INTERVAL_MS = 300;
    const UNWANTED_UDM = new Set(['2', '7', 'vids', '28', '39', '54']);
    const stats = {
        scans: 0,
        hidden: 0,
        reasons: {},
    };

    const hiddenStyle = document.createElement('style');
    hiddenStyle.textContent = '[data-google-cleanup-hidden] { display: none !important; }';
    (document.head || document.documentElement).appendChild(hiddenStyle);

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
        return Boolean(root.querySelector([
            '[data-mcpr]',
            '[data-attrid="title"]',
            '[data-attrid="subtitle"]',
            '[data-attrid^="kc:"]',
            '[data-attrid^="lab/fact/"]',
        ].join(',')));
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
            if (hasNewsRoute(section) || hasForumRoute(section)) continue;
            if (section.querySelector('[data-mcpr], [data-attrid^="kc:"]')) continue;

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
