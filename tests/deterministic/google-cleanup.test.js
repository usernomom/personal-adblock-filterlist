const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createHarness,
    hiddenReason,
} = require('../helpers/google-cleanup-harness');

const fixturesDir = path.resolve(__dirname, '..', 'fixtures');

function withRoot(inner, id = 'root') {
    return `<div id="rso"><div id="${id}">${inner}</div></div>`;
}

function queryLink(q, text = q) {
    return `<a href="/search?q=${encodeURIComponent(q)}">${text}</a>`;
}

function externalLink(url = 'https://example.com/article', text = 'Example') {
    return `<a href="${url}">${text}</a>`;
}

function youtubeLink(url = 'https://www.youtube.com/watch?v=test-video', text = 'YouTube video') {
    return `<a href="${url}">${text}</a>`;
}

function newsLink() {
    return '<a href="/search?q=topic&tbm=nws">News</a>';
}

function forumLink(value = '18') {
    return `<a href="/search?q=topic&udm=${value}">Forums</a>`;
}

function assertHidden(document, id, reason) {
    const node = document.getElementById(id);
    assert.ok(node, `fixture node #${id} must exist`);
    assert.equal(
        hiddenReason(node),
        reason,
        `#${id} should be hidden for reason "${reason}", got "${hiddenReason(node)}"`,
    );
    assert.equal(
        node.style.getPropertyValue('display'),
        'none',
        `#${id} should have inline display:none`,
    );
    return node;
}

function assertPreserved(document, id) {
    const node = document.getElementById(id);
    assert.ok(node, `fixture node #${id} must exist`);
    assert.equal(
        hiddenReason(node),
        null,
        `#${id} should remain preserved, got hide reason "${hiddenReason(node)}"`,
    );
    assert.notEqual(
        node.style.getPropertyValue('display'),
        'none',
        `#${id} should not have inline display:none`,
    );
    return node;
}

test('generic-section hides the whole root when the section owns all visible text', () => {
    const h = createHarness({
        html: withRoot('<g-section-with-header id="section">Refine results</g-section-with-header>'),
    });
    assertHidden(h.document, 'root', 'generic-section');
    assert.equal(h.api.stats.reasons['generic-section'], 1);
    h.close();
});

test('generic-section hides only the section when useful sibling content exists', () => {
    const h = createHarness({
        html: withRoot(
            '<g-section-with-header id="section">Refine results</g-section-with-header>' +
            `<div id="useful">${externalLink()}</div>`,
        ),
    });
    assertHidden(h.document, 'section', 'generic-section');
    assertPreserved(h.document, 'root');
    assertPreserved(h.document, 'useful');
    h.close();
});

test('generic-section preserves knowledge-semantic sections', () => {
    const h = createHarness({
        html: withRoot(
            '<g-section-with-header id="section"><div data-kpid="vise:/m/01smm">Columbus</div></g-section-with-header>',
        ),
    });
    assertPreserved(h.document, 'section');
    assertPreserved(h.document, 'root');
    h.close();
});

test('generic-section preserves sections with an actual News route', () => {
    const h = createHarness({
        html: withRoot(`<g-section-with-header id="section">${newsLink()}</g-section-with-header>`),
    });
    assertPreserved(h.document, 'section');
    assertPreserved(h.document, 'root');
    h.close();
});

test('generic-section preserves sections with a forum route', () => {
    const h = createHarness({
        html: withRoot(`<g-section-with-header id="section">${forumLink()}</g-section-with-header>`),
    });
    assertPreserved(h.document, 'section');
    assertPreserved(h.document, 'root');
    h.close();
});

test('recipe cluster is removed', () => {
    const h = createHarness({
        html: withRoot('<div data-attrid="RecipeCluster">Recipes</div>'),
    });
    assertHidden(h.document, 'root', 'recipe-cluster');
    h.close();
});

test('social profile cluster is removed', () => {
    const h = createHarness({
        html: withRoot('<div data-attrid="social media presence">Profiles</div>'),
    });
    assertHidden(h.document, 'root', 'social-profiles');
    h.close();
});

