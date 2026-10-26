/**
 * 二维码（绑定两步验证时给验证器 App 扫，ADR 0030）。用 qrcode-generator 算出点阵，画成 SVG：
 * 不用图片、不用画布，颜色跟着设计令牌（深色模块在浅色底上；暗色主题下是浅色模块在深色底上，主流验证器都能扫，扫不了时用旁边的密钥手输）。
 * 四周留 4 个模块的空白（二维码规范要求的静区）。
 */
import qrcode from "qrcode-generator";

/** 文字的点阵：纠错等级 M（约 15% 可恢复），版本自动选。 */
export function qrMatrix(text: string): boolean[][] {
  const code = qrcode(0, "M");
  code.addData(text, "Byte");
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => code.isDark(row, col)));
}

const QUIET = 4;

export function QrCode({ text, label }: { text: string; label: string }) {
  const matrix = qrMatrix(text);
  const size = matrix.length + QUIET * 2;
  // 一行里连续的深色模块合成一个矩形，元素少一些
  const rects: { x: number; y: number; w: number }[] = [];
  matrix.forEach((row, y) => {
    let start = -1;
    row.forEach((dark, x) => {
      if (dark && start < 0) start = x;
      if ((!dark || x === row.length - 1) && start >= 0) {
        const end = dark ? x + 1 : x;
        rects.push({ x: start, y, w: end - start });
        start = -1;
      }
    });
  });
  return (
    <svg className="qr-code" role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <rect className="qr-code__quiet" x={0} y={0} width={size} height={size} />
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} className="qr-code__module" x={r.x + QUIET} y={r.y + QUIET} width={r.w} height={1} />
      ))}
    </svg>
  );
}
