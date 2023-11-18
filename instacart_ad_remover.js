// ==UserScript==
// @name     Instacart Ad Remover
// @version  2
// @match    https://*.instacart.ca/*
// @require  http://ajax.googleapis.com/ajax/libs/jquery/1.7.2/jquery.min.js
// @require  https://gist.github.com/raw/2625891/waitForKeyElements.js
// @grant    GM_addStyle
// ==/UserScript==

function isSponsored(elem) {
  return elem.querySelector('img[alt="Sponsored badge"]') !== null
}

function blockAdsInHome() {
  let items = document.querySelectorAll('#store-wrapper div[data-testid="mobile-ssr-item"]')

  items.forEach(item => {
    if (isSponsored(item)) {
      item.style.display = 'none';
    }
  })
}

function blockAdsInSearch() {
  let [head, ...tail] = document.querySelectorAll('#store-wrapper .e-wqerce')

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

function block() {
  blockAdsInSearch();
  blockAdsInHome();
}

waitForKeyElements('div[aria-label="Product"]', block);