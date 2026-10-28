// Where alerts go, and how each kind of channel wants its message (docs/plans/groundwork.md,
// section 7): a plain webhook (JSON), ntfy, a Discord webhook or a Slack webhook. A channel's URL
// and token may be written as `${secret.NAME}`, so the value itself stays in Secrets.

export const CHANNEL_TYPES = ["webhook", "ntfy", "discord", "slack"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export interface ChannelConfig {
  url: string;
  token?: string | undefined;
}

/** One alert, the same for every channel. */
export interface AlertMessage {
  /** The rule's trigger, such as `failed` or `recovered`. */
  trigger: string;
  /** One line: "Shop: failed". */
  title: string;
  /** What happened, in a sentence or two. */
  text: string;
  /** The page to open (the run, or the web app). */
  link: string;
  /** For webhooks: the event that caused it. */
  event?: { seq: number; type: string; runId?: string | undefined; data: Record<string, unknown> } | undefined;
}

export interface Outgoing {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const SECRET_REF = /\$\{secret\.([A-Za-z_][A-Za-z0-9_]{0,63})\}/g;

/** Fills `${secret.NAME}` in a channel's URL or token. Throws when a secret is missing. */
export function fill(value: string, secret: (name: string) => string | undefined): string {
  return value.replace(SECRET_REF, (_, name: string) => {
    const v = secret(name);
    if (v === undefined) throw new Error(`The secret ${name} isn't set (Settings > Secrets).`);
    return v;
  });
}

/** What the API shows for a channel's URL: a secret reference as written, otherwise the site only. */
export function shownUrl(url: string): string {
  if (/^\$\{secret\.[A-Za-z_][A-Za-z0-9_]*\}$/.test(url.trim())) return url.trim();
  try {
    return `${new URL(url).origin}/…`;
  } catch {
    return "…";
  }
}

/** Checks a URL as written (a secret reference counts as fine). */
export function checkUrl(url: string): string | null {
  if (SECRET_REF.test(url)) {
    SECRET_REF.lastIndex = 0;
    return null;
  }
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? null : "A channel's URL starts with https:// or http://.";
  } catch {
    return "That isn't a URL. Paste the whole address, starting with https://.";
  }
}

/** The request a channel sends for a message, with secrets filled in. */
export function outgoing(type: ChannelType, config: ChannelConfig, m: AlertMessage, secret: (name: string) => string | undefined): Outgoing {
  const url = fill(config.url, secret);
  const token = config.token ? fill(config.token, secret) : undefined;
  const auth: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  switch (type) {
    case "webhook":
      return {
        url,
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ source: "watchwright", trigger: m.trigger, title: m.title, text: m.text, link: m.link, event: m.event ?? null }),
      };
    case "ntfy":
      // ntfy takes the text as the body and the rest as headers; headers must be plain ASCII.
      return {
        url,
        headers: { "content-type": "text/plain; charset=utf-8", "x-title": ascii(m.title), "x-click": m.link, "x-tags": tagOf(m.trigger), ...auth },
        body: m.text,
      };
    case "discord":
      return { url, headers: { "content-type": "application/json" }, body: JSON.stringify({ content: `**${m.title}**\n${m.text}\n${m.link}`, allowed_mentions: { parse: [] } }) };
    case "slack":
      return { url, headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `*${slack(m.title)}*\n${slack(m.text)}\n<${m.link}|Open in Watchwright>` }) };
  }
}

function ascii(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, "?");
}

function slack(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** An ntfy tag (shown as an emoji) for the trigger. */
function tagOf(trigger: string): string {
  if (trigger === "passed" || trigger === "recovered") return "white_check_mark";
  if (trigger === "test") return "bell";
  if (trigger === "approval") return "raised_hand";
  return "warning";
}

/** Sends one request; throws with a short reason when it doesn't get a 2xx answer in time. */
export async function send(out: Outgoing, timeoutMs = 10_000): Promise<void> {
  let res: Response;
  try {
    res = await fetch(out.url, { method: "POST", headers: out.headers, body: out.body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
    throw new Error(err instanceof Error && err.name === "TimeoutError" ? `No answer in ${timeoutMs / 1000} s.` : `Couldn't reach ${new URL(out.url).host}${cause}.`, { cause: err });
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200).trim();
    throw new Error(`${new URL(out.url).host} answered ${res.status}${text ? `: ${text}` : ""}.`);
  }
}
