/**
 * 订单的一张证据照片：带令牌取回图片，显示缩略图；「系统时间」就是系统收到照片的时间。供应商后台和运营后台共用。
 * 运营后台每取一次都记审计（ADR 0054），所以可能带着客人联系方式的截图用 `autoLoad={false}`，点了才取。
 *
 * 画在 canvas 上，不用 `<img src="blob:…">`：全站内容安全策略的 img-src 不放行 blob:（ADR 0054），用 img 在任何环境都显示不出来。
 * 解不出来的格式（手机拍的 HEIC，很多浏览器不支持）写明并给下载链接，不能让人以为没有照片。
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type OrderFile, getOrderFile } from "../../api/dispatch.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Button } from "../../components/Button.tsx";
import { formatInZone } from "../../lib/dispatch-display.ts";
import { fileKindName } from "../../lib/no-show-evidence.ts";

interface Loaded {
  /** 下载原图用；组件卸载时收回 */
  url: string;
  /** 浏览器解不出来为 null */
  bitmap: ImageBitmap | null;
}

async function decode(blob: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

function PhotoCanvas({ bitmap, label }: { bitmap: ImageBitmap; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    element.width = bitmap.width;
    element.height = bitmap.height;
    element.getContext("2d")?.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return <canvas ref={canvas} role="img" aria-label={label} />;
}

export function EvidencePhoto({ orderId, file, timeZone, portal = "tenant", autoLoad = true }: { orderId: string; file: OrderFile; timeZone: string; portal?: "tenant" | "platform"; autoLoad?: boolean }) {
  const { token } = usePortalSession();
  const [wanted, setWanted] = useState(autoLoad);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    let current: Loaded | null = null;
    getOrderFile(token, orderId, file.id, portal)
      .then(async (blob) => {
        const bitmap = await decode(blob);
        if (cancelled) {
          bitmap?.close();
          return;
        }
        current = { url: URL.createObjectURL(blob), bitmap };
        setLoaded(current);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (current !== null) {
        URL.revokeObjectURL(current.url);
        current.bitmap?.close();
      }
    };
  }, [token, orderId, file.id, portal, wanted]);
  const kind = fileKindName(file.kind);
  const time = formatInZone(file.uploaded_at, timeZone);
  const body = (): ReactNode => {
    if (!wanted) return <Button size="sm" onClick={() => setWanted(true)}>{`查看${kind}`}</Button>;
    if (failed) return <span className="table__muted">照片读不出来</span>;
    if (loaded === null) return <span className="table__muted">加载中…</span>;
    return (
      <>
        {loaded.bitmap !== null ? <PhotoCanvas bitmap={loaded.bitmap} label={`${kind}，系统时间 ${time}`} /> : <span className="table__muted">浏览器显示不了这种格式，请下载后查看。</span>}
        <a className="link" href={loaded.url} download>
          {`下载${kind}原图`}
        </a>
      </>
    );
  };
  return (
    <figure className="evidence-photo">
      {body()}
      <figcaption>
        {kind} · 系统时间 <time dateTime={file.uploaded_at}>{time}</time>
      </figcaption>
    </figure>
  );
}
