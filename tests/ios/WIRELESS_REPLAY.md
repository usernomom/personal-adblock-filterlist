# Physical iPhone replay over Wi-Fi

Last updated: 2026-09-29 (America/Toronto). Repository: `G:\GitHub\personal-adblock-filterlist`. Production bridge fix: `0025667fc2a827abe16c821ceef20073e9d0e8a6`. Investigation documentation was published as `1af8bfa204d5def9143fcbe70689a133c455dff3`; harness implementation remains intentionally uncommitted.

## Outcome and scope

The unplugged physical iPhone has repeatedly executed the captured Google DOM, working-tree production bridge 13.2.8, and real pinned uBlacklist filtering code, then POSTed correlated PASS/FAIL to the Home PC. The controller automatically builds, verifies/starts the LAN server, discovers the paired phone, launches Safari, waits for the callback, and cleans up. No automated Google search or manual replay-URL opening is part of this workflow.

The missing wireless step was a heartbeat check-in before Web Inspector, maintained through the callback. Wi-Fi idle recovery is a separate condition: after a gap the phone stopped appearing in Bonjour and its previous lockdown TCP address timed out. The user woke/unlocked it and the unchanged command returned PASS in 107 ms. This establishes wake recovery; it does not establish remote wake or locked-device launch.

A seven-minute between-run heartbeat experiment ended in physical PASS (139 ms), but later monitored tests showed that opening a second Wi-Fi client terminates the original heartbeat. The development watcher now holds one paired client and reuses it for every build/replay. Two consecutive watcher callbacks were PASS (142 ms and 117 ms) after an actual source edit. Continuous locked-device launch and remote wake remain unproven. They are not current requirements: this investigation would be resumed only if the old iPhone 11 becomes a dedicated test bed, and that setup would probably use a direct wired PC connection instead of requiring wireless wake.

## Verified environment

| Item | Value |
| --- | --- |
| iPhone | Corp-iPhone-KLG9WQ643K |
| UDID | 00008150-001A030A2E46401C |
| Hardware identifier | iPhone18,3 |
| Lockdown ProductVersion / BuildVersion | 27.0 / 24A437 |
| Last observed iPhone LAN IP | 192.168.2.82; discovery must not assume it stays fixed |
| Home PC LAN address | 192.168.2.224 |
| Replay listener | 0.0.0.0:8767 |
| Classic iTunes | 12.13.10.3 |
| Apple Mobile Device Support | 19.4.0.10 |
| Apple Mobile Device Service / Bonjour Service | Running; Automatic |
| Microsoft Store Apple Devices | Removed |
| Python / pymobiledevice3 | Python 3.12 / 11.19.4 |
| Python source installation | C:\Users\harsh\AppData\Roaming\Python\Python312\site-packages\pymobiledevice3 |
| Production bridge | google_news_ublacklist_bridge.user.js 13.2.8 |

The iTunes setting **Sync with this iPhone over Wi-Fi** was enabled and Apply was committed using the real Session-1 UI. The checkbox remained checked and Apply reverted to Sync. Device-side `EnableWifiConnections` was already true. Do not repeat this setup or blame Safari settings: wired Web Inspector and wired physical replay were already successful before this transport investigation. Remote Automation and Web Inspector were enabled. Developer Mode was not enabled or needed.

Windows Ethernet uses the Private profile. Enabled inbound Node.js rules allow `C:\Program Files\nodejs\node.exe` on Private networks. The LAN endpoint was fetched successfully, and a newly started server on port 8768 was reached by the physical iPhone. The original port-8767 server (observed PID 1204) was reused and left running. PID is historical, not a permanent identity.

## Routine command

Run on the Home PC:

```powershell
Set-Location G:\GitHub\personal-adblock-filterlist
npm run replay:ios:wireless -- --udid 00008150-001A030A2E46401C
```

Equivalent direct command:

```powershell
python tests\ios\ios-wireless-replay.py run --udid 00008150-001A030A2E46401C
```

The default endpoint is `http://192.168.2.224:8767/__ios/replay-demo`. To change address/port, use `--base-url http://<PC-LAN-IP>:<port>/__ios/replay-demo`. `--no-build` intentionally reuses the old bundle. `--fixture <name>` selects `tests/fixtures/ios/<name>.html`. A missing fixture returns a physical FAIL callback. A supplied `--id` must be fresh; IDs already recorded in the result log are refused before Safari launch.

