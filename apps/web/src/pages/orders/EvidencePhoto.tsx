/**
 * 订单的一张证据照片：带令牌取回图片，显示缩略图；「系统时间」就是系统收到照片的时间。供应商后台和运营后台共用。
 * 运营后台每取一次都记审计（ADR 0054），所以可能带着客人联系方式的截图用 `autoLoad={false}`，点了才取。
 * 手机拍的 HEIC 很多浏览器显示不了，这时给下载链接，不能让运营以为没有照片。
 */
import { type ReactNode, useEffect, useState } from "react";
import { type OrderFile, getOrderFile } from "../../api/dispatch.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Button } from "../../components/Button.tsx";
import { formatInZone } from "../../lib/dispatch-display.ts";
import { fileKindName } from "../../lib/no-show-evidence.ts";

export function EvidencePhoto({ orderId, file, timeZone, portal = "tenant", autoLoad = true }: { orderId: string; file: OrderFile; timeZone: string; portal?: "tenant" | "platform"; autoLoad?: boolean }) {
  const { token } = usePortalSession();
  const [wanted, setWanted] = useState(autoLoad);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [undisplayable, setUndisplayable] = useState(false);
  useEffect(() => {
    if (!wanted) return;
    let revoked = false;
    let objectUrl: string | null = null;
    getOrderFile(token, orderId, file.id, portal).then(
      (blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      () => setFailed(true),
    );
    return () => {
      revoked = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [token, orderId, file.id, portal, wanted]);
  const kind = fileKindName(file.kind);
  const time = formatInZone(file.uploaded_at, timeZone);
  const body = (): ReactNode => {
    if (!wanted) return <Button size="sm" onClick={() => setWanted(true)}>{`查看${kind}`}</Button>;
    if (failed) return <span className="table__muted">照片读不出来</span>;
    if (url === null) return <span className="table__muted">加载中…</span>;
    if (undisplayable) {
      return (
        <a className="link" href={url} download>
          {`浏览器显示不了这种格式，下载${kind}`}
        </a>
      );
    }
    return <img src={url} alt={`${kind}，系统时间 ${time}`} onError={() => setUndisplayable(true)} />;
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
