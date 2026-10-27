# Recording

Record writes test steps for you while you click through your site. Open a test in the [editor](./editing), put the cursor where the new steps should go and press **Record**. A browser opens with the pack's browser, viewport and options, and its page shows in a live view on the Watchwright page. Click, type and scroll on that view as you would on the site: each action becomes a step in the list beside it.

Nothing is written until **Done**, which puts the steps into the file at the cursor as an unsaved edit, so you can look them over before you save. **Cancel** throws them away. Both close the recording browser.

## Where it starts

In a YAML test, Record starts **from here**: the pack's `beforeEach` and the test's steps above the cursor run first, and you watch them run. Recording starts from the state they leave the page in, so you only record what comes next. If one of those steps fails, recording still starts, from where it stopped, and says which step broke. A file with unsaved edits is saved first, so the steps that run are the ones you see.

In a code test, the pack's `beforeEach` runs and recording starts at the site's address. Done writes the steps as `h` calls after the cursor's line.

A recording uses the pack's site the way a run does: a run of the same site waits until the recording ends, and a recording waits (and says so) while a run of the site is going.

## What gets recorded

Clicks, double clicks, typing, keys, checkboxes, menus, file uploads and going to another address become `click`, `dblclick`, `fill`, `press`, `check`, `uncheck`, `select`, `upload` and `goto` steps. Typing into one field becomes a single `fill`. The bar above the view has back, reload and an address box. New tabs and popups show as tabs on the view; click one to send your input there.

On a phone, a tap is a click and dragging scrolls. Use the box under the view to type into the page: what you type there goes to the field that has focus, and **Enter** presses Enter.

## Targets: the element, or the spot you clicked

A recorded step points at the **element** you clicked, not at the point on the screen, so the test keeps working when the page's layout moves. Playwright's recorder picks the target, preferring what a person sees: a role and its name, a label, a placeholder or a text, and a test id when the page has one.

Each step also keeps the other targets that pick out the same element, checked on the page when you clicked: each matches only that element. When there are several, a menu under the step lets you switch, for example from a text that may change to a test id. When several elements share a target (items of a list with the same test id), the element's own text narrows it (`testId: todo-title` with `hasText: Buy milk`), and as a last resort its place among them (`nth`), which breaks when the list changes.

Some elements don't have a meaningful middle: a canvas, a map, a color or image picker. For a click, tick **At the spot clicked** to keep where inside the element you clicked. The step gets a `position` (`{ x, y }` in pixels from the element's top-left corner), and the run clicks the same spot of the same element, wherever it is on the page.

```yaml
- click: { target: { testId: palette }, position: { x: 40, y: 26 } }
```

## Tools

- **Check**: click an element on the view, then pick what to check: that it is visible or hidden, its text, its value, whether it is checked, or how many elements like it there are. The current text, value or count is filled in. You get an `expect` step.
- **Wait for**: click an element to add a `waitFor` step that waits until it is visible or hidden.
- **Shot**: adds a `shot` step with a name.
- **Note**: adds a `note` step, a message for the people who review the result.

Remove a step with its bin button. Steps added with Check and Wait for get the same target menu.

## Record in a window

When the server runs on a machine with a screen, the Record menu also has **Record in a window**. It opens the recording browser as a normal window on that machine instead of the live view, for when you would rather click in a real browser. The steps still arrive on the Watchwright page, and Done and Cancel work the same.

## From an agent or a script

Recording is in the [HTTP API](../reference/http-api#recording): start one, send clicks and keys to it, read and change its steps, and stop it.
