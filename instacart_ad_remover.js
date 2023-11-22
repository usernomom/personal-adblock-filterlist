// ==UserScript==
// @name     Instacart Ad Remover
// @version  7
// @match    https://*.instacart.ca/*
// @require  http://ajax.googleapis.com/ajax/libs/jquery/1.7.2/jquery.min.js
// @require  https://gist.github.com/raw/2625891/waitForKeyElements.js
// @downloadURL https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/instacart_ad_remover.js
// @grant    GM_addStyle
// ==/UserScript==

function isSponsored(elem) {
  return elem.querySelector('img[alt="Sponsored badge"]') !== null
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