The server is owned for the duration of a run if newly started, then terminated. An existing verified server is reused and never stopped by this command. Reused server and controller must share the same result-log path.

| Exit | JSON state | Meaning |
| --- | --- | --- |
| 0 | PASS | Current callback contains boolean true |
| 3 | WAITING_FOR_WIFI_PAIRING | No paired device discovered; this can also mean temporarily unreachable/asleep, not lost pairing |
| 4 | LAUNCH_FAILED | Selection, Wi-Fi service, Safari/automation, or stale-ID failure |
| 5 | FAIL | Current physical callback fails assertions |
| 6 | RESULT_TIMEOUT | Safari launched but no matching callback arrived |
| 7 | PREFLIGHT_FAILED | Build or server verification/startup failed |

### Development loop with a held Wi-Fi connection

Start once for a development session:

```powershell
Set-Location G:\GitHub\personal-adblock-filterlist
npm run watch:ios:wireless -- --udid 00008150-001A030A2E46401C
```

The watcher checks in once, holds Marco/Polo between runs, performs an initial build/replay, and then rebuilds and automatically launches another replay when inputs change. Watched inputs are root `.user.js` files, package configuration, the replay HTML, captured fixtures, pinned vendor sources, and builder scripts. Generated bundle output is excluded, preventing a rebuild loop. Each run uses a new ID and prints the full correlated PASS/FAIL callback as one JSON line; callbacks also remain in the result log. An unchanged snapshot does not rebuild or reopen Safari.

Use this mode for iterative work. Separate standalone `run` commands create another Wi-Fi client and can terminate the held keeper. The watcher reuses its checked-in lockdown client, creates/closes a Web Inspector/automation session for each replay, and monitors heartbeat health during builds, waits, and replays. A build error prints BUILD_FAILED and waits for the next edit while preserving the connection. A transport loss prints WATCH_RECONNECTING, closes its services, and tries discovery again after five seconds. An unreachable phone produces WAITING_FOR_WIFI_PAIRING until discovery recovers; this does not prove the host can remotely wake it. Multiple matching clients produce SELECTION_FAILED and are all closed before exit 4.

Ctrl+C stops the watcher and cleans up its owned server. For a bounded agent job:

```powershell
npm run watch:ios:wireless -- --udid 00008150-001A030A2E46401C --duration 540
```

Use a CatDesk job timeout longer than duration plus cleanup (for example 600000 ms). `--max-runs 2` stops after two callbacks, returning the final callback's exit code. A duration/Ctrl+C stop reports WATCH_STOPPED with exit 0; that state is an operational stop, not a physical PASS. Read the last matching callback when judging a change. The watcher is reusable code, not an installed startup service; restart it after host reboot or after updating controller Python. Long-term battery cost and arbitrary locked-device launch are not yet characterized.

## Root-cause isolation

Paired Bonjour/TCP lockdown worked with USB disconnected while native Apple usbmux returned `[]`. These are distinct paths: missing native Network publication is not evidence of generic Wi-Fi or pairing failure.

| Stage | Direct mobdev2 result without heartbeat |
| --- | --- |
| Bonjour + pairing | Device found and full lockdown info returned |
| A: StartService(`com.apple.webinspector`) | Succeeded; observed port 61665, EnableServiceSSL true |
| B: TCP to returned service port | Connected |
| C: Pair-record TLS setup | Succeeded; TLS 1.2 |
| D: `_rpc_reportIdentifier:` write | Could complete; no valid session followed |
| E: First Web Inspector response | Connection terminated |
| Passive control: TLS then receive, without sending RPC | Connection also terminated |

Service ports vary between starts; do not hard-code 61665. The passive control establishes that the problem was not simply an incorrectly formed reportIdentifier payload.

Installed source was inspected in `lockdown.py`, `service_connection.py`, and `services/lockdown_service.py` / `services/webinspector.py`. Both transports obtain a descriptor through the same lockdown StartService operation and honor its SSL flag using pair-record credentials. USB/native Network dial through Apple's usbmux broker; `TcpLockdownClient` dials the returned device port directly.

Before this turn, the full built-in Web Inspector retry window had already been allowed to run: repeated `webinspectord refused the session; retrying` from approximately 17:54:54 through 17:55:14, ending about 17:55:15 (times as recorded in the prior diagnostic). The installed constants were `HANDSHAKE_RETRY_TIMEOUT = 20` and `HANDSHAKE_RETRY_INTERVAL = 1`. Thus the ordinary short consecutive-session gate did not explain the persistent refusal.

