// 本机验收用：把 http://127.0.0.1:18443 原样转发到测试环境（只给本机 WebKit 用，WebKit 缺 TLS 组件）
import http from "node:http"; import https from "node:https";
http.createServer((req, res) => {
  const up = https.request({ host: "nozomi.moveglobal.io", path: req.url, method: req.method, headers: { ...req.headers, host: "nozomi.moveglobal.io" } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(18443, "127.0.0.1");
