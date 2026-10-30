# Google `/goto` links and the "Verifying your request" page

Status: **abandoned on 2026-10-29 by the owner's decision.** No userscript, filter or test changed. This file records what the investigation established so a later attempt starts from it.

## Symptom

On iPhone Safari, the owner increasingly saw, after tapping a Google result, a google.com page reading "Verifying your request — You'll be able to continue in a few seconds. Don't refresh this page." with a greyed "Continue" button. The destination loaded 10 to 20 seconds later. The owner asked for the result links to go straight to the real site, replacing Google's `/goto` links if needed.

## Conclusions

1. For signed-out users, Google's mobile result pages no longer contain the real destination of an organic result anywhere the page can read. Each result links to `https://www.google.com/goto?url=CAES…`, whose token is encrypted with a key only Google holds. The only way to learn the destination is to ask Google: the `/goto` redirect itself, or a script request that reads its `Location` header.
2. Signed-in users get direct hrefs (plus a `ping` to `/url`), and a tap navigates straight to the site. The owner never signs in and always searches in Safari Private tabs, so this route is closed.
3. Every userscript fix therefore costs at least one Google request per link. The three variants (resolve on tap, rewrite every link on load, start resolving on touch) were all rejected by the owner. Content-blocker rules cannot do it on iOS (see Facts).
4. The interstitial was not reproduced: 6 taps on the phone and 3 clicks in Neon all reached the destination in under a second. Public sources document the page only on the search request, as part of Google's risk-based anti-bot checks; none ties it to result taps. Its trigger in the owner's setup is unknown.

## Facts

### Google's `/goto` change

- Google confirmed `/goto` result links on 2026-08-26, calling them "technical measures against evolving forms of abuse". Sightings began about 2026-06-23, and the rollout varies by region, account and time.
- The token is base64url protobuf with exactly two fields: field 1 = varint 1, and field 2 = bytes starting `01 eb 3b 30 15` (a version byte and a 4-byte key id, matching Tink's output-prefix format). The rest is ciphertext: in 7 of 8 measured tokens, its length is the destination length plus 59 bytes (plus 60 in the eighth), and no host bytes appear in it. Changing one character returns HTTP 400. The same destination gets different tokens on different pages.
- The `ping` attribute is `/url?sa=t&source=web&rct=j&opi=89978449&url=<same token>`, so it carries nothing extra. `data-ved` is Google's click-tracking id, not a URL.
- Resolution: a cookieless `GET https://www.google.com/goto?url=<token>` that does not follow redirects returns 302 with the destination in `Location`, in about 80 ms (measured from the PC with the iPhone UA, 2026-10-29). Tokens are reusable, both by a second fetch and by tapping a bfcache-restored page about 60 s old. HEAD does not return the target in three independent tests (one vendor reports otherwise). In a page, `fetch(…, {redirect: 'manual'})` returns an opaque response without `Location`. Tampermonkey's `GM_xmlhttpRequest` supports `redirect: 'manual'`; Violentmonkey has no redirect control (issue #2359). Whether Macaque supports it was not tested. The bridge already resolves `/goto` on Macaque by following redirects and reading the final URL.
- Since about 2026-09-09, Google's page data (`W_jd`) no longer holds real URLs for web results (Greasy Fork script 591392's changelog, consistent with the live dumps below).
- AdGuard for iOS does not support `$urltransform`, and `$urlskip` is not in AdGuard's modifier table. uBlock Origin's `urlskip=` does not apply to iOS Safari, and no static filter can decrypt the token anyway.

### Live observations, 2026-10-29

Phone path (iPhone Safari, regular tab, signed out; Macaque, AdGuard Pro, uBlacklist 10.1.2, StopTheMadness Pro and UnTrap active):

- Every organic result was `a.UBFage[href="/goto?url=CAES…"][data-ved][ping="/url?…"]`, wrapping `div[role=heading][aria-level=3]` inside `.Ww4FFb.vt6azd`. The anchors had no `jsaction`, `onclick`, `target` or `rel`, and Google did not rewrite the href on tap. Results added by "More search results" had the same shape. Ads use `/aclk?…`.
- A full search of the page HTML, every inline script, `W_jd`, comments, data attributes and about-this-result payloads (3 page loads, 8 results checked against the true destination, with every common encoding tried) found no exact destination, path prefix or distinctive path segment. Only the host appears, as the displayed citation `span.nC62wb[role=text]` (for example `https://www.canadiantire.ca`), and it is tied to its result only by position in the page. The `W_jd` tokens belong to the Reddit, YouTube and "More from" module cards, not to organic results.
- 6 taps, including a re-tap of a used token from an aged page, all reached the destination by the first poll (about 0.7 s, 1.5 s for an ad). No interstitial, `/sorry` page or captcha appeared.
- Script markers: uBlacklist bridge 13.2.9, Google cleanup 140.0.18, no new-tab marker. The owner confirmed `google_open_results_new_tab.user.js` has been disabled in Macaque for weeks.

Neon path (dedicated profile, signed in):

- With the desktop UA, organic results had direct hrefs. On a mouse click, Google's script switched the href to `/url?sa=t&…`, a 200 page that forwards with `google.navigateTo` within about 0.5 s.
- With full iPhone emulation (Safari UA, a 390 px viewport, touch), the signed-in profile got the same mobile markup as the phone, but with direct hrefs and `ping`. An emulated tap sent the ping in the background and loaded the destination directly, with no Google hop.
- Script markers: bridge 13.2.9, cleanup 140.0.18, no new-tab marker. Why the new-tab script does not run in Violentmonkey was not checked.
- No background `/goto` request was seen, because desktop results have no `/goto` links.

