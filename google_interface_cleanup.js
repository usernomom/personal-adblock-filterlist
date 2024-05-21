// ==UserScript==
// @name         Google interface cleanup
// @version      57
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_interface_cleanup.js
// @require      http://ajax.googleapis.com/ajax/libs/jquery/1.7.2/jquery.min.js
// @require      https://gist.github.com/raw/2625891/waitForKeyElements.js
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search
// @run-at       document-start
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
    "jns.org"
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
    'Perspectives'
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
    let annoyances2 = annoyances.filter(a => a != 'Videos')

    let matchingAnnoyances =
        annoyances2
        .filter(annoyance => div.innerHTML.indexOf(annoyance) != -1)
        .flatMap(a => {
            let k = getbyXpath(`.//div[text()='${a}']|//span[text()='${a}']`, div)
            // console.log(a, k)
            return k
        })
    // .filter(node => !isHidden(node));

    let MjjYud = document.querySelectorAll('#rso div.MjjYud')

    if (MjjYud.length > 2) {
        if (matchingAnnoyances.length > 0) {
            div.style.display = 'none'
        }
    } else {
        matchingAnnoyances.forEach(matchingAnnoyance => {
            if (matchingAnnoyance && !isHidden(matchingAnnoyance)) {
                console.log(div, matchingAnnoyance)

                let jsdata = matchingAnnoyance.closest('div[jsdata]')

                if (jsdata && !(jsdata.closest('#appbar'))) {
                    jsdata.style.display = 'none';
                }
            }
        });
    }

    if (div.innerHTML.indexOf('Videos') != -1) {
        // Videos requires special treatment
        let videosAnnoyances = getbyXpath(`.//div[text()='Videos']|//span[text()='Videos']`, div)

        videosAnnoyances.forEach(videosAnnoyance => {
            if (videosAnnoyance && !isHidden(videosAnnoyance)) {
                let datavt = videosAnnoyance.closest('div[data-vt]')

                if (datavt && !(datavt.closest('#appbar'))) {
                    datavt.style.display = 'none';
                } else {
                    let dataart = videosAnnoyance.closest('div[data-art]')

                    if (dataart && !(dataart.closest('#appbar'))) {
                        dataart.style.display = 'none';
                    }
                }
            }
        });
    }

    if (div.querySelector("#iur") !== null) {
        div.style.display = 'none';
    }
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

function otherCrap2(jNode) {
    let div = jNode[0]
    // console.log(div)

    let matchingAnnoyance =
        annoyances
        .filter(annoyance => div.innerHTML.indexOf(annoyance) != -1)
        .flatMap(a => {
            let k = getbyXpath(`.//div[text()='${a}']|//span[text()='${a}']`, div)
            // console.log(a, k)
            return k
        })
        .find(node => !isHidden(node))

    if (matchingAnnoyance) {
        // console.log(div, matchingAnnoyance)

        let hiddenClue = div.querySelector('.U3THc');

        if ((hiddenClue === null)) {
            div.style.display = 'none'
        }
    }

    if (div.querySelector("#iur") !== null) {
        div.style.display = 'none';
    }
}


// waitForKeyElements('g-scrolling-carousel div[jscontroller] a', clickbaitNews)
waitForKeyElements('div[data-init-vis]', clickbaitNews)
waitForKeyElements('div[role="listitem"] a', clickbaitNews)
waitForKeyElements('#kp-wp-tab-overview > div', otherCrap2);
waitForKeyElements('#bres > div', otherCrap2);
waitForKeyElements('#rso div.MjjYud', otherCrap);
waitForKeyElements('#botstuff div.MjjYud', otherCrap);
waitForKeyElements('#iur div[jscontroller]', undesiredElement)
waitForKeyElements('div[data-abe]', undesiredElement);
waitForKeyElements('g-popup', undesiredElement)
waitForKeyElements('div[data-peekaboo]', undesiredElement)
waitForKeyElements('.U3THc', undesiredElement)
waitForKeyElements('body #lb', destroyElement)