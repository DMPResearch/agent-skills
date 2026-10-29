# Repo extensions and conservative checks

catalogue.json is authoritative; regenerate its view with
`python3 scripts/render-catalogue.py`. Product colours, architecture, scenario
matrices, budgets and approval details belong to repo extensions, not universal
rules. The punctuation check UI-001 is optional and its example policy lives
only in extension.example.json; its promotion remains opt-in. The universal writing gate PROC-SLOP-WRITING
now cites owner AGENTS.md section 0; source punctuation hits remain candidates.

A repo opts in by adopting a version 1 JSON extension and naming its path in
AGENTS.md. Each added rule needs id, rule, check, kind and violation. Use
SEC-, ENG-, UI-, TEST- or PROC- prefixes with repo namespaces; do not replace
catalogue IDs. Repo instructions win; report conflicts rather than silently
waiving a security requirement. No PR reviewer is wired by this package.

The mechanical default is intentionally narrow. Complete provider-token formats,
private-key blocks containing material and non-placeholder high-entropy password-bearing URLs
are violations on raw text anywhere, including docs, comments, tests and JSON.
Only hand-written logic over its adopted length budget produces ENG-002;
config/data, generated files, repo exemptions, legacy ratchets and valid
justifications are honored as described below. Weak secret assignments, model
IDs, punctuation and design/smell heuristics are candidates. Context does not
waive strong credentials. The shared recognizer always redacts its evidence.

Each candidate rule has a total count and at most 20 redacted locations. The
JSON candidate_summary and readable candidate_text are bounded; matches beyond
20 contribute to counts but are not repeated. They never cause exit 1. The
auditor gets only counts and capped examples, not the full mechanical report.

To promote a check, explicitly supply a rule-to-glob map:

```json
{"version":1,"rules":[],"violation_globs":{"UI-002":["src/ui/**"]}}
```

For UI-001 first adopt the rule in extension.example.json and record the repo
owner's typography decision; then select its paths. Promotions apply only to
matching repo-relative paths. Trusted repo-hook findings also require matching
violation_globs before they become violations. Nothing opts a repo in through
installation, a shared skill or the existing automatic reviewer.

Optional token_globs, generated_globs, exclude and violation_globs use Python
fnmatch on POSIX repo-relative paths, not a special globstar language. List
root-level and nested patterns where needed. Default token paths are tokens.*,
**/tokens.* and **/tokens/**. Lockfiles, generated/_generated directories,
*.generated.*, *.gen.* and generated markers skip length checks, not scanning.
The model-pattern data can be extended with past_generation_model_patterns.

Checks consider tracked UTF-8 text files up to 4 MB. Symlinks and recognized
private paths are not read; untracked and oversized files are not coverage.
A diff resolves its base with rev-parse --verify --end-of-options and parses
one unified diff shared with the audit runner. Added lines are checked, plus
whole changed-code-file length; deleted lines need auditor judgment.

An optional hook is an executable and argv, never shell text. Review it before
--allow-hook. It must be read-only and return a JSON array of rule_id, file,
line, severity, evidence and why, without secrets. Hook failures mean incomplete.
A hook cannot authorize its own execution or its own violation promotion.

## Authored-code length and justifications

The length rule does not count config/data as authored logic: JSON/YAML/TOML/
INI/lock files, token/theme styles, literal-only code data modules and generated
files are excluded. A config/locale/lexicon name alone never exempts logic;
repo-owned explicit exemptions remain honored.
Logic beside a dictionary is not exempt merely because it shares a directory.
Add repo-specific data paths with length_data_globs.

To import an existing repo ratchet without executing its code, use:

```json
{"length_policy":{"exemptions_source":"scripts/check-file-size.mjs","legacy":"scripts/file-size-legacy.json"}}
```

The inert JS adapter reads a numeric MAX_LINES, a literal EXTENSIONS list and
simple regex literals in EXEMPT. Unsupported expressions fail as incomplete;
no package scripts, hooks or JS are executed. Legacy JSON maps files to their
existing budgets. Sources must be regular files within the repo. A sample
adoption for Ereno lives in evals/practice-audit/extensions/ereno.json; it is
not installed into that repo or its reviewer.

An eligible oversized file may contain one top comment within ten lines:
`practice-allow: ENG-002 because <specific reason>`. Use // in TS/JS/Swift/Go/Rust,
<!-- ... --> in HTML/Vue/Svelte, # in Python/shell, or /* ... */ in CSS (block comments also work in TS/JS).
At least 40 characters, eight words and five distinct words are required as a
substance floor. A string containing the marker is not a comment. Missing,
unknown or non-length rule ids and empty/weak reasons leave the length finding
active. Valid reasons appear in justified with review=required. Auditors still
check the reason and clean code; security findings are unaffected.

## Smell and design candidates

ENG-CAND-001..005 detect function spans, nesting, empty catch/except blocks,
commented code and contextless TODO/FIXME in Python and TS/JS/Swift. Configure
smell_thresholds.function_lines (60 default) and nesting_depth (4 default).
They never fail by default; promote only via explicit violation_globs. Python
uses the host AST, with unsupported syntax warnings; lexical JS/TS/Swift spans
are estimates, not typechecked compiler guarantees.

UI-002 includes raw type, spacing, radius, shadow and layer values. Token paths
use token_globs; design_scales maps source property names to approved literal
values, e.g. {"fontSize":[12,16],"gap":["8px","16px"]}. UI-DS-002..004 cover
inline values, dark-token overrides, local focus/touch dimensions and image
semantics/geometry. Missing local styles can be supplied elsewhere; these are
candidates for judgment, never proof of a rendered defect. Global candidate
sampling may retain fewer than 20 examples per rule to keep the whole summary
below 200 lines; counts always include every detected location.

Strong provider keys/tokens, complete key material and high-entropy password
URLs are always violations on raw source, including tests/docs/comments/JSON.
Only weaker secret heuristics are candidates. The shared pre-push recognizer
retains main's secret-URL behavior; public configuration URLs are not a blanket
exemption for a secret-named variable.

Password URL default violations use the shared recognizer's token-length,
character-mixture and entropy requirements on the password alone. Dictionary
words stay candidates even when the pre-push guard flags the credentialed URL.
The guard intentionally retains main's broader URL coverage.
