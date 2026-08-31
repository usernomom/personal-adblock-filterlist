// ==UserScript==
// @name         Google Search reCAPTCHA audio solver
// @namespace    https://github.com/usernomom/personal-adblock-filterlist
// @author       nobody
// @description  Solves Google Search unusual-traffic reCAPTCHA audio challenges with iOS-safe submission, diagnostics, bounded retries, and transcriber failover.
// @license      MIT
// @version      6
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
    const ACTIVE_KEY = 'google-sorry-active-v6';
    const SERVER_KEY = 'google-sorry-transcriber-v6';
    const TTL = 3 * 60 * 1000;
    const REQUEST_TIMEOUT = 60000;
    const SOURCE_TIMEOUT = 15000;
    const QUICK_SUBMIT_CHECK = 1400;
    const VERIFY_TIMEOUT = 9000;
    const MAX_REJECTIONS = 2;
    const MAX_NO_RECOGNITION_RETRIES = 1;
    const SERVERS = [
        'https://engageub.pythonanywhere.com',
        'https://engageub1.pythonanywhere.com'
    ];
    const S = {
        anchor: '#recaptcha-anchor',
        audioMode: '#recaptcha-audio-button',
        input: 'input#audio-response, textarea#audio-response, input[name="audio-response"], textarea[name="audio-response"], .rc-audiochallenge-response-field input, .rc-audiochallenge-response-field textarea',
        verify: '#recaptcha-verify-button',
        reload: '#recaptcha-reload-button',
        error: '.rc-audiochallenge-error-message',
        blocked: '.rc-doscaptcha-body',
        status: '#recaptcha-accessible-status',
        play: '.rc-audiochallenge-play-button, #audio-source + button, button[aria-label*="PLAY" i]'
    };

    let solving = false;
    let overlay = null;
    const history = [];

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const jitter = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
    const preview = (v, n = 100) => String(v == null ? '' : v)
        .replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

    function visible(el) {
        if (!el) return false;
        const st = getComputedStyle(el), r = el.getBoundingClientRect();
        return st.display !== 'none' && st.visibility !== 'hidden' &&
            Number(st.opacity || 1) !== 0 && r.width > 0 && r.height > 0;
    }

    function log(message, error = false) {
        (error ? console.warn : console.log)(TAG, message);
        history.push((error ? 'ERROR: ' : '') + preview(message, 180));
        while (history.length > 7) history.shift();

        const render = () => {
            if (!overlay || !overlay.isConnected) {
                overlay = document.createElement('div');
                overlay.id = 'google-audio-captcha-status';
                overlay.setAttribute('aria-hidden', 'true');
                Object.assign(overlay.style, {
                    position: 'fixed', left: '6px', top: '6px', zIndex: '2147483647',
                    width: 'calc(100% - 12px)', maxHeight: '106px', overflow: 'hidden',
                    padding: '4px 6px', borderRadius: '4px', color: '#fff',
                    font: '10px/1.25 -apple-system,BlinkMacSystemFont,sans-serif',
                    whiteSpace: 'pre-wrap', pointerEvents: 'none', opacity: '.94',
                    boxSizing: 'border-box'
                });
                (document.body || document.documentElement).appendChild(overlay);
            }
            overlay.textContent = history.join('\n');
            overlay.style.background = error ? 'rgba(110,0,0,.84)' : 'rgba(0,0,0,.78)';
        };
        if (document.readyState === 'loading' && !document.body) {
            document.addEventListener('DOMContentLoaded', render, { once: true });
        } else render();
    }

    function sorryPage() {
        return /(^|\.)google\.(com|ca)$/i.test(location.hostname) && location.pathname.startsWith('/sorry/');
    }
    function recaptchaFrame() {
        return ['www.google.com', 'www.recaptcha.net'].includes(location.hostname) && location.pathname.includes('/recaptcha/');
    }
    function sorryReferrer() {
        try {
            const u = new URL(document.referrer);
            return /(^|\.)google\.(com|ca)$/i.test(u.hostname) && u.pathname.startsWith('/sorry/');
        } catch (_) { return false; }
    }

    async function gmGet(key, fallback) {
        try {
            if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
            if (globalThis.GM && typeof GM.getValue === 'function') return await GM.getValue(key, fallback);
        } catch (_) {}
        return fallback;
    }
    async function gmSet(key, value) {
        try {
            if (typeof GM_setValue === 'function') return void GM_setValue(key, value);
            if (globalThis.GM && typeof GM.setValue === 'function') await GM.setValue(key, value);
        } catch (_) {}
    }
    function gmRequest(details) {
        const fn = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest :
            globalThis.GM && typeof GM.xmlhttpRequest === 'function' ? GM.xmlhttpRequest.bind(GM) :
            globalThis.GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest.bind(GM) : null;
        if (!fn) return Promise.reject(new Error('GM.xmlhttpRequest unavailable'));

        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (cb, v) => { if (!done) { done = true; cb(v); } };
            const timer = setTimeout(() => finish(reject, new Error('GM request watchdog timeout')),
                (details.timeout || REQUEST_TIMEOUT) + 2500);
            fn({
                ...details,
                onload: r => { clearTimeout(timer); finish(resolve, r); },
                onerror: e => { clearTimeout(timer); finish(reject, new Error('GM request error: ' + preview(e))); },
                ontimeout: () => { clearTimeout(timer); finish(reject, new Error('GM request timed out')); },
                onabort: () => { clearTimeout(timer); finish(reject, new Error('GM request aborted')); }
            });
        });
    }

    async function active() {
        if (sorryReferrer()) return true;
        const v = await gmGet(ACTIVE_KEY, null);
        return !!(v && Number.isFinite(v.ts) && Date.now() - v.ts < TTL);
    }

    async function waitFor(selector, timeout, predicate = visible) {
        const until = Date.now() + timeout;
        while (Date.now() < until) {
            const el = document.querySelector(selector);
            if (el && (!predicate || predicate(el))) return el;
            await sleep(120);
        }
        return null;
    }

    function text(selector) {
        const el = document.querySelector(selector);
        return el ? preview(el.textContent || el.innerText || '', 180) : '';
    }
    function blocked() {
        const el = document.querySelector(S.blocked);
        return visible(el) ? text(S.blocked) : '';
    }

    function audioUrls() {
        const out = [];
        const add = raw => {
            if (!raw) return;
            try { raw = new URL(raw, location.href).toString(); } catch (_) {}
            if (/^https:\/\//i.test(raw) && !out.includes(raw)) out.push(raw);
        };
        const root = document.querySelector('#audio-source');
        if (root) { add(root.currentSrc); add(root.src); add(root.getAttribute('src')); }
        document.querySelectorAll('audio').forEach(a => {
            add(a.currentSrc); add(a.src); add(a.getAttribute('src'));
            const source = a.querySelector('source[src]'); if (source) add(source.src);
        });
        document.querySelectorAll('audio source[src],source#audio-source[src]').forEach(e => add(e.src || e.getAttribute('src')));
        document.querySelectorAll('.rc-audiochallenge-tdownload-link a[href],a.rc-audiochallenge-tdownload-link[href]')
            .forEach(e => add(e.href || e.getAttribute('href')));
        return out;
    }
    const audioUrl = () => audioUrls()[0] || '';

    async function waitForAudio(timeout) {
        const until = Date.now() + timeout;
        while (Date.now() < until) {
            const u = audioUrl(); if (u) return u;
            await sleep(120);
        }
        return '';
    }

    function responseText(response) {
        if (!response) return '';
        if (typeof response.responseText === 'string') return response.responseText;
        if (typeof response.response === 'string') return response.response;
        return '';
    }

    function noRecognitionError(message) {
        const e = new Error(message);
        e.code = 'NO_RECOGNITION';
        return e;
    }

    async function transcribeOne(server, url, lang) {
        const name = new URL(server).hostname.split('.')[0];
        log('POST ' + name);
        const r = await gmRequest({
            method: 'POST', url: server,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data: 'input=' + encodeURIComponent(url.replace('recaptcha.net', 'google.com')) +
                '&lang=' + encodeURIComponent(lang || 'en-US'),
            timeout: REQUEST_TIMEOUT
        });
        const raw = responseText(r), status = Number(r && r.status);
        log(name + ' HTTP ' + (Number.isFinite(status) ? status : '?') + ' → "' + preview(raw, 60) + '"');
        if (status && (status < 200 || status >= 300)) throw new Error(name + ' HTTP ' + status);
        const t = preview(raw, 80);
        if (t === '0') throw noRecognitionError(name + ' returned no recognition');
        if (!t || /[<>]/.test(t)) throw new Error(name + ' invalid response: "' + preview(raw, 60) + '"');
        return t;
    }

    async function transcribe(url) {
        const lang = /^en(?:-|$)/i.test(document.documentElement.lang || '') ? document.documentElement.lang : 'en-US';
        const preferred = Math.max(0, Math.min(SERVERS.length - 1, Number(await gmGet(SERVER_KEY, 0)) || 0));
        const order = [preferred, ...SERVERS.map((_, i) => i).filter(i => i !== preferred)];
        const errors = [];
        for (const i of order) {
            try {
                const t = await transcribeOne(SERVERS[i], url, lang);
                await gmSet(SERVER_KEY, i);
                log('Transcript: "' + preview(t, 60) + '"');
                return t;
            } catch (e) { errors.push(e); }
        }
        if (errors.length && errors.every(e => e && e.code === 'NO_RECOGNITION')) {
            throw noRecognitionError(errors.map(e => e.message).join(' | '));
        }
        throw new Error(errors.map(e => e.message || String(e)).join(' | ') || 'all transcribers failed');
    }

    function setAnswer(input, value) {
        if (!input || !('value' in input)) return false;
        input.focus();
        input.value = value;
        try {
            input.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                composed: true,
                inputType: 'insertText',
                data: value
            }));
        } catch (_) {
            input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return input.value === value;
    }

    // Safari userscripts run in an isolated world. In that environment WebKit can
    // reject richer KeyboardEvent init dictionaries (notably a cross-world `view`).
    // KeyboardEvent options are optional, so use the minimal dictionary and never
    // allow a synthetic keyboard-event failure to prevent the ordinary click.
    function dispatchEnter(node) {
        if (!node) throw new Error('activation target missing');
        node.focus();

        const ev = {
            code: 'Enter',
            key: 'Enter',
            bubbles: true,
            composed: true,
            cancelable: true
        };

        for (const type of ['keydown', 'keypress']) {
            try {
                node.dispatchEvent(new KeyboardEvent(type, ev));
            } catch (e) {
                log(type + ' KeyboardEvent skipped: ' + (e && e.message ? e.message : String(e)));
            }
        }

        // This is the actual activation path. It must run even if WebKit rejected
        // one of the synthetic keyboard events above.
        node.click();

        try {
            node.dispatchEvent(new KeyboardEvent('keyup', ev));
        } catch (e) {
            log('keyup KeyboardEvent skipped: ' + (e && e.message ? e.message : String(e)));
        }
    }

    function state() {
        const input = document.querySelector(S.input), verify = document.querySelector(S.verify);
        return {
            audio: audioUrl(), value: input && 'value' in input ? input.value : '',
            inputVisible: visible(input), verifyVisible: visible(verify),
            error: text(S.error), status: text(S.status), blocked: blocked()
        };
    }

    function classify(before) {
        const now = state();
        if (now.blocked) return { state: 'blocked', message: now.blocked };
        if (!now.inputVisible && !now.verifyVisible) return { state: 'accepted' };
        if (now.error && now.error !== before.error) return { state: 'incorrect', message: now.error };
        if (now.audio && now.audio !== before.audio) return { state: 'new-audio', audioUrl: now.audio, message: now.error || now.status };
        if (now.status && now.status !== before.status) {
            if (/verified|success|solved/i.test(now.status)) return { state: 'accepted', message: now.status };
            if (/incorrect|try again|multiple correct|solve more/i.test(now.status)) return { state: 'incorrect', message: now.status };
        }
        if (before.value && !now.value && now.verifyVisible) {
            return { state: 'incorrect', message: now.error || now.status || 'answer consumed but challenge remained' };
        }
        return { state: 'unchanged' };
    }

    async function waitSignal(before, timeout) {
        const until = Date.now() + timeout;
        let r = { state: 'unchanged' };
        while (Date.now() < until) {
            r = classify(before);
            if (r.state !== 'unchanged') return r;
            await sleep(120);
        }
        return r;
    }

    async function submit(input, verify, transcript, currentAudio) {
        const before = state();
        before.value = transcript;
        before.audio = currentAudio;

        log('Submitting with Enter+click');
        dispatchEnter(verify);
        let r = await waitSignal(before, QUICK_SUBMIT_CHECK);
        if (r.state !== 'unchanged') return r;

        log('No effect; trying Enter from answer field');
        dispatchEnter(input);
        return await waitSignal(before, VERIFY_TIMEOUT);
    }

    async function newAudio(previous, reason = 'Requesting fresh audio clip') {
        const button = document.querySelector(S.reload);
        if (!button || !visible(button) || button.disabled) return '';
        log(reason);
        await sleep(jitter(350, 650));
        dispatchEnter(button);
        const until = Date.now() + 7000;
        while (Date.now() < until) {
            const u = audioUrl(); if (u && u !== previous) return u;
            await sleep(120);
        }
        return '';
    }

    async function solveFrame() {
        if (solving || !await active()) return;
        solving = true;
        try {
            log('Solver v6 active');
            if (blocked()) return log('Google disabled audio: ' + blocked(), true);

            let url = audioUrl();
            if (!url) {
                const audioButton = await waitFor(S.audioMode, 10000);
                if (!audioButton) return log('Audio-mode button not found', true);
                log('Switching to audio challenge');
                await sleep(jitter(350, 700));
                audioButton.click();
            }
            url = url || await waitForAudio(SOURCE_TIMEOUT);
            if (!url) return log(visible(document.querySelector(S.play)) ?
                'No audio URL exposed before PLAY' : 'Audio source URL not found', true);

            let rejections = 0;
            let noRecognitionRetries = 0;
            while (rejections < MAX_REJECTIONS) {
                let transcript;
                try {
                    transcript = await transcribe(url);
                } catch (e) {
                    if (e && e.code === 'NO_RECOGNITION' && noRecognitionRetries < MAX_NO_RECOGNITION_RETRIES) {
                        noRecognitionRetries++;
                        const next = await newAudio(url, 'No transcription; requesting one fresh clip');
                        if (!next) return log('No transcription and could not obtain fresh audio', true);
                        url = next;
                        continue;
                    }
                    return log('Transcription failed: ' + (e.message || e), true);
                }

                const input = await waitFor(S.input, 4000);
                const verify = document.querySelector(S.verify);
                if (!input || !verify || !visible(verify)) return log('Answer controls unavailable', true);
                if (!setAnswer(input, transcript)) return log('Could not set answer field', true);

                log('Answer field="' + preview(input.value, 60) + '"');
                await sleep(jitter(250, 450));
                const result = await submit(input, verify, transcript, url);
                log('Submit result: ' + result.state + (result.message ? ' → ' + result.message : ''));

                if (result.state === 'accepted') return log('Solved');
                if (result.state === 'blocked') return log('Google blocked audio: ' + result.message, true);
                if (result.state === 'unchanged') return log('Submission produced no DOM/state change', true);

                rejections++;
                if (rejections >= MAX_REJECTIONS) return log('Stopped after ' + rejections + ' Google rejections', true);
                if (result.state === 'new-audio' && result.audioUrl) { url = result.audioUrl; continue; }
                const next = await newAudio(url, 'Google rejected answer; requesting new clip');
                if (!next) return log('Could not obtain replacement audio', true);
                url = next;
            }
        } finally { solving = false; }
    }

    async function anchorFrame() {
        if (!await active()) return;
        const anchor = await waitFor(S.anchor, 8000);
        if (!anchor) return;
        const clear = async () => {
            if (anchor.getAttribute('aria-checked') === 'true') {
                await gmSet(ACTIVE_KEY, { ts: 0 });
                return true;
            }
            return false;
        };
        if (await clear()) return;
        const obs = new MutationObserver(() => clear().then(ok => { if (ok) obs.disconnect(); }));
        obs.observe(anchor, { attributes: true, attributeFilter: ['aria-checked'] });
        if (visible(anchor) && anchor.getAttribute('aria-checked') !== 'true') {
            await sleep(jitter(250, 550));
            anchor.click();
        }
    }

    if (sorryPage()) {
        gmSet(ACTIVE_KEY, { ts: Date.now(), host: location.hostname });
        return;
    }
    if (!recaptchaFrame()) return;

    const start = () => {
        if (location.pathname.includes('/anchor')) anchorFrame().catch(e => console.warn(TAG, e));
        else if (location.pathname.includes('/bframe')) solveFrame().catch(e => log('Solver crashed: ' + (e.message || e), true));
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();