Fresh device syslog showed:

```text
2026-09-29 18:11:20.601654 ... Received Pending Client Connection: <_RWIRelayClientTCPConnection: ...>
2026-09-29 18:11:20.601805 ... Unexpected type: <private>, Expected type: <private>
2026-09-29 18:12:05.746132 ... Received Pending Client Connection: <_RWIRelayClientTCPConnection: ...>
2026-09-29 18:12:05.746318 ... Unexpected type: <private>, Expected type: <private>
```

The private error does not identify an alternative frame format. Legacy binary WIRFinalMessageKey/chunk framing did not fix the connection. Delays between TLS and reportIdentifier also failed; recorded 1-, 2-, and 5-second cases all ended in ConnectionTerminatedError. Source inspection of existing appium-ios-device and ios-webkit-debug-proxy clients did not justify a new framing proxy.

## Concrete fix

Before Web Inspector:

1. Start `com.apple.mobile.heartbeat` on the paired TCP lockdown client.
2. Read the initial plist, observed as `{"Command":"Marco","Interval":10,"SupportsSleepyTime":true}`.
3. Send `{"Command":"Polo"}`.
4. Keep reading Marco and replying Polo in a background task.
5. Connect Web Inspector, launch Safari, start its automation session, and navigate to the run-specific LAN URL.
6. Keep the heartbeat alive until the matching callback or a bounded failure.
7. Stop automation and close inspector, heartbeat, and lockdown.

With heartbeat check-in the inspector reported `WIRAutomationAvailabilityAvailable`, and the physical replay succeeded. Native Apple usbmux still returned `[]` during successful unplugged runs. This disproves the earlier hypothesis that native Network usbmux or a broker emulation was necessary for this replay. No installed pymobiledevice3 patch, large proxy, CoreDevice/HID path, Developer Mode, or new Windows computer-use service was introduced.

Initial heartbeat reply has an 8-second deadline. Discovery/API launch/result waits are bounded. Service closes and heartbeat-task cancellation now have five-second deadlines. An independent review found the original teardown gap: cancelling the outer wait could otherwise wait indefinitely on a stalled close and prevent owned-server cleanup. A regression cancels an active body, stalls both service closes, verifies timely completion and both attempts, then releases the old code so a failing test cannot hang the suite.

## Replay composition and assertions

| Component | Source |
| --- | --- |
| Real sanitized captured Google DOM | tests/fixtures/ios/massimo-live-iphone17-2026-09-29.html |
| Capture metadata | tests/fixtures/ios/massimo-live-iphone17-2026-09-29.json |
| Production bridge | Root google_news_ublacklist_bridge.user.js |
| Real uBlacklist filtering / adapters | tests/vendor/ublacklist, pinned upstream 0ca455399f97d5d2c978b993dd00b36c23d070e8 |
| Builtin filter source | af37cf32fb6702a28e8e3ed1e1e30898deec90a8 |
| Ruleset engine | @ublacklist/ruleset@2.0.1 |
| Bundle builder | tests/scripts/build-ios-ublacklist-replay.mjs |
| Physical page | tests/ios/replay-demo.html |
| Wireless controller | tests/ios/ios-wireless-replay.py |
| LAN server | tests/live/serve-userscripts-lan.mjs |

The replay adapts only the production bridge's relative-URL base to Google's origin because the replay page itself is on a LAN origin. This is Safari execution of the production source with that harness adaptation, not a userscript-manager install/update test. The existing production fix had already been physically verified against real Google.

PASS requires five captured Massimo Dutti results resolved to the correct host, classified by uBlacklist, allowed, and visible; the captured Amazon control must resolve, be classified as blocked, and hidden. Bridge fallback attempts must be absent. The observed callbacks reported `externalNetworkAttempts: []` and `googleRequestsMade: 0`.

The page now honors the fixture query instead of ignoring it. FAIL reports retain `Error.message` separately from `Error.stack`: on physical Safari the stack contained only a source frame and originally hid “Fixture HTTP 404”. The controller ignores non-object log rows, rejects stale run IDs, and accepts only literal boolean true as PASS.

## Physical evidence

All rows below are observed callbacks; page elapsed time is not total command duration.

