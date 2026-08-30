// ==UserScript==
// @name         Walmart.ca — Sold by Walmart only
// @description  Limits listings to Walmart-sold items and streamlines Walmart.ca checkout.
// @license      MIT
// @version      5
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/walmart_sold_by_walmart.js
// @match        https://www.walmart.ca/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const WALMART_FACET = 'retailer_type:Walmart';
  const LISTING_PATH = /^\/(?:en|fr)\/(?:search|browse|shop)(?:\/|$)/i;
  let lastCheckedUrl = '';
  let lastContinueClick = 0;
  let lastCustomClick = 0;

  function normalizeText(value) {
    return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function isVisible(element) {
    return Boolean(element && (
      element.offsetWidth ||
      element.offsetHeight ||
      element.getClientRects().length
    ));
  }

  function enforceWalmartSeller() {
    const currentUrl = window.location.href;

    if (currentUrl === lastCheckedUrl) return;
    lastCheckedUrl = currentUrl;

    const url = new URL(currentUrl);
    if (!LISTING_PATH.test(url.pathname)) return;

    const facets = (url.searchParams.get('facet') || '')
      .split('||')
      .filter(Boolean);

    const sellerFacets = facets.filter((facet) =>
      facet.toLowerCase().startsWith('retailer_type:')
    );

    if (
      sellerFacets.length === 1 &&
      sellerFacets[0].toLowerCase() === WALMART_FACET.toLowerCase()
    ) {
      return;
    }

    const otherFacets = facets.filter(
      (facet) => !facet.toLowerCase().startsWith('retailer_type:')
    );

    url.searchParams.set('facet', [WALMART_FACET, ...otherFacets].join('||'));
    window.location.replace(url.toString());
  }

  function smallestVisibleTextElement(root, expected) {
    const selector = 'h1, h2, h3, h4, [role="heading"], p, span, div';

    return [...root.querySelectorAll(selector)].find((element) => {
      if (!isVisible(element)) return false;
      if (normalizeText(element.textContent) !== expected) return false;

      return ![...element.children].some(
        (child) => isVisible(child) && normalizeText(child.textContent) === expected
      );
    });
  }

  function nearestAncestorWithButton(marker, buttonText) {
    let candidate = marker;

    while (candidate && candidate !== document.body) {
      const button = [...candidate.querySelectorAll('button')].find(
        (item) => isVisible(item) && normalizeText(item.textContent) === buttonText
      );

      if (button) return { container: candidate, button };
      candidate = candidate.parentElement;
    }

    return null;
  }

  function continuePastMissingAnything(root = document) {
    const marker = smallestVisibleTextElement(root, 'missinganything');
    if (!marker) return;

    const match = nearestAncestorWithButton(marker, 'continue');
    if (!match || match.button.disabled) return;

    const now = Date.now();
    if (now - lastContinueClick < 2000) return;
    lastContinueClick = now;

    setTimeout(() => {
      if (match.button.isConnected && isVisible(match.button) && !match.button.disabled) {
        match.button.click();
      }
    }, 100);
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
      // Fall through to the native/React setter below.
    }

    if (Number.parseFloat(input.value) !== Number.parseFloat(value)) {
      setNativeInputValue(input, value);
    }
  }

  function driverTipLabel(root = document) {
    const selector = 'h1, h2, h3, h4, [role="heading"], p, span, div';

    return [...root.querySelectorAll(selector)].find((element) => {
      if (!isVisible(element)) return false;

      const text = (element.textContent || '').trim();
      if (!/^driver tip\s*\(optional\)\s*:/i.test(text)) return false;
      if (text.length > 100) return false;

      return ![...element.children].some((child) =>
        isVisible(child) && /^driver tip\s*\(optional\)\s*:/i.test(
          (child.textContent || '').trim()
        )
      );
    });
  }

  function isCustomTipButton(button) {
    if (!button) return false;

    const text = normalizeText(button.textContent);
    const ariaLabel = normalizeText(button.getAttribute('aria-label'));

    return text.startsWith('custom') || ariaLabel.startsWith('customtip');
  }

  function driverTipContainer(label) {
    let candidate = label;

    while (candidate && candidate !== document.body) {
      const hasCustomInput = Boolean(findTipInput(candidate));
      const hasCustomButton = [...candidate.querySelectorAll('button')].some(
        (button) => isVisible(button) && isCustomTipButton(button)
      );
      const presetCount = [...candidate.querySelectorAll('button')].filter(
        (button) => isVisible(button) && /^\d+%/.test((button.textContent || '').trim())
      ).length;

      if (hasCustomInput || hasCustomButton || presetCount >= 2) return candidate;
      candidate = candidate.parentElement;
    }

    return label.parentElement;
  }

  function visibleTipDialog(root = document) {
    return [...root.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
      .filter(isVisible)
      .find((dialog) => normalizeText(dialog.textContent).includes('tip'));
  }

  function findTipInput(scope) {
    if (!scope) return null;

    const inputs = [...scope.querySelectorAll(
      'input[inputmode="decimal"], input[inputmode="numeric"], ' +
      'input[type="number"], input[type="tel"], input[type="text"]'
    )].filter(isVisible);

    return inputs.find((input) =>
      /tip|custom/i.test([
        input.getAttribute('aria-label'),
        input.getAttribute('placeholder'),
        input.getAttribute('name'),
        input.id
      ].filter(Boolean).join(' '))
    ) || (inputs.length === 1 ? inputs[0] : null);
  }

  function saveTipIfNeeded(scope) {
    if (!scope) return false;

    const saveButton = [...scope.querySelectorAll('button')].find((button) => {
      if (!isVisible(button) || button.disabled) return false;
      const text = normalizeText(button.textContent);
      return ['save', 'savetip', 'apply', 'done', 'confirm'].includes(text);
    });

    if (!saveButton) return false;
    saveButton.click();
    return true;
  }

  function keepDriverTipAtZero(root = document) {
    const label = driverTipLabel(root);
    if (!label) return;

    const container = driverTipContainer(label);
    if (!container) return;

    // Walmart renders the current amount next to the heading rather than inside
    // the heading itself. Read the complete tip section so an already-zero
    // custom tip is recognized and does not get reopened every observer pass.
    if (/\$\s*0(?:\.0{1,2})?\b/.test(container.textContent || '')) return;

    const dialog = visibleTipDialog(root);
    const scope = dialog || container;
    const input = findTipInput(scope);

    if (input) {
      if (Number.parseFloat(input.value) !== 0) {
        setInputValueViaEditing(input, '0');
        input.blur();
        setTimeout(scheduleCheckoutAutomation, 150);
        return;
      }

      saveTipIfNeeded(scope);
      return;
    }

    const customButton = [...container.querySelectorAll('button')].find(
      (button) => isVisible(button) && !button.disabled && isCustomTipButton(button)
    );

    if (!customButton) return;

    const now = Date.now();
    if (now - lastCustomClick < 1000) return;
    lastCustomClick = now;
    customButton.click();
  }

  function runCheckoutAutomation() {
    continuePastMissingAnything();
    keepDriverTipAtZero();
  }

  let checkoutScheduled = false;

  function scheduleCheckoutAutomation() {
    if (checkoutScheduled) return;
    checkoutScheduled = true;

    setTimeout(() => {
      checkoutScheduled = false;
      runCheckoutAutomation();
    }, 50);
  }

  function startCheckoutAutomation() {
    if (!document.documentElement) {
      document.addEventListener('DOMContentLoaded', startCheckoutAutomation, { once: true });
      return;
    }

    const observer = new MutationObserver(scheduleCheckoutAutomation);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleCheckoutAutomation();

    window.addEventListener('pageshow', scheduleCheckoutAutomation);
    window.addEventListener('popstate', scheduleCheckoutAutomation);
    window.setInterval(scheduleCheckoutAutomation, 1000);
  }

  enforceWalmartSeller();
  window.addEventListener('pageshow', enforceWalmartSeller);
  window.addEventListener('popstate', () => setTimeout(enforceWalmartSeller, 0));
  window.setInterval(enforceWalmartSeller, 750);

  startCheckoutAutomation();
})();
