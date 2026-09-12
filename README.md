# personal-adblock-filterlist

Personal browser cleanup rules and userscripts.

Stable userscripts include [`google_interface_cleanup.user.js`](https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_interface_cleanup.user.js), [`google_open_results_new_tab.user.js`](https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_open_results_new_tab.user.js), and [`reddit_safari_back_button_fix.user.js`](https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js). Google interface cleanup removes unwanted Google-owned result modules and suppresses unsolicited inline video autoplay. It does not maintain a site/domain blacklist: ordinary destination filtering belongs to uBlacklist, while `google_news_ublacklist_bridge.user.js` exposes Google-obscured destinations without changing their host so uBlacklist can apply that policy. Playback is permitted only for a video associated with the trusted click/key interaction that initiated it, so unrelated taps or scrolling cannot globally unlock autoplay. The Google new-tab script opens recognized Search results through the browser's native new-tab anchor behavior. The Reddit script only intervenes in the short Safari `back_forward` trap, trying to close the tab first and falling forward only if the tab remains alive.

Compatibility note: with the StopTheMadness update observed on 2026-09-08, StopTheMadness must be disabled on Google for the verified Google -> Reddit -> Safari Back workflow. No StopTheMadness-specific workaround is embedded in the userscripts.

Regression and LAN-development documentation: [`tests/README.md`](tests/README.md).
