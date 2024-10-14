// ==UserScript==
// @name         Google search - Open cross-site links in new tab
// @version      2
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @grant        GM_addStyle
// @grant        window.close
// @require      http://code.jquery.com/jquery-3.4.1.min.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/refs/heads/main/open_links_new_tab.js
// ==/UserScript==

(function () {
    'use strict';

    // Your code here...
})();
var $ = window.jQuery;
$(document).on('click', 'a', function (e) {
    e.preventDefault();
    var url = $(this).attr('href');
    if (!url.startsWith('/')) {
        window.open(url, '_blank');
    }
});