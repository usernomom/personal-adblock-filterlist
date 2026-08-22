// ==UserScript==
// @name         Walmart.ca — Sold by Walmart only
// @description  Automatically limits Walmart.ca search, browse, and shop listings to items sold by Walmart.
// @license      MIT
// @version      1
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

  function enforceWalmartSeller() {
    const currentUrl = window.location.href;

    // Walmart uses client-side navigation in some places. Only re-check when
    // the URL changes, so the periodic fallback has negligible overhead.
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

  enforceWalmartSeller();
  window.addEventListener('pageshow', enforceWalmartSeller);
  window.addEventListener('popstate', () => setTimeout(enforceWalmartSeller, 0));
  window.setInterval(enforceWalmartSeller, 750);
})();
