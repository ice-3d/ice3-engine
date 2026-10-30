const COLOR_CACHE_LIMIT = 128;
const COLOR_CACHE = new Map<
  string,
  readonly [number, number, number, number]
>();

export function colorToRgba(
  color: string,
): readonly [number, number, number, number] {
  const normalized = color.startsWith('#') ? color.slice(1) : color;
  const expanded = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Unsupported ICE basic material color: ${color}`);
  }
  const key = expanded.toLowerCase();
  const cached = COLOR_CACHE.get(key);
  if (cached) return cached;
  const rgba = Object.freeze([
    Number.parseInt(expanded.slice(0, 2), 16) / 255,
    Number.parseInt(expanded.slice(2, 4), 16) / 255,
    Number.parseInt(expanded.slice(4, 6), 16) / 255,
    1,
  ]) as readonly [number, number, number, number];
  if (COLOR_CACHE.size >= COLOR_CACHE_LIMIT) {
    const oldest = COLOR_CACHE.keys().next().value as string | undefined;
    if (oldest !== undefined) COLOR_CACHE.delete(oldest);
  }
  COLOR_CACHE.set(key, rgba);
  return rgba;
}
