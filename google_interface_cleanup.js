// ==UserScript==
// @name         Google interface cleanup
// @version      23
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_interface_cleanup.js
// @require      http://ajax.googleapis.com/ajax/libs/jquery/1.7.2/jquery.min.js
// @require      https://gist.github.com/raw/2625891/waitForKeyElements.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// ==/UserScript==

const websitesToBlock = [
    "timesofisrael.com",
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
    "wionews.com"
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

function otherCrap(jNode) {
    let div = jNode[0]

    let annoyances = [
        'People also ask',
        'People also search for',
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
        'Others searched'
    ]

    let matchingAnnoyance =
        annoyances
        .filter(annoyance => div.innerHTML.indexOf(annoyance) != -1)
        .flatMap(a => getbyXpath(`//div[text()='${a}']|//span[text()='${a}']`, div))
        .find(node => !isHidden(node, div));

    if (matchingAnnoyance) {
        let hiddenClue = div.querySelector('.U3THc');

        if ((hiddenClue === null) && !(div.closest('#appbar'))) {
            div.style.display = 'none';
        }
    }

    if (div.querySelector("#iur") !== null) {
        div.style.display = 'none';
    }
}

function undesiredElement(jNode) {
    jNode[0].style.display = 'none'
}

function clickbaitNews(jNode) {
    let a = jNode[0]

    let matchingLink = websitesToBlock.find(websiteToBlock => a.href.indexOf(websiteToBlock) > -1)

    if (matchingLink) {
        a.closest('div[jscontroller]').style.display = 'none';
    }
}

waitForKeyElements('g-scrolling-carousel div[jscontroller] a', clickbaitNews)
waitForKeyElements('#kp-wp-tab-overview > div', otherCrap);
waitForKeyElements('#bres > div', otherCrap);
waitForKeyElements('#rso div.MjjYud', otherCrap);
waitForKeyElements('div[jsname]', otherCrap)
waitForKeyElements('#iur div[jscontroller]', undesiredElement)