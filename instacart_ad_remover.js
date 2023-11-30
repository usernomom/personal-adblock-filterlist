// ==UserScript==
// @name     Instacart Ad Remover
// @version  16
// @match    https://*.instacart.ca/*
// @require  http://ajax.googleapis.com/ajax/libs/jquery/1.7.2/jquery.min.js
// @require      https://gist.github.com/raw/2625891/waitForKeyElements.js
// @downloadURL https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/instacart_ad_remover.js
// @grant    GM_addStyle
// ==/UserScript==

function isSponsored(elem) {
  if (elem) {
    return elem.querySelector('img[alt="Sponsored badge"]') !== null
  } else return false
}

function individualItems(jNode) {
  let li = jNode[0]

  if (isSponsored(li)) {
    let parent = li.parentNode;
    if (parent.tagName == 'DIV') {
      parent.style.display = 'none'
    } else {
      li.style.display = 'none';
    }
  }
}

function sponsoredCarousel(jNode) {
  let div = jNode[0];

  let spans = div.querySelectorAll('span')

  if ([...spans].filter(span => span.innerHTML == ' nsored').length > 0) {
    div.style.display = 'none';
  }
}

function undesiredElement(jNode) {
  jNode[0].style.display = 'none'
}

function blockAdsInSearch() {
  let [head, ...tail] = document.querySelectorAll('#store-wrapper .e-wqerce:not([style*="display:none"]):not([style*="display: none"])')

  if (head) {
    let mainList = head.querySelector('ul')
    let otherLists = tail.map(node => node.querySelectorAll('ul li'))

    otherLists.forEach(itemList => itemList.forEach(item => mainList.append(item)))

    tail.forEach(node => node.style.display = "none")

    mainList.childNodes.forEach(item => {
      if (isSponsored(item)) {
        item.style.display = 'none';
      }
    })
  }
}

function blockAdsInCart(jNode) {
  let div = jNode[0]

  if (div.innerHTML.indexOf('Suggested items') != -1) {
    div.style.display = 'none'
  }
}

function homeBanner(jNode) {
  let carousel = jNode[0].closest('div[aria-label="carousel"]')

  if (carousel) {
    carousel.style.display = "none"
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

function checkoutButton(jNode) {
  if (jNode[0].textContent === "Continue") {
    let continueButton = jNode[0].closest("button")

    continueButton.addEventListener("click", function () {
      let otherAmountRadio = document.querySelector('#store .__reakit-portal input[id="radio-base-option-4"]')
    
      if (otherAmountRadio) {
        otherAmountRadio.click();

        setTimeout(function () {
          let input = document.querySelector('#store .__reakit-portal input[placeholder="Other amount"]')

          if (input) {
            input.value = '0.00';
            input.dispatchEvent(new Event('input', {
              bubbles: true
            }));
          }
        }, 2000);
      }
    });
  }
}

waitForKeyElements('#store-wrapper .e-wqerce div[aria-label="Product"]', blockAdsInSearch);
waitForKeyElements('#store ul li', individualItems);
waitForKeyElements('#store-wrapper div[data-testid="async-item-list"]', sponsoredCarousel);
waitForKeyElements('#store-wrapper div[aria-label="item carousel"]', sponsoredCarousel);
waitForKeyElements('#store-wrapper div.e-7nkw5n', sponsoredCarousel);
waitForKeyElements('#store-wrapper .e-ijs5rh', sponsoredCarousel); // Sponsored carousel in search results
waitForKeyElements('#store-wrapper div[data-testid="carousel"]', sponsoredCarousel); // Sponsored carousel when an item is selected
waitForKeyElements('#store-wrapper div[data-testid="regimen-section"]', undesiredElement);
waitForKeyElements('#store-wrapper .e-efhdpf', undesiredElement); // Related recipes
waitForKeyElements('#cart-body > div', blockAdsInCart);
waitForKeyElements('#store-wrapper button[data-testid="home-announcement-banner-1"]', homeBanner)
waitForKeyElements('#store-wrapper button[aria-disabled="false"] > span[aria-hidden="false"]', checkoutButton)