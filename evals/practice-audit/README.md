# Practice-audit calibration

Run from the shared skills checkout, using the same installed CLIs and account
routing as the real audit. This costs two real model runs, not CI or a fake
review. Default panel: claude-opus-5-5 and gpt-6-sol with high reasoning.

```sh
python3 evals/practice-audit/calibrate.py \
  --out /Volumes/DevBox/tmp/practice-calibration-<new-run> \
  --claude-config-dir "$HOME/.claude-b"
```

The generator creates a new throwaway Git repo and an empty baseline, then
stages 16 violations: two mechanical (strong secret and authored-code length)
and 14 judgment seeds. These include three code smells (swallowed write error,
mixed-purpose dispatcher and consequential magic limit) and two design defects
(raw component colour and removed focus style), alongside duplication, boundary
contract, source-based tests, contrast, hierarchy and process evidence. The simulated
execution record is test evidence only; no deploy or product action occurs.
Synthetic credentials are assembled only at generation time, never stored as
complete literals in this repo. Clean controls cover optional-chain config,
documented placeholders, a guard marker, recorded prose and behavioral tests.

No expected.json is written before or during auditing. The driver materializes
the answer file only after the model processes finish. The fixture uses generic
instructions and ordinary module paths rather than folders labeling controls.
Its process record describes events without restating the policy rules. The real practice-audit runs in diff mode with the execution record
explicitly supplied as --evidence-file. No auditor sees the scorer or expected
answers as part of its scope. Models and timeouts remain CLI configuration.
The script does not rerun failed panels automatically or change its answer key
after seeing results.

score.json records each found/missed seed and every unmatched finding. A match
requires a predefined rule, file and line range, except ENG-002 which is a
file-level finding regardless of the reporter's chosen anchor line. Mechanical
candidates are excluded from violations. Extra reports matching the same seed
are not double-counted. Passing requires a complete two-family audit, every
mechanical seed from the checker itself, at least seven judgment seeds per family, all three smell seeds and both
design seeds per family, and at most two unmatched findings. A family that
contributes nothing or fails to inspect files fails calibration.
Source findings still need a human check for substantive correctness; location
matching alone does not establish that the auditor understood the defect.

Use --prepare-only to inspect the fixture without paying for auditors. To
rescore a saved run without rerunning models:

```sh
python3 evals/practice-audit/calibrate.py --out <existing-run> \
  --report <existing-run>/audit/report.json
```

Local scorer/noise tests: `python3 -I -m unittest discover -s scripts/tests`.
Never add this live evaluation to paid CI without the owner's authorization.

The catalogue's no-ai-slop blockers are checked first. Seeds for copied logic,
source-mirroring tests and silenced errors accept ENG-SLOP-CODE as the merged
hard-gate verdict; detailed IDs remain accepted. Labels and legitimate process
secondary rules are frozen before the run, not revised after seeing findings.
