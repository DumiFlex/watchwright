<!-- Made from https://dumiflex.github.io/watchwright/guide/tasks by `pnpm --filter watchwright skill-references`; edit the site page, not this file. -->

# Setup, teardown and tasks

Tests often change the site they test: they add items, delete them, import data. A pack can put the site back around its runs, so the people who use the app day to day find it the way they left it. Four parts work together:

- **`setup`** runs at each start of a run, before the first test, and is told whether the run is new, resumed or redone.
- **`teardown`** runs once when the run ends.
- **Tasks** are named steps of the pack that run on their own, from the pack page, the command line, an agent or a schedule.
- **`afterTask`** runs when a paused run goes on after a task used its site.

They share **pack state**: a few named values the server keeps for the pack, such as the name of a backup.

## Pack state

Every one of these hooks, and `beforeAttempt` and `afterAttempt`, gets `state`:

```ts
state.set("original", "backup-2026-11-03"); // any JSON value, up to 64 KB
state.get("original");                      // "backup-2026-11-03", or undefined
state.delete("original");
state.keys();                               // ["original", …]
```

Values last across runs, tasks and server restarts. The pack page's **Tasks** tab lists them under **Saved values**, where you can delete one, and `GET /packs/:id/state` returns them with secrets masked. Keep big data in a file and save its name.

## Setup

`setup` runs each time a run starts: a new run, a resume after it was stopped or the server restarted, and a redo of broken attempts. Besides `{ page, context, browser, h, params, packDir, info }` it gets:

| Field | What it is |
|---|---|
| `start` | `"new"`, `"resume"` or `"redo"`. |
| `run` | `{ id, status }` of this run. |
| `state` | The pack's state. |

A pause and its resume happen inside one start, so they don't run setup again.

## Teardown

`teardown` runs once when a run ends, in the run's browser, with setup's context and a `status`:

- `"finished"`: the run went through its tests.
- `"stopped"`: someone stopped it. A stopped run can be resumed later, so a teardown that puts the site back may want to keep the run's own data for then (see the example below). After **Stop now** the browser context is fresh, since stopping closed the old one.
- `"failed"`: setup threw partway, so a half-done setup can be undone.

It doesn't run when the server shuts down: that run is interrupted and resumes later with the site as it was. An error in teardown goes on the run's log and doesn't change the run's status. Its time limit is the pack's `run.testTimeout` (30 minutes by default).

## Tasks

```ts
tasks: {
  restore: {
    title: "Restore my data",
    description: "Puts back the data the last run's setup saved.",
    run: async ({ h, state, run }) => { … },
  },
},
```

Names are lowercase letters, digits and dashes. A task can also have `readOnly: true` (see below) and a `timeout` in ms.

A task runs as a run of the `task` kind with one step, so you watch it in the live view and it keeps a log, like any run. It's named **Task: _title_** in the runs list. The pack's dashboard leaves task runs out, and a new run doesn't copy its choices from one. It doesn't run the pack's setup or teardown, but it has the pack's helpers in `h`.

Start one:

- On the pack page, open **Tasks** and press **Run**.
- From a script: `POST /runs` with `{ "packId": "…", "kind": "task", "tests": ["restore"] }`.
- From the command line: `watchwright run <pack> restore --kind task --wait`.
- From an agent: the `start_run` tool with `kind: "task"`.
- On a schedule: a schedule whose run fields are `{ "kind": "task", "tests": ["restore"] }`.

### Knowing whether a run is mid-way

A task gets `run`: the pack's latest run that is mid-way, with its `status` (`running`, `pausing`, `paused`, `stopped`, `interrupted`, or `queued` when it's about to resume), or `null` when none is. A task that puts the site back can save the run's data first, so the run gets it back when it goes on.

### When a task starts

Runs of the same site wait for each other, and so does a task, with one exception: **a task starts at once while the site's run is paused**. So you can pause a long run, restore your data, use the app, and resume.

- While the task runs, the paused run can't resume, retry or skip; it says which task it waits for. A broken pause that runs out of time waits for the task before it skips.
- A task started while a run is going waits until that run pauses or ends.
- A run stopped or interrupted holds nothing: a task starts at once.

### Going on after a task

When the paused run goes on, the pack's `afterTask` runs first, before the next test, with setup's context and `tasks` (the titles of the tasks that ran). That's where the run puts its own data back. If the run was paused in the middle of a test, that attempt ends as stopped and runs again from the start, since the task changed the site under it.

If `afterTask` fails, the run logs why and pauses again, so you can put things right by hand and resume.

A task with `readOnly: true` (a backup, a report) changes nothing on the site: the paused run goes on where it was, with no `afterTask` and nothing run again.

## Example: put the person's data back

A pack whose app has its own backup and restore. Setup saves the person's data and loads the test data; teardown and the **Restore** task put the person's data back, and keep the run's data when the run will want it again; `afterTask` and a resumed setup give the run its data back.

```ts
import { pack } from "watchwright";

// The app's own backup and restore, through its API.
async function save(h) { /* returns the backup's name */ }
async function restore(h, name) { /* puts that backup back */ }
async function loadTestData(h) { /* imports the pack's data */ }

// The person's data back. First keeps the run's, when a run will want it again.
async function giveOriginal(h, state, keepRun) {
  if (state.get("holds") !== "run") return; // the person's data is already there
  if (keepRun) state.set("runData", await save(h));
  await restore(h, state.get("original"));
  state.set("holds", "original");
}

// The run's data back, if the person's was put back in the meantime.
async function giveBack(h, state) {
  if (state.get("holds") !== "original" || !state.get("runData")) return;
  await restore(h, state.get("runData"));
  state.set("holds", "run");
}

export default pack({
  name: "My app",
  site: { key: "my-app", baseURL: "http://127.0.0.1:8080/" },

  async setup({ h, start, state }) {
    if (start === "new") {
      state.set("original", await save(h));
      state.set("holds", "run");
      await loadTestData(h);
    } else await giveBack(h, state);
  },
  teardown: ({ h, state, status }) => giveOriginal(h, state, status === "stopped"),
  afterTask: ({ h, state }) => giveBack(h, state),
  tasks: {
    restore: {
      title: "Restore my data",
      run: ({ h, state, run }) => giveOriginal(h, state, run !== null),
    },
  },
});
```

`holds` says whose data is on the site now, so a second **Restore** doesn't save your own data over the run's.

## In `pack.yaml`

A pack without code can have `teardown`, `afterTask` and `tasks` as steps:

```yaml
teardown:
  - goto: /admin/restore
  - click: { role: button, label: Restore latest backup }
tasks:
  restore:
    title: Restore my data
    steps:
      - goto: /admin/restore
      - click: { role: button, label: Restore latest backup }
```

Steps can't read pack state or the `run` a task sees; for those, write the pack file in code.
