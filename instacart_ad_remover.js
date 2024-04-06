// ==UserScript==
// @name     Instacart Ad Remover
// @version  24
// @match    https://*.instacart.ca/*
// @require  http://ajax.googleapis.com/ajax/libs/jquery/1.7.2/jquery.min.js
// @require     https://gist.github.com/raw/2625891/waitForKeyElements.js
// @downloadURL https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/instacart_ad_remover.js
// @grant    GM_addStyle
// ==/UserScript==

unsafeWindow.Element.prototype._attachShadow = unsafeWindow.Element.prototype.attachShadow;
unsafeWindow.Element.prototype.attachShadow = function () {
  return this._attachShadow({
    mode: "open"
  });
};

function isSponsored(elem) {
  if (elem) {
    // var descendentDivs = elem.querySelectorAll('section, div')

    // var sponsored = Array.from(descendentDivs).find(div => div !== null && div.shadowRoot !== null)

    // if (sponsored) {
    //   return true;
    // } else return false;

    const sponsored = elem.querySelector('article[data-cfp-eligible]')

    if (sponsored) {
      return true
    } else return false;

  } else return false
}

function individualItems(jNode) {
  let li = jNode[0].closest('li')

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

function defaultTip(jNode) {
  const spans = jNode[0].querySelectorAll('span');

  const otherBtn = [...spans].filter(span => span.innerHTML == 'Other')[0].closest('button')
  otherBtn.click()

  const tipDiv = document.querySelector('div[aria-label="Say thanks with a tip"]')
  tipDiv.querySelector('#radio-base-option-4').click()

  const otherInput = tipDiv.querySelector('input[placeholder="Other amount"]')
  otherInput.focus();
  
  waitForKeyElements('div[aria-label="Say thanks with a tip"] button:has(span)', function(jNode) {
    const btn = jNode[0]

    if(btn.innerText.includes('Continue')) {
      btn.click()
    }
  })
}

waitForKeyElements('#store-wrapper .e-wqerce div[aria-label="Product"]', blockAdsInSearch);
waitForKeyElements('#store ul li div[aria-label="Product"]', individualItems);
waitForKeyElements('#store-wrapper div[data-testid="async-item-list"]', sponsoredCarousel);
waitForKeyElements('#store-wrapper div[aria-label="item carousel"]', sponsoredCarousel);
waitForKeyElements('#store-wrapper div.e-7nkw5n', sponsoredCarousel);
waitForKeyElements('#store-wrapper .e-ijs5rh', sponsoredCarousel); // Sponsored carousel in search results
waitForKeyElements('#store-wrapper div[data-testid="carousel"]', sponsoredCarousel); // Sponsored carousel when an item is selected
waitForKeyElements('#store .e-1dclc8o', sponsoredCarousel); // Sponsored carousel when an item is selected
waitForKeyElements('#store-wrapper div[data-testid="regimen-section"]', undesiredElement);
waitForKeyElements('#store-wrapper .e-efhdpf', undesiredElement); // Related recipes
waitForKeyElements('#cart-body > div', blockAdsInCart);
waitForKeyElements('#store-wrapper button[data-testid="home-announcement-banner-1"]', homeBanner)
waitForKeyElements('#store-wrapper #home-content-tab-panel div[aria-label="carousel"]', undesiredElement)
waitForKeyElements('#store-wrapper div[aria-label="Treatment Tracker modal"]', undesiredElement) // offer banner at bottom
waitForKeyElements('#store div[aria-label="announcement"]', undesiredElement)
waitForKeyElements('#store-wrapper div[aria-label="Tip Options"]', defaultTip)
