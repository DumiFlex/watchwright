# Dashboards

A pack's dashboard shows how its runs went over time, at a glance: outcomes and run times for a plain test pack, and for a pack whose runs are judged by numbers, scores or setups, those numbers, scores and setups. The pack says what its dashboard shows with a `dashboard` block; without one it shows outcomes, run times and the latest failures.

::: info Planned
The server already answers every tile's numbers (`GET /packs/:id/dashboard`, and the `pack_dashboard` tool for agents). The pack page's dashboard, **Customize** on the page, and the tiles on the public status page and in shares come next.
:::

Everything a tile shows is something any pack can record: `h.metric` and collectors' metrics, `h.text`, `h.file`, screenshots, flags, review scores, a run's params and the facts it saved with `info`, and tests' sections and tags.

## The `dashboard` block

```yaml
dashboard:
  runs: 40              # the latest 40 runs (default 20, at most 200)
  filters: [model]      # params the person viewing can pick at the top
  groups:
    - title: Models
      tiles:
        - { leaderboard: model, columns: [score.correct, score.quality, metric.AI s, flags.finding, runs], width: 4 }
        - { scatter: model, x: metric.AI s, y: score.quality, width: 2 }
        - { breakdown: section, measure: score.quality, split: model, width: 2 }
    - title: To look at
      tiles:
        - { unreviewed: true }
        - { lowest: quality, width: 2 }
        - { failures: true, kind: finding }
```

A smaller one, for a pack checked for passes and failures:

```yaml
dashboard:
  runs: 15
  tiles:
    - { matrix: true, split: format, width: 4 }
    - { failures: true, width: 2 }
    - { flaky: true }
    - { duration: true }
```

| Field | What it does |
|---|---|
| `tiles` | The tiles, in order. |
| `groups` | Instead of `tiles`: named rows of tiles, `{ title, tiles }`, so a long dashboard reads in parts. |
| `runs` | How many of the latest runs the tiles read (default 20, at most 200). Runs still queued don't count. |
| `days` | Instead of a number of runs: the runs of the last so many days. |
| `filters` | Params (or facts) the person viewing can pick a value of; the pick applies to every tile. |

In a `pack.ts`, the same block is the `dashboard` option of `pack({ … })`. A misspelled tile kind or field is a load problem with its place, like every other mistake in the pack file.

## Tiles

A tile is its kind with a name (`metric: Load ms`) or `true` (`matrix: true`), plus fields.

### Numbers over time

| Tile | Shows |
|---|---|
| `outcome: true` | Passed, failed and broken per run. |
| `metric: <name>` | One metric per run, over the run's attempts: `of` is `mean` (default), `median`, `p90`, `sum`, `min`, `max` or `last`. `unit` overrides the metric's unit; `goal: { below: 1500 }` (or `above`) draws the line it should stay under (or over). |
| `score: <criterion>` | The mean review score of one criterion per run (`score: true`: every scale criterion), with how many attempts are scored so far. A yes counts 1, a no 0. |
| `choices: <criterion>` | How often each answer of a choices or yes/no criterion was given, per run. |
| `flags: <name or kind>` | How many attempts per run raised a flag: one by name, every flag of a kind (`flags: finding`), or any (`flags: true`). |
| `duration: true` | How long each run took, and the slowest tests (`limit`, default 5). |
| `stat: <measure>` | One number over the runs in range, with the change from as many runs before them. |

### Comparing setups

| Tile | Shows |
|---|---|
| `leaderboard: <param>` | One row per value of a param (or fact), with `columns` of measures (default `[passrate, score, runs]`) and the best value of each column marked. |
| `scatter: <param>` | Two measures, `x` and `y`, per value of a param: one dot each. |
| `breakdown: section` | One `measure` (default `passrate`) per section, `tag` or `test`; with `split`, one column per param value. |

### Which tests

| Tile | Shows |
|---|---|
| `matrix: true` | Tests down the side, runs across, each cell an attempt's outcome. With `split`, one grid per param value. |
| `flaky: true` | Tests whose outcome flipped between passing and not most often (`limit`, default 10). |
| `failures: true` | The latest failed or broken attempts, and attempts with a finding or robot flag, with their message (`kind: finding`: attempts with a finding, whatever their outcome). `limit`, default 10. |
| `lowest: <criterion>` | The attempts with the lowest mean score on a criterion, or with `lowest: metric.<name>`, the highest value of a metric. |
| `unreviewed: true` | How many attempts in range wait for a score, and the first of them. |

### What runs made

| Tile | Shows |
|---|---|
| `value: <param or info.fact>` | The latest run's value, and since when it has been the same. |
| `shot: <name>` | The latest screenshot with that name (`shot: true`: any); `compare: previous` adds the one before. |
| `output: <name>` | The latest `h.text` or `h.file` with that name. |
| `latest: true` | The latest run: status, counts, label, who started it, its params and facts. |

### Words and links

| Tile | Shows |
|---|---|
| `note: <Markdown>` | Your words: what the pack checks, who to ask. |
| `links: [...]` | Buttons: `{ preset: Nightly }` starts a run with a preset, `{ compare: last }` opens Compare for the last two runs, `{ export: true }` exports, `{ url: https://…, label: App }` opens a page. |

### Fields every tile has

| Field | What it does |
|---|---|
| `title` | Shown above the tile. Default: made from the kind and name. |
| `width` | 1 to 4 columns of the dashboard's grid (default 1; 2 for `leaderboard`, `matrix`, `breakdown` and `failures`). Phones show one column. |
| `test`, `tests`, `section`, `tag` | Only these tests' attempts. |
| `params` | Only runs with these values: `{ model: q9 }`. |
| `split` | One series (or grid) per value of this param, in one tile. Write `info.<fact>` for a fact a run saved. |
| `runs` | How many runs back, instead of the dashboard's. |
| `current` | `false` also counts tries that broke and were run again (default: only the try that counts). |
| `public` | `false` keeps the tile off the public status page and shares. |

### Measures

`stat`, `leaderboard` columns, `scatter`'s `x` and `y` and `breakdown`'s `measure` take a measure:

| Measure | Is |
|---|---|
| `passrate` | Passed attempts out of passed, failed and broken ones. Higher is better. |
| `score`, `score.<criterion>` | The mean review score, of every scale criterion or one. Higher is better. |
| `metric.<name>` | The mean of a metric over the attempts (a `stat` takes `of`). Lower is better. |
| `flags`, `flags.<kind or name>` | Attempts with any flag, or with a flag of that kind or name. Lower is better. |
| `duration` | The mean time per attempt, in ms. Lower is better. |
| `runs`, `attempts` | How many. |

## Keeping things out of shares

A `share` block keeps a pack's outputs out of share links and the public status page:

```yaml
share:
  texts: false              # no h.text texts
  metrics: false            # no metrics
  reviews: false            # no review scores or notes
  outputs: [secret-report.md]   # never these texts or files
```
