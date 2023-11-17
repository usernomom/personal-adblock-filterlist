// ==UserScript==
// @name         Bypass paywalls by redirecting to archive.is
// @author       nobody
// @description  Bypass paywalls by redirecting to archive.is
// @version      0.0.1
// @include      /^https://www\.wsj\.com/.+$/
// @include      /^https://www\.thestar\.com/.+$/
// @match        https://*.ft.com/content/*
// @match        https://*.bloomberg.com/*/articles/*
// @match        https://*.haaretz.com/*
// @run-at       document-start
// ==/UserScript==

(function() {
    function redirect() {
        location.href = `https://archive.is/newest/${location.href.split('?')[0]}`;
    }

    redirect();
})();