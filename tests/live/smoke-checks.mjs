/** Pure verdicts for live smoke cases, kept here so they can be unit-tested. */

function hostOf(value) {
  try { return new URL(value).hostname; } catch { return ''; }
}

function fail(message, details) {
  throw new Error(`${message}\n${JSON.stringify(details, null, 2)}`);
}

/**
 * YouTube Music must reach uBlacklist with its exact host, untouched by
 * Cleanup: through Google's own uBlacklist-readable link (a.UBFage or
 * a[role=presentation] with a music.youtube.com href, which the bridge leaves
 * alone by design) or through a bridge proxy. Returns 'native' or 'proxy'.
 */
export function youtubeMusicDelegation(result) {
  if (!result) fail('YouTube Music result was not found', result);
  if (result.cleanupReason) fail('Google Cleanup must not domain-filter YouTube Music', result);
  let path = '';
  if (result.bridgeRoot === '1' && hostOf(result.proxy) === 'music.youtube.com') path = 'proxy';
  else if (result.nativeLink && hostOf(result.source) === 'music.youtube.com') path = 'native';
  if (!path) fail('neither a native uBlacklist link nor a bridge proxy carries the music.youtube.com destination', result);
  if (result.uBlacklistProcessed !== '1') fail('uBlacklist did not process the YouTube Music result root', result);
  return path;
}
