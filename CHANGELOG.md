# Changelog

## [0.4.0](https://github.com/DumiFlex/watchwright/compare/v0.3.0...v0.4.0) (2026-10-28)


### Features

* a Stop Watchwright button in Settings ([#59](https://github.com/DumiFlex/watchwright/issues/59)) ([41c2c0c](https://github.com/DumiFlex/watchwright/commit/41c2c0c5a2c9af8311ade1cb0ea1cd79965b8433))
* add packs without typing paths: folder browser, path completion, find packs, locate and remove ([#43](https://github.com/DumiFlex/watchwright/issues/43)) ([983d8ec](https://github.com/DumiFlex/watchwright/commit/983d8ece32be41e69bb2f10a58f12a5ff09ef852))
* each test's recent attempts on the pack page, with flaky tests marked ([#62](https://github.com/DumiFlex/watchwright/issues/62)) ([e39bbd5](https://github.com/DumiFlex/watchwright/commit/e39bbd5c533abdef1fb4bddc5a10a83b642db265))
* edit packs in the web app: files, a code editor with YAML hints, a Steps view and Run this test ([#53](https://github.com/DumiFlex/watchwright/issues/53)) ([51659ae](https://github.com/DumiFlex/watchwright/commit/51659ae2f10b29734b3c7dd65565f245745bfb95))
* Markdown preview in the editor and READMEs on pack pages ([#55](https://github.com/DumiFlex/watchwright/issues/55)) ([1540607](https://github.com/DumiFlex/watchwright/commit/15406076b36b51ca4ab936ab2a739f7c76df3369))
* pack images and a cursor-following side by side in the Markdown preview ([#58](https://github.com/DumiFlex/watchwright/issues/58)) ([7864439](https://github.com/DumiFlex/watchwright/commit/786443976b0c1ec4795c9d786ed25396f0ba7289))
* pack pieces for real-world packs: attempt and collector hooks, waitUntil, child caps and several parents, h.skip, run info, test descriptions, choice labels, Files tab ([#41](https://github.com/DumiFlex/watchwright/issues/41)) ([8958f70](https://github.com/DumiFlex/watchwright/commit/8958f707f0e914d8b05a7bf840a4ae010182ef3a))
* record tests by clicking on the live view, with other targets and the spot clicked ([#54](https://github.com/DumiFlex/watchwright/issues/54)) ([68a2412](https://github.com/DumiFlex/watchwright/commit/68a24122def0b58eff1fb0d89d4d6fee68b11745))
* run again, run labels, presets, and a New run that starts from your latest run ([#47](https://github.com/DumiFlex/watchwright/issues/47)) ([0fecaa8](https://github.com/DumiFlex/watchwright/commit/0fecaa88711a19c543bb2470a7a524daea1cc5b5))
* run tools: add tests to a running run, rewind the live view, step timeline, add to review, changes since the last run ([#44](https://github.com/DumiFlex/watchwright/issues/44)) ([cc16aea](https://github.com/DumiFlex/watchwright/commit/cc16aea51c591caa9398289477d7ae387f77fa79))
* runs at a glance: headline numbers and attempts per day on the runs page ([#63](https://github.com/DumiFlex/watchwright/issues/63)) ([148ad63](https://github.com/DumiFlex/watchwright/commit/148ad63bcaa40219c9d3064c6f529397b3b817a5))
* settings page, open files in your editor, starter packs ([#45](https://github.com/DumiFlex/watchwright/issues/45)) ([28942b3](https://github.com/DumiFlex/watchwright/commit/28942b34d709b5625ddeeb9ae7185e564d580e22))
* watch runs from the tab title, notifications and run shortcuts; find packs, runs and tests ([#48](https://github.com/DumiFlex/watchwright/issues/48)) ([530740a](https://github.com/DumiFlex/watchwright/commit/530740a0fb26d9c6331c52b9d853a8cec43578af))
* **web:** a filmstrip of the attempt's video, and each step's before and after ([#68](https://github.com/DumiFlex/watchwright/issues/68)) ([c5c7d55](https://github.com/DumiFlex/watchwright/commit/c5c7d55461c44dd4f6121356a4a994d6ef4c1450))
* **web:** a log viewer with search, level toggles, follow and links to lines ([#69](https://github.com/DumiFlex/watchwright/issues/69)) ([8dca000](https://github.com/DumiFlex/watchwright/commit/8dca000e3d69ee30c3691d44382310ee537b3ba2))
* **web:** compare two screenshots side by side, as a wipe or as an overlay ([#66](https://github.com/DumiFlex/watchwright/issues/66)) ([24e5684](https://github.com/DumiFlex/watchwright/commit/24e56843b9b9ae41ab4a52ab9a830b7ae8c0aa86))
* **web:** empty states that say what to do next, and loading skeletons ([#61](https://github.com/DumiFlex/watchwright/issues/61)) ([67fc15e](https://github.com/DumiFlex/watchwright/commit/67fc15e62803f81ced467d9e3122046d06595fa6))
* YAML tests and pack.yaml, a YAML starter, convert to code, and a TodoMVC example pack ([#52](https://github.com/DumiFlex/watchwright/issues/52)) ([a60a312](https://github.com/DumiFlex/watchwright/commit/a60a312c24331d9a5329bfb35d9047e26b890c11))


### Bug Fixes

* a run takes a test file saved in the editor while it runs, and the Record dialog fits short windows ([#65](https://github.com/DumiFlex/watchwright/issues/65)) ([3b53c39](https://github.com/DumiFlex/watchwright/commit/3b53c39e0a932f8fd2f1fd8b36bab7a9dc65959e))
* image viewer zoom, tooltips inside dialogs, page scroll behind dialogs and the video after full screen ([#46](https://github.com/DumiFlex/watchwright/issues/46)) ([63ea58f](https://github.com/DumiFlex/watchwright/commit/63ea58ff99df720e31aed3668547505977507c8b))
* one Browse button to add or find packs, and step 4 signed off ([#71](https://github.com/DumiFlex/watchwright/issues/71)) ([9eeef41](https://github.com/DumiFlex/watchwright/commit/9eeef414ae7bf17dbec0ca64fcd8ce10b067e193))
* outline the element under the pointer while recording, and size icon buttons like the others ([#56](https://github.com/DumiFlex/watchwright/issues/56)) ([8341bdc](https://github.com/DumiFlex/watchwright/commit/8341bdc3a43d4f6fe48cbf169299cf59693ac57d))
* **web:** open the timeline zoomed in far enough for whole step labels ([#67](https://github.com/DumiFlex/watchwright/issues/67)) ([7aef6b6](https://github.com/DumiFlex/watchwright/commit/7aef6b6adcef661d1d762b530cba62a1b54c8f78))
* **web:** smooth video timeline that stays readable with many steps ([#57](https://github.com/DumiFlex/watchwright/issues/57)) ([89c17c2](https://github.com/DumiFlex/watchwright/commit/89c17c253541a61e3f3d558b07f897e45754a03b))
* **web:** video controls move the timeline, edge scrolling while dragging, menus in full screen ([#64](https://github.com/DumiFlex/watchwright/issues/64)) ([5667446](https://github.com/DumiFlex/watchwright/commit/56674467a3fdb7658967816e8c26ddc084c06bb1))

## [0.3.0](https://github.com/DumiFlex/watchwright/compare/v0.2.0...v0.3.0) (2026-10-27)


### Features

* compare runs side by side and export them as Markdown or zip ([#35](https://github.com/DumiFlex/watchwright/issues/35)) ([827b126](https://github.com/DumiFlex/watchwright/commit/827b126a427b13656ca05ced01e274d7c3f2dab4))
* live run queue edits and marks ([#27](https://github.com/DumiFlex/watchwright/issues/27)) ([f366197](https://github.com/DumiFlex/watchwright/commit/f36619721b8b5697e43e835ee9f330c2bbcca3b8))
* review rubrics, scoring and a results grid ([#31](https://github.com/DumiFlex/watchwright/issues/31)) ([bff13ec](https://github.com/DumiFlex/watchwright/commit/bff13ec7c2ba225445c26eee69b94e9fd7eaf275))
* **web:** attempt page with image viewer, video player and trace viewer ([#29](https://github.com/DumiFlex/watchwright/issues/29)) ([69c736a](https://github.com/DumiFlex/watchwright/commit/69c736ac724d5e52b7dcd689909511fb08eec28d))
* **web:** code view, diff view, JSON tree and check tree ([#32](https://github.com/DumiFlex/watchwright/issues/32)) ([ab58cf8](https://github.com/DumiFlex/watchwright/commit/ab58cf8af04be3ad2e78fcf27eed3178bb1620b2))
* **web:** command palette, side drawer, breadcrumbs and key hints ([#33](https://github.com/DumiFlex/watchwright/issues/33)) ([8781895](https://github.com/DumiFlex/watchwright/commit/87818953785f8aea329523946892c7eead19b040))
* **web:** data table, date range picker and toasts ([#26](https://github.com/DumiFlex/watchwright/issues/26)) ([4b658c3](https://github.com/DumiFlex/watchwright/commit/4b658c3dd6e6edb031b3af3d593c34dafb6d8c0a))
* **web:** Lucide icons instead of hand-drawn ones ([#30](https://github.com/DumiFlex/watchwright/issues/30)) ([bb667ff](https://github.com/DumiFlex/watchwright/commit/bb667fff05a7052c6da410d5a412fba80b127223))
* **web:** new run page with planned order and run options ([#25](https://github.com/DumiFlex/watchwright/issues/25)) ([a587b51](https://github.com/DumiFlex/watchwright/commit/a587b51fe11a71e818ff8fbe34bc23d9e9a77de6))
* **web:** popup placement, multi-select and resizable text area ([#24](https://github.com/DumiFlex/watchwright/issues/24)) ([e5bd5c4](https://github.com/DumiFlex/watchwright/commit/e5bd5c4f034dafef7506df0957fb8acd154848c6))
* **web:** runs and packs pages, navigation and run delete ([#23](https://github.com/DumiFlex/watchwright/issues/23)) ([694e197](https://github.com/DumiFlex/watchwright/commit/694e197bfc79d15eb7d59cc8f3c9a9674848eda9))
* **web:** split panes, timeline scrubber and reorderable list ([#28](https://github.com/DumiFlex/watchwright/issues/28)) ([66f0203](https://github.com/DumiFlex/watchwright/commit/66f0203206fa18755708ca657da92fcddf5c8b77))
* **web:** stat tiles, bar chart, sparklines and loading placeholders ([#34](https://github.com/DumiFlex/watchwright/issues/34)) ([f3b45a3](https://github.com/DumiFlex/watchwright/commit/f3b45a346abd79eb968b9f22b2776d78f4e2a778))


### Bug Fixes

* step 2 sign-off fixes from the Firefox run ([#36](https://github.com/DumiFlex/watchwright/issues/36)) ([11073aa](https://github.com/DumiFlex/watchwright/commit/11073aa6bab57afa5f3ad8357183086a52dc1995))

## [0.2.0](https://github.com/DumiFlex/watchwright/compare/v0.1.0...v0.2.0) (2026-10-27)


### Features

* step 1 run engine, packs, live view and HTTP API ([#14](https://github.com/DumiFlex/watchwright/issues/14)) ([82567a6](https://github.com/DumiFlex/watchwright/commit/82567a6398fed867113de499cb9570af5e8a894c))
* **web:** Movement design and theme picker ([#12](https://github.com/DumiFlex/watchwright/issues/12)) ([0fd99ab](https://github.com/DumiFlex/watchwright/commit/0fd99abc62c129e24f1041f55c1a632eaf9a4658))
* **web:** themed checkbox and select instead of browser controls ([#15](https://github.com/DumiFlex/watchwright/issues/15)) ([64491de](https://github.com/DumiFlex/watchwright/commit/64491de7792b290b579db00364e5624fafdbafcf))
* **web:** themed control kit for every browser control ([#16](https://github.com/DumiFlex/watchwright/issues/16)) ([a14dfc2](https://github.com/DumiFlex/watchwright/commit/a14dfc25d4ec607262fabc6c2042d9fa9820fc33))

## 0.1.0 (2026-10-26)


### Features

* project skeleton and step 1 plan ([#1](https://github.com/DumiFlex/watchwright/issues/1)) ([b9157ee](https://github.com/DumiFlex/watchwright/commit/b9157ee2d3930822046473d54b7245b69fc309bb))

## Changelog