Private tabs: the owner's Macaque has "Allow in Private Browsing" on (owner, 2026-10-29). An earlier toolkit note (2026-09-30) found no Instacart marker in a tab opened from a Private tab. The toolkit can open, probe and tap a Private tab if the owner leaves one in front, but it cannot detect private mode or create a Private tab, and `deploy` needs a regular tab.

### The uBlacklist bridge's own `/goto` traffic

From the code (`google_news_ublacklist_bridge.user.js`, 13.2.9):

- When a single-`/goto` result has no `W_jd` mapping and no displayed URL, the bridge fetches the `/goto` URL about 120 ms after parsing. It uses `GM_xmlhttpRequest` (`anonymous: true`, following redirects, so it also downloads the destination page), with 5 attempts of 2.5 s each and unbounded concurrency for ordinary results. There is no per-page cap, and failures are not remembered.
- The fetch was widened to ordinary mobile results on 2026-09-10 (159b712) and given retries on 2026-09-13 (6be6146).
- Live, on the phone, the bridge's proxies held only the host for 42 of 47 results, taken from the displayed citation. The full-URL proxies (Reddit, Medium, Stack Overflow) can only come from these fetches, about 1 to 3 per page, because those results show a site name instead of a URL citation.
- The owner chose to leave the bridge as is (2026-10-29).

The bridge rewrote result hrefs in v10 (fdfa9ee, 2026-08-31). That was removed in v11 (b3d4b6a, 2026-09-01), with no reason recorded. Its BEHAVIOUR SPEC rule UB-3 now forbids rewriting hrefs.

### The "Verifying your request" page in public sources

- Its exact wording is documented in degoog-org/official-extensions issue #41 (2026-09-19), served to a scraper's search request. Search Engine Roundtable (2026-09-01) describes Google testing a Continue button that enables after a few seconds before results load, as part of its anti-bot effort. Google has made no statement about it.
- Google's "unusual traffic" help page attributes those checks to automated traffic from the network (VPNs, shared networks, malware). heise (2025-06-16) reports Google treating iCloud Private Relay traffic as bots, mainly Safari on Mac; that is unconfirmed for this page. Hacker News users report `/goto` hops stalling for 20 s or more in Firefox, with no identified cause.
- Developers of `/goto` resolvers warn that bulk background resolution can trigger captchas: Greasy Fork 591392 pauses for 5 minutes on a 429 or captcha, and Rob--W/dont-track-me-google issue #68 discusses it. Rob--W's extension (v4.30) resolves one link on hover or interaction; it does not run on Safari.

## Options considered

| Option | Outcome |
|---|---|
| Sign in so Google serves direct links | Ruled out: the owner never signs in and always uses Private tabs |
| Resolve the token on tap and navigate directly (one Google request per tap, outside the tab) | Rejected by the owner |
| Rewrite every result link on load (about 10 to 20 Google requests per page) | Rejected by the owner |
| Start resolving on touch, open on release | Rejected by the owner |
| AdGuard `$urltransform`/`$urlskip`, uBO `urlskip` | Not available on iOS Safari, and cannot decrypt the token |
| Throttle the bridge's retries | Declined: bridge left as is |
| Another search engine | Offered, not chosen |

## Open items if this is revisited

- Capture the interstitial's full URL when it next appears (tap the address bar): `/goto`, `/url`, `/search` or other. This decides whether any link-level change can avoid it.
- Find out whether a script request to `/goto` ever receives the verification page instead of a 302. All of today's anonymous requests got a 302.
- Find out whether Macaque's `GM_xmlhttpRequest` supports `redirect: 'manual'` or exposes the final URL at headers-received, so a resolve can avoid downloading the destination.
- The phone and Neon run bridge 13.2.9 from the unmerged branch `fix/ublacklist-mobile-firewall-fail-closed` (draft PR #5; its live check is toolkit PR #2), while main has 13.2.8.

## Testing hazards found

- Every live search adds Google traffic from the owner's IP, and every phone search also triggers the bridge's background fetches. Keep live probes to a few searches.
- During this investigation, creating an isolated browser context over CDP (`Target.createBrowserContext`) on the Neon automation instance (:9223) coincided with a Neon crash (`exit_type: Crashed`). Neon relaunched with all its pages, according to its session data. The cause is unconfirmed; do not use isolated contexts on that instance.

## Sources

- Search Engine Roundtable, `/goto` confirmed (2026-08-26): https://www.seroundtable.com/google-search-goto-tracking-41957.html
- Search Engine Roundtable, "verifying your request" Continue test (2026-09-01): https://www.seroundtable.com/google-search-verifying-your-request-continue-41985.html
- degoog-org/official-extensions issue #41 (2026-09-19): https://github.com/degoog-org/official-extensions/issues/41
- Rob--W/dont-track-me-google issues #67 and #68: https://github.com/Rob--W/dont-track-me-google/issues/67
- Greasy Fork, Google Search Direct Links (Bypass /goto): https://greasyfork.org/scripts/591392
- Hacker News discussion (2026-09-12): https://news.ycombinator.com/item?id=49668386
- Google, unusual traffic help: https://support.google.com/websearch/answer/86640
- heise, iCloud Private Relay and Google (2025-06-16): https://www.heise.de/en/news/iCloud-Private-Relay-Google-temporarily-blocks-access-from-Apple-devices-10447483.html
- AdGuard filter syntax (modifier support by platform): https://adguard.com/kb/general/ad-filtering/create-own-filters/
- Violentmonkey redirect control, issue #2359: https://github.com/violentmonkey/violentmonkey/issues/2359
