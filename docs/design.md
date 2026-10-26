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
- Number inputs use custom up/down buttons, never the browser's native spinners.
- Every page works at phone width (390px) and in every look and mode. Check them with the theme picker before taking screenshots.
- Keep motion small and respect `prefers-reduced-motion`.

## Adding a look

1. Add a `[data-look="<id>"]` block to `style.css` that overrides the color tokens (and fonts or radii if it changes them). Bundle any new font with a `@fontsource` package.
2. Add `{ id, name, note }` to `LOOKS` in `packages/web/src/theme.ts`.
3. Check contrast (text 4.5:1, control borders and focus rings 3:1) in light and dark, and add screenshots to `docs/screenshots/themes`.
