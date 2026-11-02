# Long pages: getting around them

Dumi, on 0.12.0: picking from a dropdown throws the page back to another scroll position; the attempt page means scrolling to the bottom for the log and back up again; a pack with many tests has a very long scrollbar; and on a pack page the dashboard, latest failures and recent runs push the README, tests, parameters, flags and rubric far down. The bar he set: **nobody should have to scroll for ages, or fit what they want into view by hand.**

## How it was checked

A seeded server: one pack with 60 tests in five sections, files (`h.file`), texts, metrics and flags on its attempts, two runs of 120 attempts. Page heights at 1440 x 900 and at 390 px (a phone), with the README tab open on the pack page:

| Page | 1440 px | 390 px | Notes |
|---|---|---|---|
| Runs | 900 | 1,130 | fine |
| Pack | 1,776 | 2,384 | Tests tab of a 126-test pack: about 6,000 |
| Run | 3,295 | 3,642 | 120 result rows; the Log is the last card |
| Attempt | 1,018 | 1,421 | Dumi's bench attempts: about 3,000 (long steps, Markdown files) |
| Compare | 7,328 | 15,623 | two runs side by side |
| New run | 1,144 | 2,089 | |
| Kit | 13,193 | 21,726 | the control kit, for us |

## The dropdown bug

Reproduced on the attempt page: at the bottom of the page, picking another file in **Files** moved the page from 667 px down to 208. Two causes:

1. **The panel collapses while the next file loads.** The Files and Collectors panels empty themselves (to "Loading…") as soon as another file is picked, so the page gets shorter for a moment and the browser clamps the scroll position to the new, shorter page. When the file arrives the page grows again, but the position stays where it was clamped. Fix: keep showing the previous file until the next one is read, then swap.
2. **The dropdowns move focus and scroll into view.** `SelectMenu` and `MultiSelect` call `focus()` on the list and `scrollIntoView()` on the active option. `scrollIntoView` scrolls every scrollable ancestor, the page included, and Firefox (where Dumi runs) does it even for a list placed with `position: fixed`. Fix: `focus({ preventScroll: true })` everywhere a popup takes or gives back focus, and scroll only the list itself, never the page.

Both fixes live in the shared controls (and the attempt panels), so every dropdown gets them.

## What other tools do

- **Docs sites** (VitePress, which our own site uses; MDN; GitHub's README view): an "On this page" list in the right margin, sticky, marking the section in view. GitHub adds an outline button on the file header for narrow windows.
- **GitHub repository and pull request pages**: tabs at the top of the page (Code, Issues, Pull requests…; Conversation, Commits, Files changed), each its own address, so a big area never sits under another.
- **Grafana, GitLab, Jenkins**: a pack- or project-level page split into tabs (Overview, Pipelines, Tests…), with the overview first.
- **Mobile pages**: a small floating "back to top" button once you are a screen or two down.

## The design

### 1. "On this page" for long pages

A shared outline that any view fills with its sections (`useOutline` in `src/outline.ts`). One component in the app shell (`PageOutline`) shows it:

- **Wide windows** (room in the right margin beside the page, about 1,600 px and up): a sticky list in the margin, like the docs site: **On this page**, the sections, the one in view marked. At its foot, **Back to top** and **To the bottom**.
- **Narrower windows and phones**: a small floating group at the bottom right: an outline button that opens the same list as a popup, and up and down arrows. It shows only when the page is longer than about a screen and a half, and each arrow only when there is somewhere to go.

Pages without an outline still get the up and down arrows when they are long (Compare, Runs, New run…).

What each page lists:

- **Attempt**: About, the problem (when it failed), Summary, Steps, then each of Shots, Texts, Log, Collectors, Files and Video. Picking one of those opens its tab and scrolls to it, so "the log" is one click from anywhere. Review is listed too, for windows where it sits under the rest.
- **Run**: Live view or Queue, Since the last run, Results, Run video, Log.
- **Pack**: depends on the tab (below): on Tests, its sections (Search, Cart…), so a 126-test pack is one click from any section; on README, the README's headings, like the docs site.

### 2. The pack page in tabs

The pack's own tabs move up to sit under its header, and the dashboard and runs become tabs too:

**Dashboard** · **Runs** · **README** · **Tests** · **Parameters** · **Flags** · **Rubric**

- Dashboard holds the dashboard (with its latest failures tile), Runs the recent runs list with the link to all of them.
- The tab is in the address (`#/packs/<id>?tab=tests`), so a link, Back and a reload keep it.
- Without a tab in the address the page opens on **Dashboard** once the pack has run, else on **README** when there is one, else on **Tests**. Packs that have never run don't show an empty Dashboard tab.
- On a phone the tab row scrolls sideways, like the attempt page's tabs already do.

### 3. Not in this change

- Settings (and Admin) are being split into pages in another thread, and already have their own section list, so they stay as they are.
- A sticky header on the Results table and the Compare table: worth doing, but separate.

## Risks

- A fixed rail over the page on windows where the margin is barely wide enough: the rail shows only when the margin fits it whole (measured from the page's right edge on every resize).
- The floating arrows could cover a page's last controls on a phone: they sit in the bottom-right corner with a gap, hide at the top or bottom where they do nothing, and the page gets bottom padding while they show.
