// ==UserScript==
// @name         Google interface cleanup
// @version      91
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_interface_cleanup.js
// @require      http://ajax.googleapis.com/ajax/libs/jquery/1.7.2/jquery.min.js
// @require      https://gist.github.com/raw/2625891/waitForKeyElements.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search
// @run-at       document-idle
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
    "msnbc.com"
]

const annoyances = [
    'People also ask',
    'People also search for',
    'People also search',
    'Videos',
    'Short videos',
    'Refine this search',
    'Search a song',
    'Related searches',
    'Hum to search',
    'Trending videos',
    'For context',
    'Also searched for',
    'Often searched together',
    'Others searched',
    'Local news',
    'Popular on X',
    'People also watch',
    'Events',
    'Profiles',
    'Perspectives',
    'What to watch',
    'Posts on X',
    'Nearby stores',
    'People also buy from',
    'Trending movies',
    'Ticket prices',
    'Mentioned in the news',
    'Visual stories',
    'Latest posts from',
    'View on X'
]

// Where el is the DOM element you'd like to test for visibility
function isHidden(el) {
    if (el === null) {
        return true;
    } else {
        return (el.offsetParent === null)
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

function removeJunkPeriodic() {
    console.log("running...")
    // var MjjYud = document.querySelectorAll('#rso div.MjjYud')

    // MjjYud.forEach(m => removeJunk(m));

    // var MjjYud = document.querySelectorAll('#botstuff div.MjjYud')

    // MjjYud.forEach(m => removeJunk(m));

    // let unwantedSelectors = ['#iur', 'product-viewer-group']
    // unwantedSelectors.map(s => {
    //     [...document.querySelectorAll(s)].map(n => {
    //         n.style.display = 'none';
    //     })
    // })
}

function removeJunkTrigger(jNode) {
    removeJunk(jNode[0])
}

function removeJunk(div) {
    // let annoyances2 = annoyances.filter(a => a != 'Videos')

    let matchingAnnoyances =
        annoyances
        .filter(annoyance => div.innerHTML.indexOf(annoyance) != -1)
        .flatMap(a => {
            let k = getbyXpath(`.//div[starts-with(text(), '${a}')]|//span[starts-with(text(), '${a}')]`, div)
            // console.log(a, k)
            return k
        })
        .filter(node => !isHidden(node));

    // console.log(matchingAnnoyances)

    // if (MjjYud.length > 2) {
    //     // console.log(matchingAnnoyances)
    //     if (matchingAnnoyances.length > 0) {
    //         div.style.display = 'none'
    //     }
    // } else {
        matchingAnnoyances.forEach(matchingAnnoyance => {
            if (matchingAnnoyance && !isHidden(matchingAnnoyance)) {
                // console.log(div, matchingAnnoyance)
                traverseAncestors(matchingAnnoyance)
            }
        });
    // }

    // if (div.innerHTML.indexOf('Videos') != -1) {
    //     // Videos requires special treatment
    //     let videosAnnoyances = getbyXpath(`.//div[text()='Videos']|//span[text()='Videos']`, div)

    //     videosAnnoyances.forEach(videosAnnoyance => {
    //         if (videosAnnoyance && !isHidden(videosAnnoyance)) {
    //             traverseAncestors(videosAnnoyance)
    //         }
    //     });
    // }
}

function undesiredElement(jNode) {
    jNode[0].style.display = 'none'
}

function destroyElement(jNode) {
    jNode[0].remove()
}

function clickbaitNews(jNode) {
    let elem = jNode[0]

    if (elem.tagName == 'A') {
        let matchingLink = websitesToBlock.find(websiteToBlock => elem.href.indexOf(websiteToBlock) > -1)

        if (matchingLink) {
            elem.closest('div[jscontroller]').style.display = 'none';
        }
    } else if (elem.tagName == 'DIV') {
        let a = elem.querySelector('a')

        if (a) {
            let matchingLink = websitesToBlock.find(websiteToBlock => a.href.indexOf(websiteToBlock) > -1)

            if (matchingLink) {
                elem.style.display = 'none';
            }
        }
    }
}

// function otherCrap2(jNode) {
//     let div = jNode[0]
//     // console.log(div)

//     let matchingAnnoyance =
//         annoyances
//         .filter(annoyance => div.innerHTML.indexOf(annoyance) != -1)
//         .flatMap(a => {
//             let k = getbyXpath(`.//div[text()='${a}']|//span[text()='${a}']`, div)
//             // console.log(a, k)
//             return k
//         })
//         .find(node => !isHidden(node))

//     if (matchingAnnoyance) {
//         // console.log(div, matchingAnnoyance)

//         let hiddenClue = div.querySelector('.U3THc');

//         if ((hiddenClue === null)) {
//             div.style.display = 'none'
//         }
//     }

//     if (div.querySelector("#iur") !== null) {
//         div.style.display = 'none';
//     }
// }

function undesiredElementParent(jNode) {
    let parent = jNode[0].parentElement;

    if (parent !== null) {
        parent.style.display = 'none';
    }
}

function traverseAncestors(node) {
    if (node) {
        if (node.tagName == 'DIV') {
            let parentElement = node.parentElement
            let childDivs = [...parentElement.children].filter(c => c.tagName == "DIV")
            // console.log(childDivs)

            if (((childDivs.length > 1) && (node.hasAttribute('jsdata'))) || node.className == 'MjjYud') {
                // console.log(node)
                node.style.display = 'none';
            } else {
                traverseAncestors(node.parentNode);
            }
        } else traverseAncestors(node.parentNode)
    }
}

function disableSearchSuggestions(jNode) {
    jNode[0].parentElement.removeAttribute('jscontroller')
}

// waitForKeyElements('g-scrolling-carousel div[jscontroller] a', clickbaitNews)
waitForKeyElements('div[data-init-vis]', clickbaitNews)
waitForKeyElements('div[role="listitem"] a', clickbaitNews)
// waitForKeyElements('#kp-wp-tab-overview > div', otherCrap2);
// waitForKeyElements('#bres > div', otherCrap2);
waitForKeyElements('#rso div.MjjYud', removeJunkTrigger);
waitForKeyElements('#botstuff div.MjjYud', removeJunkTrigger);
waitForKeyElements('#iur div[jscontroller]', undesiredElement)
waitForKeyElements('div[data-abe]', undesiredElement);
waitForKeyElements('g-popup', undesiredElement)
waitForKeyElements('div[data-peekaboo]', undesiredElement)
waitForKeyElements('.U3THc', undesiredElement)
waitForKeyElements('body #lb', destroyElement)
waitForKeyElements('.PNZEbe', undesiredElementParent);
waitForKeyElements('div[data-initq]', undesiredElement)
waitForKeyElements('div[data-has-close]', undesiredElement)
waitForKeyElements('g-sticky-content', undesiredElement)
waitForKeyElements('span[data-ae]', undesiredElement) // dynamic top suggestion bar
waitForKeyElements('textarea[title="Search"]', disableSearchSuggestions)
waitForKeyElements('div[data-ie]', undesiredElement)
waitForKeyElements('#media_result_group', undesiredElement)
waitForKeyElements('div[data-attrid="VisualDigestFullBleedVideoResult"]', undesiredElement)
waitForKeyElements('inline-video', undesiredElement)
waitForKeyElements('product-viewer-group', undesiredElement)
waitForKeyElements('#iur', undesiredElement)

// setInterval(removeJunkPeriodic, 1000);