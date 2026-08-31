# ZipCheckup Agent

**Eighty-eight million Americans are served by a water system with a health-based violation on record. This page turns that record into something an AI agent can call.**

Live: https://artakulov.github.io/zipcheckup-agent/
Code: https://github.com/artakulov/zipcheckup-agent

---

## Why this use case fits WebMCP

That 88-million figure is not an estimate. It is 4,268 public water systems in the dataset behind this page, and it is public information - just spread across federal databases in formats no homebuyer will ever open.

So people ask an assistant instead. And an assistant reading a rendered web page sees a table cell. It cannot tell a zero somebody measured from a blank nobody filled in, so it produces the most fluent answer available, which on health data is usually a reassuring one.

WebMCP changes the unit of exchange. Instead of scraping a number off the screen, the agent calls a function and receives a typed value with its provenance attached:

```jsonc
{ "metric": "lead_level_mg_l", "status": "known", "value": 0.0075, "unit": "mg/L",
  "source": { "dataset": "ZipCheckup Open Data", "upstream": "EPA SDWIS and utility CCRs", "license": "CC-BY-4.0" },
  "measured": { "as_of": "2026-08-19" },
  "threshold": { "name": "EPA lead action level", "value": 0.015, "unit": "mg/L",
                 "citation": "40 CFR Part 141 Subpart I", "comparison": "at_or_below" } }
```

The model cannot misquote a number it never had to read off a page, and it cannot lose the threshold that gives the number meaning, because the threshold travels with it.

And when a value is not in the public record, the tool returns an explicit `unknown` carrying the reason and a statement of what that absence does **not** prove. There is no code path in this project by which a missing measurement reaches an agent as `0`. On drinking water that is the difference between an answer and a guess.

## How the user experience is better

**Before:** comparing three addresses on drinking water, lead, radon and enforcement history means opening several federal systems with different formats and vintages and reconciling them by hand.

**Now:** one conversation. Six tools over 42,679 US ZIP codes, every value with its source, its date and the regulation it is judged against.

The search tool returns three numbers instead of one: measured and passing, measured and failing, and how many ZIP codes could not be judged because nobody measured them. Filter Michigan on lead below 0.005 mg/L and it reports 466 passing, 209 failing, and 492 excluded for missing data - and says, in the payload, that exclusion is a data gap and not a safety finding. That third number is the one a conventional site quietly drops.

## What people and agents can now do together that was difficult before

The shortlist on the page is genuinely shared state, not a display. `zipcheckup_update_shortlist` and the person's own Add button call the same function in the same store. Rows record who added them and render with an "added by agent" badge and a brief highlight, so the person watches the model work rather than reading a report about it afterwards. They can delete a row the agent added. An activity log prints every call with its arguments, its duration and its known/unknown counts.

That is the collaboration: the person steers, the agent researches across the whole country, and both write into one artifact either of them can correct.

And it ends with something the person keeps. `zipcheckup_draft_civic_letter` writes to the water system serving that address, composing prose **only** from facts whose status is known - an unknown value physically cannot reach the letter body, because the composer reads from nowhere else. Everything unknown becomes a question to the utility rather than an allegation. When the dataset publishes no contact for that system, the tool returns `resolution: "unresolved"` and refuses to name a recipient instead of guessing one. Measured across a sample of systems, only a minority publish any contact at all, so guessing would be the common case rather than the edge case.

## How WebMCP is implemented

Six tools registered through `document.modelContext.registerTool` under a single page-level `AbortController`. The page reads its own registration back through `getTools()` and shows the result in the header badge, so what is displayed is evidence rather than a claim. A **Revoke all** button calls `abort()` and the badge drops to zero live via the `toolchange` event - the correct demonstration of cancellation now that `unregisterTool` has been removed from the spec.

Compatibility decisions, all measured on Chrome 152 rather than taken from documentation:

- `navigator.modelContext` is absent; the spec moved the entry point to `document` on 2026-04-23, so targeting `navigator` fails outright.
- `getTools()` is asynchronous and returns `inputSchema` as a **JSON string** on Chrome 149-153, as an object from 154+. The code branches on `typeof`.
- `RegisteredTool.title` defaults to `""`, not `undefined`, so `title || name` is correct and `??` is not.
- `executeTool()` is a non-standard Chromium extension taking a `RegisteredTool` object and a JSON string, so nothing required depends on it.

Where a browser has no native WebMCP, the page vendors `@mcp-b/webmcp-polyfill` 5.0.1 as a pinned 24 KB IIFE. Where no agent is attached at all, an on-page **Agent console** builds its form from each tool's own `inputSchema` and calls the tool directly, so every contract is inspectable by hand.

`scripts/mcp-bridge.mjs` goes the other way: it opens the page in Chrome with native WebMCP and re-exposes whatever `getTools()` reports as an ordinary stdio MCP server, letting agents that are not in a browser use the page's tools. It hardcodes no tool names, so it tests the registration rather than reimplementing it. We drove a real coding agent through it without naming any tool; it found them from their descriptions, chained them, and carried the "unknown is not zero" contract into its own prose unprompted.

## Engineering the judges can check

- `npm run smoke` runs 84 assertions in real Chromium **against the deployed URL**, not localhost. Among them: no unknown metric is ever serialised as `0`; a ZIP with an unknown value is never ranked best or worst; every search match has a *known* value on the metric it was filtered by; the word "unknown" never appears in a letter body; and an agent's write renders a row the human can see, attributed to the agent.
- `npm run verify:data` re-derives every shipped artifact from the source bucket and exits non-zero on drift.
- The build refuses to run on a shape assertion failure. This matters: 2,158 rows of the source contain quoted fields with embedded commas, and parsing with `split(',')` shifts columns and produces plausible-looking but wrong health values.
- `docs/TOOLS.md` is generated from `getTools()` on the running page, so the documented contracts are the registered ones.

## Data

[ZipCheckup Open Data](https://registry.opendata.aws/zipcheckup-us-home-environmental-risk/), accepted into the AWS Registry of Open Data, CC BY 4.0. 42,679 US ZIP codes and 10,517 public water systems serving 282 million people, built from EPA SDWIS, published Consumer Confidence Reports and EPA radon zones. Thresholds are cited to 40 CFR Part 141 Subpart I and verified against EPA's published rule. Where a figure is a composite rather than a measurement, it ships with `threshold.status: "not_applicable"` and says so.

The dataset is committed to the repository, so the project clones and runs with no API key, no build step and no network access. `web/data/BUILD.json` records the source URL, ETag and per-column coverage of the exact bytes shipped, and `docs/DATA.md` documents the caveats a developer should know before building on it.

## Built with

JavaScript (ES modules, no framework, no bundler), WebMCP, `@mcp-b/webmcp-polyfill`, Node.js, Playwright, GitHub Pages / Cloudflare Pages, AWS Registry of Open Data, EPA SDWIS.
