import type { Bbox } from "./types";

/** Validate the study-region inputs the way the API does, so the UI can explain problems before a request. */
export function parseBbox(v: [string, string, string, string]): Bbox | string {
  const nums = v.map((x) => Number(x));
  if (nums.some((n) => !Number.isFinite(n))) return "All four bounding-box values must be numbers.";
  const [a, b, c, d] = nums as Bbox;
  if (!(a < c) || !(b < d)) return "Use min < max for both longitude and latitude.";
  if (c - a > 30 || d - b > 30) return "Each axis must span at most 30 degrees.";
  if (a < -180 || c > 180 || b < -90 || d > 90) return "Longitude must be within [-180, 180] and latitude within [-90, 90].";
  return [a, b, c, d];
}
