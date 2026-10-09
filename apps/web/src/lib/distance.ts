/** 「约 18 公里」；不到 1 公里写「不到 1 公里」。 */
export function formatDistance(km: number): string {
  return km < 1 ? "不到 1 公里" : `约 ${Math.round(km)} 公里`;
}
