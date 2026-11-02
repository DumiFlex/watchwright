# Dashboards plan

Status: built (2026-11-02), in PRs #181 to #184 and the sign-off PR. Agreed in outline by Dumi (2026-11-02) and built after the Docker step of [self-hosting.md](self-hosting.md).

Dumi, 2026-11-02: "we should probably work on some dashboard customization, since many runs can come with their own setups, outputs, reviews and so on." And on the first draft: go with the suggestions, look at what the Wildcard bench and smoke packs need, and come up with more components and fields people can set up.

Today every pack looks the same at a glance: the public status page ([Sharing](../../packages/site/guide/sharing.md)) and the runs list show passed, failed and broken counts. That's right for a plain test pack and says little about a pack whose runs are judged by numbers (a page's load time, an AI's seconds per answer), by review scores, by which setup they ran with (a model, a language, a tool format), or by what they produced (a report, a screenshot). This plan lets each pack say what its dashboard shows, from things Watchwright already records, and lets people change it on the page.

Everything here is general: a dashboard is built from what any pack can record (`h.metric`, `h.text`, `h.file`, collectors' metrics and files, screenshots, flags, rubric scores, a run's params and info, tests' sections and tags). Nothing is for one site. The Wildcard packs below are the first two users, used to check the design covers real needs.

## 1. What the two Wildcard packs need

**The AI bench** (`bench/` in the Wildcard Pipeline repo) runs the same tests against one model per run (`model` param: q9, q35, q27, haiku, sonnet, opus, fable). Each attempt records the `AI calls` and `AI s` metrics (from its `aiDebug` collector), finding, robot and info flags, the `AI model` run info, and is scored by a person on four criteria: `correct`, `follows`, `quality` (1 to 5) and `ui` (none, minor, major). Tests are in sections (wildcards, fixed values, combines…) and some are tagged `changes-library`.

What Dumi needs to see: **which model is best and at what cost.** One row per model with its mean scores, AI seconds per test and finding count; the same split by section (a model can be good at wildcards and poor at the pack builder); how many attempts are scored so far (scoring takes days); score against time per model; and the latest answers that scored low, to read.

**The AI smoke pack** (`bench/smoke/`) checks every AI flow pass or fail in about 6 minutes, with `fake`, `reset` and `format` (auto, native, json) params and finding flags (`ai-error`, `wrong-card`, `apply-did-nothing`…).

What Dumi needs to see: **is anything broken right now, and since when.** A grid of tests by recent runs, colored by outcome; the same per `format`, since the chat tests run once with each; which tests flip between pass and fail (flaky); the findings of the latest run with their messages; and run time per run.

Neither fits counts and a row of marks. Both fit the tiles below.

## 2. Tiles

A **dashboard** is an ordered list of **tiles** for one pack. Every tile has the same common fields (section 3); this is what each kind shows.

### Numbers over time

| Tile | Shows |
|---|---|
| `outcome` | Passed, failed and broken per run, and a row of marks. The default when a pack says nothing. |
| `metric` | One metric per run (`of`: mean, median, p90, sum, min, max or last over the run's attempts), as a number with a trend line. `goal: { below: 1500 }` or `{ above: … }` draws a line and colors the latest value. Collectors' metrics count too (`AI s`). |
| `score` | The mean of one rubric criterion per run, or of all scale criteria; shows how many attempts are scored, so a half-reviewed run reads as one. |
| `choices` | How often each answer of a `choices` or yes/no criterion was given (`ui`: none, minor, major), as a stacked bar per run. |
| `flags` | How many attempts per run raised a flag, one flag or a kind (`kind: finding`). |
| `duration` | How long each run took, and the slowest tests. |
| `stat` | One big number with the change from the period before (pass rate this week, median AI seconds), like the runs page's tiles. |

### Comparing setups

| Tile | Shows |
|---|---|
| `leaderboard` | One row per value of a param (or info fact), over the runs in range: chosen columns (scores, metrics, pass rate, findings, runs) with the best in each column marked. **The bench's model table.** |
| `scatter` | Two measures per group (mean `quality` against mean `AI s` per model), one dot per group. |
| `breakdown` | One measure split by section, tag or test (pass rate per section, mean score per section), optionally per param value: a small table with bars. |

### Which tests

| Tile | Shows |
|---|---|
| `matrix` | Tests down the side, the last runs across, each cell an attempt's outcome; a cell opens the attempt. Optionally one grid per param value. **The smoke pack's grid.** |
| `flaky` | Tests whose outcome changed most often in range, with their last outcomes. |
| `failures` | The latest failed or flagged attempts with their error or flag message, newest first. |
| `lowest` | The attempts with the lowest score on a criterion (or the highest metric), to look at first. |
| `unreviewed` | How many attempts in range wait for a score, with a link to the first. |

### What runs made

| Tile | Shows |
|---|---|
| `value` | The latest value of a param or info fact (`info.AI model`, the app's version), and when it last changed. |
| `shot` | The latest screenshot with a name, from one test or any; `compare: previous` puts the one before beside it. |
| `output` | The latest `h.text` or `h.file` with a name: a link, and a preview for Markdown, JSON and images. |
| `latest` | The latest run as a card: status, counts, label, who started it, and its own values for the dashboard's other tiles. |

### Words and links

| Tile | Shows |
|---|---|
| `note` | Markdown the dashboard's author writes: what the pack checks, who to ask, a link to the app. |
| `links` | Buttons: start a run with a preset, open Compare for the last two runs, export. |

## 3. Fields every tile has

```yaml
- metric: AI s
  title: AI seconds per test     # shown above the tile; a default comes from the kind and name
  of: median
  unit: s
  width: 2                       # 1 to 4 columns of the dashboard grid; phones show one column
  test: W3                       # only this test (or tests: [W3, W4], section: Wildcards, tag: changes-library)
  params: { model: q9 }          # only runs with these param values
  split: model                   # one series per value of this param or info fact, in one tile
  runs: 30                       # how many runs back (default: the dashboard's)
  current: true                  # only current attempts (the default), not ones redone after they broke
  public: false                  # never on the public status page or in shares
```

`split` is what makes one tile answer "per model" or "per tool format" without a tile per value. A dashboard also has:

- `runs` (default 20) and `days` (instead of a count) for its range;
- `filters`: params the person viewing can switch at the top (`filters: [model]`), which then apply to every tile. Picking `model: q9` turns the bench's dashboard into q9's;
- `groups`: tiles in named rows with a heading (`{ title: Scores, tiles: [...] }`), so a long dashboard reads in parts.

## 4. Where it comes from

**The pack says what it wants:** a `dashboard:` block in `pack.yaml`, or the same field in `pack.ts`. The pack's author knows what its outputs mean, and the dashboard travels with the pack. The Wildcard bench's would be:

```yaml
dashboard:
  runs: 40
  filters: [model]
  groups:
    - title: Models
      tiles:
        - { leaderboard: model, columns: [score.correct, score.follows, score.quality, metric.AI s, flags.finding, runs], width: 4 }
        - { scatter: model, x: metric.AI s, y: score.quality, width: 2 }
        - { breakdown: section, measure: score.quality, split: model, width: 2 }
    - title: To look at
      tiles:
        - { unreviewed: true }
        - { lowest: quality, width: 2 }
        - { failures: true, kind: finding }
```

And the smoke pack's:

```yaml
dashboard:
  runs: 15
  tiles:
    - { matrix: true, split: format, width: 4 }
    - { failures: true, width: 2 }
    - { flaky: true }
    - { duration: true }
```

**People change it on the page.** The pack page's dashboard has **Customize**: add a tile from a picker that lists the metric, text, file, shot, flag, criterion, param and section names found in the pack's recent runs (nobody types names), drag tiles to reorder, resize them, edit a tile's fields in a side panel, and hide one. The change is kept on the server per pack (Settings never has to know the pack's files), and **Reset to the pack's** drops it. Users and admins can customize; viewers see the result.

## 5. Where it shows

1. **The pack page** gets the dashboard at the top, with its filters. This is the main place to look at a pack.
2. **The public status page** (`#/status`) shows each pack's public tiles below its name. Tiles that show what runs made (`shot`, `output`, `failures`, `lowest`) are public only when the status page's **Runs open read-only** is on. An admin can hide more tiles from the public in Settings › Sharing.
3. **The runs list**, filtered to one pack, shows that pack's dashboard instead of the all-packs tiles.
4. **Agents** get a `pack_dashboard` MCP tool: the tiles' numbers as data, so an agent can answer "which model is fastest on combines" without reading results one by one.

## 6. Shared runs show more of what a run made

The read-only run page (share links and the status page) shows status, errors, screenshots, videos and files today. It gets what the run page has, read-only:

- **Texts** (`h.text`) with the Markdown preview, and **metrics** per attempt;
- **Review scores and notes**, with reviewers shown as "Reviewer 1", "Reviewer 2" unless the share includes names (a new toggle on the Share box);
- the pack's dashboard tiles for **that one run** on top (its metric values, mean scores, the model it used).

A pack can keep things out of every share and the status page with `share: { texts: false, outputs: [secret-report.md], reviews: false }`. Traces and network files stay private unless a share includes them, as now.

## 7. How it's built

- **Data.** Tiles read `runs` and `runs_attempts` (counts, flags, metrics, texts, params, info), the reviews and the artifacts, all already in the database; the server answers every tile of a dashboard in one request. For a range of 40 runs this is a few indexed queries; nothing is precomputed. Sections and tags come from the pack's tests as loaded now (a test removed since shows under its id).
- **Pack format.** `dashboard` and `share` are validated like the rest of the pack file, with line-numbered messages in the editor for a misspelled tile or field.
- **The override** is a `dashboards` plugin with its own migration: one row per pack with the tiles and who changed them last.
- **Web.** Tiles are components in `src/components/tiles/`, built on the control kit, `SparkLine`, `BarChart` and `StatTile`, and shown at `#/kit` like other controls. Every tile works at phone width (one column) and in every look and mode.

API:

- `GET /packs/:id/dashboard?runs=&days=&<filter>=`: the dashboard (pack's, with the override applied) and every tile's data.
- `GET /packs/:id/dashboard/names`: what the picker offers, from the last 50 runs.
- `POST /packs/:id/dashboard` `{ tiles | groups, runs?, filters? }` (user) saves the override; `DELETE` drops it.
- `GET /public/status` returns each pack's public tiles with their data.

## 8. Pull requests

1. This plan.
2. Server: the `dashboard` and `share` fields in the pack format, tile data for every kind, the `dashboards` plugin with the override, the actions and the MCP tool, tests against a seeded store.
3. Web, numbers and comparing: the pack page's dashboard with `outcome`, `metric`, `score`, `choices`, `flags`, `duration`, `stat`, `leaderboard`, `scatter`, `breakdown`, filters and groups. Screenshots.
4. Web, tests and outputs: `matrix`, `flaky`, `failures`, `lowest`, `unreviewed`, `value`, `shot`, `output`, `latest`, `note`, `links`, and Customize with the picker. Screenshots.
5. Public: the status page's tiles, the shared run page's texts, metrics, reviews and run tiles, the `share:` block and the reviewer-names toggle. Screenshots.
6. Docs (a "Dashboards" guide, the pack fields, the API) and sign-off: the bench's and the smoke pack's dashboards from section 4 on real runs, sent to the pipeline project as a report rather than changed in its repo.

## 9. Decided

- The pack's `dashboard:` block sets the tiles, with changes on the page on top (Dumi, 2026-11-02).
- Shared runs show review scores and notes with anonymous reviewer names by default (Dumi, 2026-11-02).
- The tiles cover what the Wildcard bench and smoke packs need (section 1); more kinds can be added later without changing the format, since a tile is its kind plus the common fields.
