# Reviewing results

Passed and failed say whether a test's checks held. Many things worth knowing aren't checks: whether an answer read well, whether a layout looked right, whether a search found the best product. For those, you score each attempt by hand, or let an agent score it, against a rubric the pack defines.

## The rubric

A pack lists the criteria in `rubric`. Each one is a 1-to-N scale (`scale`, 2 to 10, 5 when nothing else is given), named `choices`, or `yesNo`:

```ts
export default pack({
  name: "Shop search",
  rubric: [
    { id: "overall", title: "Overall", scale: 5 },
    { id: "relevance", title: "Relevant results", description: "Do the first five results match the query?", scale: 5 },
    { id: "layout", title: "Layout", choices: ["Broken", "Rough", "Fine"] },
  ],
  // …
});
```

A test can add criteria of its own or drop some of the pack's:

```ts
test("C1", {
  title: "Checkout total",
  review: {
    drop: ["relevance"],
    add: [{ id: "total-right", title: "Total looks right", yesNo: true }],
  },
}, async ({ h }) => { /* … */ });
```

A pack without a rubric is scored on one 1-to-5 **Overall**. The pack page's **Rubric** tab shows the criteria and which tests change them. A run keeps the rubric it started with, so editing the pack later doesn't change how old runs are scored.

## Scoring on the web page

Open an attempt from the run page. The **Review** panel beside the results has one row of buttons per criterion and a note. Click a score, or focus a row and press a digit; pick the same score again to clear it. Changes save by themselves a moment later. J and K move to the next and previous attempt, so you can work through a run from the keyboard.

To talk about one picture or one step, use **Add to review note** in the screenshot viewer or beside a step on the **Steps** timeline. It adds a line naming the shot's file (`Shot 03-results.png: `) or the step and when it started (`Step send › wait at 0:12: `) to your note, with the cursor after it.

Once a run is over, its page shows the results as a grid: one row per test, one column per attempt, with each attempt's status, its score and its flags, and the test's mean score at the end. Scale scores count on a 1-to-5 footing so tests with different scales compare; choices and yes/no criteria are shown but not averaged.

## Comparing runs

**Compare** in the top bar puts up to six runs of one pack side by side: tests down the side, runs across the top. Runs with different parameter values make a matrix, for example one run per model, and the parameters that differ are shown in bold. Each cell has the attempt's status, score, flags and metrics; **Show in cells** adds a screenshot or a kept text to every cell, and **All screenshots** on a row opens every screenshot of that row's attempts side by side. When the cells show a screenshot, **Compare "name"…** on a row opens two of them in one view: side by side, a **Wipe** with a line you drag across, or an **Overlay** that marks the changed pixels in red with a box around them. It says what share of the pixels changed and where; pick any two attempts of the row as before and after. Search the rows by test id or title. **Only tests that differ** keeps the rows where the runs went differently, by the same rule as Since the last run below (a test one run doesn't have counts too); it starts on when there are more than twelve rows, and the export always has every test. Click a cell to open the attempt and review it. The address holds the runs and the choice, so a comparison can be shared. A finished run's page has a **Compare** button that starts one with that run.

## Exporting

A finished run's page also shows **Since the last run**: the attempts whose status, flags, score or time moved since the newest earlier run of the same pack with the same parameters and the same chosen tests (else the newest with the same parameters, so a full run is compared with the last full run, not a quick run of three tests). The first ten show, with **Show all** for the rest; attempts only one of the two runs has are counted under the list. A score counts as moved at half a point, a time at half again as long or short (and at least 2 seconds apart). **Compare side by side** opens both runs on the compare page.

**Export** on a run page or the compare page downloads the results as Markdown: the runs with their parameters and mean scores, then one section per test with each attempt's status, flags, metrics, the scores as a small table, the reviewers' notes and links to the screenshots and files (kept texts, collector records, and the files tests and collectors saved). The plain Markdown links to the Watchwright server. **Markdown and files (zip)** puts the screenshots and files next to the Markdown, under `shots/<run>/<attempt>/` and `files/<run>/<attempt>/`, so it reads anywhere, for example attached to an issue. Videos and traces stay out of the zip; open them from the attempt page.

## Reviews from agents and scripts

Each review belongs to a reviewer: the name a client sends in `x-watchwright-client`. The web page is `web`. An agent that sends its own name keeps its own review of the same attempt, and the web page shows it below yours, read only. See [Reviews in the HTTP API](../reference/http-api#reviews).

```bash
curl -X POST http://127.0.0.1:7420/api/v1/runs/1a2b3c4d/attempts/0123456789ab/review \
  -H "content-type: application/json" -H "x-watchwright-client: agent-7" \
  -d '{ "scores": { "overall": 4, "layout": "Fine" }, "note": "Second result is off-topic." }'
```
