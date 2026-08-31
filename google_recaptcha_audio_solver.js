// ==UserScript==
// @name         Google Search reCAPTCHA audio solver
// @namespace    https://github.com/usernomom/personal-adblock-filterlist
// @author       nobody
// @description  Automatically solves Google Search unusual-traffic reCAPTCHA challenges through the audio challenge, with bounded retries and server failover.
// @license      MIT
// @version      1
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
    const ACTIVE_KEY = 'google-sorry-active-v1';
    const PREFERRED_SERVER_KEY = 'google-sorry-transcriber-v1';
    const ACTIVE_TTL_MS = 3 * 60 * 1000;
    const MAX_AUDIO_ATTEMPTS = 3;
    const REQUEST_TIMEOUT_MS = 30000;
    const VERIFY_TIMEOUT_MS = 7000;

    const TRANSCRIBERS = [
        'https://engageub.pythonanywhere.com',
        'https://engageub1.pythonanywhere.com'
    ];

    const SELECTORS = {
        anchor: '#recaptcha-anchor',
        audioButton: '#recaptcha-audio-button',
        audioSource: '#audio-source',
        audioInput: '#audio-response',
        verifyButton: '#recaptcha-verify-button',
        reloadButton: '#recaptcha-reload-button',
        imageChallenge: '#rc-imageselect',
        audioError: '.rc-audiochallenge-error-message',
        blocked: '.rc-doscaptcha-body',
        status: '#recaptcha-accessible-status'
    };

    function log(...args) {
        console.log(TAG, ...args);
    }

    function warn(...args) {
        console.warn(TAG, ...args);
    }

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
            return /(^|\.)google\.(com|ca)$/i.test(ref.hostname) && ref.pathname.startsWith('/sorry/');
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

    function gmRequest(details) {
        return new Promise((resolve, reject) => {
            const request = globalThis.GM && typeof GM.xmlhttpRequest === 'function'
                ? GM.xmlhttpRequest.bind(GM)
                : (globalThis.GM && typeof GM.xmlHttpRequest === 'function'
                    ? GM.xmlHttpRequest.bind(GM)
                    : (typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null));

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
            }, (details.timeout || REQUEST_TIMEOUT_MS) + 2000);

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
            await delay(150);
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

    function currentAudioUrl() {
        const source = document.querySelector(SELECTORS.audioSource);
        if (source && source.src) return source.src;
        const audio = document.querySelector('audio[src]');
        if (audio && audio.src) return audio.src;
        const nested = document.querySelector('audio source[src]');
        return nested && nested.src ? nested.src : '';
    }

    async function waitForAudioUrl(timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const url = currentAudioUrl();
            if (url) return url;
            await delay(150);
        }
        return '';
    }

    function normalizedAudioUrl(rawUrl) {
        try {
            const url = new URL(rawUrl);
            if (url.hostname === 'www.recaptcha.net') {
                url.hostname = 'www.google.com';
            }
            return url.toString();
        } catch (_) {
            return rawUrl.replace('recaptcha.net', 'google.com');
        }
    }

    function normalizeTranscript(text) {
        const normalized = String(text || '').trim().replace(/\s+/g, ' ');
        if (!normalized || normalized === '0') return '';
        if (normalized.length > 100) return '';
        if (/[<>\r\n]/.test(normalized)) return '';
        return normalized;
    }

    async function transcribeWith(server, audioUrl, language) {
        const body = 'input=' + encodeURIComponent(normalizedAudioUrl(audioUrl)) +
            '&lang=' + encodeURIComponent(language || 'en-US');

        const response = await gmRequest({
            method: 'POST',
            url: server,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data: body,
            timeout: REQUEST_TIMEOUT_MS
        });

        if (!response || (response.status && (response.status < 200 || response.status >= 300))) {
            throw new Error('HTTP ' + (response ? response.status : 'unknown'));
        }

        const transcript = normalizeTranscript(response.responseText);
        if (!transcript) throw new Error('invalid transcription response');
        return transcript;
    }

    async function transcribe(audioUrl) {
        const language = document.documentElement.lang || 'en-US';
        const preferred = Math.max(0, Math.min(
            TRANSCRIBERS.length - 1,
            Number(await gmGet(PREFERRED_SERVER_KEY, 0)) || 0
        ));
        const order = [preferred, ...TRANSCRIBERS.map((_, index) => index).filter(index => index !== preferred)];
        let lastError = null;

        for (const index of order) {
            const server = TRANSCRIBERS[index];
            try {
                log('Transcribing with', server);
                const transcript = await transcribeWith(server, audioUrl, language);
                await gmSet(PREFERRED_SERVER_KEY, index);
                return transcript;
            } catch (error) {
                lastError = error;
                warn('Transcriber failed:', server, error.message || error);
            }
        }

        throw lastError || new Error('all transcribers failed');
    }

    function setInputValue(input, value) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
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

            await delay(200);
        }
        return { state: 'timeout' };
    }

    async function reloadAudio() {
        const button = document.querySelector(SELECTORS.reloadButton);
        if (!button || !visible(button) || button.disabled) return false;
        await delay(jitter(300, 650));
        button.click();
        return true;
    }

    async function solveChallengeFrame() {
        if (!await activationIsValid()) return;

        log('Active Google /sorry/ reCAPTCHA frame detected.');

        const blocked = blockedMessage();
        if (blocked) {
            warn('Audio solving unavailable:', blocked);
            return;
        }

        const audioButton = await waitFor(SELECTORS.audioButton, 10000);
        if (!audioButton) {
            warn('Audio challenge button not found.');
            return;
        }

        if (!currentAudioUrl() && visible(audioButton)) {
            await delay(jitter(350, 800));
            audioButton.click();
        }

        let audioUrl = await waitForAudioUrl(10000);
        if (!audioUrl) {
            warn('Audio source did not appear.');
            return;
        }

        for (let attempt = 1; attempt <= MAX_AUDIO_ATTEMPTS; attempt++) {
            const blockedNow = blockedMessage();
            if (blockedNow) {
                warn('Google blocked the audio challenge:', blockedNow);
                return;
            }

            try {
                log('Audio attempt', attempt, 'of', MAX_AUDIO_ATTEMPTS);
                const transcript = await transcribe(audioUrl);
                const input = await waitFor(SELECTORS.audioInput, 3000);
                const verify = document.querySelector(SELECTORS.verifyButton);
                if (!input || !verify || !visible(verify)) {
                    throw new Error('audio response controls not available');
                }

                setInputValue(input, transcript);
                await delay(jitter(250, 550));
                verify.click();

                const outcome = await waitForVerificationOutcome(audioUrl);
                if (outcome.state === 'accepted') {
                    log('Audio challenge accepted.');
                    return;
                }
                if (outcome.state === 'blocked') {
                    warn('Google blocked further audio attempts:', outcome.message);
                    return;
                }
                if (outcome.state === 'new-audio') {
                    audioUrl = outcome.audioUrl;
                    continue;
                }

                warn('Verification did not complete:', outcome.state, outcome.message || '');
            } catch (error) {
                warn('Attempt failed:', error.message || error);
            }

            if (attempt >= MAX_AUDIO_ATTEMPTS) break;

            const oldAudio = audioUrl;
            if (!await reloadAudio()) break;

            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
                const nextAudio = currentAudioUrl();
                if (nextAudio && nextAudio !== oldAudio) {
                    audioUrl = nextAudio;
                    break;
                }
                await delay(150);
            }

            if (audioUrl === oldAudio) {
                warn('Reload did not produce a new audio challenge.');
                break;
            }
        }

        warn('Stopped after bounded retries; leaving the challenge for manual completion.');
    }

    async function handleAnchorFrame() {
        if (!await activationIsValid()) return;
        const anchor = await waitFor(SELECTORS.anchor, 8000);
        if (!anchor) return;

        const clearIfSolved = async () => {
            if (anchor.getAttribute('aria-checked') === 'true') {
                log('reCAPTCHA solved; clearing activation state.');
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
            await delay(jitter(250, 600));
            anchor.click();
            log('Clicked reCAPTCHA checkbox once.');
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
            solveChallengeFrame().catch(error => warn('Challenge handler failed:', error));
        }
    });
})();
