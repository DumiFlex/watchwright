# Setup, teardown and tasks: putting a site back around runs

Research note, 2026-11-03. The question came from the first pack (an AI bench), but the need is general: a pack changes the site it tests, and the person wants the site back the way it was, both when a run ends and whenever they ask.

## The need

A pack whose tests change the app's data (a library, a shop's catalogue, a CMS) wants to:

1. **At the start of a run**, save the person's own data and load the pack's test data.
2. **When the run ends**, put the person's data back by itself.
3. **Whenever the person asks** (from the web page, the CLI, an agent or a schedule), run the same "put it back" step on its own, queued like a run.
4. **Know whether a run is mid-way.** If one is paused, stopped or interrupted, the step first saves the site as the run left it, so that when the run goes on it gets its own data back before the next test.

## What Watchwright has today

| Need | Today |
| --- | --- |
| 1. Start of a run | `setup` in the pack file (or `setup:` steps in `pack.yaml`). It runs at every start of a run, including a resume and a redo, and can't tell them apart. |
| 2. End of a run | Nothing. `afterAttempt` runs after each attempt, not once at the end. |
| 3. A step on its own | Nothing. The closest is a test the person picks alone in New run, but it's a test: it shows in results, dashboards and pass rates, and a run with it waits for the site like any run, so it can't run while the bench is paused. |
| 4. Knowing about a run | Nothing. A hook sees only its own run, and nothing a pack saves lasts past one run except files. Packs keep module-level variables, which a server restart loses. |

So setup exists; the rest does not. That makes the pack lifecycle incomplete, so this is fix-first work on the testing capability, not a new capability.

## Design

Everything below is general: no site names, and the pack fills in what "save" and "put back" mean for its app.

### Pack state

A small store of named values per pack, kept in the database, so setup, teardown, tasks and the attempt hooks can share them across runs and restarts: `state.get(key)`, `state.set(key, value)`, `state.delete(key)`, `state.keys()`. Values are JSON, up to 64 KB each. The Tasks tab on the pack page shows them and lets a person delete one; `GET /packs/:id/state` returns them (masked like everything else a run records).

Per pack, not per run: the "original data" a task restores belongs to the pack, and a task often runs when no run exists at all. Each hook also gets the run's id, for a pack that wants to keep values per run.

### `setup` learns how the run starts

`setup` gets `start: "new" | "resume" | "redo"` (and `run: { id }`). A new run saves the person's data and loads the test data; a resume puts back what the run had when it stopped.

### `teardown`

Runs once when a run ends: it went through its tests (`status: "finished"`), it was stopped (`"stopped"`), or setup failed partway (`"failed"`, so a half-done setup can be undone). It runs in the run's browser before it closes, after any task on the site is done. It doesn't run when the server shuts down: that run is interrupted and resumes later, with the site as it was. After "stop now" the browser context is replaced first, since stopping closed it. An error is logged on the run; it doesn't change the run's status.

### Tasks

Named steps in the pack: `tasks: { restore: { title, description, readOnly, timeout, run(ctx) } }` (or steps in `pack.yaml`). A task runs as a **run of the `task` job kind** with one item, so it gets everything a run has for free: the queue, the live view, the log, its history on the runs list, `runs.start` from the CLI and agents, schedules and alerts. It doesn't run the pack's setup or teardown.

The task's context has what setup has (`page`, `h`, `params`, `packDir`, `state`) plus `run`: the pack's latest run that is **mid-way** (running, paused, stopped, interrupted, or queued to resume), or `null`. That's how the step knows whether to save the run's data first.

**When a task starts.** Runs of a site wait for each other. A task waits too, with one exception: it may start while the site's run is **paused** (by hand or on a broken attempt). That's the point of the feature: pause the run, use the app, then resume. While the task runs, the paused run can't resume, retry or skip (it says why), and a broken pause that runs out of time waits for the task before it skips. A task queued while a run is going starts at its next pause, or when it ends.

### Going on after a task: `afterTask`

When a paused run goes on after a task used its site, Watchwright runs the pack's `afterTask({ tasks, state, … })` before the next test, to put the run's data back. If the run was paused in the middle of an attempt, that attempt ends as stopped ("a task used the site while it was paused") and runs again from the start, since its page and data changed under it. A task marked `readOnly: true` (a backup, a report) changes nothing: the run goes on where it was, with no `afterTask` and no redo.

If `afterTask` fails, the run logs why and pauses again, so the person can put things right before resuming.

### Why not other shapes

- **Tasks as tests with a flag.** They'd need to stay out of results, pass rates, dashboards, plans and `needs`, which touches every place tests are listed, and still couldn't run during a pause. A job kind is the seam the engine already has for "something that runs, that isn't a test".
- **Running the task inside the paused run's browser.** The paused attempt's page is mid-test; a task there would move it. Its own browser is cleaner, and the site-level rule (task while paused, then `afterTask`) is what keeps the two from colliding.
- **Watchwright taking the snapshots itself.** It can't: only the pack knows how to save and restore its app. Watchwright gives the moments (start, end, task, going on) and the place to keep values.

## The pattern a pack writes

```ts
const save = async (h) => /* the app's own backup: returns a name */;
const restore = async (h, name) => /* the app's own restore */;

export default pack({
  // …
  async setup({ h, start, state }) {
    if (start === "new") {
      state.set("original", await save(h)); // the person's data
      state.set("holds", "run");
      await loadTestData(h);
    } else await giveBack(h, state); // resume or redo: the run's data, if a task put the person's back
  },
  async teardown({ h, state, status }) {
    // A stopped run may be resumed: keep its data for then.
    await giveOriginal(h, state, status !== "finished");
  },
  afterTask: ({ h, state }) => giveBack(h, state),
  tasks: {
    restore: {
      title: "Restore my data",
      run: ({ h, state, run }) => giveOriginal(h, state, run !== null),
    },
  },
});

// Puts the person's data back; first keeps the run's when a run will want it again.
async function giveOriginal(h, state, keepRun) {
  if (state.get("holds") === "run" && keepRun) state.set("runData", await save(h));
  await restore(h, state.get("original"));
  state.set("holds", "original");
}
async function giveBack(h, state) {
  if (state.get("holds") !== "original" || !state.get("runData")) return;
  await restore(h, state.get("runData"));
  state.set("holds", "run");
}
```

The `holds` value is what stops a second "restore" from saving the person's own data over the run's.

## Scope of the build

- Engine: `start` for setup, `teardown`, `afterTask`, the `whilePaused` rule for task runs, redo of an attempt a task interrupted, pack state.
- `task` job kind (its own plugin, `tasks`), and `tasks:`, `teardown:` and `afterTask:` in `pack.yaml` (steps; state is code-only).
- API: tasks in the pack summary, `GET /packs/:id/state`, `DELETE /packs/:id/state/:key`; tasks start through `runs.start` with `kind: "task"`.
- Web: a Tasks tab on the pack page (each task with Run, a note when it will wait, the saved values); the run page says when a task holds the site.
- Docs site: a "Setup, teardown and tasks" guide page and the pack reference; the agent skill's references.
- A report for the bench pack with the changes it can make.