| Run ID | Result | Replay time | Scenario |
| --- | --- | --- | --- |
| wifi-proof-d82bcd00 | PASS | 141 ms | First complete wireless heartbeat/API proof |
| wireless-1790720180-c3c8de | PASS | 140 ms | Updated controller |
| wireless-1790720321-35fd28 | PASS | 103 ms | Consecutive run 1 |
| wireless-1790720335-64e449 | PASS | 167 ms | Consecutive run 2 |
| wireless-1790720373-25ee41 | PASS | 196 ms | Automatically owned server on 8768 |
| wireless-1790720510-472edd | FAIL | n/a | Missing fixture, exit 5; older stack-only error |
| wireless-1790720523-806115 | PASS | 126 ms | Recovery immediately after intentional FAIL |
| wireless-1790720973-e62362 | FAIL | n/a | npm command, owned 8768 server, Fixture HTTP 404, exit 5 |
| wireless-1790720989-55fbce | PASS | 105 ms | npm command, owned 8768 server, exit 0 |
| wireless-1790721707-97a3f4 | PASS | 107 ms | After user woke/unlocked phone; final teardown fix active |
| wireless-1790722330-e9eb68 | PASS | 139 ms | Original seven-minute probe; keeper health at callback unchecked |
| idle-1790723773-60425e | PASS | 151 ms | Corrected shared-client heartbeat-only probe, keeper healthy |
| watch-1790723986-23a018 | PASS | 142 ms | First held-client watcher run |
| watch-1790724024-718dbf | PASS | 117 ms | Source edit triggered second watcher run |
| watch-1790724148-a4e83e | PASS | 103 ms | npm watcher, owned 8768 server |
| watch-1790724191-574603 | PASS | 99 ms | Source edit triggered second npm watcher run |

The already-proven wired baseline was PASS, 96 ms, bridge 13.2.8. It is historical comparison, not a new cable requirement. After owned-server runs, no 8768 listener remained; the original 8767 server remained alive. No lingering diagnostic Python webinspector/syslog processes were found during cleanup checks.

## Idle reachability and recovery

A later normal run returned exit 3. Two additional Bonjour scans (10 and 15 seconds) returned `[]`, and a two-second TCP connection to last-known `192.168.2.82:62078` timed out. Home PC still held `192.168.2.224` and its LAN server remained healthy. These observations establish device-side reachability loss; they do not prove whether the radio, lock state, Bonjour publication, a changed address, or another device condition caused it.

User wake/unlock restored the same unchanged command to PASS. No re-pair, USB reconnection, iTunes toggle, Safari setting change, or Developer Mode was used.

### Between-run heartbeat experiment

A finite host probe held the paired TCP heartbeat open for seven minutes, answered 40 beats before launching another ordinary controller process, and recorded 41 beats by the final report. A notification-proxy connection observed screen and lock events at approximately 373 seconds, including `com.apple.springboard.hasBlankedScreen` and `com.apple.springboard.lockcomplete`; further screen/lock-state events followed at 374–375 seconds.

At 420.9 seconds the probe launched the normal controller while its heartbeat remained connected. The physical iPhone returned PASS in 139 ms, run `wireless-1790722330-e9eb68`, exit 0. The complete probe finished cleanup at 434.1 seconds. It did not assert keeper-task health at callback time, so the counts do not prove uninterrupted keeper health all the way through the callback. The actual physical PASS remains valid. It does not prove that two heartbeat sessions coexist. A later probe monitored the keeper during replay and disproved that interpretation.

**Verified:** a seven-minute held-heartbeat experiment, real screen/lock transitions while the probe ran, and a subsequent successful wireless replay. **Not established:** the phone stayed locked until/during replay, heartbeat alone caused the improved availability (notification proxy was also open), all-day/reboot recovery, or acceptable long-term battery cost. No permanent keeper was installed. The single-run controller still closes its heartbeat after each run.

The executed source is archived in the evidence JSON. A safer reproduction probe is retained as `tests/ios/diagnostics/hold-wifi-heartbeat.py`. Run only when deliberately checking between-run behavior; it waits seven minutes and then launches the regular replay:

```powershell
python tests\ios\diagnostics\hold-wifi-heartbeat.py
```

