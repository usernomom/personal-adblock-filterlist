// ==UserScript==
// @name         Instacart Sponsored Placement Probe
// @description  Copies a sanitized structural report for visible Instacart sponsored placements.
// @version      1
// @match        https://*.instacart.ca/*
// @match        https://*.instacart.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_ID = 'instacart-ad-probe-button';
  const PANEL_ID = 'instacart-ad-probe-panel';

  function normalize(value) {
    return (value || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  function isSponsored(value) {
    const text = normalize(value);
    return text.includes('sponsor') || text.includes('promoted') || text === 'paidad';
  }

  function allRoots() {
    const roots = [document];

    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !roots.includes(element.shadowRoot)) {
          roots.push(element.shadowRoot);
        }
      }
    }

    return roots;
  }

  function findMarkers() {
    const markers = [];
    const seen = new Set();

    for (const root of allRoots()) {
      for (const element of root.querySelectorAll('*')) {
        const text = normalize(element.innerText || element.textContent);
        const childHasSignal = [...element.children].some((child) => {
          const childText = normalize(child.innerText || child.textContent);
          return childText.length <= 60 && isSponsored(childText);
        });

        const attributeSignal = [...element.attributes].some((attribute) =>
          isSponsored(attribute.name) || isSponsored(attribute.value)
        );

        let pseudoSignal = false;
        if (!text || text.length > 60) {
          for (const pseudo of ['::before', '::after']) {
            const content = getComputedStyle(element, pseudo).content;
            if (content && content !== 'none' && isSponsored(content)) {
              pseudoSignal = true;
              break;
            }
          }
        }

        const compactTextSignal = text && text.length <= 60 && isSponsored(text) && !childHasSignal;

        if ((compactTextSignal || attributeSignal || pseudoSignal) && !seen.has(element)) {
          seen.add(element);
          markers.push({
            element,
            signal: compactTextSignal ? 'text' : attributeSignal ? 'attribute' : 'pseudo-element'
          });
        }
      }
    }

    return markers;
  }

  function attributesFor(element) {
    const useful = {};

    for (const attribute of element.attributes || []) {
      if (
        attribute.name === 'id' ||
        attribute.name === 'class' ||
        attribute.name === 'role' ||
        attribute.name === 'aria-label' ||
        attribute.name === 'alt' ||
        attribute.name === 'title' ||
        attribute.name.startsWith('data-')
      ) {
        useful[attribute.name] = attribute.value.slice(0, 240);
      }
    }

    return useful;
  }

  function nextAncestor(element) {
    if (element.parentElement) {
      return element.parentElement.matches('main, [role="main"], body, html')
        ? null
        : element.parentElement;
    }
    const root = element.getRootNode();
    return root && root.host ? root.host : null;
  }

  function describeChain(start) {
    const chain = [];
    let element = start;

    for (let depth = 0; element && depth < 12; depth += 1) {
      const rect = element.getBoundingClientRect();
      chain.push({
        depth,
        tag: element.tagName.toLowerCase(),
        attributes: attributesFor(element),
        text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        children: element.children.length,
        images: element.querySelectorAll('img, picture').length,
        productCards: element.querySelectorAll('[data-item-card="true"], [aria-label="Product"]').length,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      });
      element = nextAncestor(element);
    }

    return chain;
  }

  function makeReport() {
    const markers = findMarkers();
    return JSON.stringify({
      page: `${location.origin}${location.pathname}`,
      viewport: { width: innerWidth, height: innerHeight },
      markers: markers.map(({ element, signal }, index) => ({
        index,
        signal,
        chain: describeChain(element)
      }))
    }, null, 2);
  }

  function showReport(report) {
    document.getElementById(PANEL_ID)?.remove();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647', 'background:#fff',
      'padding:16px', 'display:flex', 'flex-direction:column', 'gap:12px'
    ].join(';');

    const status = document.createElement('strong');
    const markerCount = JSON.parse(report).markers.length;
    status.textContent = `${markerCount} marker(s) found. Report copied; paste it into ChatGPT.`;

    const textarea = document.createElement('textarea');
    textarea.value = report;
    textarea.readOnly = true;
    textarea.style.cssText = 'flex:1;width:100%;font:12px monospace;border:1px solid #777;';

    const close = document.createElement('button');
    close.textContent = 'Close probe';
    close.style.cssText = 'padding:12px;font-size:16px;';
    close.addEventListener('click', () => panel.remove());

    panel.append(status, textarea, close);
    document.documentElement.append(panel);
    textarea.select();
  }

  function installButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.textContent = 'Probe Instacart ads';
    button.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:110px', 'z-index:2147483646',
      'padding:10px 12px', 'border:2px solid #fff', 'border-radius:999px',
      'background:#111', 'color:#fff', 'font:600 14px sans-serif'
    ].join(';');

    button.addEventListener('click', () => {
      const report = makeReport();
      if (typeof GM_setClipboard === 'function') GM_setClipboard(report, 'text');
      showReport(report);
    });

    document.documentElement.append(button);
  }

  installButton();
  window.addEventListener('pageshow', installButton);
})();
