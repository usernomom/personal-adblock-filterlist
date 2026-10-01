# Userscript testing

Run the deterministic production-userscript suite with:

~~~powershell
npm ci
npm test
~~~

The jsdom tests in tests/deterministic/ exercise the actual .user.js packages, metadata, and behavior. These tests are useful for fast regressions but do not establish what an installed script does on a current website.

## Physical iPhone live tests

Physical iPhone testing lives in the private [iphone-safari-toolkit repository](https://github.com/usernomom/iphone-safari-toolkit). Its [live-testing procedure](https://github.com/usernomom/iphone-safari-toolkit/blob/main/tests/ios/LIVE_TESTING.md) covers installed Macaque scripts on real current sites. The transport, Python tests, site notes, and archived definitions are maintained there. Captured Google DOM is **not** an acceptable physical validation method.

The development server stays in this production userscript checkout:

~~~powershell
npm run serve:userscripts:lan
~~~

It serves the current working-tree userscript with no-cache headers and rewrites only the served development download/update URLs to the LAN host. Committed source metadata continues to point to canonical GitHub URLs. Use the private toolkit to open the install URL in Safari, manually approve Install/Update in Macaque, and continue live testing.

## Desktop live checks

npm run test:live remains a separate Opera Neon / Violentmonkey check for live Google. It requires the configured desktop browser profile and installed scripts. It does not substitute for physical Safari validation.
