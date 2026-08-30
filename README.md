# ZipCheckup Agent

**A page that is a tool, not just a document.** It registers [WebMCP](https://github.com/webmachinelearning/webmcp) tools with the browser so an AI agent can query US home environmental-risk data by calling functions on the page, instead of scraping the rendered HTML.

Built for [The WebMCP Challenge](https://webmcp.devpost.com/) (OpenAI + Devpost, September 2026).

## The problem it solves

Ask any assistant whether the drinking water at an address is safe and you will usually get a confident answer. Civic environmental data does not support confident answers: coverage is patchy, agencies publish on different cadences, and a blank cell means *nobody measured*, not *nothing was found*.

Every tool on this page returns a **value envelope** instead of a bare number:

```jsonc
{ "metric": "boil_water_advisories", "status": "unknown", "value": null,
  "unknown_reason": "this column is present in the source schema but empty for all 42,679 rows of the 2026-08-19 snapshot",
  "not_a_claim_of": "zero, none, clean, safe, or that the metric was measured and came back negative",
  "how_to_resolve": "Ask the water system or the state drinking-water primacy agency" }
```

Missing data can never reach an agent as `0`. Every present value carries its source, its snapshot date and the legal threshold it is judged against, with the regulatory citation.

## Run it locally

No API keys, no build step, no network access required. The dataset is committed.

```bash
git clone https://github.com/artakulov/zipcheckup-agent
cd zipcheckup-agent
npm run serve      # http://localhost:4173
```

## Seeing the tools

| Where | What happens |
|---|---|
| ChatGPT desktop browser | Native `document.modelContext`. Tools appear as Site tools; no flag needed. |
| Chrome / Edge 149+ | Native, via the WebMCP origin trial on the deployed domain, or `chrome://flags/#enable-webmcp-testing` locally. |
| Any other browser | The page loads a 24 KB polyfill ([`@mcp-b/webmcp-polyfill`](https://www.npmjs.com/package/@mcp-b/webmcp-polyfill) 5.0.1, vendored and pinned) so registration still works. |
| No agent attached | Use the **Agent console** on the page to call any tool by hand and read the exact payload an agent would receive. |

The status badge in the header reports which path is live and how many tools are registered. The tool list under it is read back from `document.modelContext.getTools()`, so it is evidence of registration rather than a claim of it.

## Data

[ZipCheckup Open Data](https://registry.opendata.aws/zipcheckup-us-home-environmental-risk/), accepted into the AWS Registry of Open Data, CC BY 4.0. 42,679 US ZIP codes, snapshot 2026-08-19. See [`docs/DATA.md`](docs/DATA.md) for per-column coverage and the known caveats, and `web/data/BUILD.json` for the exact source URL, ETag and checksums this build ships.

`npm run verify:data` re-derives every shipped artifact from the source bucket and exits non-zero on any drift.

## Licence

Code MIT ([`LICENSE`](LICENSE)). Data CC BY 4.0 ([`LICENSE-DATA`](LICENSE-DATA)).