test('product viewer group is removed', () => {
    const h = createHarness({
        html: withRoot('<product-viewer-group>Products</product-viewer-group>'),
    });
    assertHidden(h.document, 'root', 'products');
    h.close();
});

test('non-news cluster is removed when it has no News route', () => {
    const h = createHarness({
        html: withRoot('<div data-news-cluster-id="cluster-1">Mentioned in the news</div>'),
    });
    assertHidden(h.document, 'root', 'non-news-cluster');
    h.close();
});

test('embedded news cluster and its matching title are removed together', () => {
    const h = createHarness({
        html: withRoot(
            '<div id="title" data-attrid="lab/cluster/title/abc">Mentioned in the news</div>' +
            '<div id="content" data-attrid="lab/cluster/content/abc">' +
            '<div data-news-cluster-id="cluster-1">Story</div></div>',
        ),
    });
    assertHidden(h.document, 'content', 'embedded-news-cluster');
    assertHidden(h.document, 'title', 'embedded-news-cluster-title');
    assertPreserved(h.document, 'root');
    const stats = h.api.stats;
    assert.equal(stats.reasons['embedded-news-cluster'], 1);
    assert.equal(stats.reasons['embedded-news-cluster-title'], 1);
    h.close();
});

test('embedded news cluster is preserved when its content has an actual News route', () => {
    const h = createHarness({
        html: withRoot(
            '<div id="content" data-attrid="lab/cluster/content/abc">' +
            `<div data-news-cluster-id="cluster-1">${newsLink()}</div></div>`,
        ),
    });
    assertPreserved(h.document, 'content');
    assertPreserved(h.document, 'root');
    h.close();
});

test('question accordion is removed from structural progressbar/button signals', () => {
    const h = createHarness({
        html: withRoot(
            '<div role="progressbar"></div><div role="progressbar"></div>' +
            '<button>Question 1</button><button>Question 2</button>',
        ),
    });
    assertHidden(h.document, 'root', 'question-accordion');
    h.close();
});

test('question-like module is preserved when it contains a News route', () => {
    const h = createHarness({
        html: withRoot(
            '<div role="progressbar"></div><div role="progressbar"></div>' +
            `<button>Question 1</button><button>Question 2</button>${newsLink()}`,
        ),
    });
    assertPreserved(h.document, 'root');
    h.close();
});

test('image vertical is removed when it has no protected image semantics', () => {
    const h = createHarness({
        html: withRoot('<a href="/search?q=cats&udm=2">Images</a>'),
    });
    assertHidden(h.document, 'root', 'unwanted-vertical');
    h.close();
});

test('image vertical is preserved when it has protected entity/image attrid semantics', () => {
    const h = createHarness({
        html: withRoot(
            '<a href="/search?q=cats&udm=2">Images</a>' +
            '<div data-attrid="entity/images">Useful entity image</div>',
        ),
    });
    assertPreserved(h.document, 'root');
    h.close();
});

test('image vertical with only "images universal" semantics is removed', () => {
    const h = createHarness({
        html: withRoot(
            '<a href="/search?q=cats&udm=2">Images</a>' +
            '<div data-attrid="images universal">Generic images</div>',
        ),
    });
    assertHidden(h.document, 'root', 'unwanted-vertical');
    h.close();
});

test('protected image semantics do not save a root that also links another unwanted vertical', () => {
    const h = createHarness({
        html: withRoot(
            '<a href="/search?q=cats&udm=2">Images</a>' +
            '<a href="/search?q=cats&udm=7">Videos</a>' +
            '<div data-attrid="entity/images">Useful image</div>',
        ),
    });
    assertHidden(h.document, 'root', 'unwanted-vertical');
    h.close();
});

test('non-image unwanted vertical is removed', () => {
    const h = createHarness({
        html: withRoot('<a href="/search?q=cats&udm=7">Videos</a>'),
    });
    assertHidden(h.document, 'root', 'unwanted-vertical');
    h.close();
});

