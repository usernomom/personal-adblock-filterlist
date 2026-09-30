// ==UserScript==
// @name         Clean Up Linkedin Posts
// @namespace    https://thevgergroup.com/
// @version      1.4
// @description  Remove posts containing "Suggested" from the feed
// @author       Patrick O'Leary
// @match        https://www.linkedin.com/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/linkedin-cleanup.user.js
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/linkedin-cleanup.user.js
// ==/UserScript==

/*
 * BEHAVIOUR SPEC - the live-test contract (tests/ios/LIVE_TESTING.md).
 * Each rule is tested exactly as written, by ID; nothing outside it is.
 * Rules change only on the owner's request.
 *
 * LI-1 Suggested posts. On www.linkedin.com, feed posts
 *      (div[data-id^="urn:li:activity:"]) containing a span whose text starts
 *      with "Suggested", "Vorgeschlagen" or "Anzeige" are hidden. Other posts
 *      stay visible. Re-checked on every page change.
 * Test marker: html[data-linkedin-cleanup-version] = @version.
 */

const HIDE = /^(?:Vorgeschlagen|Suggested|Anzeige)/;
const VERSION = '1.4';

(function() {
    'use strict';

    // Function to hide suggested posts
    function hideSuggestedPosts() {
        // Live-install marker for the iPhone harness.
        document.documentElement.setAttribute('data-linkedin-cleanup-version', VERSION);

        // Select all divs that have a data-id attribute starting with "urn:li:activity:"
        const feedItems = document.querySelectorAll('div[data-id^="urn:li:activity:"]');

        feedItems.forEach(feedItem => {
            // Check if any grandchild contains a span with the text "Suggested"
            feedItem.querySelectorAll('span').forEach(spanElement => {
                let text = spanElement.textContent.trim();
                if (text.match(HIDE)) {
                    // Instead of removing, hide the item by setting the display to none
                    feedItem.style.display = 'none';
                }
            })
        });
    }

    // Run the function initially
    hideSuggestedPosts();

    // Run the function when new posts are loaded (using a MutationObserver)
    const observer = new MutationObserver(hideSuggestedPosts);
    observer.observe(document.body, { childList: true, subtree: true });

})();
