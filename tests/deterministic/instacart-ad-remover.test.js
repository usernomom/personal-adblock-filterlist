const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'instacart_ad_remover.user.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');

async function waitFor(predicate, description, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${description}`);
}

function createHarness() {
    const dom = new JSDOM(`<!doctype html>
<html>
<head></head>
<body>
  <main>
    <div role="region" aria-label='Results for "chips"' id="results-region">
      <div id="promo-row">
        <h2>Top Selling Snacks</h2>
        <div>
          <ul id="promo-list">
            <li id="promo-item"><div data-item-card="true">Promo organic item</div></li>
          </ul>
        </div>
      </div>

      <div id="results-heading"><h1>Results for "chips"</h1></div>

      <div id="result-row-1">
        <ul id="result-list-1">
          <li id="organic-1"><div data-item-card="true"><h3>Organic chips one</h3></div></li>
          <li id="sponsored"><div data-item-card="true"><h3>Sponsored chips</h3><ic-nt-tag>Sp onsored</ic-nt-tag></div></li>
        </ul>
      </div>

      <div id="result-row-2">
        <ul id="result-list-2">
          <li id="organic-2"><div data-item-card="true"><h3>Organic chips two</h3></div></li>
        </ul>
      </div>

      <div id="next-section">
        <h2>Dips and salsas</h2>
        <ul id="next-list">
          <li id="next-item"><div data-item-card="true"><h3>Organic salsa</h3></div></li>
        </ul>
      </div>
    </div>
  </main>
</body>
</html>`, {
        url: 'https://sameday.costco.ca/store/costco-canada/s?k=chips',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });

    dom.window.eval(scriptSource);
    return dom;
}

test('search compaction stays inside the actual Results section', async () => {
    const dom = createHarness();
    const { document } = dom.window;

    try {
        await waitFor(
            () => document.getElementById('sponsored').classList.contains('instacart-cleanup-hidden'),
            'sponsored search result to be hidden',
        );

        const promoRow = document.getElementById('promo-row');
        const resultRow1 = document.getElementById('result-row-1');
        const organic1 = document.getElementById('organic-1');
        const organic2 = document.getElementById('organic-2');
        const nextSection = document.getElementById('next-section');
        const nextItem = document.getElementById('next-item');

        assert.equal(
            promoRow.contains(organic1) || promoRow.contains(organic2),
            false,
            'organic search results must not be moved into a promo carousel that precedes the Results heading',
        );
        assert.equal(resultRow1.contains(organic1), true);
        assert.equal(
            resultRow1.contains(organic2),
            true,
            'later search rows should still compact into the first actual search-results row',
        );
        assert.equal(
            nextSection.contains(nextItem),
            true,
            'the following category section must not be folded into search results',
        );
        assert.equal(
            document.getElementById('next-list').classList.contains('instacart-cleanup-hidden'),
            false,
            'the following category product list must remain visible',
        );
    } finally {
        dom.window.close();
    }
});
