// ==UserScript==
// @name         Instacart Ad Remover
// @description  Removes sponsored products and placements, compacts search results, and hides cart cross-sells.
// @version      77
// @license      MIT
// @match        https://*.instacart.ca/*
// @match        https://*.instacart.com/*
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/instacart_ad_remover.js
// @run-at       document-start
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  const HIDDEN_CLASS = 'instacart-cleanup-hidden';
  const SPONSORED_TEXTS = new Set([
    'advertisingcontenthere',
    'paidad',
    'anad',
    'advertise',
    'promoted',
    'sponsored',
    'sponsoreed',
    'spaahnserd',
    'spawhnserd',
    'spawnserd',
    'spaunsered',
    'spaunserd',
    'spauncered',
    'spauncerd',
    'spohnserd',
    'spohncerd',
    'spohncered',
    'spawncerd',
    'spawncered'
  ]);

  const cleanupCss = `
    .${HIDDEN_CLASS} {
      display: none !important;
    }
  `;

  function installStyles() {
    if (typeof GM_addStyle === 'function') {
      GM_addStyle(cleanupCss);
      return;
    }

    const target = document.head || document.documentElement;
    if (!target) {
      document.addEventListener('DOMContentLoaded', installStyles, { once: true });
      return;
    }

    const style = document.createElement('style');
    style.textContent = cleanupCss;
    target.append(style);
  }

  installStyles();

  function normalizeText(value) {
    return (value || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  function isSponsoredText(value) {
    const normalized = normalizeText(value);
    return SPONSORED_TEXTS.has(normalized) || normalized.includes('sponsored');
  }

  function imageHasSponsoredSignal(image) {
    return ['alt', 'aria-label', 'title']
      .map((name) => image.getAttribute(name))
      .some(isSponsoredText);
  }

  function elementHasSponsoredSignal(element) {
    if (!element) return false;

    if (
      element.matches?.('[data-cfp-eligible]') ||
      element.querySelector?.('[data-cfp-eligible]')
    ) {
      return true;
    }

    const tags = [
      ...(element.matches?.('ic-nt-tag') ? [element] : []),
      ...(element.querySelectorAll?.('ic-nt-tag') || [])
    ];

    if (tags.some((tag) => isSponsoredText(tag.innerText || tag.textContent))) return true;
    if (isSponsoredText(element.innerText || element.textContent)) return true;

    return [...(element.querySelectorAll?.('img') || [])]
      .some(imageHasSponsoredSignal);
  }

  function isSponsoredLabel(element) {
    if (!element) return false;

    if (element.matches?.('[data-cfp-eligible]')) {
      return elementHasSponsoredSignal(element);
    }

    const text = normalizeText(element.innerText || element.textContent);
    if (!text || text.length > 40 || !isSponsoredText(text)) return false;

    // Keep the smallest node that carries the label. This avoids treating an
    // entire placement as the marker just because it contains "Sponsored".
    return ![...element.children].some((child) => {
      const childText = normalizeText(child.innerText || child.textContent);
      return childText && childText.length <= 40 && isSponsoredText(childText);
    });
  }

  function sponsoredMarkers(root = document) {
    return [...root.querySelectorAll(
      'ic-nt-tag, [data-cfp-eligible], [aria-label*="sponsor" i], ' +
      '[title*="sponsor" i], span, p, small, div'
    )].filter(isSponsoredLabel);
  }

  function hide(element) {
    if (element && !element.classList.contains(HIDDEN_CLASS)) {
      element.classList.add(HIDDEN_CLASS);
    }
  }

  function productCards(root = document) {
    return [...root.querySelectorAll(
      '[data-item-card="true"], div[aria-label="Product"][role="group"]'
    )];
  }

  function productListItem(card) {
    const cardRoot = card.closest('[data-item-card="true"]') || card;
    const listItem = cardRoot.closest('li');

    return listItem || cardRoot;
  }

  function hideSponsoredProducts(root = document) {
    const seen = new Set();

    for (const card of productCards(root)) {
      const cardRoot = card.closest('[data-item-card="true"]') || card;
      if (seen.has(cardRoot)) continue;
      seen.add(cardRoot);

      if (elementHasSponsoredSignal(cardRoot)) {
        hide(productListItem(cardRoot));
      }
    }
  }

  function hideStandalonePlacements(root = document) {
    const markers = sponsoredMarkers(root);

    for (const marker of markers) {
      if (marker.closest('[data-item-card="true"], [aria-label="Product"]')) continue;

      const explicitTarget = marker.closest(
        'article, [data-testid*="placement" i], [data-testid*="sponsor" i]'
      );

      if (explicitTarget) {
        hide(explicitTarget);
        continue;
      }

      // Branded storefront showcases contain a hero image plus real product
      // cards. Because their Sponsored label lives outside those cards, the
      // containing section is the ad and should be removed as one unit.
      let target = marker.parentElement;

      while (
        target &&
        !target.matches('main, [role="main"], body, html')
      ) {
        const isSection = target.matches('section, [role="region"]');
        const hasPlacementContent = Boolean(target.querySelector(
          'img, picture, video, [data-item-card="true"], a[href], button'
        ));

        if (isSection && hasPlacementContent) break;
        target = target.parentElement;
      }

      if (target && !target.matches('main, [role="main"], body, html')) hide(target);
    }

    const legacyPlacements = root.querySelectorAll(
      '#storefront-placements-content article, #store-wrapper article'
    );

    for (const placement of legacyPlacements) {
      if (
        !placement.querySelector('[data-item-card="true"]') &&
        elementHasSponsoredSignal(placement)
      ) {
        hide(placement);
      }
    }
  }

  function isProductList(list) {
    return [...list.children].some((item) =>
      item.tagName === 'LI' && item.querySelector(':scope > [data-item-card="true"]')
    );
  }

  function compactSearchResults(root = document) {
    const resultRegions = [...root.querySelectorAll('[role="region"][aria-label]')]
      .filter((region) => normalizeText(region.getAttribute('aria-label')).startsWith('resultsfor'));

    for (const region of resultRegions) {
      const lists = [...region.querySelectorAll('ul')].filter(isProductList);
      if (!lists.length) continue;

      const primaryList = lists[0];

      for (const list of lists) {
        const items = [...list.children].filter((item) =>
          item.tagName === 'LI' && item.querySelector(':scope > [data-item-card="true"]')
        );

        for (const item of items) {
          if (elementHasSponsoredSignal(item)) {
            hide(item);
          } else if (list !== primaryList) {
            primaryList.append(item);
          }
        }

        if (list !== primaryList) {
          const row = list.parentElement;
          hide(row && row !== region && row.children.length === 1 ? row : list);
        }
      }
    }
  }

  function inCartOrCheckout() {
    return /\/(?:cart|checkout)(?:\/|$)/i.test(location.pathname) ||
      Boolean(document.querySelector('#cart-body'));
  }

  function hideCartCrossSells(root = document) {
    if (!inCartOrCheckout()) return;

    const unwantedHeadings = new Set([
      'suggesteditems',
      'youmayalsolike',
      'recommendedforyou',
      'beforeyougo'
    ]);

    const headings = root.querySelectorAll('h1, h2, h3, h4, [role="heading"]');

    for (const heading of headings) {
      if (!unwantedHeadings.has(normalizeText(heading.textContent))) continue;

      const cartBody = heading.closest('#cart-body');
      let target = heading.closest('section, article, [role="region"]');

      if (!target && cartBody) {
        target = heading;
        while (target.parentElement && target.parentElement !== cartBody) {
          target = target.parentElement;
        }
      }

      hide(target);
    }

    for (const section of root.querySelectorAll('#cart-body > div')) {
      if (normalizeText(section.textContent).includes('suggesteditems')) hide(section);
    }
  }

  // Retain the original script's checkout conveniences. These are deliberately
  // scoped to the same labels used by the old implementation.
  function handleTipOptions(root = document) {
    for (const tipDiv of root.querySelectorAll('div[aria-label="Tip Options"]')) {
      const otherSpan = [...tipDiv.querySelectorAll('span')]
        .find((span) => span.textContent.trim() === 'Other');

      if (otherSpan && !tipDiv.dataset.cleanupOtherClicked) {
        tipDiv.dataset.cleanupOtherClicked = 'true';
        otherSpan.closest('button')?.click();
      }

      const radio = tipDiv.querySelector('#radio-base-option-4');
      const otherInput = tipDiv.querySelector('input[placeholder="Other amount"]');

      if (radio && otherInput && !tipDiv.dataset.cleanupTipSelected) {
        tipDiv.dataset.cleanupTipSelected = 'true';
        radio.click();
        otherInput.focus();
      }

      const continueButton = [...tipDiv.querySelectorAll('button')]
        .find((button) => normalizeText(button.textContent).includes('continue'));

      if (
        continueButton &&
        tipDiv.dataset.cleanupTipSelected &&
        !tipDiv.dataset.cleanupTipContinued
      ) {
        tipDiv.dataset.cleanupTipContinued = 'true';
        continueButton.click();
      }
    }
  }

  function continuePastCheckoutCrossSell(root = document) {
    if (!inCartOrCheckout()) return;

    const buttons = root.querySelectorAll('footer button');

    for (const button of buttons) {
      if (
        normalizeText(button.textContent) === 'continuetocheckout' &&
        !button.dataset.cleanupClicked
      ) {
        button.dataset.cleanupClicked = 'true';
        setTimeout(() => {
          if (button.isConnected && !button.disabled) button.click();
        }, 500);
      }
    }
  }

  let cleanupScheduled = false;

  function runCleanup() {
    cleanupScheduled = false;
    hideSponsoredProducts();
    hideStandalonePlacements();
    compactSearchResults();
    hideCartCrossSells();
    handleTipOptions();
    continuePastCheckoutCrossSell();
  }

  function scheduleCleanup() {
    if (cleanupScheduled) return;
    cleanupScheduled = true;
    setTimeout(runCleanup, 50);
  }

  function start() {
    const observer = new MutationObserver(scheduleCleanup);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleCleanup();

    window.addEventListener('pageshow', scheduleCleanup);
    window.addEventListener('popstate', scheduleCleanup);
    window.setInterval(scheduleCleanup, 1500);
  }

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
