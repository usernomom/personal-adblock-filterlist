// ==UserScript==
// @name         Google interface cleanup
// @match        https://*.google.com/search*
// @match        https://*.google.ca/search*
// @match        https://*.google.fr/search*
// @match        https://*.google.co.uk/search*
// @version      3
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
    "thesun.co.uk"
]

var processed = false;

function otherCrap() {
    function remove(selector) {
        document.querySelectorAll(selector).forEach(div => {
            if ((div.innerHTML.indexOf('People also ask') != -1) || (div.innerHTML.indexOf('People also search for') != -1) || div.innerHTML.indexOf('Videos') != -1 || div.innerHTML.indexOf('Short videos') != -1) {
                let hiddenClue = div.querySelector('.U3THc');

                if (hiddenClue === null) {
                    div.style.display = 'none';
                }
            }
        })
    }

    if (!processed) {
        remove("#kp-wp-tab-overview > div");
        remove("#bres > div");
        remove("#rso > div");
        processed = true;
    }

    document.querySelectorAll('#iur').forEach(div => div.style.display = 'none');
}

function clickbaitNews() {
    let carouselElements = document.querySelectorAll('g-scrolling-carousel div[jscontroller]');

    carouselElements.forEach(carouselElement => {
        websitesToBlock.forEach(websiteToBlock => {
            let matchingLinks = carouselElement.querySelectorAll(`a[href*="${websiteToBlock}"]`)

            if (matchingLinks.length != 0) {
                carouselElement.style.display = 'none';
            }
        })
    })
}

function removeCrap() {
    clickbaitNews();
    otherCrap();
}

// Run the 'removeCrap' function every second
setInterval(removeCrap, 1000);