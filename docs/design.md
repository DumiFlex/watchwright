# Design

Watchwright's look is called **Movement**, after the works of a mechanical watch: clean surfaces, fine hairlines, tabular numbers and one blued-steel blue. The web app ships it as the default theme, with four optional looks. The documentation site uses the same tokens.

## The mark

A watch dial with twelve ticks, one blued-steel hand and a ruby jewel at the pivot. It stays the same in every theme; only the dial's ink follows the theme's text color. Source: `packages/web/src/components/BrandMark.vue` and `packages/web/public/favicon.svg`.

## Themes

A theme is a **look** (palette, fonts, corners) in a **mode** (light, dark, or follow the system). The theme picker in the page header sets both, and the browser remembers the choice.

| Look | Idea | Fonts | Modes |
|---|---|---|---|
| Movement (default) | A watchmaker's precision: porcelain or blue-black, blued-steel blue | Geist, Geist Mono | light, dark |
| Drafting table | The wright's workshop drawing: drafting paper or blueprint, safety orange | Archivo Expanded, IBM Plex Sans, IBM Plex Mono | light, dark |
| On air | A broadcast control room: graphite, a red tally light for what is live | Barlow Condensed, Barlow, DM Mono | light, dark |
| Night watch | A dim indigo room for watching an overnight run, low blue light | Geist, Geist Mono | dark only |
| High contrast | Black and white, 2px lines and focus rings | Geist, Geist Mono | light, dark |

All fonts are bundled with the app (Fontsource, SIL Open Font License), so the page works offline and never calls a font CDN.

Screenshots of every look are in [screenshots/themes](screenshots/themes).

## Tokens

All tokens are CSS custom properties in `packages/web/src/style.css`. Components use them and never a literal color. Each color is written once as `light-dark(light, dark)`, and `color-scheme` picks the side, so a look is one block of values.

| Token | Use |
|---|---|
| `--ground` | Page background. `--ground-image` adds a pattern (the drafting grid). |
| `--surface` | Cards, panels, the header. |
| `--raised` | Secondary buttons, hovered rows, stepper buttons. |
| `--line` | Borders and dividers. `--line-strong` is for control borders and neutral dots (3:1 on surface). |
| `--text`, `--muted` | Body text and secondary text (both 4.5:1 or better on ground and surface). |
| `--accent`, `--on-accent` | Primary buttons, links, selection, focus rings, progress; text on an accent fill. |
| `--accent-text` | Accent-colored text where `--accent` is too light or dark to read. |
| `--accent-soft` | Selected rows and nav items. |
| `--live` | What is happening now (the live badge, the current step). Same as the accent except in On air, where it is the tally red. |
| `--ok`, `--bad`, `--warn`, `--paused` | Passed, failed (and destructive actions), broken, paused. Status color is never the only cue: pair it with a word or an icon. |
| `--font-ui`, `--font-display`, `--font-mono` | Text, the display face (wordmark, page and test titles), logs, paths, timecodes and counts. |
| `--display-weight`, `--display-tracking`, `--display-case`, `--display-stretch` | How the look sets its display face. Use the `.display` class. |
| `--radius-sm`, `--radius`, `--radius-chip` | Small controls, buttons and cards, chips. |
| `--border-width` | 1px, or 2px in High contrast. Write borders as `var(--border-width) solid var(--line)`. |
| `--space-1` … `--space-12` | 4, 8, 12, 16, 20, 24, 32, 48 px. |

