# Demo video

Target 2:45. Hard limit 3:00. Avatar on camera for the opening and the close; screen recording fills the middle under the same voice track.

## Narration script (for HeyGen Studio, one render)

> Eighty-eight million Americans are served by a water system with a health-based violation on record. That isn't a secret. It's public record, spread across federal databases in formats nobody reads. I'm Artem Akulov, and I made that record something an AI agent can actually use.
>
> Ask any assistant whether the water at an address is safe and you'll get a fluent paragraph. It's reading a web page. It can't tell a zero somebody measured from a blank nobody filled in, so it guesses, and on health data it guesses reassuringly.
>
> This page fixes that at the source. It publishes six tools through WebMCP, and an agent calls them like functions instead of scraping the screen. Forty-two thousand US ZIP codes. Every value comes back with where it came from, when it was published, and the legal threshold it's judged against. Lead arrives with the EPA action level of fifteen parts per billion and the regulation that sets it, in the same payload. The model can't misquote a number it never had to read off a page.
>
> And when a figure isn't in the public record, the tool says so, and says why. It never returns a zero it doesn't have.
>
> Then it stops being a lookup. This shortlist is shared state. The agent adds a ZIP and the row appears while I'm watching, marked as added by the agent. I can change it. We're editing the same object, not passing messages about it.
>
> Search runs the whole country and returns three numbers instead of one: measured and passing, measured and failing, and how many ZIP codes nobody has measured at all. That third number is the one that usually disappears.
>
> And it ends with something you keep. The agent drafts a letter to the water system serving that address, built only from facts that are on the record, with everything else turned into a question rather than an accusation. If no contact is published for that utility, it refuses to invent one.
>
> The dataset behind this is ZipCheckup's own, accepted into the AWS Registry of Open Data, built from EPA drinking-water records and published water-quality reports, covering two hundred and eighty-two million people.
>
> The code is open, the data is CC-BY, and it runs with no API key. Point an agent at it and it will tell you what's true, what isn't known, and what you can do about it. Thanks for watching.

## Screen recording beats, cut to the voice track

Cue points are generated from each middle paragraph's share of the rendered audio; `scripts/record-demo.mjs` holds the numbers and replays the product against them.

| Cue | Beat | On screen |
|---|---|---|
| open | who and what | avatar |
| 0:00 | the stakes | page hero, badge reading native WebMCP and 6 tools |
| 0:12 | one question instead of four databases | run 90210, card fills, 11 of 14 known |
| 0:26 | six tools, called not scraped | registered tools panel |
| 0:42 | lead with its threshold and citation | hold on the lead cell, EPA action level visible |
| 0:55 | shared state | agent adds two ZIPs, rows flash, activity log fills |
| 1:10 | three numbers | find_safer_zips tally: passed / failed / not measured |
| 1:24 | something you keep | letter panel, facts asserted vs questions asked |
| close | credits | avatar |

Lead with a well-covered ZIP, not a sparse one. The mechanism is proved by three marked unknowns sitting beside eleven known values; a mostly-empty card proves it too, but reads as a thin product.

Do not narrate the revoke or re-register buttons; they read as debugging on camera.
