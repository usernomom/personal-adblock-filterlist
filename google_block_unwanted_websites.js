// ==UserScript==
// @name         Google search - block unwanted websites
// @description  Block unwanted websites in Google search results
// @version      9
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_block_unwanted_websites.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @run-at       document-end
// ==/UserScript==

const websitesToBlock = [
    "youtube.com"
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