Post-experiment review found two guard gaps: keeper failure during the child controller was not checked, and a 120-second subprocess timeout could bypass the controller's finally blocks and orphan an owned Node server. The saved probe uses an in-process replay API inside an owned-server context, races keeper failure against replay, and applies startup/send/register deadlines. Three RED-to-GREEN regressions verify keeper failure cancels active replay, a stopped keeper cannot accept PASS, and successful replay preserves the keeper. An abbreviated physical attempt of this revised probe found NO_DEVICE (exit 3); its owned 8768 server was cleaned up. Later, the phone became reachable again. Monitored one-second probes repeatedly failed when replay opened another Wi-Fi client: keeperDone was true and keeperError was ConnectionTerminatedError. The preserved traceback located failure in the keeper's heartbeat receive, not StartService/TLS/Web Inspector or cleanup. Re-awaiting the already-failed task during cleanup had mutated the original traceback; cleanup now retrieves finished-task exceptions without re-raising them.

The probe was changed to borrow the already checked-in lockdown client through `replay_on_checked_in_lockdown`. An 11-second heartbeat-only run (no notification proxy) returned physical PASS in 151 ms, run `idle-1790723773-60425e`, exit 0, with keeperHealthy true and two beats. Cleanup completed at 16.9 seconds. Two ownership regressions confirm the borrowed lockdown is neither closed nor used to start a second heartbeat, including replay cancellation. The previous seven-minute test remains historical evidence with its original source archived; it is not a successful seven-minute test of this corrected single-client implementation.

The probe registers notifications read-only; it does not post fake lock events or change lock settings. The diagnostics sleep API was inspected but not invoked because its documented behavior disconnects the host and would confound a natural-idle experiment. Raw event timing and the actual callback are saved in the structured evidence JSON.

### Watcher evidence

The first physical watch process produced `watch-1790723986-23a018` PASS (142 ms), then an actual Patchloom edit to the replay HTML/package configuration triggered `watch-1790724024-718dbf` PASS (117 ms). Both callbacks used the same held client. The process exited 0 after two runs. Source-change detection, fresh IDs, rebuilt sources, repeated Safari automation, heartbeat monitoring, and callbacks were all exercised without another phone action. A later npm watch process automatically started an owned port-8768 server and returned two more physical PASS callbacks: `watch-1790724148-a4e83e` (103 ms) and `watch-1790724191-574603` (99 ms), with another actual source edit between them. It exited 0 after two runs. Afterwards 8768 had zero listeners; the original 8767 server (PID 1204) remained alive.

## Tests and review

```powershell
npm test
npm run test:ios-wireless
git diff --check
```

Current checks after the completed live E2E: **127/127 JavaScript tests** and **21/21 Python tests** pass. The first JavaScript rerun exposed an over-escaped version regex in the new Cleanup replay test (126/127); correcting that test assertion made the complete rerun pass. Documentation/evidence readback and diagnostic syntax/path checks passed; whitespace checks are recorded alongside the final state. Python tests cover heartbeat check-in ordering, continued replies, invalid/missing check-in, inspector/body failure cleanup, cancellation with stalled closes, actual Node server ownership/reuse, unrelated-server rejection, build failure, stale callback IDs, malformed non-object rows, and strict boolean results, keeper failure/cancellation monitoring, borrowed lockdown ownership, changed/unchanged watch snapshots, build-error recovery, and ambiguous-client cleanup. The JavaScript missing-fixture regression also models Safari's frame-only stack.

Code review originally stalled on a remote read batch. Exact source snapshots were provided locally to the reviewer. Review identified the cleanup deadline issue; it was fixed and the new test went RED then GREEN. Review subsequently reported no remaining Critical/Important/Minor findings in its bounded controller review and confirmed the cancellation regression exercises both service closes. That review did not independently judge dependency-level UDID filtering or HTML runtime behavior; direct physical runs and the JS suite supply that evidence.

Final watch review identified an ambiguous-device cleanup leak: discovery returned live clients but selection failed before any was assigned for cleanup. Every rejected client is now closed and selection stops; a regression verifies both closes and a single discovery attempt. The diagnostic error reporter also now handles failures before keeper creation without masking the original exception.

## Troubleshooting without restarting the investigation

```powershell
python tests\ios\ios-wireless-replay.py probe
python -m pymobiledevice3 bonjour mobdev2 --pair-records C:\ProgramData\Apple\Lockdown --timeout 5
python -m pymobiledevice3 lockdown info --mobdev2 --udid 00008150-001A030A2E46401C
python -m pymobiledevice3 usbmux list
Get-NetTCPConnection -State Listen -LocalPort 8767
Get-Content "$env:TEMP\ios-userscript-replay-results.jsonl" -Tail 3
```