for (const [label, url] of [
    ['youtube.com', 'https://www.youtube.com/watch?v=test-video'],
    ['YouTube subdomain', 'https://m.youtube.com/watch?v=test-video'],
    ['youtu.be', 'https://youtu.be/test-video'],
    ['youtube-nocookie.com', 'https://www.youtube-nocookie.com/embed/test-video'],
]) {
    test(`standalone ${label} result is removed from the All tab`, () => {
        const h = createHarness({
            html: withRoot(youtubeLink(url)),
        });
        assertHidden(h.document, 'root', 'youtube-result');
        assert.equal(h.api.stats.reasons['youtube-result'], 1);
        h.close();
    });
}

for (const [label, path] of [
    ['Google /url?url= wrapper', '/url?url='],
    ['Google /url?q= wrapper', '/url?q='],
    ['Google /goto?url= wrapper', '/goto?url='],
]) {
    test(`${label} to YouTube is removed from the All tab`, () => {
        const target = encodeURIComponent('https://www.youtube.com/watch?v=test-video');
        const h = createHarness({
            html: withRoot(`<a href="${path}${target}">Wrapped YouTube result</a>`),
        });
        assertHidden(h.document, 'root', 'youtube-result');
        h.close();
    });
}

test('realistic YouTube result with an opaque Google tracking link is removed', () => {
    const h = createHarness({
        html: withRoot(
            youtubeLink('https://www.youtube.com/watch?v=Ddu89kmaeTk', 'YouTube · Vacuum Wars') +
            '<a href="/goto?url=CAESYwOpaqueGoogleToken">tracking</a>',
        ),
    });
    assertHidden(h.document, 'root', 'youtube-result');
    h.close();
});

test('mixed external content is preserved when YouTube is only one destination', () => {
    const h = createHarness({
        html: withRoot(
            youtubeLink() +
            externalLink('https://example.com/article', 'Independent article'),
        ),
    });
    assertPreserved(h.document, 'root');
    h.close();
});

test('knowledge/entity content is preserved even when its only external destination is YouTube', () => {
    const h = createHarness({
        html: withRoot(
            `<div data-kpid="vise:/m/entity">Entity</div>${youtubeLink()}`,
        ),
    });
    assertPreserved(h.document, 'root');
    h.close();
});

test('YouTube results are preserved on the explicit Videos tab', () => {
    const h = createHarness({
        url: 'https://www.google.com/search?q=roborock&udm=7',
        html: withRoot(youtubeLink()),
    });
    assertPreserved(h.document, 'root');
    assert.equal(h.api.stats.scans, 0);
    h.close();
});

test('query refinement is removed when it has only Google query links', () => {
    const h = createHarness({
        html: withRoot(queryLink('alpha') + queryLink('beta')),
    });
    assertHidden(h.document, 'root', 'query-refinement');
    h.close();
});

test('ordinary external web result is preserved', () => {
    const h = createHarness({
        html: withRoot(`<h3>Useful result</h3>${externalLink()}`),
    });
    assertPreserved(h.document, 'root');
    h.close();
});

test('external web destination prevents query-refinement hiding even with Google query links', () => {
    const h = createHarness({
        html: withRoot(`${externalLink()}${queryLink('related')}${queryLink('more')}`),
    });
    assertPreserved(h.document, 'root');
    h.close();
});

test('actual News route is preserved', () => {
    const h = createHarness({
        html: withRoot(`<div data-news-cluster-id="cluster">${newsLink()}</div>`),
    });
    assertPreserved(h.document, 'root');
    h.close();
});

test('forum route udm=18 is preserved', () => {
    const h = createHarness({
        html: withRoot(`${forumLink('18')}${queryLink('related')}${queryLink('more')}`),
    });
    assertPreserved(h.document, 'root');
    h.close();
});

test('forum route udm=forums is preserved', () => {
    const h = createHarness({
        html: withRoot(`${forumLink('forums')}${queryLink('related')}${queryLink('more')}`),
    });
    assertPreserved(h.document, 'root');
    h.close();
});

