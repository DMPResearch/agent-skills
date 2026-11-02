# Batch size evidence

A bounded subscription pilot used existing production captures from one screen,
one engine and one theme, across five viewports. Each candidate contained a
known reference-render defect and one generated overlap frame with opaque
metadata. Exactly six Opus calls ran: sheets and full-size passes at each size.
No timeout, retry, capacity rejection or model fallback occurred. Every call
returned exact frame coverage, caught calibration and successfully opened all
of its required images through the Read tool.

| Real frames per call | Sheet seconds | Full-size seconds | Known illustration defect on sheet | Known illustration defect at full size |
|---|---:|---:|---|---|
| 7 | 56.4 | 64.7 | Not identified; entry flagged for another reference concern | Caught |
| 14 | 39.0 | 91.8 | Defective entry passed | Caught |
| 28 | 89.3 | 138.3 | Defective entry passed | Caught |

Use at most 28 real frames plus calibration per call, with at most eight
images per contact sheet. The paired passes took about 8.1 seconds per real
frame at 28, versus 9.3 at 14 and 17.3 at seven in this pilot. A larger context
gives the critic more material to attend to; these samples do not establish a
general miss rate. Sheet flags alone are insufficient: the 14/28-frame sheet
calls passed the defective frame and relied on unrelated flags to trigger a
full read. A lone defective frame could therefore have passed that policy.

## Mandatory full-size policy

Before any sheets, read every capture at the shortest phone and widest desktop
for each distinct screen, declared auth/data state, engine and theme at full
size. Only the remaining sizes use sheets. Any flag from either pass escalates
those remaining sizes of that same group. Boundary captures include all reached
control and break states; exact frame coverage and the complete matrix remain
required. Missing either boundary blocks a passing verdict for that group.

A second subscription pilot used approved captures with one defective real
production frame substituted per cohort. The first cohort had two mandatory
frames and one intermediate-size frame. The second tested the original
previously measured defective phone with one approved desktop. No product
screen was edited. Four calls ran without retry, timeout or capacity rejection.
Read tool results confirmed every required image was actually delivered.

| Call | Real frames | Seconds | Result | Calibration |
|---|---:|---:|---|---|
| Mandatory phone/desktop | 2 | 33.7 | Lone defective phone failed for geometry/reference drift before sheets; approved desktop passed | Caught |
| Intermediate sheet | 1 | 20.1 | Approved frame passed | Caught |
| Escalated intermediate full read | 1 | 19.6 | Approved frame passed | Caught |
| Original defective phone/approved desktop, full read | 2 | 43.6 | Phone failed for geometry/reference drift; approved desktop passed | Caught |

Both full reads failed the defective frame independently of any sheet flag.
Neither named the original illustration palette difference. This is evidence
that the required full-read path can reject a lone defective frame, not proof
that it detects every defect on that frame. The narrower palette claim remains
unproved in this pilot. No further calls were made to turn that miss into a
positive result. The pilot used subscription access without a paid API. A
missing current session meter was disclosed in its private evidence, not inferred
from a stale usage logger.

Twenty-eight remains the measured upper bound for grouping mandatory full-size
reads, not a detection guarantee. Intermediate-only defects can still be missed
on sheets when neither boundary nor another sheet frame flags them. Full reads
also have judgment limits, as the palette miss demonstrates. No quality claim
is bought by omitting required frames or shrinking the matrix.

For the historical two-application workload of 3,782 intended captures, counted
without deduplicating overwritten paths, the new 28-frame policy requires:

| Workload | Mandatory full calls | Remaining-size sheet calls | Initial calls | Calls if every state group escalates | With one retry on every required call |
|---|---:|---:|---:|---:|---:|
| First application, 1,832 frames | 32 | 47 | 79 | 126 | 252 |
| Second application, 1,950 frames | 35 | 50 | 85 | 135 | 270 |
| Both, 3,782 frames | 67 | 97 | 164 | 261 | 522 |

There are 1,556 mandatory full-size frames in this workload. These are group
ceilings computed from historical declared coverage, not a forecast for other
projects. Complete graph traversal may produce more captures. Ten-minute calls
and the two-hour review cap are unchanged. Completed receipts survive stops;
resume unfinished work, explicitly splitting a previously timed-out batch if
needed, rather than increasing the cap or reducing coverage. A small pilot does
not establish reliability across themes, engines or other defect classes. The
implementation still requires independent review.
