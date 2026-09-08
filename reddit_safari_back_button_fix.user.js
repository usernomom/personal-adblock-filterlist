// ==UserScript==
// @name         Reddit Safari Back Button Fix
// @namespace    local.reddit.safari.backfix
// @version      1.4.3-macaque-clean
// @description  Escape Reddit JavaScript-challenge history traps in Safari without breaking the initial challenge load.
// @match        https://reddit.com/*
// @match        https://*.reddit.com/*
// @run-at       document-start
// @grant        GM.log
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js
// @updateURL    https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js
// ==/UserScript==

(() => {
    'use strict';

    const TAG = '[reddit-safari-backfix]';
    const STATE_VERSION = '1.4.3-macaque-clean';
    const GOOGLE_CHILD_PARAM = '__rbf_google_child';

    const CONFIG = Object.freeze({
        minMsBetweenActions: 1200,
        maxActionsPerTab: 4,
        closeFallbackDelayMs: 350,
        historyFallbackDelayMs: 80,
    });

    const KEYS = Object.freeze({
        actionCount: '__reddit_backfix_action_count__',
        lastActionAt: '__reddit_backfix_last_action_at__',
        normalRedditSeen: '__reddit_backfix_normal_reddit_seen__',
        lastTrapUrl: '__reddit_backfix_last_trap_url__',
        pendingTarget: '__reddit_backfix_pending_target__',
        armedTarget: '__reddit_backfix_armed_target__',
        stateVersion: '__reddit_backfix_state_version__',
        externalEntryOrigin: '__reddit_backfix_external_entry_origin__',
        externalAutoBackTarget: '__reddit_backfix_external_auto_back_target__',
        googleChild: '__reddit_backfix_google_child__',
    });

    const CHALLENGE_PARAMS = Object.freeze([
        'solution',
        'js_challenge',
        'token',
        'jsc_token',
        'jsc_orig_r',
    ]);

    function log(event, details = {}) {
        try {
            if (typeof GM !== 'undefined' && GM && typeof GM.log === 'function') {
                GM.log(TAG, event, details);
            }
        } catch (_) {
            // Diagnostics must never affect navigation.
        }
    }

    function ssGetString(key, fallback = '') {
        try {
            const value = sessionStorage.getItem(key);
            return value == null ? fallback : value;
        } catch (_) {
            return fallback;
        }
    }

    function ssSetString(key, value) {
        try {
            sessionStorage.setItem(key, String(value));
        } catch (_) {
            // Storage failures are non-fatal.
        }
    }

    function ssGetNumber(key, fallback = 0) {
        const value = Number(ssGetString(key, ''));
        return Number.isFinite(value) ? value : fallback;
    }

    function ssSetNumber(key, value) {
        ssSetString(key, Number(value));
    }

    function isRedditHost(hostname) {
        const host = String(hostname || '').toLowerCase();
        return host === 'reddit.com' || host.endsWith('.reddit.com');
    }

    function isTopWindow() {
        try {
            return window.top === window.self;
        } catch (_) {
            return false;
        }
    }

    function navType() {
        try {
            const entry = performance.getEntriesByType('navigation')[0];
            return entry && typeof entry.type === 'string' ? entry.type : '';
        } catch (_) {
            return '';
        }
    }

    function parsedRedditUrl(rawUrl) {
        try {
            const url = new URL(String(rawUrl), location.href);
            return isRedditHost(url.hostname) ? url : null;
        } catch (_) {
            return null;
        }
    }

    function hasChallengeParams(rawUrl) {
        const url = parsedRedditUrl(rawUrl);
        return Boolean(url && CHALLENGE_PARAMS.some(name => url.searchParams.has(name)));
    }

    function cleanUrl(rawUrl) {
        const url = parsedRedditUrl(rawUrl);
        if (!url) return String(rawUrl);

        for (const name of CHALLENGE_PARAMS) {
            url.searchParams.delete(name);
        }

        if (url.origin === location.origin) {
            return `${url.pathname}${url.search}${url.hash}`;
        }
        return url.href;
    }

    function targetKey(rawUrl) {
        const url = parsedRedditUrl(rawUrl);
        if (!url) return '';

        let path = url.pathname || '/';
        if (path.length > 1) path = path.replace(/\/+$/, '');
        return path;
    }

    function originOf(rawUrl) {
        if (!rawUrl) return '';
        try {
            return new URL(String(rawUrl), location.href).origin;
        } catch (_) {
            return '';
        }
    }

    function navigationEntrySnapshot(entry) {
        if (!entry) return null;
        try {
            return {
                index: typeof entry.index === 'number' ? entry.index : null,
                url: typeof entry.url === 'string' ? entry.url : '',
                key: typeof entry.key === 'string' ? entry.key : '',
                id: typeof entry.id === 'string' ? entry.id : '',
                sameDocument:
                    typeof entry.sameDocument === 'boolean' ? entry.sameDocument : null,
            };
        } catch (_) {
            return null;
        }
    }

    function navigationSnapshot() {
        try {
            const nav = window.navigation;
            if (!nav) return { supported: false };

            let entries = [];
            try {
                entries =
                    typeof nav.entries === 'function'
                        ? nav.entries().map(navigationEntrySnapshot)
                        : [];
            } catch (_) {
                entries = [];
            }

            let activation = null;
            try {
                if (nav.activation) {
                    activation = {
                        navigationType: nav.activation.navigationType || '',
                        from: navigationEntrySnapshot(nav.activation.from),
                        entry: navigationEntrySnapshot(nav.activation.entry),
                    };
                }
            } catch (_) {
                activation = null;
            }

            return {
                supported: true,
                canGoBack: Boolean(nav.canGoBack),
                canGoForward: Boolean(nav.canGoForward),
                currentEntry: navigationEntrySnapshot(nav.currentEntry),
                activation,
                entries,
            };
        } catch (error) {
            return { supported: true, error: String(error) };
        }
    }

    function pageContextSnapshot() {
        let hasOpener = false;
        try {
            hasOpener = window.opener != null;
        } catch (_) {
            hasOpener = false;
        }

        return {
            referrerPresent: Boolean(document.referrer),
            referrerOrigin: originOf(document.referrer),
            hasOpener,
            visibilityState: document.visibilityState || '',
            historyLength: history.length,
            navigation: navigationSnapshot(),
        };
    }

    function installNavigationDiagnostics() {
        try {
            const nav = window.navigation;
            if (!nav || typeof nav.addEventListener !== 'function') {
                log('navigation-api-unavailable', pageContextSnapshot());
                return;
            }

            nav.addEventListener('navigate', event => {
                const destinationUrl = event.destination && typeof event.destination.url === 'string' ? event.destination.url : '';
                const googleChild = ssGetString(KEYS.googleChild, '') === '1';
                const closeGoogleChildChallengeTraverse =
                    event.navigationType === 'traverse' &&
                    googleChild &&
                    hasChallengeParams(location.href) &&
                    destinationUrl !== '' &&
                    !hasChallengeParams(destinationUrl) &&
                    targetKey(destinationUrl) !== '' &&
                    targetKey(destinationUrl) === targetKey(location.href);

                if (closeGoogleChildChallengeTraverse) {
                    log('google-child-back-traverse-close', {
                        from: location.href,
                        to: destinationUrl,
                    });
                    try {
                        window.close();
                    } catch (error) {
                        log('google-child-back-traverse-close-failed', { error: String(error) });
                    }
                    return;
                }

                log('navigation-navigate', {
                    navigationType: event.navigationType || '',
                    canIntercept: Boolean(event.canIntercept),
                    userInitiated: Boolean(event.userInitiated),
                    hashChange: Boolean(event.hashChange),
                    downloadRequest: event.downloadRequest || null,
                    destination: navigationEntrySnapshot(event.destination),
                    context: pageContextSnapshot(),
                });
            });

            nav.addEventListener('currententrychange', event => {
                log('navigation-currententrychange', {
                    navigationType: event.navigationType || '',
                    from: navigationEntrySnapshot(event.from),
                    context: pageContextSnapshot(),
                });
            });
        } catch (error) {
            log('navigation-diagnostics-install-failed', { error: String(error) });
        }
    }

    function handleCloseBlocked(reason, fallbackDirection) {
        log('still-open-after-window-close', {
            reason,
            fallbackDirection,
            href: location.href,
            historyLength: history.length,
        });

        setTimeout(() => {
            try {
                if (fallbackDirection === 'back') {
                    history.back();
                    log('history-back', { reason });
                } else {
                    history.forward();
                    log('history-forward', { reason });
                }
            } catch (error) {
                log('history-fallback-failed', {
                    reason,
                    fallbackDirection,
                    error: String(error),
                });
            }
        }, CONFIG.historyFallbackDelayMs);
    }

    function actOnTrap(reason, fallbackDirection = 'back') {
        const now = Date.now();
        const nextCount = ssGetNumber(KEYS.actionCount, 0) + 1;
        const cleaned = cleanUrl(location.href);

        ssSetNumber(KEYS.actionCount, nextCount);
        ssSetNumber(KEYS.lastActionAt, now);
        ssSetString(KEYS.lastTrapUrl, location.href);
        ssSetString(KEYS.pendingTarget, '');
        ssSetString(KEYS.armedTarget, '');

        log('trap-action', {
            reason,
            count: nextCount,
            before: location.href,
            cleaned,
            fallbackDirection,
            historyLength: history.length,
        });

        try {
            history.replaceState(history.state, '', cleaned);
        } catch (error) {
            log('replaceState-failed', { error: String(error) });
        }

        try {
            window.close();
        } catch (error) {
            log('window-close-failed', { error: String(error) });
        }

        // A script-opened Reddit tab can close here. In a normal same-tab
        // navigation Safari blocks close(), so use the direction selected for the
        // specific trap shape. The observed two-entry clean-URL loop needs forward;
        // challenge-bearing traversal traps still use back.
        setTimeout(() => {
            handleCloseBlocked(reason, fallbackDirection);
        }, CONFIG.closeFallbackDelayMs);
    }

    if (!isTopWindow() || !isRedditHost(location.hostname)) return;

    // A Safari tab can survive userscript upgrades for months. Reset the small
    // state machine once per version so stale data cannot arm the wrong entry.
    if (ssGetString(KEYS.stateVersion, '') !== STATE_VERSION) {
        ssSetNumber(KEYS.actionCount, 0);
        ssSetNumber(KEYS.lastActionAt, 0);
        ssSetString(KEYS.normalRedditSeen, '');
        ssSetString(KEYS.lastTrapUrl, '');
        ssSetString(KEYS.pendingTarget, '');
        ssSetString(KEYS.armedTarget, '');
        ssSetString(KEYS.externalEntryOrigin, '');
        ssSetString(KEYS.externalAutoBackTarget, '');
        ssSetString(KEYS.googleChild, '');
        ssSetString(KEYS.stateVersion, STATE_VERSION);
    }

    // Google v4 carries provenance in the URL fragment so Google's opaque
    // redirect remains untouched. Accept the v3 query marker too so already-open
    // tabs survive the upgrade, then strip either form immediately.
    try {
        const markerUrl = parsedRedditUrl(location.href);
        let markerSeen = false;
        if (markerUrl) {
            if (markerUrl.searchParams.get(GOOGLE_CHILD_PARAM) === '1') {
                markerSeen = true;
                markerUrl.searchParams.delete(GOOGLE_CHILD_PARAM);
            }

            const fragment = markerUrl.hash.startsWith('#') ? markerUrl.hash.slice(1) : markerUrl.hash;
            const parts = fragment ? fragment.split('&').filter(Boolean) : [];
            const marker = `${GOOGLE_CHILD_PARAM}=1`;
            const kept = parts.filter(part => part !== marker);
            if (kept.length !== parts.length) {
                markerSeen = true;
                markerUrl.hash = kept.length ? `#${kept.join('&')}` : '';
            }
        }

        if (markerUrl && markerSeen) {
            ssSetString(KEYS.googleChild, '1');
            const markerCleaned = `${markerUrl.pathname}${markerUrl.search}${markerUrl.hash}`;
            history.replaceState(history.state, '', markerCleaned);
            log('google-child-recorded', { href: location.href, cleaned: markerCleaned });
        }
    } catch (error) {
        log('google-child-marker-failed', { error: String(error) });
    }

    const initialHref = location.href;
    const initialHadChallenge = hasChallengeParams(initialHref);
    const initialTarget = targetKey(initialHref);

    const initialReferrerOrigin = originOf(document.referrer);
    let initialExternalReferrer = false;
    try {
        const referrerUrl = new URL(document.referrer);
        initialExternalReferrer =
            (referrerUrl.protocol === 'https:' || referrerUrl.protocol === 'http:') &&
            !isRedditHost(referrerUrl.hostname);
    } catch (_) {
        initialExternalReferrer = false;
    }

    if (!initialHadChallenge && initialExternalReferrer) {
        ssSetString(KEYS.externalEntryOrigin, initialReferrerOrigin);
        log('external-entry-recorded', {
            origin: initialReferrerOrigin,
            target: initialTarget,
            href: location.href,
            historyLength: history.length,
        });
    }

    function runTrapCheck(trigger, { persisted = false, traversalHint = false } = {}) {
        const navigationType = navType();
        const now = Date.now();
        const actionCount = ssGetNumber(KEYS.actionCount, 0);
        const lastActionAt = ssGetNumber(KEYS.lastActionAt, 0);
        const normalRedditSeen = ssGetString(KEYS.normalRedditSeen, '');
        const pendingTarget = ssGetString(KEYS.pendingTarget, '');
        const armedTarget = ssGetString(KEYS.armedTarget, '');
        const externalEntryOrigin = ssGetString(KEYS.externalEntryOrigin, '');
        const externalAutoBackTarget = ssGetString(KEYS.externalAutoBackTarget, '');
        const googleChild = ssGetString(KEYS.googleChild, '') === '1';
        const underActionCap = actionCount < CONFIG.maxActionsPerTab;
        const outsideThrottle = lastActionAt === 0 || now - lastActionAt >= CONFIG.minMsBetweenActions;
        const shortHistory = history.length <= 2;
        const isBackForward = navigationType === 'back_forward';
        const isTraversal = persisted || traversalHint || isBackForward;
        const currentHasChallenge = hasChallengeParams(location.href);
        const currentTarget = targetKey(location.href);
        const armedChallengeReturn =
            currentHasChallenge &&
            armedTarget !== '' &&
            currentTarget !== '' &&
            currentTarget === armedTarget;
        const restoredArmedChallenge =
            persisted &&
            initialHadChallenge &&
            armedTarget !== '' &&
            initialTarget === armedTarget;
        const challengeTraversal = isTraversal && currentHasChallenge;
        const legacyShortHistoryTrap = isBackForward && shortHistory && !currentHasChallenge;

        log('trap-check', {
            trigger,
            href: location.href,
            initialHref,
            initialHadChallenge,
            initialTarget,
            navigationType,
            historyLength: history.length,
            persisted,
            traversalHint,
            actionCount,
            lastActionAt,
            normalRedditSeen,
            pendingTarget,
            armedTarget,
            externalEntryOrigin,
            externalAutoBackTarget,
            googleChild,
            underActionCap,
            outsideThrottle,
            shortHistory,
            isBackForward,
            currentHasChallenge,
            currentTarget,
            armedChallengeReturn,
            restoredArmedChallenge,
            challengeTraversal,
            legacyShortHistoryTrap,
            pageContext: pageContextSnapshot(),
        });

        if (!underActionCap || !outsideThrottle) return;

        // This is the key Safari 26.6.1 case observed in Macaque: returning to the
        // zombie challenge can be reported as a plain "navigate". Session state is
        // therefore the primary signal, not PerformanceNavigationTiming.type.
        if (armedChallengeReturn || restoredArmedChallenge) {
            actOnTrap(
                armedChallengeReturn ? 'armed-challenge-return' : 'pageshow-armed-challenge',
                'back',
            );
            return;
        }

        // A true traversal into a challenge is also a trap even if the arm state
        // was lost (for example after an upgrade while the tab stayed open).
        if (challengeTraversal) {
            actOnTrap(
                persisted
                    ? 'pageshow-bfcache-challenge'
                    : traversalHint
                      ? 'popstate-challenge'
                      : 'back_forward-challenge',
                'back',
            );
            return;
        }

        if (legacyShortHistoryTrap && googleChild) {
            ssSetString(KEYS.externalAutoBackTarget, '');
            log('google-child-short-history-close', {
                currentTarget,
                historyLength: history.length,
            });
            try {
                window.close();
            } catch (error) {
                log('google-child-short-history-close-failed', { error: String(error) });
            }
            return;
        }

        if (
            legacyShortHistoryTrap &&
            externalAutoBackTarget !== '' &&
            currentTarget === externalAutoBackTarget
        ) {
            // An externally opened tab already traversed itself back from Reddit's
            // challenge entry to the clean first entry. Do not bounce it forward;
            // the next Safari Back press can now perform Safari's native close-tab
            // and return-to-parent behavior.
            ssSetString(KEYS.externalAutoBackTarget, '');
            log('external-auto-back-arrived', {
                currentTarget,
                externalEntryOrigin,
                historyLength: history.length,
            });
            return;
        }
        if (legacyShortHistoryTrap) {
            // This is the exact state observed after pressing Safari Back on iOS
            // 26.6.1: a clean Reddit URL, navType=back_forward, history.length=2.
            // In that two-entry loop the working July strategy advances forward;
            // going backward leaves Safari at the beginning of the loop.
            actOnTrap('back_forward-short-history', 'forward');
            return;
        }

        if (!isTraversal && currentHasChallenge) {
            // First challenge load: do NOT scrub or mark it as a normal Reddit
            // page. Let Reddit complete its challenge and remember only the target.
            ssSetString(KEYS.pendingTarget, currentTarget);
            log('challenge-pending', {
                currentTarget,
                href: location.href,
                historyLength: history.length,
                externalEntryOrigin,
            });

            // Safari's Navigation API shows Reddit pushing this challenge as entry 1
            // on top of the clean entry 0. If the clean entry originally came from
            // another site (for example Google opened in a new tab), move back to
            // entry 0 after pageshow and suppress the normal short-history bounce.
            if (!googleChild && externalEntryOrigin !== '' && shortHistory) {
                ssSetString(KEYS.externalAutoBackTarget, currentTarget);
            }
            return;
        }

        if (!isTraversal && !currentHasChallenge) {
            const cleaned = cleanUrl(location.href);
            ssSetString(KEYS.normalRedditSeen, cleaned);

            // The first clean Reddit page after a challenge arms that challenge
            // entry. If Back later returns to it—even as navType="navigate"—we can
            // identify it without touching unrelated Reddit navigations.
            if (pendingTarget !== '' && currentTarget === pendingTarget) {
                ssSetString(KEYS.armedTarget, currentTarget);
                ssSetString(KEYS.pendingTarget, '');
                log('challenge-armed', {
                    currentTarget,
                    cleaned,
                    historyLength: history.length,
                });
            }
        }
    }

    log('diagnostic-init', pageContextSnapshot());
    installNavigationDiagnostics();
    runTrapCheck('document-start');

    addEventListener(
        'pagehide',
        event => {
            log('pagehide', {
                persisted: Boolean(event.persisted),
                context: pageContextSnapshot(),
            });
        },
        true,
    );

    addEventListener(
        'pageshow',
        event => {
            log('pageshow', {
                persisted: Boolean(event.persisted),
                context: pageContextSnapshot(),
            });
            if (!event.persisted) {
                const externalAutoBackTarget = ssGetString(KEYS.externalAutoBackTarget, '');
                if (
                    externalAutoBackTarget !== '' &&
                    hasChallengeParams(location.href) &&
                    targetKey(location.href) === externalAutoBackTarget
                ) {
                    log('external-challenge-auto-back', {
                        target: externalAutoBackTarget,
                        href: location.href,
                        context: pageContextSnapshot(),
                    });
                    setTimeout(() => {
                        try {
                            history.back();
                            log('external-challenge-history-back', {
                                target: externalAutoBackTarget,
                            });
                        } catch (error) {
                            log('external-challenge-history-back-failed', {
                                error: String(error),
                            });
                        }
                    }, CONFIG.historyFallbackDelayMs);
                }
                return;
            }
            runTrapCheck('pageshow', { persisted: true });
        },
        true,
    );

    addEventListener(
        'popstate',
        () => {
            log('popstate', pageContextSnapshot());
            if (!hasChallengeParams(location.href)) return;
            runTrapCheck('popstate', { traversalHint: true });
        },
        true,
    );
})();
