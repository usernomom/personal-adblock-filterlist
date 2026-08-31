// ==UserScript==
// @name         Google Search reCAPTCHA audio solver
// @namespace    https://github.com/usernomom/personal-adblock-filterlist
// @author       nobody
// @description  Automatically solves Google Search unusual-traffic reCAPTCHA audio challenges with iOS-safe source discovery, diagnostics, bounded retries, and transcriber failover.
// @license      MIT
// @version      2
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_recaptcha_audio_solver.js
// @match        https://*.google.com/sorry/*
// @match        https://*.google.ca/sorry/*
// @match        https://www.google.com/recaptcha/*
// @match        https://www.recaptcha.net/recaptcha/*
// @run-at       document-start
// @connect      engageub.pythonanywhere.com
// @connect      engageub1.pythonanywhere.com
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[GoogleAudioCaptcha]';
    const ACTIVE_KEY = 'google-sorry-active-v2';
    const PREFERRED_SERVER_KEY = 'google-sorry-transcriber-v2';
    const ACTIVE_TTL_MS = 3 * 60 * 1000;
    const MAX_AUDIO_ATTEMPTS = 3;
    const REQUEST_TIMEOUT_MS = 60000;
    const VERIFY_TIMEOUT_MS = 9000;
    const SOURCE_TIMEOUT_MS = 15000;

    const TRANSCRIBERS = [
        'https://engageub.pythonanywhere.com',
        'https://engageub1.pythonanywhere.com'
    ];

    const SELECTORS = {
        anchor: '#recaptcha-anchor',
        audioModeButton: '#recaptcha-audio-button',
        audioInput: '#audio-response, .rc-audiochallenge-response-field, input[name="audio-response"]',
        verifyButton: '#recaptcha-verify-button',
        reloadButton: '#recaptcha-reload-button',
        audioError: '.rc-audiochallenge-error-message',
        blocked: '.rc-doscaptcha-body',
        playButton: '.rc-audiochallenge-play-button, #audio-source + button, button[aria-label*="PLAY" i]',
        audioChallenge: '.rc-audiochallenge, #rc-audiochallenge'
    };

    let statusElement = null;
    let statusHideTimer = null;
    let solving = false;

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function jitter(min, max) {
        return Math.floor(min + Math.random() * (max - min + 1));
    }

    function visible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity || 1) !== 0 &&
            rect.width > 0 && rect.height > 0;
    }

    function log(...args) {
        console.log(TAG, ...args);
    }

    function warn(...args) {
        console.warn(TAG, ...args);
    }

    function ensureStatusElement() {
        if (statusElement && statusElement.isConnected) return statusElement;
        if (!document.documentElement) return null;

        const host = document.body || document.documentElement;
        const el = document.createElement('div');
        el.id = 'google-audio-captcha-status';
        el.setAttribute('aria-hidden', 'true');
        Object.assign(el.style, {
            position: 'fixed',
            left: '6px',
            top: '6px',
            zIndex: '2147483647',
            maxWidth: 'calc(100% - 12px)',
            padding: '3px 6px',
            borderRadius: '4px',
            background: 'rgba(0,0,0,.72)',
            color: '#fff',
            font: '11px -apple-system, BlinkMacSystemFont, sans-serif',
            lineHeight: '1.25',
            pointerEvents: 'none',
            opacity: '.92'
        });
        host.appendChild(el);
        statusElement = el;
        return el;
    }

    function setStatus(message, { error = false, autoHide = false } = {}) {
        const prefix = error ? 'ERROR: ' : '';
        if (error) warn(message); else log(message);

        const render = () => {
            const el = ensureStatusElement();
            if (!el) return;
            el.textContent = prefix + message;
            el.style.background = error ? 'rgba(120,0,0,.82)' : 'rgba(0,0,0,.72)';
            el.style.display = 'block';

            if (statusHideTimer) clearTimeout(statusHideTimer);
            if (autoHide) {
                statusHideTimer = setTimeout(() => {
                    if (statusElement) statusElement.style.display = 'none';
                }, 1800);
            }
        };

        if (document.readyState === 'loading' && !document.body) {
            document.addEventListener('DOMContentLoaded', render, { once: true });
        } else {
            render();
        }
    }

    function isGoogleSorryPage() {
        return /(^|\.)google\.(com|ca)$/i.test(location.hostname) &&
            location.pathname.startsWith('/sorry/');
    }

    function isRecaptchaFrame() {
        return (location.hostname === 'www.google.com' || location.hostname === 'www.recaptcha.net') &&
            location.pathname.includes('/recaptcha/');
    }

    function referrerLooksLikeGoogleSorry() {
        try {
            const ref = new URL(document.referrer);
            return /(^|\.)google\.(com|ca)$/i.test(ref.hostname) &&
                ref.pathname.startsWith('/sorry/');
        } catch (_) {
            return false;
        }
    }

    async function gmGet(key, fallback) {
        try {
            if (typeof GM_getValue === 'function') {
                const value = GM_getValue(key, fallback);
                return value === undefined ? fallback : value;
            }
            if (globalThis.GM && typeof GM.getValue === 'function') {
                const value = await GM.getValue(key, fallback);
                return value === undefined ? fallback : value;
            }
        } catch (error) {
            warn('GM get failed:', error);
        }
        return fallback;
    }

    async function gmSet(key, value) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(key, value);
                return;
            }
            if (globalThis.GM && typeof GM.setValue === 'function') {
                await GM.setValue(key, value);
            }
        } catch (error) {
            warn('GM set failed:', error);
        }
    }

    function getGmRequestFunction() {
        if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest;
        if (globalThis.GM && typeof GM.xmlhttpRequest === 'function') return GM.xmlhttpRequest.bind(GM);
        if (globalThis.GM && typeof GM.xmlHttpRequest === 'function') return GM.xmlHttpRequest.bind(GM);
        return null;
    }

    function gmRequest(details) {
        return new Promise((resolve, reject) => {
            const request = getGmRequestFunction();
            if (!request) {
                reject(new Error('GM.xmlhttpRequest is unavailable'));
                return;
            }

            let settled = false;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                callback(value);
            };

            const watchdog = setTimeout(() => {
                finish(reject, new Error('GM request watchdog timeout'));
            }, (details.timeout || REQUEST_TIMEOUT_MS) + 2500);

            request({
                ...details,
                onload(response) {
                    clearTimeout(watchdog);
                    finish(resolve, response);
                },
                onerror(error) {
                    clearTimeout(watchdog);
                    finish(reject, new Error('GM request failed: ' + String(error)));
                },
                ontimeout() {
                    clearTimeout(watchdog);
                    finish(reject, new Error('GM request timed out'));
                },
                onabort() {
                    clearTimeout(watchdog);
                    finish(reject, new Error('GM request aborted'));
                }
            });
        });
    }

    async function activateSorrySession() {
        await gmSet(ACTIVE_KEY, { ts: Date.now(), host: location.hostname });
        log('Google /sorry/ session armed.');
    }

    async function clearSorrySession() {
        await gmSet(ACTIVE_KEY, { ts: 0, host: '' });
    }

    async function activationIsValid() {
        if (referrerLooksLikeGoogleSorry()) return true;
        const value = await gmGet(ACTIVE_KEY, null);
        return Boolean(value && Number.isFinite(value.ts) && Date.now() - value.ts < ACTIVE_TTL_MS);
    }

    function onDomReady(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback, { once: true });
        } else {
            callback();
        }
    }

    async function waitFor(selector, timeoutMs, predicate = visible) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const element = document.querySelector(selector);
            if (element && (!predicate || predicate(element))) return element;
            await delay(120);
        }
        return null;
    }

    function blockedMessage() {
        const element = document.querySelector(SELECTORS.blocked);
        const text = element ? element.textContent.trim() : '';
        return visible(element) && text ? text : '';
    }

    function audioErrorMessage() {
        const element = document.querySelector(SELECTORS.audioError);
        const text = element ? element.textContent.trim() : '';
        return visible(element) && text ? text : '';
    }

    function absolutize(raw) {
        if (!raw) return '';
        try {
            return new URL(raw, location.href).toString();
        } catch (_) {
            return String(raw);
        }
    }

    function candidateAudioUrls() {
        const candidates = [];
        const add = value => {
            const url = absolutize(value);
            if (url && !candidates.includes(url)) candidates.push(url);
        };

        const audioSource = document.querySelector('#audio-source');
        if (audioSource) {
            add(audioSource.currentSrc);
            add(audioSource.src);
            add(audioSource.getAttribute('src'));
        }

        for (const audio of document.querySelectorAll('audio')) {
            add(audio.currentSrc);
            add(audio.src);
            add(audio.getAttribute('src'));
            const source = audio.querySelector('source[src]');
            if (source) add(source.getAttribute('src'));
        }

        for (const source of document.querySelectorAll('audio source[src], source#audio-source[src]')) {
            add(source.src);
            add(source.getAttribute('src'));
        }

        for (const link of document.querySelectorAll('.rc-audiochallenge-tdownload-link a[href], a.rc-audiochallenge-tdownload-link[href]')) {
            add(link.href);
            add(link.getAttribute('href'));
        }

        return candidates.filter(url => /^https:\/\//i.test(url));
    }

    function currentAudioUrl() {
        return candidateAudioUrls()[0] || '';
    }

    async function waitForAudioUrl(timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        let lastCount = -1;

        while (Date.now() < deadline) {
            const urls = candidateAudioUrls();
            if (urls.length) {
                setStatus('Audio source found');
                return urls[0];
            }

            if (urls.length !== lastCount) {
                lastCount = urls.length;
                log('Audio URL candidates:', urls);
            }
            await delay(120);
        }
        return '';
    }

    function normalizedAudioUrl(rawUrl) {
        try {
            const url = new URL(rawUrl);
            if (url.hostname === 'www.recaptcha.net') url.hostname = 'www.google.com';
            return url.toString();
        } catch (_) {
            return String(rawUrl).replace('recaptcha.net', 'google.com');
        }
    }

    function normalizeTranscript(text) {
        const normalized = String(text || '').trim().replace(/\s+/g, ' ');
        if (!normalized || normalized === '0') return '';
        if (normalized.length > 120) return '';
        if (/[<>\r\n]/.test(normalized)) return '';
        return normalized;
    }

    async function transcribeWith(server, audioUrl, language) {
        setStatus('Transcribing via ' + new URL(server).hostname.replace('.pythonanywhere.com', ''));

        const body = 'input=' + encodeURIComponent(normalizedAudioUrl(audioUrl)) +
            '&lang=' + encodeURIComponent(language || 'en-US');

        const response = await gmRequest({
            method: 'POST',
            url: server,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            data: body,
            timeout: REQUEST_TIMEOUT_MS,
            anonymous: true
        });

        const status = Number(response && response.status);
        if (status && (status < 200 || status >= 300)) {
            throw new Error('HTTP ' + status);
        }

        const transcript = normalizeTranscript(response && response.responseText);
        if (!transcript) {
            const preview = String(response && response.responseText || '').trim().slice(0, 80);
            throw new Error('invalid transcription response' + (preview ? ': ' + preview : ''));
        }
        return transcript;
    }

    async function transcribe(audioUrl) {
        const htmlLang = document.documentElement.lang || 'en-US';
        const language = /^en(?:-|$)/i.test(htmlLang) ? htmlLang : 'en-US';
        const preferred = Math.max(0, Math.min(
            TRANSCRIBERS.length - 1,
            Number(await gmGet(PREFERRED_SERVER_KEY, 0)) || 0
        ));
        const order = [preferred, ...TRANSCRIBERS.map((_, index) => index).filter(index => index !== preferred)];
        let lastError = null;

        for (const index of order) {
            const server = TRANSCRIBERS[index];
            try {
                const transcript = await transcribeWith(server, audioUrl, language);
                await gmSet(PREFERRED_SERVER_KEY, index);
                setStatus('Transcript received');
                return transcript;
            } catch (error) {
                lastError = error;
                warn('Transcriber failed:', server, error.message || error);
                setStatus('Transcriber failed; trying backup');
            }
        }

        throw lastError || new Error('all transcribers failed');
    }

    function setInputValue(input, value) {
        const prototype = input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function waitForVerificationOutcome(previousAudioUrl) {
        const deadline = Date.now() + VERIFY_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const blocked = blockedMessage();
            if (blocked) return { state: 'blocked', message: blocked };

            const error = audioErrorMessage();
            if (error) return { state: 'incorrect', message: error };

            const nextAudio = currentAudioUrl();
            if (nextAudio && nextAudio !== previousAudioUrl) {
                return { state: 'new-audio', audioUrl: nextAudio };
            }

            const input = document.querySelector(SELECTORS.audioInput);
            const verify = document.querySelector(SELECTORS.verifyButton);
            if ((!input || !visible(input)) && (!verify || !visible(verify))) {
                return { state: 'accepted' };
            }

            await delay(180);
        }
        return { state: 'timeout' };
    }

    async function reloadAudio(previousAudioUrl) {
        const button = document.querySelector(SELECTORS.reloadButton);
        if (!button || !visible(button) || button.disabled) return '';

        setStatus('Requesting another audio clip');
        await delay(jitter(350, 650));
        button.click();

        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) {
            const next = currentAudioUrl();
            if (next && next !== previousAudioUrl) return next;
            await delay(120);
        }
        return '';
    }

    async function solveChallengeFrame() {
        if (solving || !await activationIsValid()) return;
        solving = true;

        try {
            setStatus('Audio solver active');

            const blocked = blockedMessage();
            if (blocked) {
                setStatus('Google disabled audio challenges', { error: true });
                return;
            }

            let audioUrl = currentAudioUrl();
            if (!audioUrl) {
                const audioModeButton = await waitFor(SELECTORS.audioModeButton, 10000);
                if (!audioModeButton) {
                    setStatus('Audio-mode button not found', { error: true });
                    return;
                }

                setStatus('Switching to audio challenge');
                await delay(jitter(350, 700));
                audioModeButton.click();
            }

            audioUrl = audioUrl || await waitForAudioUrl(SOURCE_TIMEOUT_MS);
            if (!audioUrl) {
                const playVisible = visible(document.querySelector(SELECTORS.playButton));
                setStatus(
                    playVisible
                        ? 'No audio URL exposed before PLAY (iOS layout)'
                        : 'Audio source URL not found',
                    { error: true }
                );
                return;
            }

            for (let attempt = 1; attempt <= MAX_AUDIO_ATTEMPTS; attempt++) {
                const blockedNow = blockedMessage();
                if (blockedNow) {
                    setStatus('Google disabled further audio attempts', { error: true });
                    return;
                }

                try {
                    setStatus('Solving audio ' + attempt + '/' + MAX_AUDIO_ATTEMPTS);
                    const transcript = await transcribe(audioUrl);
                    const input = await waitFor(SELECTORS.audioInput, 4000);
                    const verify = document.querySelector(SELECTORS.verifyButton);
                    if (!input || !verify || !visible(verify)) {
                        throw new Error('audio answer controls not available');
                    }

                    setInputValue(input, transcript);
                    setStatus('Submitting answer');
                    await delay(jitter(300, 600));
                    verify.click();

                    const outcome = await waitForVerificationOutcome(audioUrl);
                    if (outcome.state === 'accepted') {
                        setStatus('Solved', { autoHide: true });
                        return;
                    }
                    if (outcome.state === 'blocked') {
                        setStatus('Google blocked further audio attempts', { error: true });
                        return;
                    }
                    if (outcome.state === 'new-audio') {
                        audioUrl = outcome.audioUrl;
                        continue;
                    }

                    warn('Verification outcome:', outcome.state, outcome.message || '');
                    setStatus('Answer rejected; retrying');
                } catch (error) {
                    warn('Solve attempt failed:', error);
                    setStatus('Attempt failed: ' + (error.message || error), { error: true });
                }

                if (attempt >= MAX_AUDIO_ATTEMPTS) break;
                const nextAudio = await reloadAudio(audioUrl);
                if (!nextAudio) {
                    setStatus('Could not load another audio clip', { error: true });
                    break;
                }
                audioUrl = nextAudio;
            }

            setStatus('Stopped after bounded retries', { error: true });
        } finally {
            solving = false;
        }
    }

    async function handleAnchorFrame() {
        if (!await activationIsValid()) return;
        const anchor = await waitFor(SELECTORS.anchor, 8000);
        if (!anchor) return;

        const clearIfSolved = async () => {
            if (anchor.getAttribute('aria-checked') === 'true') {
                await clearSorrySession();
                return true;
            }
            return false;
        };

        if (await clearIfSolved()) return;

        const observer = new MutationObserver(() => {
            clearIfSolved().then(solved => {
                if (solved) observer.disconnect();
            });
        });
        observer.observe(anchor, { attributes: true, attributeFilter: ['aria-checked'] });

        if (visible(anchor) && anchor.getAttribute('aria-checked') !== 'true') {
            await delay(jitter(250, 550));
            anchor.click();
        }
    }

    if (isGoogleSorryPage()) {
        activateSorrySession();
        return;
    }

    if (!isRecaptchaFrame()) return;

    onDomReady(() => {
        const path = location.pathname;
        if (path.includes('/anchor')) {
            handleAnchorFrame().catch(error => warn('Anchor handler failed:', error));
        } else if (path.includes('/bframe')) {
            solveChallengeFrame().catch(error => {
                setStatus('Solver crashed: ' + (error.message || error), { error: true });
            });
        }
    });
})();
