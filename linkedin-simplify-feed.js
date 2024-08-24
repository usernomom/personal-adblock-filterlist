// ==UserScript==
// @name         LinkedIn Cleanup
// @version      4
// @description  Hides useless annoyances on LinkedIn
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/linkedin-simplify-feed.js
// @author       Me
// @match        https://www.linkedin.com/feed/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

let annoyances = [
    'likes this',
    'celebrates this',
    'finds this funny',
    'Suggested',
    'commented on this'
]

// Where el is the DOM element you'd like to test for visibility
function isHidden(el) {
    if (el === null) {
        return true;
    } else {
        return (el.offsetParent === null)
    }
}

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

function getbyXpath(xpath, contextNode) {
    let results = [];
    let query = document.evaluate(xpath, contextNode || document,
        null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0, length = query.snapshotLength; i < length; ++i) {
        results.push(query.snapshotItem(i));
    }
    return results;
}

function block(node) {
    let p = node.querySelector('article[data-id="main-feed-card"] > p')

    if (p) {
        let annoyanceMaybe = annoyances.find(a => p.innerHTML.indexOf(a) != -1)

        if (annoyanceMaybe) {
            console.log(p)
            node.remove();
        }
    }
}

waitForKeyElements('.feed-container > li', block, false)