# Step 5 research: a CLI, an MCP server and an agent skill

Notes from reading the current tools and trying things in the cloud sandbox (2026-10-28), before writing [docs/plans/step-5.md](../plans/step-5.md). Step 5 is the agent step in the build order ([docs/plan.md](../plan.md), section 1): a person's own AI agent (Claude Code, Codex, Cursor, any MCP client) does what a person does on the web page, while the person watches it on the web page. Watchwright still has no AI of its own.

## 1. What other tools do

| Tool | How agents reach it | What it teaches the agent | How a person watches |
|---|---|---|---|
| **Playwright MCP** (`@playwright/mcp`) | An MCP server, stdio or HTTP, about 25 tools (`browser_navigate`, `browser_click` with a `ref`, `browser_snapshot`, …). | Tool descriptions only. | A headed browser window on the machine. |
| **playwright-cli** (`@playwright/cli` 0.1) | A CLI with named sessions (`-s=name`); each command prints the URL, the title and a snapshot file with element refs (`e21`). `playwright-cli install --skills` writes a skill into `.claude/skills` (or `~/.agents/skills` with `--skills=agents`). | The skill: commands, refs, sessions. | A headed browser, or `show` for a dashboard of sessions. |
| **Playwright test agents** (`npx playwright init-agents --loop=claude\|vscode\|opencode`) | Writes agent definitions (planner, generator, healer) and an MCP config into the project. | The agent files: plan in Markdown, write tests, heal broken ones. | Nothing beyond the test runner. |
| **Checkly, PiwiTests** | A CLI with JSON output; PiwiTests also has an MCP server over its results. | Docs. | Their dashboards, after the fact. |

What carries over:

- **Both doors, one source.** Coding agents with a shell do well with a CLI; agents without one (Claude Desktop, chat clients) need MCP. Measured token costs are about the same (Checkly: 45–48k vs 48–50k tokens for one task), so pick by fit and build both from the same declarations.
- **Element refs beat selectors for exploring.** An aria snapshot with refs lets an agent say "click e4" without guessing a selector, and the snapshot is far smaller than HTML.
- **A skill is how an agent learns the rules.** Tool descriptions say what a call does; a skill says when to use which, in what order, and what not to do.
- **The gap Watchwright fills:** none of these let a person watch the agent work from a web page, pause it, and see what it did afterwards. Watchwright already has the live view, pause and the store; the agent only needs doors to them.

## 2. MCP in October 2026

- **Spec 2025-11-25** is current: tools with `inputSchema` and optional `outputSchema` / `structuredContent`, image content (`{ type: "image", data, mimeType }`), tool annotations (`readOnlyHint`, `destructiveHint`), URL-mode elicitation, and **Tasks** (experimental: a call returns a task to fetch later). Clients differ a lot in what they support beyond plain tools, text and images.
- **TypeScript SDK v2** splits into `@modelcontextprotocol/server` 2.4.0 (depends only on `zod` and `@modelcontextprotocol/core`), `@modelcontextprotocol/node` (Node HTTP transport, on Hono) and `@modelcontextprotocol/client`. v1 (`@modelcontextprotocol/sdk` 1.32) is still maintained.
- **Plain JSON Schema works.** v2 has `fromJsonSchema(schema)`, so a tool takes the action's own JSON Schema as it is, with no Zod copy. Tried in the sandbox: a stdio server with one tool registered from a JSON Schema, called from the SDK client: the client listed the schema unchanged, a good call returned text and an image, and a bad call came back as `isError` with the validator's message (`data must have required property 'b'`).
- **Transports:** stdio (the client starts a process) and streamable HTTP (one URL; `Mcp-Session-Id` keeps a session). Claude Code (`claude mcp add --transport http`), Codex, Cursor and VS Code all take an HTTP URL; Claude Desktop's local servers are stdio.
- **Tasks:** too new to rely on. A bounded wait tool (returns within about two minutes with what changed) works in every client and is what the base design asked for (docs/plan.md, section 2.1).

## 3. Agent skills

- **The format is shared**: a folder with `SKILL.md` (YAML front matter `name`, lowercase with hyphens, at most 64 characters and the same as the folder; `description`, at most 1024 characters, saying what it does and when to use it) and optional `references/`, `scripts/` and `assets/` the agent reads when it needs them (the agentskills.io spec).
- **Where agents look:** Claude Code reads `.claude/skills/<name>/` in the project and `~/.claude/skills/`; Codex reads `.agents/skills/<name>/` in the project (and parents) and `~/.agents/skills/`; more tools read `.agents/skills` each month. Writing both covers the common agents.
- **Keep the top file short.** Agents load `SKILL.md` whole when the description matches and the references only when needed, so the step list, the pack API and the results schema go in references, generated from the same sources as the docs site so they can't drift.

## 4. Exploring a page: what Playwright 1.64 gives

- `page.ariaSnapshot({ mode: "ai" })` returns the page's accessibility tree with a ref on each element (`- textbox "New" [ref=e4]`), and `page.getByRef("e4")` is a locator for it. Tried in the sandbox (headless Chromium): the snapshot of a small form was nine lines, and filling through `getByRef` worked.
- A ref only lasts until the next snapshot, so it can't go into a test. Step 4's Record already turns an element into good targets (test id, role, label, text; `candidatesOf` in `plugins/record/candidates.ts`), so a ref the agent uses becomes those targets before the step is stored.
- **Record is already an exploring browser** that the person watches on the live view, with the pack's options and a step list. An agent exploring a page is the same thing driven by steps instead of clicks: the steps it tries land in the same list, and the person sees them and can take over with the mouse.

## 5. Who is calling

- Every action already gets a client name from the `x-watchwright-client` header, and runs keep it as "started by". MCP clients send their name in `initialize` (`clientInfo.name`, such as `claude-code`); a CLI run from an agent's shell can tell from the environment (Claude Code sets `CLAUDECODE=1`; the others are checked during the build), and `--as` overrides it.

## 6. Risks

- **Deleting things.** Some actions remove runs, packs or files, and one stops the server. An agent should not do these without the person. The base design suggested an approval banner on the web page; with nothing paid to approve until step 6, leaving these actions out of what agents get by default is enough for now (open question in the plan).
- **Big screenshots.** Scroll shots can be thousands of pixels tall, and clients cap image sizes. The file tool says the size and offers the file's URL when it is too big, instead of failing.
- **The server isn't running.** An MCP client that starts `watchwright mcp` over stdio expects it to work; it starts the server in the background when none answers, and says where.
- **Installing.** Watchwright isn't on npm, so `npx watchwright …` doesn't work for strangers yet. An HTTP MCP address needs no install path at all, which makes it the default way to connect.

## 7. Sources

- MCP specification 2025-11-25 (tools, content types, annotations, tasks); TypeScript SDK docs (ts.sdk.modelcontextprotocol.io) and the `@modelcontextprotocol/server` 2.4.0 type declarations (`McpServer.registerTool`, `fromJsonSchema`, `StdioServerTransport`, `NodeStreamableHTTPServerTransport`).
- Playwright docs: Playwright MCP, `playwright-cli` (sessions, snapshots, `install --skills`), test agents (`init-agents`); Playwright 1.64.1 `types.d.ts` (`ariaSnapshot` `mode: "ai"`, `getByRef`).
- Agent Skills specification (agentskills.io) and the Codex skills docs (`.agents/skills`).
- Checkly, "MCP vs CLI token efficiency" (2026).
- Sandbox checks: an MCP stdio server with a JSON Schema tool and an image reply, called from the SDK client; `ariaSnapshot({ mode: "ai" })` and `getByRef` on headless Chromium.
