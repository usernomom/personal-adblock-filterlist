# Google News tab: resolving name-only cards without requests

Status: **shelved on 2026-10-30 by the owner's decision.** No userscript or test changed. This file records what the investigation established and the design the owner shelved, so a later attempt starts from it.

## Symptom

Bridge 13.3.5 (`google_news_ublacklist_bridge.user.js`) resolves name-only Google result cards from the page's own data and never requests `/goto` (UB-6). Its header records one accepted limit: on Google's separate News tab (`tbm=nws`) the cards name only the publisher's display name, so cards from unlisted publishers are released unresolved and uBlacklist cannot block them there. The All tab, including its Top stories cards, is unaffected. The owner asked for a solution that just works.

## Conclusions

1. Nothing on a signed-out News-tab page names a card's site. Each card holds the publisher's display name, the headline, a relative time, a thumbnail, a 16 px inline `data:image/png` favicon and an opaque `/goto?url=` link. The page has no `faviconV2` address at all, the card has no `jsdata` entry, and the card's `/goto` token appears in no script. With UB-6 in force, no reading of that page can resolve the card.
2. The same publishers' Top stories cards on the All tab do name the site: the card's data entry carries a `faviconV2?url=<site>` address (what 13.3.5 reads), and the card's favicon `img` carries the same address in `src` or lazily in `data-src`. Bridge 13.3.5 proxied those cards to their sites on the phone (for example `https://pagesix.com/` and `https://www.si.com/`).
3. The publisher display name is identical on both tabs. Seven publishers were seen on both in one session (Page Six, Yahoo, E! News, Castanet, The New York Times, The Times of India, Sports Illustrated) and every name matched word for word.
4. The only request-free solution is therefore a memory that the All tab fills and the News tab reads, keyed by publisher name. Its known miss is a publisher never seen in Top stories on that device. The owner shelved it.

## Facts

### Live observations, 2026-10-30

Phone path (iPhone Safari, regular tab, signed out; Macaque; bridge 13.3.5), three pages captured read-only through the `iphone-safari-toolkit` probe:

- News tab, `q=Taylor+Swift` and `q=weather`: 12 cards each, every one `div[data-news-cluster-id][data-news-doc-id]` wrapping one `a.aJWbwf[href="/goto?url=..."]`. The bridge marked all 24 `data-ub-google-bridge-unresolved="1"` and attached no proxy. Card structure: thumbnail; then `div.MgUUmf` holding a wrapper with the favicon `img.YQ4gaf[width=16][height=16][src^="data:image/png"]` followed by a bare `<span>` with the publisher name; then the headline `div[role=heading][aria-level=3]`; then the time `span[data-ts]`. `faviconV2` occurred 0 times in the page HTML and in every script. No `data-amp-*`, `data-curl`, `data-surl` or `ping` carried a destination. Names seen: People.com, Page Six, Castanet, Yahoo, The New York Times, E! News, The Times of India, Sports Illustrated, NDTV Sports, MoneyWise.com, BBC, Severe Weather Europe, CTV News, CHCH, NOW Toronto, SteinbachOnline, blogTO, The Weather Network, Montreal Gazette, SooToday.com.
- All tab, `q=Taylor+Swift`: 46 `[data-news-cluster-id]` clusters, 283 `/goto` links, `faviconV2` 132 times in the HTML and 89 times in scripts. Of the 20 cards probed, every card's `/goto` token had a `faviconV2?url=` site in the page data (two inline scripts), and the bridge had written `span[data-ub-google-source-proxy="news"] a.UBFage` with that site on each. Card structure: thumbnail; headline `div.eAaXgc` (not a heading element); time `span[data-ts]`; then `div.iDBaYb` holding the favicon `img.XNo5Ab` (8 with a `faviconV2` `src`, 10 with it lazily in `data-src`, 2 inline `data:` images) and, in a sibling subtree, `span.OSrXXb` with the publisher name. Video cards (a "2:06" duration first) show no publisher name.
- Join keys between the tabs: `/goto` tokens differ for the same article (0 shared); `data-news-doc-id` is shared (7 of the first 20 All-tab cards matched a News-tab card); the inline favicon bytes are identical per publisher where both tabs inline them (Page Six), but the All tab inlines only about one favicon in ten.
- No verification or "unusual traffic" page appeared.

