// ==UserScript==
// @name         Google interface cleanup
// @version      99
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_interface_cleanup.js
// @require      https://cdn.jsdelivr.net/gh/CoeJoder/GM_wrench@v1.5/dist/GM_wrench.min.js
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
    'View on X',
    'Images'
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

function removeJunk(jNode) {
    let div = jNode
    
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

    matchingAnnoyances.forEach(matchingAnnoyance => {
        if (matchingAnnoyance && !isHidden(matchingAnnoyance)) {
            // console.log(div, matchingAnnoyance)
            traverseAncestors(matchingAnnoyance)
        }
    });
}

function undesiredElement(jNode) {
    jNode.style.display = 'none'
}

function destroyElement(jNode) {
    jNode.remove()
}

function clickbaitNews(jNode) {
    let elem = jNode

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

function undesiredElementParent(jNode) {
    let parent = jNode.parentElement;

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
    jNode.parentElement.removeAttribute('jscontroller')
}

GM_wrench.waitForKeyElements('div[data-init-vis]', clickbaitNews, false, 300, 5)
GM_wrench.waitForKeyElements('div[role="listitem"] a', clickbaitNews, false, 300, 5)
GM_wrench.waitForKeyElements('#rso div.MjjYud', removeJunk);
GM_wrench.waitForKeyElements('#botstuff div.MjjYud', removeJunk);
GM_wrench.waitForKeyElements('#iur div[jscontroller]', undesiredElement)
GM_wrench.waitForKeyElements('div[data-abe]', undesiredElement);
GM_wrench.waitForKeyElements('g-popup', undesiredElement)
GM_wrench.waitForKeyElements('div[data-peekaboo]', undesiredElement)
GM_wrench.waitForKeyElements('.U3THc', undesiredElement)
GM_wrench.waitForKeyElements('body #lb', destroyElement)
GM_wrench.waitForKeyElements('.PNZEbe', undesiredElementParent);
GM_wrench.waitForKeyElements('div[data-initq]', undesiredElement)
GM_wrench.waitForKeyElements('div[data-has-close]', undesiredElement)
GM_wrench.waitForKeyElements('textarea[title="Search"]', disableSearchSuggestions)
GM_wrench.waitForKeyElements('#media_result_group', undesiredElement)
GM_wrench.waitForKeyElements('div[data-attrid="VisualDigestFullBleedVideoResult"]', undesiredElement)
GM_wrench.waitForKeyElements('inline-video', undesiredElement)
GM_wrench.waitForKeyElements('product-viewer-group', undesiredElement)
GM_wrench.waitForKeyElements('#iur', undesiredElement)