test('forum route shields a root that also contains an unwanted vertical link', () => {
    const h = createHarness({
        html: withRoot(`${forumLink('18')}<a href="/search?q=topic&udm=7">Videos</a>`),
    });
    assertPreserved(h.document, 'root');
    h.close();
});

test('exact Columbus data-kpid regression fixture is preserved', () => {
    const html = fs.readFileSync(path.join(fixturesDir, 'columbus-data-kpid.html'), 'utf8');
    const h = createHarness({ html });
    assertPreserved(h.document, 'columbus-card');
    assert.equal(h.document.getElementById('columbus-card').dataset.kpid, 'vise:/m/01smm');
    h.close();
});

test('nested data-kpid semantics preserve a query-heavy entity root', () => {
    const h = createHarness({
        html: withRoot(
            `<div data-kpid="vise:/m/entity">Entity</div>${queryLink('a')}${queryLink('b')}`,
        ),
    });
    assertPreserved(h.document, 'root');
    h.close();
});

for (const [name, markup] of [
    ['.kp-wholepage', '<div class="kp-wholepage">Entity</div>'],
    ['data-mcpr', '<div data-mcpr="1">Entity</div>'],
    ['data-attrid title', '<div data-attrid="title">Entity title</div>'],
    ['data-attrid subtitle', '<div data-attrid="subtitle">Entity subtitle</div>'],
    ['data-attrid kc:*', '<div data-attrid="kc:/location/location:short description">Fact</div>'],
    ['data-attrid lab/fact/*', '<div data-attrid="lab/fact/population">Population</div>'],
]) {
    test(`${name} knowledge semantics preserve query-heavy content`, () => {
        const h = createHarness({
            html: withRoot(`${markup}${queryLink('a')}${queryLink('b')}`),
        });
        assertPreserved(h.document, 'root');
        h.close();
    });
}

test('Toronto weather/entity regression fixture is preserved', () => {
    const html = fs.readFileSync(path.join(fixturesDir, 'toronto-weather-entity.html'), 'utf8');
    const h = createHarness({ html });
    assertPreserved(h.document, 'toronto-weather-card');
    h.close();
});

test('#bres descendant protection short-circuits classification where applicable', () => {
    const h = createHarness({
        html: withRoot(
            `<div id="bres">${queryLink('a')}${queryLink('b')}</div>`,
        ),
    });
    assertPreserved(h.document, 'root');
    h.close();
});

test('explicit udm page restores prior cleanup hides and skips structural hiding', () => {
    const h = createHarness({
        url: 'https://www.google.com/search?q=test&udm=2',
        html:
            '<div id="rso"><div id="junk" data-google-cleanup-hidden="query-refinement" style="display:none !important">' +
            `${queryLink('a')}${queryLink('b')}</div></div>` +
            '<form action="/search"><div><div id="suggest" jscontroller="abc"></div></div></form>',
    });
    assertPreserved(h.document, 'junk');
    assert.equal(h.document.getElementById('suggest').hasAttribute('jscontroller'), false);
    assert.equal(h.api.stats.scans, 0);
    h.close();
});

test('explicit tbm page restores prior cleanup hides and skips structural hiding', () => {
    const h = createHarness({
        url: 'https://www.google.com/search?q=test&tbm=nws',
        html:
            '<div id="rso"><div id="root" data-google-cleanup-hidden="query-refinement" style="display:none !important">' +
            `${queryLink('a')}${queryLink('b')}</div></div>`,
    });
    assertPreserved(h.document, 'root');
    assert.equal(h.api.stats.scans, 0);
    h.close();
});

test('search suggestion jscontroller is removed on ordinary search pages', () => {
    const h = createHarness({
        html: '<form action="/search"><div><div id="suggest" jscontroller="abc"></div></div></form>',
    });
    assert.equal(h.document.getElementById('suggest').hasAttribute('jscontroller'), false);
    h.close();
});

