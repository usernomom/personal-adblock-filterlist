// ==UserScript==
// @name         Instacart Ad Remover
// @description  Removes sponsored products and placements, storefront autoplay banners, compacts search results, and hides cart cross-sells.
// @version      85
// @license      MIT
// @match        https://*.instacart.ca/*
// @match        https://*.instacart.com/*
// @match        https://sameday.costco.ca/*
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/instacart_ad_remover.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const HIDDEN_CLASS = 'instacart-cleanup-hidden';
  const SPONSORED_TEXTS = new Set([
    'advertisingcontenthere',
    'advertisement',
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

    const accessibleLabels = ['alt', 'aria-label', 'title']
      .map((name) => element.getAttribute?.(name))
      .filter(Boolean);

    if (accessibleLabels.some(isSponsoredText)) return true;

    const text = normalizeText(element.innerText || element.textContent);
    if (!text || text.length > 40 || !isSponsoredText(text)) return false;

    return ![...element.children].some((child) => {
      const childText = normalizeText(child.innerText || child.textContent);
      return childText && childText.length <= 40 && isSponsoredText(childText);
    });
  }

  function sponsoredMarkers(root = document) {
    return [...root.querySelectorAll(
      'ic-nt-tag, [data-cfp-eligible], [aria-label*="sponsor" i], ' +
      '[title*="sponsor" i], img[alt*="sponsor" i], span, p, small, div'
    )].filter(isSponsoredLabel);
  }

  function directChildWithin(element, containerOrSelector) {
    const container = typeof containerOrSelector === 'string'
      ? element.closest(containerOrSelector)
      : containerOrSelector;

    if (!container) return null;

    let child = element;
    while (child.parentElement && child.parentElement !== container) {
      child = child.parentElement;
    }

    return child.parentElement === container ? child : null;
  }

  function searchResultRegionFor(element) {
    let candidate = element;

    while (candidate) {
      if (
        candidate.matches?.('[role="region"][aria-label]') &&
        normalizeText(candidate.getAttribute('aria-label')).startsWith('resultsfor')
      ) {
        return candidate;
      }

      candidate = candidate.parentElement;
    }

    return null;
  }

  function inferredPlacementFor(marker) {
    let candidate = marker.parentElement;
    let smallestContentContainer = null;

    while (
      candidate &&
      !candidate.matches('main, [role="main"], body, html')
    ) {
      const hasPlacementContent = Boolean(candidate.querySelector(
        'img, picture, video, a[href], button'
      ));
      const isSemanticBoundary = candidate.matches(
        'section, article, [role="region"]'
      );

      if (!smallestContentContainer && (hasPlacementContent || isSemanticBoundary)) {
        smallestContentContainer = candidate;
      }

      const cardCount = candidate.querySelectorAll('[data-item-card="true"]').length;
      const parentCardCount = candidate.parentElement?.querySelectorAll(
        '[data-item-card="true"]'
      ).length || 0;

      if (cardCount > 0 && parentCardCount > cardCount) return candidate;

      candidate = candidate.parentElement;
    }

    return smallestContentContainer;
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

      const resultRegion = searchResultRegionFor(marker);
      const searchPlacement = directChildWithin(marker, resultRegion);

      if (searchPlacement) {
        hide(searchPlacement);
        continue;
      }

      const unifiedPlacement = directChildWithin(marker, '[data-placements="unified"]');

      if (unifiedPlacement) {
        hide(unifiedPlacement);
        continue;
      }

      const explicitTarget = marker.closest(
        'article, [data-testid*="placement" i], [data-testid*="sponsor" i]'
      );

      if (explicitTarget) {
        hide(explicitTarget);
        continue;
      }

      const inferredTarget = inferredPlacementFor(marker);
      if (inferredTarget) hide(inferredTarget);
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

  function hideAutoplayHero(root = document) {
    const stopButton = root.querySelector(
      '[data-placements="unified"] button[aria-label="Stop animation"]'
    );

    if (!stopButton) return;

    const placement = directChildWithin(stopButton, '[data-placements="unified"]');
    hide(placement);
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

  function isVisible(element) {
    return Boolean(element && (
      element.offsetWidth ||
      element.offsetHeight ||
      element.getClientRects().length
    ));
  }

  function setNativeInputValue(input, value) {
    const view = input.ownerDocument?.defaultView || window;
    const setter = Object.getOwnPropertyDescriptor(
      view.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }

    const InputEventCtor = view.InputEvent || InputEvent;
    const EventCtor = view.Event || Event;

    input.dispatchEvent(new InputEventCtor('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value
    }));
    input.dispatchEvent(new EventCtor('change', { bubbles: true }));
  }

  function setInputValueViaEditing(input, value) {
    input.focus();

    try {
      input.setSelectionRange(0, input.value.length);
    } catch {
      input.select?.();
    }

    try {
      document.execCommand('insertText', false, value);
    } catch {
      // Fall through to the React/native setter path below.
    }

    if (Number.parseFloat(input.value) !== Number.parseFloat(value)) {
      setNativeInputValue(input, value);
    }
  }

  // Keep the checkout tip at zero. Instacart renders the preset buttons in the
  // summary, the custom amount controls in a modal, and a second confirmation
  // modal for a $0 tip, so each state is handled independently and idempotently.
  function handleTipOptions(root = document) {
    const visibleDialogs = [...root.querySelectorAll('[role="dialog"]')]
      .filter(isVisible);

    const zeroTipConfirmation = visibleDialogs.find((dialog) =>
      [...dialog.querySelectorAll('button')].some(
        (button) => normalizeText(button.textContent) === 'continuewithtip'
      )
    );

    if (zeroTipConfirmation) {
      const continueButton = [...zeroTipConfirmation.querySelectorAll('button')]
        .find((button) => normalizeText(button.textContent) === 'continuewithtip');

      if (continueButton && !continueButton.disabled) continueButton.click();
      return;
    }

    const tipDialog = visibleDialogs.find(
      (dialog) =>
        normalizeText(dialog.getAttribute('aria-label')) === 'saythankswithatip'
    );

    if (tipDialog) {
      const otherRadio = tipDialog.querySelector('#radio-base-option-4');

      if (otherRadio && !otherRadio.checked) {
        otherRadio.click();
        return;
      }

      const otherInput = tipDialog.querySelector(
        'input[placeholder="Other amount"], input[type="text"]'
      );

      if (!otherInput) return;

      if (Number.parseFloat(otherInput.value) !== 0) {
        setInputValueViaEditing(otherInput, '0');
        otherInput.blur();
        setTimeout(scheduleCleanup, 150);
        return;
      }

      const saveButton = [...tipDialog.querySelectorAll('button')]
        .find((button) => normalizeText(button.textContent) === 'savetip');

      if (saveButton && !saveButton.disabled) saveButton.click();
      return;
    }

    for (const tipDiv of root.querySelectorAll('div[aria-label="Tip Options"]')) {
      const tipContainer = tipDiv.parentElement;
      const tipHeading = tipContainer
        ? [...tipContainer.querySelectorAll('h3')]
          .find((heading) => normalizeText(heading.textContent) === 'deliverytip')
        : null;
      const tipAmount = tipHeading?.parentElement
        ?.querySelector(':scope > span')
        ?.textContent.trim();

      if (tipAmount === '$0.00') continue;

      const openButton = [...tipDiv.querySelectorAll('button')]
        .find((button) => ['other', 'edit'].includes(normalizeText(button.textContent)));

      if (openButton && !openButton.disabled) {
        openButton.click();
        return;
      }
    }
  }

  function inCheckoutAisle() {
    return /\/checkout_aisle(?:\/|$)/i.test(location.pathname);
  }

  function continuePastCheckoutCrossSell(root = document) {
    if (!inCheckoutAisle()) return;

    const continueButton = [...root.querySelectorAll('button')]
      .find((button) =>
        normalizeText(button.textContent) === 'continuetocheckout' &&
        isVisible(button)
      );

    if (
      !continueButton ||
      continueButton.disabled ||
      continueButton.dataset.cleanupClicked
    ) {
      return;
    }

    continueButton.dataset.cleanupClicked = 'true';
    setTimeout(() => {
      if (
        continueButton.isConnected &&
        !continueButton.disabled &&
        isVisible(continueButton)
      ) {
        continueButton.click();
      }
    }, 250);
  }

  let cleanupScheduled = false;

  function runCleanup() {
    cleanupScheduled = false;
    hideSponsoredProducts();
    hideStandalonePlacements();
    hideAutoplayHero();
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
