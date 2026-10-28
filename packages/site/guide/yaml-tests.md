# YAML tests

A test can be a list of steps in a YAML file instead of code. YAML tests run in the same engine as code tests: they pause between steps, show each step live and in the step timeline, keep screenshots and texts, and pick up a saved change at the next attempt. A pack can mix both, or have no code at all.

```yaml
# tests/add-todo.yaml
id: T1
title: Add a todo
section: Todos
description: A new todo shows in the list and counts as one item left.
steps:
  - goto: /todomvc/
  - fill: { target: { placeholder: What needs to be done? }, value: Buy milk }
  - press: Enter
  - expect: { target: { testId: todo-title }, text: Buy milk }
  - expect: { target: { testId: todo-count }, text: 1 item left }
  - shot: one-todo
```

The [TodoMVC example pack](https://github.com/DumiFlex/watchwright/tree/dev/examples/todomvc) is a whole pack written this way. Every step and its fields are in the [YAML steps reference](../reference/yaml-steps).

## Files

YAML tests sit with the code tests: any `.yaml` or `.yml` file under `tests/` (a pack with its own `tests` globs lists them there). A file holds one test, or several under `tests:`, with an optional `section` and `tags` that its tests share:

```yaml
section: Checkout
tags: [smoke]
tests:
  - id: C1
    title: Add to cart
    steps:
      - goto: /products/boots
      - click: { role: button, name: Add to cart }
  - id: C2
    title: Pay
    needs: [C1]
    steps:
      - goto: /cart
      - click: { role: button, name: Pay now }
```

A test takes the same fields as `test()` in code: `id`, `title`, `section`, `description`, `tags`, `runs` (a number, or `{ by: lang, de: 2, default: 1 }`), `needs`, `inside`, `timeout` and `review`, plus its `steps`.

## Steps

Each step is one verb. A step with one main value can be written short, and any step can take its fields as a map, or on lines of their own below it:

```yaml
- goto: /cart                                   # short
- click: { target: "#save", timeout: 2000 }     # fields in a map
- click: "#save"                                # fields on their own lines
  done: { text: Saved }
- reload                                        # no value at all
```

| Group | Steps |
|---|---|
| Go | `goto`, `back`, `reload`, `clear` |
| Act | `click`, `dblclick`, `fill`, `type`, `press`, `check`, `uncheck`, `select`, `hover`, `upload`, `scroll` |
| Wait | `wait`, `waitFor`, `idle` |
| Check | `expect` |
| Keep | `shot`, `scrollShots`, `keepText`, `note`, `log`, `flag`, `metric`, `save`, `info` |
| Shape | `step`, `if`, `repeat`, `child`, `skip`, `use` |

A failed `expect` fails the attempt, like `expect` in code. A step that can't be done (an element that never shows, a click that times out) makes the attempt broken, and the run pauses for Retry or Skip. Fix the file, save it, and the retry uses it.

When a step goes wrong, the attempt page names its line in the YAML file, and **Open in your editor** goes straight there.

## Targets

Most steps act on an element, its target. A target is a Playwright selector string, or a map in Playwright's words:

```yaml
- click: "#save"                                  # a CSS selector
- click: { role: button, name: Save }             # getByRole
- fill: { target: { label: Email }, value: a@b.c } # getByLabel
- check: { role: checkbox, name: Toggle Todo, within: { testId: todo-item, hasText: Milk } }
- click: { text: { regex: "^Delete", flags: i }, last: true }
```

Prefer `role`, `label` and `text`: they read like what a person sees and survive layout changes. All the keys are in the [reference](../reference/yaml-steps#targets).

## Variables

Text in a step can use variables:

| Variable | Is |
|---|---|
| `${params.lang}` | a value the run chose (the pack's `params`) |
| `${saved.order}` | a value an earlier test kept with `save` (list that test in `needs`) |
| `${secret.SHOP_PASSWORD}` | a secret set on Settings > Secrets (see [Secrets](#secrets)) |
| `${env.SHOP_PASSWORD}` | an environment variable on the machine running Watchwright |
| `${attempt}`, `${attempts}`, `${last}` | this attempt's number, how many the test gets, and whether this is the last |

A value that is a single variable keeps its type, so `count: "${saved.items}"` is a number. Write `$${` for a literal `${`.

Values read from `secret` and `env` are replaced with `•••` in logs, notes and error messages, so a password doesn't land in a result file. The step titles show the variable, not its value.

### Secrets

Passwords and tokens a test needs go on **Settings > Secrets** (or `watchwright secrets set --name SHOP_PASSWORD --value …`), not in the pack. Tests read them as `${secret.SHOP_PASSWORD}` in YAML and `h.secret("SHOP_PASSWORD")` in code; a test that asks for a secret nobody set breaks with a message that says where to add it.

- The web page and the API show a secret's name, length and when it was set, never its value. From an agent or a script, setting or deleting one waits for your approval on the web page.
- Every secret value (four characters or more) is replaced with `•••` wherever a run records or announces text: logs, notes, kept texts, step titles, errors, run facts and live events.
- Secrets are kept in Watchwright's database in its data folder, not encrypted. They stay out of packs, repos and results; they are not safe from someone who can read your data folder.
- Screenshots and video show what the page shows. Type secrets into password fields so they appear as dots.

## Branches and loops

```yaml
- if:
    has: { role: dialog, name: Cookies }
    then:
      - click: { role: button, name: Accept all }
- repeat:
    until: { text: No more results }
    max: 10
    steps:
      - click: { role: button, name: Load more }
- step:
    title: Log in
    steps:
      - fill: { target: { label: Email }, value: "${env.SHOP_USER}" }
      - fill: { target: { label: Password }, value: "${secret.SHOP_PASSWORD}" }
      - click: { role: button, name: Log in }
```

`if` takes `has` (an element is visible, optionally waiting up to `timeout` ms), `hasNot`, or `equals: [a, b]`. `step` groups steps under one title in the live view and the timeline.

## Using a code pack's helpers

In a pack with a code pack file, YAML tests can call the pack's own helpers with `use`:

```ts
// pack.ts
export default pack({
  name: "Shop",
  site: { key: "shop", baseURL: "http://127.0.0.1:3000/" },
  helpers: (h) => ({
    async login(user: string) { /* … */ },
  }),
});
```

```yaml
- use: { helper: login, args: [admin] }
```

## A pack without code

`pack.yaml` (instead of `pack.ts`) holds the pack options that are plain data:

```yaml
name: TodoMVC demo
site:
  key: playwright-todomvc
  baseURL: https://demo.playwright.dev/
browser:
  name: firefox
  viewport: { width: 1280, height: 800 }
  context: { locale: en-GB, colorScheme: dark }
params:
  lang: { choices: [en, de], default: en }
flags:
  wrong-count: finding
rubric:
  - { id: overall, title: Overall, scale: 5 }
collectors:
  - consoleErrors
  - failedRequests
  - responses: { match: /api/ }
run:
  pauseOnBroken: true
  trace: problems

setup:          # once per run, before the first test
  - info: { key: App, value: TodoMVC }
beforeEach:     # before each attempt
  - goto: /todomvc/
  - clear: storage
  - reload
afterEach: []   # after each attempt, also when it failed
```

`browser.context` takes the plain Playwright context options (`locale`, `timezoneId`, `colorScheme`, `userAgent`, `extraHTTPHeaders`, `httpCredentials`, `storageState` relative to the pack, …). Hooks written in code, your own collectors, helpers and an `idle` check need a code pack file; a code pack can still have YAML tests.

**New pack here…** in the folder browser can write a YAML starter pack for you.

## Editor support

The package ships JSON Schemas for both files: `watchwright/schema/test.json` and `watchwright/schema/pack.json` (also served at `GET /api/v1/packs/yaml-schema?kind=test|pack`). With VS Code's YAML extension, a first line such as

```yaml
# yaml-language-server: $schema=../node_modules/watchwright/dist/schema/test.json
```

gives completion and checks as you type. Watchwright's own checks say more when the pack loads: a misspelled step or field gets a "Did you mean", and every problem names its file, line and column.

## When a test outgrows YAML

`POST /api/v1/packs/:id/convert` with `{ "file": "tests/checkout.yaml" }` writes the same tests as `tests/checkout.ts`, one `h` or `expect` call per step with your comments kept, and removes the YAML file once the new one loads.
