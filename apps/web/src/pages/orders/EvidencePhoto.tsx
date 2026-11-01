/**
 * 订单的一张证据照片：带令牌取回图片，显示缩略图；「系统时间」就是系统收到照片的时间。供应商后台和运营后台共用。
 * 运营后台每取一次都记审计（ADR 0054），所以可能带着客人联系方式的截图用 `autoLoad={false}`，点了才取。
 *
 * 画在 canvas 上，不用 `<img src="blob:…">`：全站内容安全策略的 img-src 不放行 blob:（ADR 0054），用 img 在任何环境都显示不出来。
 * 解不出来的格式（手机拍的 HEIC，很多浏览器不支持）写明并给下载链接，不能让人以为没有照片。
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type OrderFile, getOrderFile } from "../../api/dispatch.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Button } from "../../components/Button.tsx";
import { formatInZone } from "../../lib/dispatch-display.ts";
import { fileKindName } from "../../lib/no-show-evidence.ts";

/** 缩略图和看清内容都够用的最长边；再大的按比例缩小。canvas 有尺寸上限（Chrome 单边 32767），超过时什么都画不出来也不报错。 */
const MAX_DRAW_SIDE = 2048;

interface Loaded {
  /** 下载原图用；组件卸载时收回 */
  url: string;
  /** 浏览器解不出来为 null */
  bitmap: ImageBitmap | null;
}

async function decode(blob: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const scale = MAX_DRAW_SIDE / Math.max(bitmap.width, bitmap.height);
  if (scale >= 1) return bitmap;
  try {
    return await createImageBitmap(bitmap, { resizeWidth: Math.max(1, Math.round(bitmap.width * scale)), resizeHeight: Math.max(1, Math.round(bitmap.height * scale)), resizeQuality: "medium" });
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

/** 真的画上去了吗：缩成一小块看有没有不透明的像素。 */
function painted(canvas: HTMLCanvasElement): boolean {
  const probe = document.createElement("canvas");
  probe.width = 8;
  probe.height = 8;
  const context = probe.getContext("2d");
  if (context === null) return false;
  context.drawImage(canvas, 0, 0, 8, 8);
  return context.getImageData(0, 0, 8, 8).data.some((value, index) => index % 4 === 3 && value > 0);
}

function PhotoCanvas({ bitmap, label, onFailed }: { bitmap: ImageBitmap; label: string; onFailed(): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    element.width = bitmap.width;
    element.height = bitmap.height;
    const context = element.getContext("2d");
    if (context === null) return;
    try {
      context.drawImage(bitmap, 0, 0);
      if (!painted(element)) onFailed();
    } catch {
      onFailed();
    }
  }, [bitmap, onFailed]);
  return <canvas ref={canvas} role="img" aria-label={label} />;
}

export interface EvidencePhotoProps {
  orderId: string;
  file: OrderFile;
  timeZone: string;
  portal?: "tenant" | "platform";
  autoLoad?: boolean;
  /** 同一种照片有好几张时的序号，放进按钮和链接的名字，读屏才分得清；只有一张为 null */
  ordinal?: number | null;
  /** 这张要看却没显示出来（取不到、解不出来、画不出来）时报告，用来在 5 项结果旁边提醒 */
  onProblem?(fileId: string, problem: boolean): void;
}

export function EvidencePhoto({ orderId, file, timeZone, portal = "tenant", autoLoad = true, ordinal = null, onProblem }: EvidencePhotoProps) {
  const { token } = usePortalSession();
  const [wanted, setWanted] = useState(autoLoad);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [drawFailed, setDrawFailed] = useState(false);
  const container = useRef<HTMLElement>(null);
  const markDrawFailed = useCallback(() => setDrawFailed(true), []);
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
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (current !== null) {
        URL.revokeObjectURL(current.url);
        current.bitmap?.close();
      }
    };
  }, [token, orderId, file.id, portal, wanted, attempt]);
  const problem = failed || drawFailed || (loaded !== null && loaded.bitmap === null);
  useEffect(() => {
    onProblem?.(file.id, problem);
  }, [onProblem, file.id, problem]);
  const kind = fileKindName(file.kind);
  const time = formatInZone(file.uploaded_at, timeZone);
  const which = ordinal === null ? "" : `（第 ${ordinal} 张）`;
  const open = (): void => {
    setWanted(true);
    // 按钮马上要消失：焦点放到这张照片的容器上，键盘和读屏用户不用从页面最前面重新走
    container.current?.focus();
  };
  const retry = (): void => {
    setFailed(false);
    setAttempt((value) => value + 1);
  };
  const body = (): ReactNode => {
    if (!wanted) return <Button size="sm" onClick={open}>{`查看${kind}${which}`}</Button>;
    if (failed) {
      return (
        <>
          <span className="table__muted">照片读不出来</span>
          <Button size="sm" onClick={retry}>{`重新取${kind}${which}`}</Button>
        </>
      );
    }
    if (loaded === null) return <span className="table__muted">加载中…</span>;
    return (
      <>
        {loaded.bitmap !== null && !drawFailed ? <PhotoCanvas bitmap={loaded.bitmap} label={`${kind}，系统时间 ${time}`} onFailed={markDrawFailed} /> : <span className="table__muted">浏览器显示不了这种格式，请下载后查看。</span>}
        <a className="link" href={loaded.url} download>
          {`下载${kind}原图${which}`}
        </a>
      </>
    );
  };
  return (
    <figure ref={container} tabIndex={-1} className="evidence-photo">
      {body()}
      <figcaption>
        {kind} · 系统时间 <time dateTime={file.uploaded_at}>{time}</time>
      </figcaption>
    </figure>
  );
}
