const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'google_interface_cleanup.js');
const source = fs.readFileSync(scriptPath, 'utf8');

function installDomCompatibility(window) {
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
        configurable: true,
        get() {
            return this.textContent || '';
        },
        set(value) {
            this.textContent = value;
        },
    });

    window.HTMLElement.prototype.getClientRects = function getClientRects() {
        if (this.dataset?.testHidden === 'true') return [];
        if (this.style?.getPropertyValue('display') === 'none') return [];
        return [{ width: 1, height: 1 }];
    };
}

function createHarness({
    html = '',
    url = 'https://www.google.com/search?q=regression',
    scriptSource = source,
} = {}) {
    const dom = new JSDOM(
        `<!doctype html><html><head></head><body>${html}</body></html>`,
        {
            url,
            runScripts: 'outside-only',
            pretendToBeVisual: true,
        },
    );

    installDomCompatibility(dom.window);
    const intervals = [];
    dom.window.setInterval = (fn, ms) => {
        intervals.push({ fn, ms });
        return intervals.length;
    };
    dom.window.clearInterval = () => {};

    dom.window.eval(scriptSource);
    const api = dom.window.__GOOGLE_INTERFACE_CLEANUP__;
    if (!api) throw new Error('Userscript did not expose __GOOGLE_INTERFACE_CLEANUP__');

    return {
        dom,
        window: dom.window,
        document: dom.window.document,
        api,
        intervals,
        run: () => api.run(),
        close: () => dom.window.close(),
    };
}

function hiddenReason(node) {
    return node?.dataset?.googleCleanupHidden || null;
}

function isHidden(node) {
    return Boolean(
        node &&
        hiddenReason(node) &&
        node.style.getPropertyValue('display') === 'none'
    );
}

module.exports = {
    repoRoot,
    scriptPath,
    source,
    createHarness,
    hiddenReason,
    isHidden,
};
