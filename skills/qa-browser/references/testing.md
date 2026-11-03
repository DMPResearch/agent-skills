# Test scheduling

Run `QA_PW_PATH=/absolute/path/to/package.json node <skill>/scripts/run-tests.mjs`.
It resolves the existing target toolchain, runs all adjacent `.test.mjs` files
with `--test-concurrency=1`, forwards cancellation and preserves child failure.
For focused work, append explicit test-file paths. The runner does not retry.
Do not use a wildcard `node --test` command as the whole-suite entry point.

The concurrent critic run exposed these load-sensitive cases:

- `resume.test.mjs`: the complete capture/review/resume process exceeded 30 s.
- `return-path.test.mjs`: multiple complete matrices lost coverage under load.
- `service-causal.test.mjs`: Chromium launch/action exceeded 10 s.
- `service-intent.test.mjs`: Chromium cell exceeded 15 s.
- `service-native.test.mjs`: Chromium native form check exceeded 10 s.
- `gate-review.test.mjs`: the initial fixture screenshot returned
  `Page.captureScreenshot: Unable to capture screenshot` in one earlier run.

Independent runs of those cases passed sequentially. The suite previously
launched files concurrently, so dozens of browser processes competed for
startup, compositor and protocol work. Serial file admission removes that
source of contention without increasing product action or capture bounds.
The runner's own regression uses exclusive file admission, records order and
checks that a real failing child returns nonzero.

Fresh post-service coverage now initializes 30 state/break views per engine,
plus continuation views, rather than resizing one live page. The measured
fixture times were 24.0 s Chromium and 27.9 s WebKit. Its 60 s test deadline
covers that expanded fixture work; the tool's 60 s cell, 10 s action and 30 min
capture bounds are unchanged. A timeout is still a failure, not an accepted
result. Real SDK replay acceptance belongs to the next authorized served-app
capture; the local client fixture proves recording/replay and egress policy.

The CLI fixture now includes 40 fresh post-service entries in addition to 40
source cells. After fixing WebKit's missing-MIME replay, it measured 34.3 s
(previously about 20 s); its subprocess budget is 60 s. This is fixture-only
headroom for additional initialization work, not a production timeout change.
The earlier 40 s cancellation remains retained as an incomplete failed proof.
