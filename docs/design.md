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
- No stock browser controls. Use the kit in `packages/web/src/components/`: `TextField` (text, search, password, email, url), `TextArea` (grows with its text, or `resizable` with a themed grip), `CheckBox`, `ToggleSwitch`, `RadioGroup`, `SelectMenu`, `MultiSelect` (search, chips, groups), `NumberInput` (custom up/down buttons), `RangeSlider`, `DatePicker` and `DateRangePicker` (both on `CalendarMonth`), `FilePicker`, `ProgressBar`, `TabBar`, `MenuButton` (a menu of links or commands), `ModalDialog` (confirm and form dialogs) and `DataTable` (sorting, sticky header, selection, only the rows on screen drawn past `virtualFrom`, `cell-<key>` slots), `SplitPane` (two panes and a drag handle, size remembered with `storage-key`, stacked at phone width), `TimelineScrubber` (steps on a time axis with a playhead), `SortableList` (drag or keyboard reordering, `locked` rows stay put), `toast()` from `src/toasts.ts` for short messages (shown by `ToastHost` in `App.vue`), and `v-tip` (`src/tooltip.ts`) instead of `title`. A Vue component's root element also picks up its parent's scoped classes, so a root class like `.row` or `.card` in a component can be restyled by the page using it: give root modifiers a component-specific name (`is-row`). Anything that pops up next to an anchor (lists, calendars, menus, tooltips) is teleported to `<body>` and placed with `usePopup` / `placePopup` from `src/popup.ts`, so cards with `overflow: hidden` never clip it and it flips above when there is no room below. Inside a `ModalDialog` it goes into the dialog instead (`usePopupHost`), because a modal makes the rest of the page inert; the toast host follows the open modal the same way (`openModals`). The page at `#/kit` shows all of them; check a new or changed control there in every look and mode. `test/controls.test.ts` fails on native controls and `title` attributes in templates. Scrollbars, placeholders, autofill and `accent-color` are themed in `style.css`.
- Every page works at phone width (390px) and in every look and mode. Check them with the theme picker before taking screenshots.
- Keep motion small and respect `prefers-reduced-motion`.

## Adding a look

1. Add a `[data-look="<id>"]` block to `style.css` that overrides the color tokens (and fonts or radii if it changes them). Bundle any new font with a `@fontsource` package.
2. Add `{ id, name, note }` to `LOOKS` in `packages/web/src/theme.ts`.
3. Check contrast (text 4.5:1, control borders and focus rings 3:1) in light and dark, and add screenshots to `docs/screenshots/themes`.

Pages share a few layout classes from `style.css`: `.page` (the centered column), `.card`, `.page-head`, `.crumb`, `.muted`, `.small`, `.error` and `.sr-only`. Routes are hash based and live in `src/router.ts`; shared text formats (durations, "5 min ago", run counts) in `src/format.ts`.
