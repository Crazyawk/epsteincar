export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, az, bx, bz) => {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
};
export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function rand(min, max) {
  return min + Math.random() * (max - min);
}
export function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}
export function isOnRoad(x, z, roads, roadHalf) {
  for (const r of roads) {
    if (Math.abs(z - r) <= roadHalf) return true;
    if (Math.abs(x - r) <= roadHalf) return true;
  }
  return false;
}
