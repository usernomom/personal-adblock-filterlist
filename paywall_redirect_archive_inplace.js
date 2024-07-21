// ==UserScript==
// @name         Bypass paywalls using archive.today snapshot
// @author       nobody
// @description  Bypass WSJ paywall by redirecting to archive.is snapshot
// @version      0.0.1
// @include      /^https://www\.wsj\.com/
// ==/UserScript==

function replaceLinks() {
  var links = document.getElementsByTagName('a');
  var regexFull = /^https:\/\/www\.wsj\.com\/(.*)(\?.*)$/i;
  for (var i = 0; i < links.length; i++) {
    links[i].href = links[i].href.replace(regexFull, 'https://archive.ph/newest/https://www.wsj.com/$1');
  }
}

setInterval(replaceLinks, 1000);