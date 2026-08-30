# Demo video

Target 2:45. Hard limit 3:00. Avatar on camera for the opening and the close; screen recording fills the middle under the same voice track.

## Narration script (for HeyGen Studio, one render)

> I'm Artem Akulov. I build ZipCheckup, an open dataset of US home environmental risk. For this challenge I made a page that an AI agent can operate, not just read.
>
> Here's the problem. Ask any assistant whether the drinking water at an address is safe, and you'll get a confident paragraph. The data underneath does not support confidence. In our dataset of forty-two thousand ZIP codes, the safety score exists for twenty-six percent of them. One column is empty for every single row. Over a thousand ZIP codes are listed with every field blank.
>
> An assistant reading a web page sees an empty table cell. It cannot tell "no violations were recorded" from "nobody ever checked". So it fills the gap with the most fluent answer available, and on health data that is usually a reassuring one.
>
> WebMCP changes what gets exchanged. The page registers six tools. Instead of scraping a number off the screen, the agent calls a function, and gets back a value with its source, its snapshot date, and the legal threshold it is judged against.
>
> Watch what happens when data is missing. This ZIP has one known metric out of fourteen. Every other field comes back as an explicit unknown, with the reason attached and a statement of what it is not a claim of. There is no code path in this project by which a missing measurement reaches an agent as zero.
>
> Now the part I care about most. The shortlist is shared state. When the agent adds a ZIP, it calls the same function my button calls, and the row appears while I watch, marked as added by the agent. I can remove it. The activity log shows every call, and how much of each answer was actually known.
>
> Finally, the agent drafts a letter to the water system. The prose is built only from facts that are known. Everything unknown becomes a question instead of an accusation. And when the dataset publishes no contact for that utility, the tool refuses to name a recipient rather than inventing a plausible one.
>
> One more thing. An agent using these tools found a mistake we hadn't: our lead figure is not the ninety percentile sample it looks like. We measured, confirmed the agent was right to doubt it, and shipped that finding.
>
> The code is open, the data is CC-BY, and the whole thing runs with no API key. Thanks for watching.

## Screen recording beats, cut to fit the voice track

| From | Beat | On screen |
|---|---|---|
| 0:00 | opening | avatar |
| 0:22 | the problem | page hero, badge showing native WebMCP and 6 tools |
| 0:48 | the empty cell | scroll to a ZIP card with mostly amber unknown cells |
| 1:05 | six tools | registered tools panel, then the badge popover from `getTools()` |
| 1:25 | missing data | run 01004, hold on 1 of 14 metrics known |
| 1:50 | shared state | agent adds a ZIP, row flashes with the agent badge, activity log fills |
| 2:15 | the letter | letter panel, recipient shown unresolved, facts vs questions counter |
| 2:35 | close | avatar |

Do not narrate the abort or re-register buttons; they read as debugging on camera.
