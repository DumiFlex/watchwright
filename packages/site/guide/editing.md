# Editing a pack

You can write and fix a pack's tests in the web app without leaving it. Press **Edit** on a pack's page, or the pencil next to a test's file. On an attempt's page, **Edit this test** opens the line the test broke on.

The editor works on the files in the pack's folder, the same files your own editor sees. A save writes the file, and the pack loads again right away, so the next attempt runs what you saved.

## Files

The file list on the left shows the pack's folder. On a phone it opens from the panel button. Folders such as `node_modules`, `dist` and `.git` are left out, and only text files open (TypeScript, JavaScript, YAML, JSON, Markdown, CSS, HTML, plain text and the like, up to 1 MB). The **+** menu (New file) makes a YAML test, a TypeScript test or an empty file. A new test is filled with a starter test and the next free id. The **⋯** menu renames or deletes the open file, and converts a YAML test to TypeScript.

The editor can't reach a file outside the pack's folder, and it doesn't follow a link that points out of it.

## Source

Source is a code editor with search (Ctrl+F) and save (Ctrl+S, Cmd+S on a Mac). Problems the pack has when it loads are underlined where they are and listed under the editor, and a click on one jumps to it. Problems in other files are listed too, with a link to open them.

In a YAML test file, the editor also checks the text as you type. It completes:

- step names on a new list item;
- a step's fields, and the target kinds (`role`, `label`, `text`, `testId`, …);
- the values a field allows.

Hovering a step or a field shows its description.

## Steps

A YAML test can also be edited as a list of steps. Each step shows an icon, a short summary ("Fill placeholder "What needs to be done?" with "Buy milk"") and its line. Click a step to open its form:

- **Change the step.** Pick another kind of step from the menu. Fields the two steps share are kept.
- **Edit the fields.** A target gets a kind menu and its value (with the role's name and **Exact** for a role). Choices get a menu, yes-or-no fields a switch, and the rest a text box. An `expect` step picks its check first.
- **Arrange the steps.** Move a step up or down, duplicate it or delete it, or drag it by its grip. **Add a step** opens a list of every step, grouped and searchable.
- **Steps inside a step.** The steps of `if`, `repeat` and `step` show as lists of their own under the step.

The steps are written back into the file in place, so your comments, blank lines and formatting stay as they were. Fields the form can't show are left as they are, with a note to change them in Source. Source and Steps show the same file, and switching keeps your place.

## Run this test

**Run** runs the test the cursor is in, with the parameters of the pack's last run. The menu beside it runs another test in the file. The run shows live under the editor, with pause, resume, retry, skip and stop. When it ends you see the result and the error, with **Go to line** for the line it broke on, and **See the attempt** opens the full attempt page.

## Record

**Record** writes steps for you while you click through the site on a live view, and puts them in the file at the cursor. See [Recording](./recording).

## When the file changes on disk

When you save, the editor checks that the file on disk is still the one you opened. If it changed in the meantime, for example after a save in your own editor or a `git pull`, it doesn't overwrite it but says so. You can:

- **Show the changes** between the file on disk and your text;
- **Use the file on disk**, which drops your edits;
- **Overwrite with mine**, which saves your edits over it.

When another tab or an agent saves the file through Watchwright and you have no unsaved edits, the editor loads the new text by itself. Unsaved edits also survive moving to another page and back, and the browser asks before you close a tab that has some.

Agents and scripts can do the same through the [files API](../reference/http-api#editing-files).
