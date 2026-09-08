# personal-adblock-filterlist

Personal browser cleanup rules and userscripts.
Stable userscripts include [`reddit_safari_back_button_fix.user.js`](https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/reddit_safari_back_button_fix.user.js), which tracks Reddit's initial JavaScript-challenge entry and escapes it when Safari later reopens that zombie entry—even when Safari reports the return as a plain `navigate`—while retaining BFCache and same-document traversal handling.

Regression-test documentation: [`tests/README.md`](tests/README.md).
