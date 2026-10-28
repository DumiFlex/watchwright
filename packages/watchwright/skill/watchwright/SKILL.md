---
name: watchwright
description: Write, run and fix browser tests with Watchwright, a Playwright test harness whose runs the person watches live on its web page. Use it when asked to test a website, write or fix a Watchwright test or test pack, run a pack, or read a run's results and screenshots. Works through the Watchwright MCP tools or the watchwright command.
---

# Watchwright

Watchwright runs browser test packs on a local server (by default `http://127.0.0.1:7420/`; the MCP server's instructions give its real address) and shows every run live on its web page. A **pack** is a folder: `pack.yaml` (or `watchwright.pack.ts`) for the site and options, and tests under `tests/`, in YAML (a list of steps) or TypeScript. You reach it through the MCP tools (`list_packs`, `start_run`, …) or the `watchwright` command; both do the same.

## Start

1. Check the server: `list_packs`, or `watchwright status`. When nothing answers, start it with `watchwright serve --no-open` (it keeps running; the MCP bridge starts one by itself).
2. Tell the person the web page's address so they can watch what you do: the run's own page, which `start_run` gives as "Watch it live: …", or the address in the MCP server's instructions. Don't assume port 7420; a server can run on another.
3. Read the pack: `get_pack` (tests, parameters, flags), `list_pack_files` and `read_pack_file`.

## The loop

1. **Explore** before writing: `explore_start`, then `explore_look` (the page as an aria snapshot; every element has a ref like `e4`) and `explore_do` (steps; a target can be `{ "ref": "e4" }`). Refs become real targets in the steps you get back. `explore_stop` answers the steps as YAML. Without MCP, read the page some other way and write the steps yourself.
2. **Write the test**, YAML first: `id`, `title`, `steps`. Use code only when YAML can't say it (loops over data, computed values, helpers). Prefer targets a person reads (`role` + `name`, `label`, `text`, `testId`) over CSS. Check each step's fields in [yaml-steps.md](references/yaml-steps.md).
3. **Check** it without saving: `check_test` with the file's text. Fix every problem it lists.
4. **Save** with `write_pack_file` (pass the `stamp` from `read_pack_file` when changing a file). The answer lists the pack's load problems; fix them.
5. **Run** only the tests you need: `start_run` with `tests: ["T1"]`, or `watchwright run <pack> T1`.
6. **Wait** in steps: `wait_for_run` waits up to 110 seconds (60 by default); while its `reason` is `timeout`, call it again with `after` set to the `cursor` it gave, until the reason is `ended` or `paused`. A run paused on a broken attempt (`pauseReason: broken`) waits for you: look at the attempt, then `control_run` with retry or skip. With the command line: `watchwright wait <run>`, again with `--after <cursor>` while it exits 6.
7. **Read** `get_run` (one line per attempt), then `get_attempt` for one that didn't pass: its error, the step it stopped at, the log, flags and files. Look at its screenshots with `get_file`; they come back as images.
8. **Decide** whose fault it is. An attempt is `failed` when an expectation didn't hold and `broken` when the robot couldn't do a step (a target not found, a timeout). A broken attempt is a problem in the test until the screenshots say otherwise: fix the target or add a wait and run again. A failure the screenshots confirm is a finding about the site: report it to the person with the run's address, the step and what the screenshot shows. Don't change the test to make a real failure pass.

## Rules

- Never stop, pause or change a run you didn't start, and only stop explore sessions you started.
- Never delete runs, packs or files unless the person asks. Deleting waits for the person to approve it on the web page; when a tool answers that it is waiting, tell the person, then wait with `wait_for_approval` (or `watchwright approvals wait <id>`).
- When a run is paused by a person (`pausedBy` in its `live` state), stop and ask them before doing anything to it.
- Keep every wait bounded and keep the person told: what you ran, its address, and what you found.
- Don't run a whole pack to check one test; packs can take hours.
- Keep secrets out of test files: use `${env.NAME}` for passwords and tokens, and `${params.name}` for values a run chooses.

## References

- [yaml-tests.md](references/yaml-tests.md): YAML test files, targets, variables, hooks.
- [yaml-steps.md](references/yaml-steps.md): every step and its fields.
- [test-packs.md](references/test-packs.md): packs in code, `test()`, `h` helpers, options, parameters, flags.
- [mcp.md](references/mcp.md): every MCP tool and exploring.
- [cli.md](references/cli.md): every command and exit code.
