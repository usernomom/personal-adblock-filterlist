# personal-adblock-filterlist

Personal browser cleanup rules and userscripts.

Stable userscripts include [`google_open_results_new_tab.user.js`](https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/google_open_results_new_tab.user.js) and [`reddit_safari_back_button_fix.user.js`](https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js). The Google script opens recognized Search results through the browser's native new-tab anchor behavior. The Reddit script only intervenes in the short Safari `back_forward` trap, trying to close the tab first and falling forward only if the tab remains alive.

Compatibility note: with the StopTheMadness update observed on 2026-09-08, StopTheMadness must be disabled on Google for the verified Google -> Reddit -> Safari Back workflow. No StopTheMadness-specific workaround is embedded in the userscripts.

Regression and LAN-development documentation: [`tests/README.md`](tests/README.md).