Read logs on the PC; do not ask the user to paste them. Default replay callbacks append to `%TEMP%\ios-userscript-replay-results.jsonl`; `IOS_REPLAY_RESULT_LOG` overrides it. General LAN logs use `%TEMP%\userscript-live.log` and `%TEMP%\userscript-http.log`. Generated replay bundle is rebuilt from pinned sources by the command. Do not automate Google queries to diagnose this replay.

The installed requests package emitted an existing RequestsDependencyWarning about urllib3/chardet/charset_normalizer versions during diagnostics and successful runs. No dependency repair was attempted; judge success using the callback and exit code, not the presence of stderr text.

For exit 3, first distinguish device reachability from lost pairing; a previously paired phone that becomes unreachable does not need routine USB setup. For exit 4, inspect the returned exception and whether the heartbeat check-in succeeded. For exit 6, inspect matching run-ID callback/server logs. For exit 7, read the printed build/server failure rather than changing phone settings. If the PC's address changed, update `--base-url` and verify listener, private firewall rule, and HTTP endpoint.

## Preserved Windows computer-use architecture finding

The Home PC FastMCP gateway runs in Windows Session 0, while Explorer, iTunes, and the user's visible desktop run in Session 1. An isolated WindowsOSMCP child launched by Session 0 returned zero windows. A computer-use MCP cannot simply be added as a Session-0 stdio child and expected to control Session 1.

The demonstrated architecture is a persistent computer-use sidecar in interactive Session 1, reached by the Session-0 gateway over loopback. Temporary scheduled-task helpers proved Session-1 screenshots, UI Automation tree inspection, focusing iTunes, scrolling, clicking, and committing the Wi-Fi sync checkbox. No permanent sidecar was installed during the iPhone transport fix.

Previously considered candidates: deploymenttheory/windows-mcp-server, WindowsOSMCP, and Mcp.ComputerUse. These are investigation notes, not a selected production dependency. WindowsOSMCP's unconstrained `mcp>=1` dependency selected MCP 2.x despite older FastMCP imports; pinning `mcp<2` allowed the isolated experiment to run. Reevaluate current packaging before any future installation.

## Artifact locations and next work

Temporary host probes are under `C:\Users\harsh\AppData\Local\UserscriptTestHarness\`, including `webinspector-stage-probe.py`, binary/appium/flush/delay probes, `webinspector-delay-matrix.log`, `webinspectord-ios.log`, `webinspectord-stage-current.log`, Session-1 iTunes/UIA/click/scroll scripts, logs, and PNGs. These are experimental helpers, not production services. Original real-device capture remains `captures\iphone17-passive-capture-1.json` under that directory.

Current durable harness code is in the repo paths above; tests/ios/evidence/wireless-replay-2026-09-29.json records structured evidence. Do not commit harness work until explicitly requested. Production source commit remains unchanged.

The next development change should be followed by the routine wireless command and current-run PASS/FAIL inspection. All-day locked-device availability and remote wake are optional future work, not an open requirement for the current phone. Revisit them only if the old iPhone 11 is adopted as a dedicated test bed; the likely setup is a direct wired PC connection, which removes the need to prove wireless wake. If wireless operation is explicitly required later, the saved bounded probe can test idle/lock behavior, reconnect safety, and power implications without installing an always-on service.

## Google Cleanup captured physical replay (2026-09-29)

After adding the Cleanup replay suite, the unplugged physical iPhone completed the full controller workflow: build → verify/start owned LAN server on 8768 → Bonjour discovery → automatic Safari launch → production Google Cleanup execution → correlated POST → exit 0. Run ID: `cleanup-physical-20260929-e2e`; Cleanup version: `140.0.13`; callback elapsed time: **419 ms** (page execution, not total controller duration). The finite Home PC job completed in about 24 seconds.

```powershell
Set-Location G:\GitHub\personal-adblock-filterlist
npm run replay:ios:wireless -- --udid 00008150-001A030A2E46401C --suite cleanup --fixture cleanup-live-iphone17-2026-09-29
```

For edit/replay development, substitute `watch:ios:wireless` with the same suite/fixture arguments. The initial Cleanup E2E used `--base-url http://192.168.2.224:8768/__ios/replay-demo` to exercise owned-server startup while preserving the original 8767 listener.

The new fixture reuses the existing passive capture for **massimo dutti leather jacket men**: captured root 4 (Shop by store/product-viewer-group), root 5 (images universal), and ordinary roots 2, 6, 7, 11, 12 plus Amazon root 14. Images/resource attributes and inline event handlers are removed; no Google scripts run. Production Cleanup source is fetched locally and evaluated unchanged.

