# Research: files a test saves with its attempt

Status: built in `feat/attempt-files`.

## The question

A pack often wants to keep its own output with each attempt: an app's debug log, a file the page downloaded, a JSON dump of what the app answered, a report it wrote. How far does Watchwright go today, and what is missing?

## What exists

- **Collectors** (`pack({ collectors })`) get the browser context when the run starts and hooks around every attempt (`beginAttempt`, `endAttempt`). Through `a.record`, `a.file(name, data, contentType?)` and `a.metric` they save records, files of any type and metrics with the attempt. Files land in `collectors/<collector>/<name>` and show on the attempt page under **Files**. The Wildcard Pipeline bench uses this to save every AI call an attempt made (its app's debug log) as Markdown and JSON.
- **Inside a test**, `h` saves screenshots (`h.shot`, `h.scrollShots`) and text (`h.keepText`, always a `.txt`). Video, the trace, the log and the steps are kept by the engine.

## The gaps

1. **A test can't save a file of its own.** Something the test has in hand mid-test (a download, a JSON answer from the app's API, a generated report) has to go through a collector, which only runs between attempts and can't see the test's variables. `keepText` is text only and always `.txt`.
2. **Markdown files show as raw text.** The attempt page's Files tab shows text in the code view. A Markdown file (the bench's AI calls, any report) reads much better rendered, and the web app already has a Markdown view (the editor's preview).
3. **The review export leaves files out.** The zip from **Export** holds the Markdown and the screenshots. Kept texts, collector records and collector files stay behind, so a review shared as a zip loses the evidence (the AI debug, for the bench).

## How others do it

- **Playwright Test**: `testInfo.attach(name, { body | path, contentType })`. Body or a path to copy; the content type defaults from the extension; names may repeat. The HTML report lists attachments per test, renders images and offers the rest as downloads.
- **Allure**: `allure.attachment(name, content, type)`; the report previews text, JSON, images and HTML inline.
- **Cypress**: no attachments; tasks write files to disk and plugins pick them up.

The common shape is one call with a name, data or a path, and an optional content type. Repeats don't fail.

## Decision

1. **`h.file(name, data, contentType?)`**, the test's twin of a collector's `a.file`. `data` is a string, a Buffer, or `{ path }` to copy a file already on disk (a Playwright download's `download.path()`). The content type defaults from the extension. Files go to `files/<name>` in the attempt folder; `name` may hold subfolders but never `..`. A name used twice in one attempt gets `-2`, `-3` before its extension, like Playwright allows repeats. It is a pause point like every helper. Returns the saved name.
   YAML tests get no step for it: a YAML test has no data of its own to save, and `keepText` covers page text.
2. **Markdown preview on the Files tab.** A Markdown file opens rendered, with a Preview / Source switch (the editor's tab bar). Relative links and images point next to the file, so a report that links its own files works. HTML in the text stays text, as in the editor.
3. **Export zip takes the files.** Each attempt's kept texts, collector records, and test and collector files go into the zip under `files/<run>/<attempt>/<path in the attempt folder>`. The Markdown lists them per attempt as links (to the server in the plain `.md` export, into the zip in the zip). Video and trace stay out: they are large, and the attempt page has them.
