// ==UserScript==
// @name     Instacart Ad Remover
// @version  5
// @match    https://*.instacart.ca/*
// @require  http://ajax.googleapis.com/ajax/libs/jquery/1.7.2/jquery.min.js
// @require  https://gist.github.com/raw/2625891/waitForKeyElements.js
// @downloadURL https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/instacart_ad_remover.js
// @grant    GM_addStyle
// ==/UserScript==

function isSponsored(elem) {
  return elem.querySelector('img[alt="Sponsored badge"]') !== null
}

function blockAdsInHome() {
  let items = document.querySelectorAll('#store-wrapper .u-noscrollbar > div:not([style*="display:none"]):not([style*="display: none"])')

  items.forEach(item => {
    if (isSponsored(item)) {
      item.style.display = 'none';
    }
  })

  document.querySelectorAll('#store-wrapper div[data-testid="async-item-list"]:not([style*="display:none"]):not([style*="display: none"])').forEach(div => {
    div.style.display = 'none';
  })

  document.querySelectorAll('#store-wrapper div[aria-label="item carousel"]:not([style*="display:none"]):not([style*="display: none"])').forEach(div => {
    let spans = div.querySelectorAll('span')

    if ([...spans].filter(span => span.innerHTML == ' nsored').length > 0) {
      div.style.display = 'none';
    }
  })
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

  document.querySelectorAll('#store-wrapper .e-ijs5rh').forEach(div => {
    div.style.display = 'none';
  })
}

function blockAdsInCart() {
  let cartBodyDivs = document.querySelectorAll('#cart-body > div:not([style*="display:none"]):not([style*="display: none"])')

  cartBodyDivs.forEach(div => {
    console.log(div)
    if (div.innerHTML.indexOf('Suggested items') != -1) {
      div.style.display = 'none'
    }
  })
}

function block() {
  blockAdsInSearch();
  blockAdsInHome();
  blockAdsInCart();
}

waitForKeyElements('div[aria-label="Product"]', block);