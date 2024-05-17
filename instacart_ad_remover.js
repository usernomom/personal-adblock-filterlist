// ==UserScript==
// @name     Instacart Ad Remover
// @version  37
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

    const sponsored = elem.querySelector('*[data-cfp-eligible]')

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

function undesiredElement(jNode) {
  jNode[0].style.display = 'none'
}

function blockAdsInSearch() {
  let [head, ...tail] = document.querySelectorAll('#store-wrapper .e-1yrpusx:not([style*="display:none"]):not([style*="display: none"]) > ul')

  if (head) {
    let mainList = head
    let otherLists = tail.map(node => node.querySelectorAll('li'))

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

  const otherSpan = [...spans].filter(span => span.innerHTML == 'Other')[0]

  if (otherSpan) {
    let otherBtn = otherSpan.closest('button')
    otherBtn.click()

    const tipDiv = document.querySelector('div[aria-label="Say thanks with a tip"]')
    tipDiv.querySelector('#radio-base-option-4').click()

    const otherInput = tipDiv.querySelector('input[placeholder="Other amount"]')
    otherInput.focus();

    waitForKeyElements('div[aria-label="Say thanks with a tip"] button:has(span)', function (jNode) {
      const btn = jNode[0]

      if (btn.innerText.includes('Continue')) {
        btn.click()
      }
    })
  }
}

function sponsoredCarousel(jNode) {
  let elem = jNode[0]

  function traverseAncestors(node) {
    if (node) {
      if (node.tagName == 'DIV') {
        // let spans = node.querySelectorAll('span')
        // let sponsoredSpans = [...spans].filter(span => span.innerHTML == ' nsored')
        let imgs = node.querySelectorAll('img')
        let sponsoredImgs = [...imgs].filter(img => img.alt.toLowerCase().trim().startsWith('spon'))
        let individualSponsored = isSponsored(node)
        let scrollbars = node.querySelectorAll('.u-noscrollbar')

        if ((sponsoredImgs.length > 0) && (!individualSponsored) && (scrollbars.length == 1)) {
          node.style.display = 'none';
        } else if (scrollbars.length > 1) {
          return;
        } else {
          traverseAncestors(node.parentNode);
        }
      } else traverseAncestors(node.parentNode)
    }
  }

  traverseAncestors(elem.parentNode)
}

function continueToNext(jNode) {
  let span = jNode[0]

  if (span.innerText === 'Continue to checkout') {
    setTimeout(function () {
      span.closest('button').click();
    }, 500);
  }
}

waitForKeyElements('#store-wrapper div[aria-label="Product"]', blockAdsInSearch);
waitForKeyElements('#store ul li div[aria-label="Product"] a', individualItems);
waitForKeyElements('#store-wrapper div[data-testid="regimen-section"]', undesiredElement);
waitForKeyElements('#store-wrapper .e-efhdpf', undesiredElement); // Related recipes
waitForKeyElements('#cart-body > div', blockAdsInCart);
waitForKeyElements('#store-wrapper button[data-testid="home-announcement-banner-1"]', homeBanner)
waitForKeyElements('#store-wrapper #home-content-tab-panel div[role="region"]', undesiredElement)
waitForKeyElements('#store-wrapper div[aria-label="Treatment Tracker modal"]', undesiredElement) // offer banner at bottom
waitForKeyElements('#store div[aria-label="announcement"]', undesiredElement)
waitForKeyElements('#store-wrapper div[aria-label="Tip Options"]', defaultTip)
waitForKeyElements('#store-wrapper .u-noscrollbar', sponsoredCarousel)
waitForKeyElements('footer span', continueToNext)