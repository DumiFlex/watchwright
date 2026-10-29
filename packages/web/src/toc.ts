// A page's list of sections: which one to mark while the page scrolls.

/**
 * The index of the section to mark: the last whose top has passed `line` (the first when none has),
 * or the last section once the page is scrolled to the bottom, where it may never reach the line.
 * `tops` are the sections' tops from the top of the window, in page order; null for one not shown.
 */
export function sectionAt(tops: readonly (number | null)[], line: number, atBottom: boolean): number {
  if (atBottom && tops.length) return tops.length - 1;
  let at = 0;
  tops.forEach((top, i) => {
    if (top !== null && top <= line) at = i;
  });
  return at;
}
