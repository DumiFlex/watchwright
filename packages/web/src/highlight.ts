// A small syntax colorer for CodeView: enough for test files (TypeScript, JavaScript) and
// JSON, not a parser. It splits text into lines of tokens; CodeView colors them from the
// theme. Anything it doesn't know stays plain.

export type Lang = "ts" | "js" | "json" | "text";
export type TokenKind = "plain" | "keyword" | "string" | "number" | "comment" | "literal" | "key" | "fn";
export type Token = { kind: TokenKind; text: string };

const KEYWORDS = new Set(
  "as async await break case catch class const continue default delete do else export extends finally for from function if import in instanceof interface let new of return static super switch this throw try type typeof var void while with yield enum implements private protected public readonly declare keyof satisfies".split(
    " ",
  ),
);
const LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

// One alternation, tried at each position; the group that matched names the token.
const RULES: Record<Exclude<Lang, "text">, RegExp> = {
  ts: /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|(\b(?:0[xob][\da-f_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?n?)\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/giy,
  js: /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|(\b(?:0[xob][\da-f_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?n?)\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/giy,
  json: /()("(?:\\.|[^"\\\n])*"?)(?=\s*:)|()("(?:\\.|[^"\\\n])*"?)|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)|(true|false|null)/giy,
};

function push(line: Token[], kind: TokenKind, text: string) {
  const last = line[line.length - 1];
  if (last && last.kind === kind) last.text += text;
  else line.push({ kind, text });
}

/** Splits `code` into lines of colored tokens. A token never spans lines. */
export function highlight(code: string, lang: Lang): Token[][] {
  const flat: Token[] = [];
  const re = lang === "text" ? null : RULES[lang];
  let i = 0;
  let plain = "";
  const flush = () => {
    if (plain) flat.push({ kind: "plain", text: plain });
    plain = "";
  };
  while (re && i < code.length) {
    re.lastIndex = i;
    const m = re.exec(code);
    if (!m || m[0] === "") {
      plain += code[i];
      i++;
      continue;
    }
    flush();
    const text = m[0];
    let kind: TokenKind = "plain";
    if (lang === "json") {
      if (m[2] !== undefined) kind = "key";
      else if (m[4] !== undefined) kind = "string";
      else if (m[5] !== undefined) kind = "number";
      else if (m[6] !== undefined) kind = "literal";
    } else if (m[1] !== undefined) kind = "comment";
    else if (m[2] !== undefined) kind = "string";
    else if (m[3] !== undefined) kind = "number";
    else {
      const word = m[4] ?? m[5] ?? "";
      kind = KEYWORDS.has(word) ? "keyword" : LITERALS.has(word) ? "literal" : m[4] !== undefined ? "fn" : "plain";
    }
    flat.push({ kind, text });
    i += text.length;
  }
  if (!re) plain = code;
  flush();
  // Cut tokens at line breaks.
  const lines: Token[][] = [[]];
  for (const t of flat) {
    const parts = t.text.split("\n");
    parts.forEach((p, k) => {
      if (k > 0) lines.push([]);
      if (p) push(lines[lines.length - 1]!, t.kind, p);
    });
  }
  return lines;
}
