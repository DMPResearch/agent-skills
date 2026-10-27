---
name: verify-live
description: Verify your own work in real browsers, iOS simulators and Android emulators before calling it done. Use after any UI, flow, link or native change, before reporting work ready, sending the owner a link or screenshot, or opening a PR. Covers the production build, the viewport and theme matrix, real Safari and Chrome, break-it tests, evidence and the screenshot critics.
---

# Verify live

Passing tests prove the code does what the tests say. They don't prove the
owner will see a working screen. Before you report UI or flow work done, see it
running the way a real user will: the production build, in real engines, at
real sizes, then try to break it. An unrun check is not a pass. Say it was not
run.

Project specifics (URLs, stack commands, devices, design rules) live in
private notes at `~/.agents/project-notes/<repo>.md`, kept out of this public
repo. Read the one for this repo if it exists, plus the repo's AGENTS.md /
CLAUDE.md.

## 1. Run the real thing

- **Production build**, not the dev server: build it, serve it (or deploy to
  the staging/preview the repo provides) and test that. Dev servers hide
  missing CSS, wrong asset paths, CSP and service-worker bugs.
- **Same build everywhere**: the served HTML, JS and CSS must come from the
  same build. Check that the asset hashes referenced by the HTML are the ones
  served (no 404s, no old hashes from a cache or service worker). The capture
  script flags missing same-origin assets.
- **Real services, real data.** No stubs, mocked backends or "demo mode"
  standing in for the product. If you need a key, account or deployment you
  don't have, stop and ask for it. Use `request_secret` in T3, never chat.
  A repo's keyless canned lane proves wiring only, never answer content.
- Never test writes against production. Production checks are read-only
  (load, look, links).

## 2. The matrix

Automated pass first (all engines, sizes and themes, with checks):

```sh
cd <dir where Playwright resolves, e.g. the repo's e2e package>
node ~/.agents/skills/verify-live/scripts/capture.mjs --url <url> [--url ...] \
  --label <surface> [--sizes phones|tablets|desktop|all|WxH,...] \
  [--engines chromium,webkit] [--themes light,dark] [--storage state.json] \
  [--theme-init "localStorage.setItem('theme', THEME)"]
```

`--themes` sets `prefers-color-scheme`. If the app keeps its own theme setting
(storage, a class or an attribute), pass `--theme-init` too, or both themes
capture the same thing. The project notes give the hook. Phones render at 3x
and wider viewports at 2x.

The sizes cover short phone viewports (iPhone Safari opened from another app
390x660, Android Chrome 412x660 and 412x620, 360x640), tall phones (390x844,
430x932), Fold outer 344x880 and inner 755x1000, iPad portrait 744x1133 and
820x1180, 1024 and 1440. It flags console and page errors, failed requests,
horizontal overflow, elements past the edge (clipping by html/body does not
hide it), and broken, unloaded, stretched, letterboxed or soft images. It
scrolls the page first so lazy images load. Shots and `report.md` go to `/Volumes/DevBox/tmp/verify/<stamp>/`.
**Every flagged issue is fixed or explained.** Exit 1 is not "fine".

Self-test after editing the script (real Chromium, local page):
`PW_DIR=<folder where Playwright resolves> bash ~/.agents/skills/verify-live/scripts/tests/test-capture.sh`

Playwright WebKit is not Safari, and Chromium device mode is not Android
Chrome. After the automated pass, check the changed screens in real engines:

**iOS Safari (Simulator):**
```sh
xcrun simctl list devices available | grep -E "iPhone|iPad"
xcrun simctl boot <udid>; open -a Simulator
xcrun simctl ui <udid> appearance dark|light
xcrun simctl openurl <udid> "<url>"
xcrun simctl io <udid> screenshot /Volumes/DevBox/tmp/verify/<task>/<name>.png
```
Use an iPhone and an iPad simulator for portrait tablets. For links the owner
will tap from another app, open them as a cross-site navigation (from Notes
or Messages, or a page on another origin), not by typing the URL. Then do the
action they will do.

**Android Chrome (Emulator):**
```sh
export ANDROID_HOME=<sdk>   # see the project notes
$ANDROID_HOME/emulator/emulator -list-avds
$ANDROID_HOME/emulator/emulator -avd <avd> -no-snapshot-save &
adb wait-for-device; adb shell cmd uimode night yes|no
adb shell am start -a android.intent.action.VIEW -d "<url>" com.android.chrome
adb exec-out screencap -p > /Volumes/DevBox/tmp/verify/<task>/<name>.png
```

**Native apps:** build and install on the simulator/emulator, then drive it
with the repo's Maestro flows (`~/.maestro/bin/maestro test <flow.yaml>`) or by
hand, and capture with `simctl io` / `adb screencap`. Check light and dark,
Dynamic Type or font scale, and rotation where supported.

**Interactive pokes in T3:** the preview tools (`preview_open`,
`preview_resize`, `preview_set_appearance`, `preview_click`,
`preview_snapshot`) and device tools (`device_open`, `device_screenshot`) are
fine for exploring. They don't replace the real-engine checks above.

## 3. Break it

On every changed screen and state, try:
- empty input, very long input, emoji or RTL text, each supported language;
- double submit, double tap, back, refresh mid-action, a second tab;
- **the existing tab**: reload a tab that had the old build open, then a fresh
  navigation (stale-asset bugs only show here);
- offline or slow network (Playwright `context.setOffline`, throttling), a 401
  or expired session;
- signed out, signed in, new user with no data, and a user with a lot of data;
- loading, empty and error states; skeletons are the final size, with no guest
  flash before sign-in resolves;
- reduced motion, reduced transparency, keyboard only (focus visible, focus
  trapped in sheets, Escape closes), and a screen reader label on each control;
- fixed or glass elements (headers, tab bars, composers) at rest and while
  scrolling: nothing hidden under them and nothing clipped at the edges.

Scroll through every section. A fold screenshot is not a check of the page.

## 4. Look at it, then get critics

- Open every shot yourself at the size the owner will see it. Look for raw
  ids or error text, stale or test content (names, emails, quotas, past
  dates), lopsided or empty areas, typos, contrast, alignment to the page
  gutter, and anything that looks generated or unfinished. Fix what fails.
  A warning note does not make it acceptable.
- Then the **screenshot critics**: an Opus critic on Claude B
  (`CLAUDE_CONFIG_DIR=~/.claude-b claude -p --model claude-opus-5-5`; never
  as a subagent on the orchestrator's own account while B has capacity, per
  the owner's routing rule) and a Cursor critic (`cursor-agent -p --mode ask --model
  grok-4.7-high`), each given the shot paths, the intended design, and the
  instruction to list defects and end with `VERDICT: approve|needs-changes`.
  Quote the owner's credential rule word for word in each critic brief
  (the Lessons line in `~/.claude/AGENTS.md` that starts "When an agent looks
  for a credential"), as that rule requires.
  If a critic can't open images, it doesn't count. Use another one. Both must
  approve. A designer reviewing their own work is not this check.
- Check account headroom before Claude critics (see `cross-review`).

## 5. Evidence and report

- Keep the evidence under `/Volumes/DevBox/tmp/verify/<task>/`. Commit
  screenshots only where the repo asks (follow its evidence README and naming)
  and never with personal data in them.
- Report each surface you checked, with sizes, engines and themes, what you
  broke and fixed, the critics' verdicts, and **what you did not check and
  why**. Say whether the result is published (link live) or still waiting for
  review.
- Sending the owner a page or mockup: make it self-contained (inline images),
  publish with `html_render` in T3, and check it at phone size first.
