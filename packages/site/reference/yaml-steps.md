<!-- Written from packages/watchwright/src/plugins/packs/yaml/steps.ts by `pnpm --filter watchwright steps-reference`. Edit the steps there, not here. -->

# YAML steps

Every step a [YAML test](../guide/yaml-tests) can use. A step is one verb with its value: `- goto: /cart`, or with fields, `- click: { target: "#save", timeout: 2000 }`. Fields can also sit beside the verb on their own lines. Steps with a plain-value form name the field it fills.

Text values can use `${params.name}`, `${saved.key}`, `${secret.NAME}`, `${env.NAME}`, `${attempt}`, `${attempts}` and `${last}` (see [Variables](../guide/yaml-tests#variables)). Where a number or true / false goes, a variable works too.

## Go

### goto

Opens a URL. A relative URL is joined to the pack's site.baseURL.

Also written as `- goto: <url>`.

| Field | Type | |
|---|---|---|
| `url` (required) | text | The URL. |
| `waitUntil` | `load`, `domcontentloaded`, `networkidle`, `commit` | When the page counts as loaded (default load). |

### back

Goes back in the browser history.

Also written as `- back`.

### reload

Reloads the page.

Also written as `- reload`.

### clear

Clears cookies, the open site's local and session storage, or both (the default), for a clean start.

Also written as `- clear` or `- clear: <what>`.

| Field | Type | |
|---|---|---|
| `what` | `cookies`, `storage`, `all` | What to clear (default all). |

## Act

### click

Clicks an element. With `done`, waits for that element to show, which also tells a click that landed from one that didn't.

Also written as `- click: <target>`.

| Field | Type | |
|---|---|---|
| `target` (required) | [target](#targets) | The element. |
| `done` | [target](#targets) | An element that shows once the click worked. |
| `button` | `left`, `right`, `middle` | Which mouse button (default left). |
| `position` | map | A spot inside the element, `{ x, y }` in pixels from its top-left corner, to use instead of its middle (for canvases, maps and image pickers). |
| `timeout` | whole number | Time limit in ms (default 15000). |

### dblclick

Double-clicks an element.

Also written as `- dblclick: <target>`.

| Field | Type | |
|---|---|---|
| `target` (required) | [target](#targets) | The element. |
| `position` | map | A spot inside the element, `{ x, y }` in pixels from its top-left corner, to use instead of its middle (for canvases, maps and image pickers). |
| `timeout` | whole number | Time limit in ms (default 15000). |

### fill

Replaces the text in an input, text area or editable element.

| Field | Type | |
|---|---|---|
| `target` (required) | [target](#targets) | The field. |
| `value` (required) | text, number or true / false | The text to put in. |

### type

Types text key by key, for fields that react to each key (search as you type).

| Field | Type | |
|---|---|---|
| `target` (required) | [target](#targets) | The field. |
| `text` (required) | text | The text. |
| `delay` | whole number | Pause between keys in ms. |

### press

Presses a key or a combination (Enter, Escape, Control+A). With a target, on that element.

Also written as `- press: <key>`.

| Field | Type | |
|---|---|---|
| `key` (required) | text | The key: Enter, Tab, ArrowDown, Control+S, … |
| `target` | [target](#targets) | Press on this element instead of the page. |

### check

Ticks a checkbox or picks a radio button.

Also written as `- check: <target>`.

| Field | Type | |
|---|---|---|
| `target` (required) | [target](#targets) | The element. |

### uncheck

Unticks a checkbox.

Also written as `- uncheck: <target>`.

| Field | Type | |
|---|---|---|
| `target` (required) | [target](#targets) | The element. |

### select

Picks options in a select element, by value or label.

| Field | Type | |
|---|---|---|
| `target` (required) | [target](#targets) | The select element. |
| `option` (required) | text or list of text | The option, or a list of them. |

### hover

Moves the mouse over an element.

Also written as `- hover: <target>`.

| Field | Type | |
|---|---|---|
| `target` (required) | [target](#targets) | The element. |
| `position` | map | A spot inside the element, `{ x, y }` in pixels from its top-left corner, to use instead of its middle (for canvases, maps and image pickers). |

### upload

Sets the files of a file input. Paths are relative to the pack folder.

| Field | Type | |
|---|---|---|
| `target` (required) | [target](#targets) | The file input. |
| `files` (required) | text or list of text | A file, or a list of files. |

### scroll

Scrolls the page or an element to the top or bottom, or scrolls an element into view.

Also written as `- scroll: <to>`.

| Field | Type | |
|---|---|---|
| `to` | `top`, `bottom` | top or bottom. |
| `target` | [target](#targets) | The element to scroll (with `to`) or to bring into view. |

## Wait

### wait

Waits a number of milliseconds. Time spent paused doesn't count.

Also written as `- wait: <ms>`.

| Field | Type | |
|---|---|---|
| `ms` (required) | whole number | Milliseconds. |

### waitFor

Waits until an element is in a state (default visible).

Also written as `- waitFor: <target>`.

| Field | Type | |
|---|---|---|
| `target` (required) | [target](#targets) | The element. |
| `state` | `visible`, `hidden`, `attached`, `detached` | visible, hidden, attached or detached. |
| `timeout` | whole number | Time limit in ms (default 30000). |

### idle

Waits until the network is quiet and the pack's idle check (if it has one) says the app is idle.

Also written as `- idle`.

| Field | Type | |
|---|---|---|
| `timeout` | whole number | Time limit in ms (default 30000). |
| `quietMs` | whole number | How long the network must be quiet (default 500). |

## Check

### expect

Checks the page. Give one check; with `not`, the opposite. Retries until it passes or times out (default 5000 ms). A failed check fails the attempt.

| Field | Type | |
|---|---|---|
| `target` | [target](#targets) | The element to check (not needed for url and title). |
| `visible` | true / false | The element is visible. |
| `hidden` | true / false | The element is hidden or gone. |
| `text` | text or `{ regex }` | The element's whole text. |
| `containsText` | text or `{ regex }` | Text the element contains. |
| `value` | text or `{ regex }` | An input's value. |
| `count` | whole number | How many elements match. |
| `checked` | true / false | A checkbox is ticked. |
| `enabled` | true / false | The element is enabled. |
| `disabled` | true / false | The element is disabled. |
| `url` | text or `{ regex }` | The page URL (relative to the site's baseURL, or a regex). |
| `title` | text or `{ regex }` | The page title. |
| `not` | true / false | Check the opposite. |
| `timeout` | whole number | How long to retry in ms (default 5000). |

## Keep

### shot

Saves a screenshot of the page, the whole page, or one element.

Also written as `- shot: <name>`.

| Field | Type | |
|---|---|---|
| `name` (required) | text | The screenshot's name. |
| `fullPage` | true / false | The whole page, not only what's in view. |
| `target` | [target](#targets) | Only this element. |

### scrollShots

Scrolls the page (or an element) top to bottom and saves a screenshot per screen.

Also written as `- scrollShots: <name>`.

| Field | Type | |
|---|---|---|
| `name` (required) | text | The screenshots' name. |
| `target` | [target](#targets) | Scroll this element instead of the page. |
| `max` | whole number | At most this many (default 20). |

### keepText

Saves an element's text (or the given text) with the attempt.

| Field | Type | |
|---|---|---|
| `name` (required) | text | The text's name. |
| `target` | [target](#targets) | The element to read. |
| `text` | text | Text to keep instead of an element's. |

### saveSignIn

Saves the browser's cookies and local storage as the site's sign-in, for runs that start signed in (`site.signIn: saved`). Put it at the end of a login test.

Also written as `- saveSignIn`.

### note

A note for the people who review the result.

Also written as `- note: <text>`.

| Field | Type | |
|---|---|---|
| `text` (required) | text |  |

### log

A line in the attempt's log.

Also written as `- log: <text>`.

| Field | Type | |
|---|---|---|
| `text` (required) | text |  |

### flag

Raises a flag the pack declares in `flags`.

Also written as `- flag: <name>`.

| Field | Type | |
|---|---|---|
| `name` (required) | text | The flag. |
| `detail` | text | What happened. |

### metric

Saves a number: the given value, or the first number in an element's text.

| Field | Type | |
|---|---|---|
| `name` (required) | text | The metric's name. |
| `value` | text, number or true / false | The number. |
| `target` | [target](#targets) | Read the number from this element. |
| `unit` | text | The unit: s, ms, items, … |

### save

Keeps a value for later tests (read it as ${saved.key}): the given value, or an element's text. Kept from a test's last attempt.

| Field | Type | |
|---|---|---|
| `key` (required) | text | The name to keep it under. |
| `value` | any value | The value. |
| `target` | [target](#targets) | Keep this element's text. |

### info

Saves a fact about the whole run (an app version, a mode), shown on the run page.

| Field | Type | |
|---|---|---|
| `key` (required) | text | The fact's name. |
| `value` (required) | text, number or true / false | Its value. |

## Shape

### step

A titled group of steps, shown as one step live and in the timeline.

| Field | Type | |
|---|---|---|
| `title` (required) | text | The title. |
| `steps` (required) | steps | The steps. |

### if

Runs `then` when the condition holds, else `else`. Conditions: `has` (an element is visible), `hasNot`, or `equals` (two values).

| Field | Type | |
|---|---|---|
| `has` | [target](#targets) | Holds when this element is visible. |
| `hasNot` | [target](#targets) | Holds when this element is not visible. |
| `equals` | list of text, number or true / false | Holds when the two values are the same text. |
| `timeout` | whole number | With has or hasNot: wait up to this long in ms for the element (default 0: look once). |
| `then` (required) | steps | The steps when it holds. |
| `else` | steps | The steps when it doesn't. |

### repeat

Runs steps a number of times, or until an element shows (at most `max` times, default 20).

| Field | Type | |
|---|---|---|
| `times` | whole number | How many times. |
| `until` | [target](#targets) | Stop once this element shows. |
| `max` | whole number | With until: give up after this many rounds. |
| `steps` (required) | steps | The steps. |

### child

Runs a child test (one with `inside: <this test>`) here, as its own attempt.

Also written as `- child: <id>`.

| Field | Type | |
|---|---|---|
| `id` (required) | text | The child test's id. |

### skip

Ends the attempt as skipped, with the reason.

Also written as `- skip: <reason>`.

| Field | Type | |
|---|---|---|
| `reason` (required) | text |  |

### use

Calls one of the pack's own helpers (from `helpers` in a code pack file) with arguments.

Also written as `- use: <helper>`.

| Field | Type | |
|---|---|---|
| `helper` (required) | text | The helper's name. |
| `args` | list of any value | Its arguments. |

## Targets

A target is a Playwright selector string (`"#save"`, `"text=Save"`, `"[data-test=save]"`), or a map with one of `role`, `label`, `placeholder`, `text`, `alt`, `title`, `testId` or `css`, plus optional filters:

| Key | Same as in Playwright |
|---|---|
| `role` with `name`, `exact`, `checked`, `disabled`, `expanded`, `pressed`, `selected`, `level`, `includeHidden` | `getByRole` |
| `label`, `placeholder`, `text`, `alt`, `title` (with `exact`) | `getByLabel`, `getByPlaceholder`, `getByText`, `getByAltText`, `getByTitle` |
| `testId` | `getByTestId` |
| `css` | `locator(css)` |
| `hasText`, `hasNotText`, `has` | `filter()` |
| `nth` (from 0, -1 is the last), `first`, `last` | `nth()`, `first()`, `last()` |
| `within` | a target to look inside |
| `frame` | an iframe to look inside |

Text in `name`, `label`, `text` and the other text keys can be a regex: `{ regex: "^Save", flags: i }`.