Neon path (dedicated profile, signed in; iPhone UA emulation 390x844 and desktop):

- The signed-in profile gets direct hrefs on the News tab too (10, 14 and 10 cards; `ping` repeats the real URL; no `/goto`), so the name-only News layout cannot be reproduced there. Favicons are inline `data:` images; no `faviconV2` on the News tab; All-tab Top stories had 102 `faviconV2` hits. An isolated (signed-out) browser context hung and was abandoned.

### Why persistence was removed before

13.3.0 (6020c4a) learned site names from the "Site · qualifier" line of ordinary results and persisted them under one GM key. 13.3.1 (6c29f1f) restricted learning to card-bound sources, kept it in page memory only, and 13.3.5 deletes the stored key, because a loosely learned pair would persist and misjudge every later page. The shelved design learns only from a news card's own `faviconV2` entry or direct href, which is Google's statement of that card's site, so that failure mode does not return.

### Storage facts

`GM_getValue` and `GM_setValue` are supported by Violentmonkey on the PC and by Macaque on iOS (its App Store listing names them: https://apps.apple.com/us/app/id1595306197); 13.3.0 ran with them on both. The value lives in the script manager's own storage on each device, never syncs, and is unreadable by page scripts.

## Shelved design (owner declined on 2026-10-30)

1. **Publisher name extraction, structural.** For a news card, the name is the first text inside the smallest ancestor of the card's favicon image that holds any text, skipping headings and `[data-ts]`. The favicon image is the 16 px `img` whose `src` or `data-src` is a `data:` URI or a `faviconV2` address. This yields "People.com" on the News tab and "Page Six" on the All tab from the captured markup. (`siteLine()` does not work for Top stories cards: their first text is the headline, which is not in a heading element.)
2. **Learning.** When a news card resolves from a card-bound source (its data entry's `faviconV2` site, or a direct href), store publisher name to registrable domain. A name seen with two domains is tombstoned. Nothing else is learned into persistent memory.
3. **Resolution on the News tab, at first sight, inside the existing quarantine.** A name that is itself a host (People.com, SooToday.com, MoneyWise.com, thecomeback.com) resolves to that origin directly. Otherwise the memory is consulted. A miss releases the card as 13.3.5 does.
4. **Storage.** One GM value named with a schema version, at most 500 entries, oldest dropped. Spec changes: UB-1 gains the two News-tab sources; UB-6 allows this one value.
5. **Tests.** Deterministic cases for name extraction on both layouts, learning, tombstoning, the cap, name-is-host, and News-tab hit and miss. One live case each in the Neon smoke suite and the iPhone batch: open the All tab for a query, then the News tab, and expect the shared publisher to carry a proxy there.

Rejected alternatives: a bundled publisher list (hard-coded, stale within weeks); a favicon-hash key (the All tab rarely inlines the favicon, so it is rarely learnable); a `data-news-doc-id` key (article-level, so it only helps for articles already seen in Top stories); any `/goto` resolution (removed by the owner on 2026-10-29, see `2026-10-29-google-goto-verifying-interstitial.md`).

## Options considered

| Option | Outcome |
|---|---|
| Read the News-tab page harder (data, favicon, AMP, ping, doc id) | Nothing names the site; verified on the phone and in Neon. |
| Persistent publisher-name memory filled by the All tab | Works for every publisher seen in Top stories on that device; shelved by the owner. |
| Name-is-host direct resolution | Free partial win (4 of 20 News-tab names were hosts); part of the shelved design. |
| Bundled publisher list | Rejected: hard-coded and stale. |
| Favicon-hash or doc-id keys | Rejected: rarely learnable, or article-level only. |
| Resolve `/goto` | Out: owner's 2026-10-29 decision. |

## Sources

- Macaque App Store listing (GM API list): https://apps.apple.com/us/app/id1595306197
- Bridge history: 6020c4a (13.3.0, persisted learning), 6c29f1f (13.3.1, page memory only), f25bf57 (13.3.5, accepted News-tab limit)