for (const attrid of [
    'VisualDigestNewsArticleResult',
    'VisualDigestSocialMediaResult',
]) {
    test(`${attrid} hides the smallest nested visual-digest node`, () => {
        const h = createHarness({
            html:
                '<div id="rso"><div id="slot"><div id="keep">Sibling</div>' +
                `<div id="digest" data-attrid="${attrid}">Digest</div></div></div>`,
        });
        assertHidden(h.document, 'digest', 'visual-digest');
        assertPreserved(h.document, 'slot');
        h.close();
    });
}

test('VisualDigestWebResult hides the full slot when the digest owns all slot text', () => {
    const h = createHarness({
        html: '<div id="rso"><div id="slot"><div id="digest" data-attrid="VisualDigestWebResult">Digest</div></div></div>',
    });
    assertHidden(h.document, 'slot', 'visual-digest');
    assertPreserved(h.document, 'digest');
    h.close();
});

test('previously hidden roots remain hidden on later runs without double-counting', () => {
    const h = createHarness({
        html: withRoot(queryLink('a') + queryLink('b')),
    });
    const root = assertHidden(h.document, 'root', 'query-refinement');
    const before = h.api.stats;
    root.style.removeProperty('display');
    h.run();
    assertHidden(h.document, 'root', 'query-refinement');
    const after = h.api.stats;
    assert.equal(after.hidden, before.hidden);
    assert.deepEqual(after.reasons, before.reasons);
    assert.equal(after.scans, before.scans + 1);
    h.close();
});

test('reason accounting is exact across mixed cleanup branches', () => {
    const h = createHarness({
        html:
            '<div id="rso">' +
            '<div id="recipe"><div data-attrid="RecipeCluster">Recipes</div></div>' +
            '<div id="social"><div data-attrid="social media presence">Profiles</div></div>' +
            '<div id="products"><product-viewer-group>Products</product-viewer-group></div>' +
            `<div id="queries">${queryLink('a')}${queryLink('b')}</div>` +
            `<div id="youtube">${youtubeLink()}</div>` +
            '<div id="digest"><div data-attrid="VisualDigestWebResult">Digest</div></div>' +
            '</div>',
    });
    assert.deepEqual(JSON.parse(JSON.stringify(h.api.stats)), {
        scans: 1,
        hidden: 6,
        reasons: {
            'recipe-cluster': 1,
            'social-profiles': 1,
            products: 1,
            'query-refinement': 1,
            'youtube-result': 1,
            'visual-digest': 1,
        },
    });
    h.close();
});

test('cleanup is idempotent across repeated runs', () => {
    const h = createHarness({
        html:
            '<div id="rso">' +
            `<div id="queries">${queryLink('a')}${queryLink('b')}</div>` +
            '<div id="recipe"><div data-attrid="RecipeCluster">Recipes</div></div>' +
            '</div>',
    });
    const initial = h.api.stats;
    h.run();
    h.run();
    const final = h.api.stats;
    assert.equal(final.hidden, initial.hidden);
    assert.deepEqual(final.reasons, initial.reasons);
    assert.equal(final.scans, initial.scans + 2);
    assertHidden(h.document, 'queries', 'query-refinement');
    assertHidden(h.document, 'recipe', 'recipe-cluster');
    h.close();
});

test('async search contexts expose visible slots as result roots', () => {
    const h = createHarness({
        html:
            '<div data-async-type="arc" data-async-rclass="search">' +
            '<div data-async-context="query:test">' +
            '<div id="async-container">' +
            `<div id="async-junk">${queryLink('a')}${queryLink('b')}</div>` +
            `<div id="async-web">${externalLink()}</div>` +
            '</div></div></div>',
    });
    assertHidden(h.document, 'async-junk', 'query-refinement');
    assertPreserved(h.document, 'async-web');
    h.close();
});

test('async container with fewer than two visible children is ignored', () => {
    const h = createHarness({
        html:
            '<div data-async-type="arc" data-async-rclass="search">' +
            '<div data-async-context="query:test">' +
            `<div><div id="lonely">${queryLink('a')}${queryLink('b')}</div></div>` +
            '</div></div>',
    });
    assertPreserved(h.document, 'lonely');
    h.close();
});
