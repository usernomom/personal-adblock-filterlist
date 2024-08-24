// ==UserScript==
// @name         LinkedIn Hide Non-Connection Posts
// @version      1.0
// @description  Hides all posts on LinkedIn that are not from direct connections
// @author       Me
// @match        https://www.linkedin.com/feed/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

let annoyances = [
    'likes this',
    'celebrates this',
    'finds this funny',
    'Suggested'
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
        let isAnnoyance = annoyances.find(a => p.innerHTML.indexOf(a) != -1)

        if (isAnnoyance) {
            console.log(p)
            // node.style.display = "none"
            node.remove()
        }
    }
}

// function block() {
//     // let isLikedPost = getbyXpath(`.//p[contains(text(), 'likes this')]`, node)

//     // console.log(isLikedPost)

//     let [...posts] = document.querySelectorAll('.feed-container > li')

//     posts.filter(n => !isHidden(n)).forEach(post => {
//         let p = post.querySelector('article[data-id="main-feed-card"] > p')

//         if (p) {
//             let annoyanceMaybe = annoyances.find(a => p.innerHTML.indexOf(a) != -1)

//             if (annoyanceMaybe) {
//                 console.log(annoyanceMaybe, p)
//                 post.remove()
//             }
//         }
//     })

//     // let [...posts2] = document.querySelectorAll('.feed-container > li')

//     // if(posts2.filter(n => !isHidden(n)).length < 2) {
//     //     location.reload()
//     // }

// }

// // Run the function on page load
// window.addEventListener('load', () => {
//     block();
// });

// // Observe DOM changes for dynamically loaded content
// const observer = new MutationObserver(block);
// observer.observe(document.body, {
//     childList: true,
//     subtree: true
// });

// waitForKeyElements('.scaffold-finite-scroll__content > div', block, false)
waitForKeyElements('.feed-container > li', block, false)