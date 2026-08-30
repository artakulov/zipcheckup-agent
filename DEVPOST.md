# ZipCheckup Agent

**A page an agent can operate, on data that is honest about what it does not know.**

Live: https://artakulov.github.io/zipcheckup-agent/
Code: https://github.com/artakulov/zipcheckup-agent

---

## Why this use case fits WebMCP

Ask any assistant whether the drinking water at an address is safe, and you will get a confident paragraph. The underlying civic data does not support confidence. In the 42,679-ZIP dataset behind this page, the composite safety score exists for 26.1% of ZIP codes. Named contaminants exist for 19.6%. One column is empty for every single row. 1,335 ZIP codes are enumerated with every field blank.

An assistant reading a rendered web page sees a table cell. It cannot tell an empty cell that means *no violations were recorded* from one that means *nobody has ever matched a record to this ZIP*. So it smooths the gap into the most fluent answer available, which on health data is usually a reassuring one.

WebMCP changes the unit of exchange. Instead of scraping a number off the screen, the agent calls a function that returns a typed envelope:

```jsonc
{ "metric": "boil_water_advisories", "status": "unknown", "value": null,
  "unknown_reason": "this column is present in the source schema but empty for all 42,679 rows",
  "not_a_claim_of": "zero, none, clean, safe, or that the metric was measured and came back negative",
  "how_to_resolve": "Ask the water system or the state drinking-water primacy agency" }
```

There is no code path by which a missing measurement reaches an agent as `0`. Every present value carries its source, its snapshot date, and the legal threshold it is judged against with the regulatory citation. This is a property the page can only enforce because it, not the model, decides what leaves the page.

## How the user experience is better

**Before:** to compare three addresses on drinking water, lead, radon and enforcement history, a person opens several federal databases with different formats and vintages, and reconciles them by hand.

**Now:** they ask, in one conversation, and the agent calls five tools against a dataset covering every US ZIP code, returns values with their provenance, and writes the shortlist onto the page in front of them.

**And the part that matters most:** when the agent has no data, the person is told so explicitly, in the same breath as the numbers. Searching for ZIPs above a safety-score threshold does not silently return a short list; it returns the list *and* the count of ZIP codes excluded because their score is unknown rather than low.

## What people and agents can now do together that was difficult before

The shortlist is genuinely shared state, not a display. The agent's `zipcheckup_update_shortlist` and the person's "Add" button call the same function in the same store. Rows record who added them and render with an "added by agent" badge and a brief highlight, so a person watches the model work rather than reading a report about it afterwards. An activity log prints every call with its arguments, its duration and its known/unknown counts.

That is the collaboration this could not do before: the person steers, the agent researches across 42,679 ZIP codes, and both write into one artifact that either of them can correct. The agent is not narrating a page. It is operating one, in the open, while its work is visible and reversible.

The read tools compose into a real task: look up three ZIPs, ask what a metric actually measures and against which threshold, search for candidates that were *measured and passed* rather than merely unmeasured, and shortlist the survivors with a note.

## How WebMCP is implemented

Five tools registered through `document.modelContext.registerTool` under a single page-level `AbortController`. The page reads its own registration back through `getTools()` and shows the result in the header badge, so what is displayed is evidence rather than a claim. A **Revoke all** button calls `abort()` and the badge drops to zero live via the `toolchange` event, which is the correct demonstration of cancellation now that `unregisterTool` has been removed from the spec.

Compatibility decisions, all measured on Chrome 152 rather than taken from documentation:

- `navigator.modelContext` is absent; the spec moved the entry point to `document` on 2026-04-23. Targeting `navigator` fails outright.
- `getTools()` is asynchronous, and returns `inputSchema` as a **JSON string** on Chrome 149-153 and as an object from 154+. The code branches on `typeof`.
- `RegisteredTool.title` defaults to `""`, not `undefined`, so `title || name` is correct and `??` is not.
- `executeTool()` is a non-standard Chromium extension taking a `RegisteredTool` object and a JSON string, so nothing required depends on it.

For anyone whose browser has no native WebMCP, the page vendors `@mcp-b/webmcp-polyfill` 5.0.1 as a pinned 24 KB IIFE, so registration works everywhere. For anyone without an agent attached at all, an on-page **Agent console** builds its form from each tool's own `inputSchema` and calls the tool directly, so every contract is inspectable by hand.

`scripts/mcp-bridge.mjs` goes the other way: it opens the page in Chrome with native WebMCP and re-exposes whatever `getTools()` reports as an ordinary stdio MCP server, letting agents that are not in a browser use the page's tools. It hardcodes no tool names, so it tests the registration instead of reimplementing it.

## What we verified, and how

The claim being made here is about honesty under missing data, so the tests are about that:

- `npm test` and `npm run smoke` run 55 assertions in real Chromium against the **deployed** URL. They assert that no unknown metric is ever serialised as `0`, that every unknown carries both a reason and a `not_a_claim_of`, that a ZIP with an unknown value is never ranked best or worst, that the all-empty column produces no ranking at all, and that every search match has a *known* value on the metric it was filtered by.
- `npm run verify:data` re-derives every shipped artifact from the source bucket and exits non-zero on drift.
- The build refuses to run on a shape assertion failure. This is not ceremony: 2,158 rows of the source contain quoted fields with embedded commas, and parsing with `split(',')` shifts columns and produces values like `home_safety_grade: 59` - health data that is wrong but plausible.

We also ran a real agent against the tools through the bridge, without telling it which tool to use. It found them from their descriptions, chained them, and carried the doctrine into its own prose unprompted: *"These blanks do not mean zero, clean, compliant, or safe."* It then noticed something we had not: the dataset assigns ZIP 90210 to the Los Angeles Department of Water and Power, while the City of Beverly Hills runs its own system for much of that area. ZIP boundaries and water-service areas do not nest. That caveat is now in the shipped metric dictionary, found by an agent using the tools we built for it.

## Data

[ZipCheckup Open Data](https://registry.opendata.aws/zipcheckup-us-home-environmental-risk/), accepted into the AWS Registry of Open Data, CC BY 4.0. Snapshot 2026-08-19, 42,679 ZIP codes, sourced from EPA SDWIS, utility Consumer Confidence Reports and EPA radon zones. Thresholds are cited to 40 CFR Part 141 Subpart I and verified against EPA's published rule. The composite safety score ships with `threshold.status: "not_applicable"` because a vendor composite has no statutory basis and pretending otherwise would be the same error the project exists to prevent.

The dataset is committed to the repository, so the project clones and runs with no API key, no build step and no network access. `web/data/BUILD.json` records the source URL, ETag and per-column coverage of the exact bytes shipped.

## Built with

JavaScript (ES modules, no framework, no bundler), WebMCP, `@mcp-b/webmcp-polyfill`, Node.js, Playwright, GitHub Pages / Cloudflare Pages, AWS Registry of Open Data, EPA SDWIS.
