// Shared logic for the trees (JsonTree, CheckTree): which rows show with some branches
// open, how the keys move through them, and the checked state of a branch from its leaves.

export type TreeNode<T = unknown> = { id: string; label: string; children?: TreeNode<T>[] | undefined; data?: T };
export type TreeRow<T = unknown> = { node: TreeNode<T>; depth: number; parent: string | null; index: number; setSize: number };

/** The rows on screen: every node whose ancestors are all open. */
export function visibleRows<T>(nodes: readonly TreeNode<T>[], open: ReadonlySet<string>, depth = 1, parent: string | null = null, out: TreeRow<T>[] = []): TreeRow<T>[] {
  nodes.forEach((node, i) => {
    out.push({ node, depth, parent, index: i + 1, setSize: nodes.length });
    if (node.children?.length && open.has(node.id)) visibleRows(node.children, open, depth + 1, node.id, out);
  });
  return out;
}

/** Every leaf id under a node (the node itself when it is a leaf). */
export function leaves<T>(node: TreeNode<T>): string[] {
  return node.children?.length ? node.children.flatMap(leaves) : [node.id];
}

/** "on" when all leaves are chosen, "off" when none, "some" otherwise. */
export function checkState<T>(node: TreeNode<T>, chosen: ReadonlySet<string>): "on" | "off" | "some" {
  const ids = leaves(node);
  const n = ids.filter((id) => chosen.has(id)).length;
  return n === 0 ? "off" : n === ids.length ? "on" : "some";
}

/** Chooses or drops every leaf under `node`, returning the new list. A branch that is fully on turns off; anything else turns on. */
export function toggleNode<T>(node: TreeNode<T>, chosen: readonly string[]): string[] {
  const ids = leaves(node);
  const set = new Set(chosen);
  if (checkState(node, set) === "on") return chosen.filter((id) => !ids.includes(id));
  for (const id of ids) set.add(id);
  return [...set];
}

/**
 * What the ARIA tree keys do from row `at`: the row to focus next and which branch to open
 * or close. Right opens a closed branch or goes to its first child; Left closes an open one
 * or goes to the parent.
 */
export function treeKey<T>(rows: readonly TreeRow<T>[], at: number, key: string, open: ReadonlySet<string>): { focus: number; open?: string; close?: string } | null {
  const row = rows[at];
  if (!row) return null;
  const branch = !!row.node.children?.length;
  switch (key) {
    case "ArrowDown":
      return { focus: Math.min(rows.length - 1, at + 1) };
    case "ArrowUp":
      return { focus: Math.max(0, at - 1) };
    case "Home":
      return { focus: 0 };
    case "End":
      return { focus: rows.length - 1 };
    case "ArrowRight":
      if (!branch) return { focus: at };
      return open.has(row.node.id) ? { focus: Math.min(rows.length - 1, at + 1) } : { focus: at, open: row.node.id };
    case "ArrowLeft":
      if (branch && open.has(row.node.id)) return { focus: at, close: row.node.id };
      return { focus: row.parent === null ? at : rows.findIndex((r) => r.node.id === row.parent) };
    default:
      return null;
  }
}

/** Ids of every branch on the way to nodes whose label (or `text`) matches `query`, to open them. */
export function pathsTo<T>(nodes: readonly TreeNode<T>[], match: (node: TreeNode<T>) => boolean): Set<string> {
  const out = new Set<string>();
  const walk = (list: readonly TreeNode<T>[], trail: string[]): boolean => {
    let any = false;
    for (const n of list) {
      const below = n.children?.length ? walk(n.children, [...trail, n.id]) : false;
      if (match(n) || below) {
        any = true;
        for (const id of trail) out.add(id);
        if (below) out.add(n.id);
      }
    }
    return any;
  };
  walk(nodes, []);
  return out;
}