Physical callback:
- Captured products: reason `products`, hidden.
- Captured images module: reason `unwanted-vertical`, hidden.
- Five captured Massimo ordinary roots: visible, no cleanup hide reason.
- Appended clone of the captured products root: hidden by subsequent production cleanup.
- Unsolicited autoplay probe: autoplay attribute removed, property disabled, pause called twice.
- Explicit `udm=2` transition: Cleanup hides restored.
- Google requests made: 0; reported external attempts: [].

This is an end-to-end **local physical replay**, not Macaque installation or fresh-live-Google verification. Earlier fresh Google navigations for `Toronto weather` and `cats` both returned Google's unusual-traffic `/sorry/index` challenge, with no results or Cleanup runtime. Those attempts are **BLOCKED**, not PASS. Their reconnaissance command's exit 0 meant the inspection completed; it did not mean the userscript passed. The owned automation tab/session was closed.

The existing default bridge/uBlacklist replay does not execute Cleanup. Only `--suite cleanup` with its appropriate fixture establishes the Cleanup behaviors above. Production script files were not changed in this step. Harness changes remain uncommitted; the commands require this Home PC working tree until the harness is separately reviewed/published.


## Installed Google Cleanup on live Google (2026-09-29 evening)

The installed Cleanup **140.0.13** executed automatically on the unplugged physical iPhone after an automatic Safari navigation to the live Google search **massimo dutti leather jacket men**. This is live-origin installation evidence, separate from the captured replay above. Run `cleanup-live-preserve-20260930T001406Z-c2fee9`, CatDesk job `b889e686-7392-4501-9640-7c0dfc070962`, reused the existing controller's `wifi_inspector` helper and dynamically discovered paired client. Only read-only DOM inspection ran in the page; no Cleanup implementation was injected or evaluated.

At observation second 0 the installed style marker reported version 140.0.13. At seconds 10, 30, 61, 92, 122, and 153 the live `https://www.google.com/search` page reported the query title, no challenge, and the following script-tagged nodes with computed `display: none`:

| Live module | Cleanup reason |
| --- | --- |
| Popular products | products |
| Shop by store | products |
| Images | unwanted-vertical |
| People also ask | question-accordion |
| People also search for | query-refinement |

The rendered body text retained an ordinary Massimo Dutti result: **Men's Leather Jackets - Massimo Dutti - CA**, its domain, and descriptive snippet. This verifies the observed live cleanup and automatic installed version; it does not establish that every ordinary result was preserved or that every possible Cleanup behavior was exercised. The five-ordinary-root, dynamic-insertion, autoplay, and explicit-vertical checks remain captured-replay evidence only.

### Premature teardown correction and inspection limitations

An earlier live attempt, `cleanup-live-20260930T001043Z-131972` (job `f7fd08a7-9f30-4224-b9fb-a0290bee0595`, exit 20), observed a challenge and then called `AutomationSession.stop_session()` immediately. The user reported that another installed userscript was still handling the challenge when the tab closed. Installed pymobiledevice3 source confirms that `stop_session()` closes every browsing context returned by `get_window_handles()`. The assertion that phone intervention was already unavoidable was unsupported and is withdrawn.

The corrected run maintained the same heartbeat and observed the page for a bounded period, omitting `stop_session()` and explicit browsing-context closure. It recorded the live results above before transport release. It did not automate a CAPTCHA bypass, manipulate verification state, or keep issuing searches on the challenge. The successful run's snapshots do not establish which mechanism cleared any prior challenge.

The observation helper's desktop-only `#search h3, #rso h3` probe remained empty despite rendered mobile results. Its completion condition therefore missed the successful live page; the job later logged read timeouts and exited **20** after its observation window. That exit is not a passing test exit. The verified live behavior comes from the inspected snapshots, not the process status. The runtime global was inaccessible in this evaluation context; the automatic versioned style and script-specific DOM changes establish execution. An isolated-world explanation was not independently verified.

A subsequent read-only retained-page check (job `a4ee3019-14eb-4ee9-9106-3113ad0afc96`) found no matching exposed page and issued no navigation; post-disconnect tab retention is **unverified**. A final attempt to collect broader mobile-link evidence (job `94fa90d9-d139-4e44-98d3-1a30a896de39`) returned `RemoteAutomationNotEnabledError` before any navigation. No settings were changed and no transport investigation was restarted. The failed follow-up does not provide additional result-preservation evidence.

