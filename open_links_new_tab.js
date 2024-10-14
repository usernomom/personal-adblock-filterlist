// ==UserScript==
// @name         Open All Links in New Tab
// @namespace    http://tampermonkey.net/
// @version      3.5.6
// @author       Firey Chicken
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @grant       GM_addStyle
// @grant        window.close
// @require      http://code.jquery.com/jquery-3.4.1.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Your code here...
})();
var $ = window.jQuery;
$(document).on('click', 'a', function(e){
    e.preventDefault();
    var url = $(this).attr('href');
    window.open(url, '_blank');
});