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

Once a run is over, its page shows the results as a grid: one row per test, one column per attempt, with each attempt's status, its score and its flags, and the test's mean score at the end. Scale scores count on a 1-to-5 footing so tests with different scales compare; choices and yes/no criteria are shown but not averaged.

## Reviews from agents and scripts

Each review belongs to a reviewer: the name a client sends in `x-watchwright-client`. The web page is `web`. An agent that sends its own name keeps its own review of the same attempt, and the web page shows it below yours, read only. See [Reviews in the HTTP API](../reference/http-api#reviews).

```bash
curl -X POST http://127.0.0.1:7420/api/v1/runs/1a2b3c4d/attempts/0123456789ab/review \
  -H "content-type: application/json" -H "x-watchwright-client: agent-7" \
  -d '{ "scores": { "overall": 4, "layout": "Fine" }, "note": "Second result is off-topic." }'
```
