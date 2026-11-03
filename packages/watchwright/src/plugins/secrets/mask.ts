/** A copy of `value` with `mask` applied to every string in it (event data, attempt results, pack state). */
export function maskDeep<T>(value: T, mask: (s: string) => string): T {
  if (typeof value === "string") return mask(value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => maskDeep(v, mask)) as T;
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, mask)])) as T;
  return value;
}
