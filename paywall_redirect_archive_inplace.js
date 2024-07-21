// ==UserScript==
// @name         Bypass paywalls using archive.today snapshot
// @downloadURL  https://raw.githubusercontent.com/usernomom/personal-adblock-filterlist/main/paywall_redirect_archive_inplace.js
// @author       nobody
// @description  Bypass WSJ paywall by redirecting to archive.is snapshot
// @version      2
// @include      /^https://www\.wsj\.com/
// @match        https://www.ft.com/*
// ==/UserScript==

function replaceLinks() {
  var links = document.getElementsByTagName('a');
  var regexes = {
    'https://www.wsj.com': /^https:\/\/www\.wsj\.com\/(.*)(\?.*)$/i,
    'https://www.ft.com/content': /^https:\/\/www\.ft\.com\/content\/(.*)$/i
  }
  for (var i = 0; i < links.length; i++) {
    for (const [source, regex] of Object.entries(regexes)) {
      if (links[i].href.startsWith(source)) {
        links[i].href = links[i].href.replace(regex, `https://archive.is/newest/${source}/$1`)
      }
    }
  }
}

setInterval(replaceLinks, 1000);