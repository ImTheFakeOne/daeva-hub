"use strict";
// Compare dotted version numbers: "1.10.0" > "1.9.3". Ignores a leading "v"
// and anything after a "-" (pre-release labels sort before the release).
function parse(v) {
  const s = String(v || "0").trim().replace(/^v/i, "");
  const [core, pre] = s.split("-", 2);
  return { parts: core.split(".").map((x) => parseInt(x, 10) || 0), pre: pre || "" };
}
function compare(a, b) {
  const A = parse(a), B = parse(b);
  for (let i = 0; i < Math.max(A.parts.length, B.parts.length); i++) {
    const d = (A.parts[i] || 0) - (B.parts[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return A.pre > B.pre ? 1 : -1;
}
const newer = (a, b) => compare(a, b) > 0;
module.exports = { compare, newer };
