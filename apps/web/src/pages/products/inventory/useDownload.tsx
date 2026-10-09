/** 导出 / 下载模版：取回文件、交给浏览器保存，并管好「准备中」「没准备好」两种状态（tenant-inventory.md 7.2）。 */
import { type ReactNode, useRef, useState } from "react";
import type { DownloadedFile } from "../../../api/client.ts";
import { usePortalSession } from "../../../auth/PortalSession.tsx";
import { Alert } from "../../../components/Alert.tsx";
import { Button } from "../../../components/Button.tsx";
import { useToast } from "../../../components/Toast.tsx";
import { saveFile } from "../../../lib/download.ts";

export interface Download {
  busy: boolean;
  /** 页面级的「文件没有准备好」提示条；没有失败时是 null */
  notice: ReactNode;
  run(fetchFile: (token: string) => Promise<DownloadedFile>, fallbackName: string): Promise<boolean>;
}

export function useDownload(): Download {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const last = useRef<{ fetchFile: (token: string) => Promise<DownloadedFile>; fallbackName: string } | null>(null);

  const run = async (fetchFile: (token: string) => Promise<DownloadedFile>, fallbackName: string): Promise<boolean> => {
    if (busy) return false;
    last.current = { fetchFile, fallbackName };
    setBusy(true);
    setFailed(false);
    try {
      const name = saveFile(await fetchFile(token), fallbackName);
      toast(`已开始下载「${name}」`);
      return true;
    } catch (err) {
      if (!handleAuthFailure(err)) setFailed(true);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const notice = failed ? (
    <Alert kind="danger">
      <span>文件没有准备好，请稍后再试。</span>
      <span className="alert__actions">
        <Button size="sm" onClick={() => last.current && void run(last.current.fetchFile, last.current.fallbackName)}>
          重试
        </Button>
      </span>
    </Alert>
  ) : null;
  return { busy, notice, run };
}
