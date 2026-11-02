# Dashboards plan

Status: plan, for Dumi to review (2026-11-02). It is built after the Docker step of [self-hosting.md](self-hosting.md), which goes on meanwhile.

Dumi, 2026-11-02: "we should probably work on some dashboard customization, since many runs can come with their own setups, outputs, reviews and so on."

Today every pack looks the same at a glance: the public status page ([Sharing](../../packages/site/guide/sharing.md)) and the runs list show passed, failed and broken counts. That's right for a plain test pack and says little about a pack whose runs are judged by numbers (a page's load time, an AI answer's length), by review scores, or by what they produced (a report, a screenshot, the model a run used). This plan lets each pack say what its dashboard shows, from things Watchwright already records, and uses that in three places.

Everything here is general: a dashboard is built from the outputs any pack can record (`h.metric`, `h.text`, `h.file`, screenshots, flags, rubric scores, a run's params and info). Nothing is for one site.

## 1. What a dashboard is

A **dashboard** is an ordered list of **tiles** for one pack. Each tile shows one thing across the pack's last runs (20 by default):

| Tile | Shows | Read from |
|---|---|---|
| `outcome` | Passed, failed and broken per run, and the row of marks the status page has now. The default when a pack says nothing. | run counts |
| `metric` | One `h.metric` value per run (mean, median, last, min or max over the run's attempts), as a number and a trend line; a goal draws a line and colors the latest value. | `runs_attempts.metrics` |
| `score` | The mean review score of one rubric criterion per run, or of all scale criteria. | reviews |
| `flag` | How many attempts per run raised a flag (a finding, a robot check). | `runs_attempts.flags` |
| `value` | The latest value of a run param or a run info fact (the model, the app's version), with when it last changed. | runs |
| `shot` | The latest screenshot with a name, from one test or any. | artifacts |
| `output` | The latest `h.text` or `h.file` with a name: a link, and a preview for Markdown and images. | `runs_attempts.texts`, artifacts |

Any tile can narrow to one test (`test: checkout`) or to runs with certain params (`params: { lang: de }`), so a pack that runs the same tests for several models can show one tile per model.

## 2. Where it comes from

**The pack says what it wants** (recommended): a `dashboard:` block in `pack.yaml` (and the same field in `pack.ts`), because the pack's author knows what its outputs mean, and it travels with the pack:

```yaml
dashboard:
  runs: 20
  tiles:
    - outcome
    - { metric: load-time, of: median, unit: ms, goal: { below: 1500 }, title: Page load }
    - { score: overall, title: Review score }
    - { value: info.model, title: Model }
    - { shot: checkout, test: checkout }
    - { output: summary.md, public: false }
```

**People can change it without editing the pack:** Settings › Dashboards (users) keeps an override per pack in the server's database: tiles added, hidden or moved. The page offers a **Customize** mode with a tile picker that lists the metric, text, file, shot, flag and criterion names found in the pack's recent runs, so nobody types names. "Reset to the pack's" drops the override.

## 3. Where it shows

1. **The pack page** gets a Dashboard section at the top, for everyone signed in. This is the main place to look at a pack.
2. **The public status page** (`#/status`) shows each pack's tiles instead of only the marks. A tile is public unless it says `public: false`, and an admin can hide more in Settings › Sharing. Outputs and shots are public only when the status page's **Runs open read-only** is on, since they come from the runs.
3. **The runs list** "at a glance" tiles stay as they are (across all packs). When the list is filtered to one pack, it shows that pack's dashboard instead.

## 4. Shared runs show more of what a run made

The read-only run page (share links and the status page) shows only status, errors, screenshots, videos and files today. It gets what the run page has, read-only:

- **Texts** (`h.text`) with the Markdown preview, and **metrics** per attempt.
- **Review scores and notes**, with the reviewer's name shown as "Reviewer 1", "Reviewer 2" unless the share includes names (a new toggle on the Share box).
- The **run's dashboard** for that one run on top: its metric values, mean scores, the model it used.

A pack can keep things out of every share and the status page with `share: { texts: false, outputs: [secret-report.md], reviews: false }`. Traces and network files stay private unless a share includes them, as now.

## 5. API

- `GET /packs/:id/dashboard?runs=20`: the pack's tiles (the pack's, with the override applied) and each tile's data. One query per tile kind over `runs` and `runs_attempts`, so 20 runs stay cheap.
- `GET /packs/:id/dashboard/names`: the names the tile picker offers, from the last 50 runs.
- `POST /packs/:id/dashboard` `{ tiles }` (user) saves the override; `DELETE` removes it.
- `GET /public/status` returns each pack's public tiles with their data.
- The `dashboard` tool for agents: `pack_dashboard`, so an agent can ask "how is the load time doing" without reading results one by one.

## 6. Pull requests

1. This plan.
2. Server: the `dashboard` field in the pack format (YAML and TS, validated), tile data, the override store (a `dashboards` plugin with its own migration), the actions and the MCP tool, tests.
3. Web: the pack page's Dashboard section with tiles (metric trend with `SparkLine`, score, value, shot, output) and Customize mode with the picker. Screenshots.
4. Public: the status page's tiles, the shared run page's texts, metrics, reviews and run dashboard, the `share:` block and the reviewer-names toggle. Screenshots.
5. Docs: a "Dashboards" guide, the pack format fields, the API; sign-off on real runs.

## 7. Questions for Dumi

1. **Who decides:** the pack's `dashboard:` block with an override in Settings (recommended), or only the web page?
2. **Reviews in shares:** show scores and notes with anonymous reviewer names by default (recommended), or leave reviews out unless the share asks for them?
3. **Anything missing:** what does the Wildcard bench, or another pack you have in mind, need on its dashboard that the tiles in section 1 can't show?
