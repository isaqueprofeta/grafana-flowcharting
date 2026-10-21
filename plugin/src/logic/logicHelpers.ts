/**
 * logicHelpers — pure, framework-agnostic helpers extracted from the legacy
 * `$GF` static surface in `globals_class.ts` (design.md: Logic_Layer "as-is",
 * Req 8.2, 8.4). These are the only `$GF.*` members the ported rules /
 * thresholds / mappings engine actually calls, so they are carried over here as
 * plain functions with no Angular, `$scope`, `$GF`, `globalThis`, or `mx*`
 * coupling.
 *
 * Ported members (verbatim algorithm):
 *   $GF.stringToRegEx          -> stringToRegEx
 *   $GF.matchString            -> matchString
 *   $GF.calculateRatioForValue -> calculateRatioForValue
 *   $GF.calculateValueForRatio -> calculateValueForRatio
 *   $GF.calculateColorForRatio -> calculateColorForRatio
 *
 * The legacy `calculateColorForRatio` used `chroma.scale([a, b]).mode('lrgb')`.
 * `chroma-js` is not a dependency of the React scaffold, so the identical
 * linear-RGB interpolation is reimplemented here as a dependency-free pure
 * function that preserves the same `lrgb` blending semantics.
 */

/**
 * Convert a user pattern into a RegExp. A leading `/` denotes a RegExp literal
 * (`/body/flags`); any other string is matched as an anchored literal. Ported
 * as-is from `$GF.stringToRegEx`.
 */
export function stringToRegEx(str: string): RegExp | null {
  try {
    if (str.charAt(0) !== '/') {
      return new RegExp(`^${str}$`);
    }
    const match = str.match(new RegExp('^/(.*?)/(g?i?m?y?)$'));
    if (match) {
      return new RegExp(match[1], match[2]);
    }
  } catch (error) {
    return null;
  }
  return null;
}

/**
 * Return whether `str` matches `pattern`. A string pattern is interpreted
 * through {@link stringToRegEx} when `enableRegExp` is true. Ported as-is from
 * `$GF.matchString`.
 */
export function matchString(str: string, pattern: RegExp | string | undefined, enableRegExp = true): boolean {
  if (!str || !pattern || str.length === 0 || (typeof pattern === 'string' && pattern.length === 0)) {
    return false;
  }
  if (str === pattern) {
    return true;
  }
  if (pattern instanceof RegExp) {
    return pattern.test(str);
  }
  if (pattern && enableRegExp === true) {
    const reg = stringToRegEx(pattern);
    if (reg) {
      return reg.test(str);
    }
  }
  return false;
}

/**
 * Compute the ratio of `value` within `[beginValue, endValue]`. Ported as-is
 * from `$GF.calculateRatioForValue`.
 */
export function calculateRatioForValue(beginValue: number, endValue: number, value: number): number {
  if (value < beginValue || value > endValue) {
    throw new Error(
      `Cannot calculate ratio for value ${value} because value is less than ${beginValue} or greater than ${endValue}`
    );
  }
  const absoluteDistance = endValue - beginValue;
  const valueDistanceFromMin = value - beginValue;
  const ratio = valueDistanceFromMin / absoluteDistance;
  return ratio;
}

/**
 * Interpolate a value between two values with a ratio. Ported as-is from
 * `$GF.calculateValueForRatio`.
 */
export function calculateValueForRatio(beginValue: number, endValue: number, ratio: number): number {
  return beginValue + (endValue - beginValue) * ratio;
}

// --- Color interpolation (lrgb), replacing the chroma-js dependency ----------

/** Parse a CSS color (`#rgb`, `#rrggbb`, `rgb()/rgba()`) into [r,g,b,a]. */
function parseColor(color: string): [number, number, number, number] | null {
  const c = color.trim();
  // #rgb / #rgba / #rrggbb / #rrggbbaa
  if (c.charAt(0) === '#') {
    const hex = c.slice(1);
    const expand = (h: string) =>
      h
        .split('')
        .map((ch) => ch + ch)
        .join('');
    let r: number;
    let g: number;
    let b: number;
    let a = 1;
    if (hex.length === 3 || hex.length === 4) {
      const full = expand(hex);
      r = parseInt(full.slice(0, 2), 16);
      g = parseInt(full.slice(2, 4), 16);
      b = parseInt(full.slice(4, 6), 16);
      if (full.length === 8) {
        a = parseInt(full.slice(6, 8), 16) / 255;
      }
    } else if (hex.length === 6 || hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
      if (hex.length === 8) {
        a = parseInt(hex.slice(6, 8), 16) / 255;
      }
    } else {
      return null;
    }
    if ([r, g, b].some((n) => Number.isNaN(n))) {
      return null;
    }
    return [r, g, b, a];
  }
  // rgb()/rgba()
  const m = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) {
    const r = parseFloat(m[1]);
    const g = parseFloat(m[2]);
    const b = parseFloat(m[3]);
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    return [r, g, b, a];
  }
  return null;
}

/** Format [r,g,b,a] back to a CSS color string (hex when fully opaque). */
function formatColor(r: number, g: number, b: number, a: number): string {
  const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  if (a >= 1) {
    const toHex = (n: number) => clamp255(n).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  const alpha = Math.max(0, Math.min(1, a));
  return `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${alpha})`;
}

/**
 * Interpolate between two colors in linear-RGB space, preserving the legacy
 * `chroma.scale([begin, end]).mode('lrgb')(ratio)` semantics. On any parse
 * failure it falls back to `endColor`, matching the legacy catch behavior.
 */
export function calculateColorForRatio(beginColor: string, endColor: string, ratio: number): string {
  try {
    const begin = parseColor(beginColor);
    const end = parseColor(endColor);
    if (!begin || !end) {
      return endColor;
    }
    const t = Math.max(0, Math.min(1, ratio));
    // lrgb: interpolate the squares of the channel values, then sqrt back.
    const lerpChannel = (x: number, y: number) => Math.sqrt((1 - t) * x * x + t * y * y);
    const r = lerpChannel(begin[0], end[0]);
    const g = lerpChannel(begin[1], end[1]);
    const b = lerpChannel(begin[2], end[2]);
    const a = begin[3] + (end[3] - begin[3]) * t;
    return formatColor(r, g, b, a);
  } catch (error) {
    return endColor;
  }
}
