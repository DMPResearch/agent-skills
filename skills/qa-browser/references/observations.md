### Declared external observations

A flow may supply `observations`, at most eight classes with unique `id`, `owner`
and `reason`. These are visible receipts, never a general ignore list. An
`external-request` class declares `match` with either an exact external `origin`
or a label-bound `hostnameSuffix` and `scheme:"https"`; exact `path`, `methods`
from GET/HEAD/OPTIONS and `resourceTypes` from fetch/xhr; and `outcomes` from
pending/cancelled only. A variable path segment uses
`{prefix:"/probes/",suffix:"/result",maxSegmentLength:64}`; only one bounded
alphanumeric, underscore or hyphen segment is accepted. Same-origin matches are
refused both at validation and observation. HTTP errors, unexpected transport
failures and control assertions remain failures. Ambiguous matches are not exempt.

A separate `expected-development-warning` class needs
`serviceEnvironment:"development"`, an exact external
`source:{origin,paths:["/client.js"]}` and exact `message`. Same-origin or different
warnings remain visible checks. Every matching receipt retains the class, owner,
reason, URL and observed outcome in JSON and Markdown reports. Consumers declare
their service classes as flow data; no provider-specific rules live in the tool.

## Registrable-domain boundary

The gate uses both ICANN and PRIVATE sections of the bundled
[Public Suffix List](https://publicsuffix.org/list/), using its
[matching and exception rules](https://github.com/publicsuffix/list/wiki/Format#formal-algorithm).
A same-site request or warning is refused unless the class has an exact origin
and `sameSiteException:{hostname:"identity.example.com",reason:"Separate identity
service operated on the same organizational domain"}`. The hostname must equal
that origin’s canonical hostname, and the reason must be nonempty. The exception
is data in each matching receipt. It does not cover the app’s own origin.

Ports and schemes do not create a different registrable domain. For IP addresses and literal
localhost, the canonical hostname is the boundary; another port on that same host also needs the explicit exception.
Independent tenants on private suffixes have independent registrable domains.
Suffix classes must name a service domain below a public suffix; a whole public
suffix is refused. Same-site sibling suffixes cannot be excepted because they do
not name one exact host. Unicode names are compared in canonical ASCII form.

`public-suffix-list.dat` is unmodified source data under its preserved MPL-2.0
notice, downloaded from
https://publicsuffix.org/list/public_suffix_list.dat.
Snapshot version: 2026-10-31_14-17-28_UTC; upstream commit
73f8cc701c084fe07d888ec552b2f0b53281a674. There is no runtime network fetch or new
package dependency. Update the snapshot explicitly with a reviewed data change.

Unknown suffixes fail closed: no one-label wildcard assumption establishes an
external boundary. If either hostname lacks a recognized registrable domain
(except IP addresses and literal localhost), request and development-warning
classes need the exact-host, reasoned `sameSiteException`. A suffix class cannot
provide that exception. Validation and runtime matching enforce the same rule.