Helper classes: `.label` (small uppercase group label), `.display` (the look's display face), `.num` (monospace tabular numbers), `.mono`.

## Rules

- Numbers that change or line up (counts, timecodes, attempts) use `.num`.
- No stock browser controls. Use the kit in `packages/web/src/components/`: `TextField` (text, search, password, email, url), `TextArea` (grows with its text, or `resizable` with a themed grip), `CheckBox`, `ToggleSwitch`, `RadioGroup`, `SelectMenu`, `MultiSelect` (search, chips, groups), `NumberInput` (custom up/down buttons), `RangeSlider`, `DatePicker` and `DateRangePicker` (both on `CalendarMonth`), `FilePicker`, `PathInput` (a folder path that completes from the server's machine as you type, with a line saying whether the folder has a pack), `FolderBrowser` (browse the server's folders: places, crumbs, a filter that also takes a path; a `footer` slot for the page's buttons), `PathLine` (a path that always fits: `~` for home, the start cut short, the last folder kept, copy and open buttons), `ProgressBar`, `TabBar`, `MenuButton` (a menu of links or commands), `ModalDialog` (confirm and form dialogs) and `DataTable` (sorting, sticky header, selection, only the rows on screen drawn past `virtualFrom`, `cell-<key>` slots), `SplitPane` (two panes and a drag handle, size remembered with `storage-key`, stacked at phone width), `TimelineScrubber` (steps on a time axis with a playhead), `SortableList` (drag or keyboard reordering, `locked` rows stay put), `ImageViewer` (full-size images over the page with previous and next, zoom steps from fit to 800% with buttons, + and -, Ctrl+wheel or a pinch, drag to pan, and download), `VideoPlayer` (themed controls on a `<video>` without the browser's own; copes with recorded WebM files that report no duration), `ScoreInput` (one review criterion as a radio group of buttons: a 1-to-N scale, named choices or yes/no; digits pick and picking again clears), `CodeView` (read-only code with line numbers, highlighting for TS, JS and JSON, `marked` lines and a copy button), `DiffView` (unified or side-by-side text diff, unchanged runs folded, the changed part of a line marked; one column at phone width), `JsonTree` (collapsible JSON with search that opens the path to each match), `CheckTree` (a tree with tri-state checkboxes; `v-model` holds the ticked leaf ids), `CommandPalette` (a fuzzy-searched list of commands on a modal dialog; the app's own opens with Mod+K), `SideDrawer` (a modal panel from the start or end edge, full width on phones), `BreadCrumbs` (the middle items fold into a menu past `max`), `KeyHint` (a shortcut drawn as keys: `keys="Mod+K"` shows Cmd on a Mac and Ctrl elsewhere; bind one with `useShortcut` from `src/keys.ts`), `StatTile` (a headline number with its change and a trend; `good-when="down"` for numbers that should fall), `BarChart` (stacked columns from zero with a legend, hover tooltip and a hidden table), `SparkLine` (a word-sized line or columns), `SkeletonBlock` (placeholders while loading; put `aria-busy` on the region), `toast()` from `src/toasts.ts` for short messages (shown by `ToastHost` in `App.vue`), and `v-tip` (`src/tooltip.ts`) instead of `title`. A Vue component's root element also picks up its parent's scoped classes, so a root class like `.row` or `.card` in a component can be restyled by the page using it: give root modifiers a component-specific name (`is-row`). Anything that pops up next to an anchor (lists, calendars, menus, tooltips) is teleported to `<body>` and placed with `usePopup` / `placePopup` from `src/popup.ts`, so cards with `overflow: hidden` never clip it and it flips above when there is no room below. Inside a `ModalDialog` it goes into the dialog instead (`usePopupHost`), because a modal makes the rest of the page inert; the toast host and `v-tip` follow the open modal the same way (`openModals`), and the page behind a modal does not scroll. The page at `#/kit` shows all of them; check a new or changed control there in every look and mode. `test/controls.test.ts` fails on native controls and `title` attributes in templates, and on a `v-tip` without its import. Charts color series by job: status tokens (`--ok`, `--bad`, `--warn`, `--paused`) for statuses, `--accent` for the series a view is about, `--muted` for context; never generated hues, never two y-axes, and text stays in text colors. Scrollbars, placeholders, autofill and `accent-color` are themed in `style.css`.
- Icons come from `src/icons.ts`: a curated set from [Lucide](https://lucide.dev) under Lucide's own names, used as components (`<X :size="14" />`). Add a new icon there, never import `@lucide/vue` elsewhere, and don't draw `<svg>` icons or type arrows and symbols (←, ▶, ✓) as text. The stroke width follows the look (`--icon-stroke`). An icon-only button needs an `aria-label`. `test/icons.test.ts` checks all of this; the grid on `#/kit` shows the set.
- Every page works at phone width (390px) and in every look and mode. Check them with the theme picker before taking screenshots.
- Keep motion small and respect `prefers-reduced-motion`.

## Adding a look

1. Add a `[data-look="<id>"]` block to `style.css` that overrides the color tokens (and fonts or radii if it changes them). Bundle any new font with a `@fontsource` package.
2. Add `{ id, name, note }` to `LOOKS` in `packages/web/src/theme.ts`.
3. Check contrast (text 4.5:1, control borders and focus rings 3:1) in light and dark, and add screenshots to `docs/screenshots/themes`.

Pages share a few layout classes from `style.css`: `.page` (the centered column), `.card`, `.page-head`, `.crumb`, `.muted`, `.small`, `.error` and `.sr-only`. Routes are hash based and live in `src/router.ts`; shared text formats (durations, "5 min ago", run counts) in `src/format.ts`.
