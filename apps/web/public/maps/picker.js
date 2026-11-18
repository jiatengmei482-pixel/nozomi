// 官网选点地图（谷歌地图，M10-01 第 2 处）。见 picker.html 的说明；和打开它的页面之间的消息（都带 source: "nozomi-map"）：
//   发出：ready（地图出来了）、failed（脚本加载失败、密钥被拒、不是被官网打开的）、pick { lat, lng }（客人点了地图或拖完标记）
//   收到：point { lat, lng }（外面的坐标变了：标记移过去，不在视野里就移地图）、pick-center（选地图中间这个位置）
const SOURCE = "nozomi-map";
const CITY_ZOOM = 12;
const POINT_ZOOM = 16;
const params = new URLSearchParams(location.search);
const key = params.get("key") ?? "";
const number = (name) => {
  const value = Number(params.get(name));
  return params.get(name) !== null && Number.isFinite(value) ? value : null;
};

function post(message) {
  if (window.parent !== window) window.parent.postMessage({ source: SOURCE, ...message }, location.origin);
}

let failed = false;
function fail(reason) {
  if (failed) return;
  failed = true;
  post({ type: "failed", reason });
}

function start() {
  const { maps } = window.google;
  const center = { lat: number("lat") ?? 35.681236, lng: number("lng") ?? 139.767125 };
  const hasPoint = number("plat") !== null && number("plng") !== null;
  const point = hasPoint ? { lat: number("plat"), lng: number("plng") } : null;
  const map = new maps.Map(document.getElementById("map"), {
    center: point ?? center,
    zoom: point === null ? CITY_ZOOM : POINT_ZOOM,
    disableDefaultUI: true,
    zoomControl: true,
    clickableIcons: false,
    gestureHandling: "greedy",
    keyboardShortcuts: true,
  });
  const marker = new maps.Marker({ map, position: point, draggable: true, visible: point !== null });
  const pick = (latLng) => {
    marker.setPosition(latLng);
    marker.setVisible(true);
    post({ type: "pick", lat: latLng.lat(), lng: latLng.lng() });
  };
  map.addListener("click", (event) => {
    if (event.latLng) pick(event.latLng);
  });
  marker.addListener("dragend", (event) => {
    if (event.latLng) pick(event.latLng);
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const data = event.data;
    if (data === null || typeof data !== "object" || data.source !== SOURCE) return;
    if (data.type === "point" && Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
      const latLng = new maps.LatLng(data.lat, data.lng);
      marker.setPosition(latLng);
      marker.setVisible(true);
      const bounds = map.getBounds();
      if (bounds === undefined || !bounds.contains(latLng)) {
        map.setCenter(latLng);
        map.setZoom(Math.max(map.getZoom() ?? POINT_ZOOM, POINT_ZOOM));
      }
    } else if (data.type === "pick-center") {
      const centerNow = map.getCenter();
      if (centerNow) pick(centerNow);
    }
  });
  maps.event.addListenerOnce(map, "tilesloaded", () => {
    if (!failed) post({ type: "ready" });
  });
}

if (window.parent === window || !/^AIza[0-9A-Za-z_-]{35}$/.test(key)) {
  fail("not-embedded");
} else {
  // 密钥被拒（网址没登记、API 没开、没开结算）时谷歌调这个全局函数
  window.gm_authFailure = () => fail("auth");
  window.__nozomiMapStart = () => {
    try {
      start();
    } catch {
      fail("error");
    }
  };
  const script = document.createElement("script");
  const language = params.get("lang") ?? "zh-CN";
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__nozomiMapStart&loading=async&language=${encodeURIComponent(language)}&region=JP`;
  script.async = true;
  script.onerror = () => fail("load");
  document.head.append(script);
}