For subsequent inspection, use the installed API's `Page.web_url` and `Page.web_title` fields and inspect current mobile markup. Keep the single heartbeat owner throughout a bounded observation window. A pending challenge must not trigger premature teardown, but the run must still close its owned test context and release automation on completion or deadline. Retain a page only when the user explicitly requests it; verify that releasing transport actually releases automation.

## Completed live Google Cleanup E2E with automatic cleanup (2026-09-29)

The native Home PC run `cleanup-live-20260930T005355Z-e907f8` completed with **PASS and process exit 0** on the physical unplugged iPhone. This supersedes the earlier snapshot-only completion claim. The user had enabled Safari Remote Automation; no additional phone action was needed for this successful run.

```powershell
python -B G:\GitHub\personal-adblock-filterlist\tests\ios\ios-live-cleanup.py --udid 00008150-001A030A2E46401C --output C:\Users\harsh\AppData\Local\UserscriptTestHarness\cleanup-live-complete-latest.json
```

The runner used dynamic mobdev2 discovery and the existing `wifi_inspector` helper with its single shared heartbeat client. It automatically navigated to a fresh Google search for **massimo dutti leather jacket men**. Google briefly returned `/sorry/index`; the runner observed the same tab until live results appeared, without interacting with the challenge or issuing another search. The mechanism that cleared the challenge was not independently instrumented.

Read-only inspection established automatic installed Cleanup **140.0.13** from the versioned style marker. Five script-tagged modules had computed `display: none` and were not visible: Popular products, Shop by store, Images, People also ask, and People also search for. Five ordinary Massimo Dutti results remained visible, with their visible `https://www.massimodutti.com` citations and mobile `DIV[role="heading"][aria-level="3"]` titles. No Cleanup implementation was injected/evaluated. The runtime global remained inaccessible in the automation context; its cause is unverified.

The corrected probe reads visible mobile headings and their nearby visible domain citations. Neither desktop `h3` selectors nor external `a[href]` selectors described these result headers. The preceding native run `cleanup-live-20260930T004814Z-44428c` missed them, later timed out on reads, and reported `CLEANUP_FAILED`; it is not a PASS.

After three seconds of stable verification, the successful runner closed its owned Google browsing context. It reported `ownedContextClosed: true`, `remainingOwnedContexts: 0`, and `preexistingContextsPreserved: true`, then released inspector, heartbeat, and lockdown and exited 0. A separate read-only inspection after process completion returned two populated Safari page listings five seconds apart: no automation target, no automation owner, and no Google test page; global automation availability remained available. That inspection also exited 0. The test did not leave Safari waiting for the user to end automation.

The observation window is bounded (default 150 seconds), and connection, inspection, and cleanup waits also have deadlines. A failed cleanup is a failed run even if live DOM checks succeeded. Live PASS covers this returned page and the behaviors above. Dynamic insertion, autoplay, and explicit `udm=2` restoration remain captured-replay evidence. After the live E2E, the full regression suite passed: 127/127 JavaScript tests and 21/21 Python tests.

The userscripts skill now specifies native execution on the target PC, mobile heading/citation inspection, bounded same-tab challenge observation, owned-context cleanup, and automation-release verification. Documentation and skill changes are published separately; the live runner and other harness implementation remain uncommitted under the existing instruction not to commit harness work.

## Primary source references

- Installed pymobiledevice3 11.19.4 source named above is the version used for all physical tests.
- [Upstream heartbeat implementation](https://github.com/doronz88/pymobiledevice3/blob/master/pymobiledevice3/services/heartbeat.py)
- [Upstream Web Inspector implementation](https://github.com/doronz88/pymobiledevice3/blob/master/pymobiledevice3/services/webinspector.py)
- [libimobiledevice heartbeat API](https://libimobiledevice.org/docs/libimobiledevice/latest/heartbeat_8h.html)
- [Historical ios-webkit-debug-proxy Wi-Fi/TLS refusal issue 263](https://github.com/google/ios-webkit-debug-proxy/issues/263): similar error, not a verified fix for this phone.
- [libimobiledevice diagnostics command](https://github.com/libimobiledevice/libimobiledevice/blob/master/tools/idevicediagnostics.c): its sleep command explicitly disconnects the host, so it was inspected but not used as a substitute for natural idle.
