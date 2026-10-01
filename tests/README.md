# Userscript testing

Run the deterministic production-userscript suite with:

~~~powershell
npm ci
npm test
~~~

The jsdom tests in tests/deterministic/ exercise the actual .user.js packages, metadata, and behavior. These tests are useful for fast regressions but do not establish what an installed script does on a current website.

## iPhone troubleshooting

There is no routine live testing. When a problem shows up while browsing, it is troubleshot once on the phone with the private [iphone-safari-toolkit](https://github.com/usernomom/iphone-safari-toolkit) (see its README and site notes), against the installed Macaque script on the real site. Each fix adds a deterministic test here and updates the script's `BEHAVIOUR SPEC` comment in the same change. Captured Google DOM is **not** an acceptable physical validation method.

The development server stays in this production userscript checkout:

~~~powershell
npm run serve:userscripts:lan
~~~

It serves the current working-tree userscript with no-cache headers and rewrites only the served development download/update URLs to the LAN host. Committed source metadata continues to point to canonical GitHub URLs. Use the private toolkit to open the install URL in Safari, manually approve Install/Update in Macaque, and continue live testing.

## Desktop live checks

npm run test:live remains a separate Opera Neon / Violentmonkey check for live Google. It requires the configured desktop browser profile and installed scripts. It does not substitute for physical Safari validation.
