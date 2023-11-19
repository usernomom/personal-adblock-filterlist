// ==UserScript==
// @name         Google interface cleanup
// @version      6
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
    "cp24.com"
]

function otherCrap(jNode) {
    let div = jNode[0]

    if ((div.innerHTML.indexOf('People also ask') != -1) || (div.innerHTML.indexOf('People also search for') != -1) || div.innerHTML.indexOf('Videos') != -1 || div.innerHTML.indexOf('Short videos') != -1) {
        let hiddenClue = div.querySelector('.U3THc');

        if (hiddenClue === null) {
            div.remove();
        }
    }

    if(div.querySelector("#iur") !== null) {
        div.style.display = 'none';
    }
}

function images(jNode) {
    jNode[0].style.display = 'none'
}

function clickbaitNews(jNode) {
    let div = jNode[0]

    let matchingLink = websitesToBlock.find(websiteToBlock => div.querySelector(`a[href*="${websiteToBlock}"]`))
    
    if (matchingLink) {
        div.closest('div[jscontroller]').style.display = 'none';
    }
}

waitForKeyElements('#rso g-scrolling-carousel div[role="list"] > div > div', clickbaitNews)
waitForKeyElements('#kp-wp-tab-overview > div', otherCrap);
waitForKeyElements('#bres > div', otherCrap);
waitForKeyElements('#rso > div', otherCrap)
waitForKeyElements('#iur div[jscontroller]', images)
