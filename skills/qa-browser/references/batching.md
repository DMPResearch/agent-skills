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

Use 28 real frames plus calibration by default, with at most eight images per
contact sheet. The paired passes took about 8.1 seconds per real frame at 28,
versus 9.3 at 14 and 17.3 at seven in this pilot. A larger context gives the
critic more material to attend to; these samples do not establish a general
miss rate. Keep the broader full-size escalation when a screen is flagged.
The larger sheet passes demonstrate why rereading only individually flagged
frames would have lost a known detection.

Every original frame still needs one judgment in each required pass. Adjacent
sizes and near-identical states may be judged on contact sheets; no image or
matrix cell is dropped or deduplicated. A suspected defect or unreadable detail
escalates that screen's frames in the same engine/theme to full-size review.
Calibration stays separate from product findings and cannot approve a batch
whose coverage is incomplete.

For one historical two-application workload of 3,782 intended frame captures in
40 screen/engine/theme groups, the exact group ceilings were:

| Real frames per call | Initial calls | Calls if every screen escalates | Calls with one retry on every required pass |
|---|---:|---:|---:|
| 7 | 552 | 1,104 | 2,208 |
| 14 | 283 | 566 | 1,132 |
| 28 | 156 | 312 | 624 |

These are workload examples, not a fixed price or forecast for other projects.
Complete graph traversal may produce more captures. The ten-minute call cap
and two-hour review budget are unchanged. Save completed receipts and resume
unfinished work rather than increasing the budget or reducing coverage. One
screen's six calls do not establish reliability across themes, engines or
other defect classes; the implementation still needs independent review.
