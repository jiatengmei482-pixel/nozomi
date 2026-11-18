/** 地图选点的坐标（官网的两种选点地图共用，M10-01 第 2 处） */
export interface LatLngValue {
  lat: number;
  lng: number;
}

/** 地图给的坐标保留 6 位小数（约 0.1 米），经度折回 [-180, 180)，和坐标栏里的写法一致。 */
export function roundLatLng(point: LatLngValue): LatLngValue {
  const lng = ((((point.lng + 180) % 360) + 360) % 360) - 180;
  return { lat: Number(point.lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}
