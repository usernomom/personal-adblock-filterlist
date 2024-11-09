// ==UserScript==
// @name         Google search - block unwanted websites
// @description  Block unwanted websites in Google search results
// @version      6
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_block_unwanted_websites.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @run-at       document-end
// ==/UserScript==

const websitesToBlock = [
    "hindustantimes.com",
    "nbcnews.com",
    "abcnews.go.com",
    "thehill.com",
    "bbc.com",
    "bbc.co.uk",
    "globalnews.ca",
    "euronews.com",
    "yahoo.com",
    "rferl.org",
    "forbes.com",
    "nationalpost.com",
    "newsweek.com",
    "fortune.com",
    "torontosun.com",
    "vancouversun.com",
    "foxnews.com",
    "nypost.com",
    "jpost.com",
    "cnn.com",
    "ndtv.com",
    "businessinsider.com",
    "independent.co.uk",
    "financialpost.com",
    "atlanticcouncil.org",
    "timesofindia.indiatimes.com",
    "timesofindia.com",
    "dailymail.co.uk",
    "express.co.uk",
    "gbnews.com",
    "thesun.co.uk",
    "ynetnews.com",
    "cp24.com",
    "ctvnews.ca",
    "iranintl.com",
    "wionews.com",
    "calgaryherald.com",
    "dw.com",
    "almayadeen.net",
    "electronicintifada.net",
    "palestinechronicle.com",
    "presstv.ir",
    "timesofisrael.com",
    "aljazeera.com",
    "arabnews.com",
    "middleeasteye.net",
    "eurasiantimes.com",
    "scmp.com",
    "haaretz.com",
    "aa.com.tr",
    "www.thejc.com",
    "foxbusiness.com",
    "wsj.com",
    "allisrael.com",
    "middleeastmonitor.com",
    "reliefweb.int",
    "israelnationalnews.com",
    "telegraph.co.uk",
    "i24news.tv",
    "kyivpost.com",
    "cnbc.com",
    "youtube.com",
    "twitter.com",
    "jns.org",
    "kyivindependent.com",
    "israelhayom.com",
    "bloomberg.com",
    "themoscowtimes.com",
    "usatoday.com",
    "axios.com",
    "pravda.com.ua",
    "nytimes.com",
    "msn.com",
    "inc.com",
    "voanews.com",
    "newarab.com",
    "cbsnews.com",
    "oilprice.com",
    "entrepreneur.com",
    "firstpost.com",
    "indiatoday.in",
    "msnbc.com",
    "cbc.ca",
    "tiktok.com",
    "amp.theguardian.com"
]

function waitForKeyElements(selectorOrFunction, callback, waitOnce, interval, maxIntervals) {
    if (typeof waitOnce === "undefined") {
        waitOnce = true;
    }
    if (typeof interval === "undefined") {
        interval = 300;
    }
    if (typeof maxIntervals === "undefined") {
        maxIntervals = -1;
    }
    var targetNodes =
        typeof selectorOrFunction === "function" ?
        selectorOrFunction() :
        document.querySelectorAll(selectorOrFunction);

    var targetsFound = targetNodes && targetNodes.length > 0;
    if (targetsFound) {
        targetNodes.forEach(function (targetNode) {
            var attrAlreadyFound = "data-userscript-alreadyFound";
            var alreadyFound = targetNode.getAttribute(attrAlreadyFound) || false;
            if (!alreadyFound) {
                var cancelFound = callback(targetNode);
                if (cancelFound) {
                    targetsFound = false;
                } else {
                    targetNode.setAttribute(attrAlreadyFound, true);
                }
            }
        });
    }

    if (maxIntervals !== 0 && !(targetsFound && waitOnce)) {
        maxIntervals -= 1;
        setTimeout(function () {
            waitForKeyElements(selectorOrFunction, callback, waitOnce, interval, maxIntervals);
        }, interval);
    }
}

function blockWebsites(jNode) {
    let elem = jNode

    let matchingLink = websitesToBlock.find(websiteToBlock => elem.href.indexOf(websiteToBlock) > -1)

    if (matchingLink) {
        let parentElement = elem.closest('.Ww4FFb.vt6azd')

        if (parentElement && parentElement.className == 'Ww4FFb vt6azd') {
            parentElement.style.display = 'none'
        } else {
            elem.closest('div[jscontroller]').style.display = 'none';
        }
    }
}

waitForKeyElements('div[role="listitem"] a', blockWebsites, false, 300, 3)