/**
 * 一次性链接（docs/design/02-components.md 第 37 节、pages/platform-tenants.md 第 2 节）。
 * 系统没有邮件服务：邀请、密码重置成功时接口返回一个只出现这一次的令牌，这个对话框把它拼成完整的链接交到操作的人手里。
 *
 * 令牌的硬性要求（2.3）：令牌和链接只在这个组件的渲染里——由发起操作的对话框放在它自己的内存状态里传进来，关闭时清掉；
 * 不进地址、路由状态、存储、日志、Toast、title、aria-label。只能用底部的按钮关闭；还没复制过就关，要再确认一次。
 */
import { useEffect, useId, useRef, useState } from "react";
import { type LinkKind, expiryText, linkMessage, oneTimeLink } from "../lib/one-time-link.ts";
import { PORTALS, type Portal } from "../lib/portal.ts";
import { Alert } from "./Alert.tsx";
import { Button } from "./Button.tsx";
import { Dialog } from "./Dialog.tsx";
import { Icon } from "./Icon.tsx";

export interface IssuedLink {
  /** 链接是哪个后台的 */
  portal: Portal;
  kind: LinkKind;
  /** 接口这一次应答里的令牌 */
  token: string;
  expiresAt: string | null;
  name: string;
  email: string;
  /** 「给谁」那一行后半句：「NOZOMI 自营车队 的管理员」「平台员工，运营」 */
  whom: string;
}

export function OneTimeLinkDialog({ issued, onClose }: { issued: IssuedLink; onClose(): void }) {
  const noteId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState<"link" | "message" | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [announce, setAnnounce] = useState("");
  const link = oneTimeLink(window.location.origin, issued.portal, issued.kind, issued.token);
  const label = issued.kind === "invite" ? "邀请链接" : "密码重置链接";

  // 对话框开着时刷新、关标签页：浏览器自带的离开确认拦一次（链接关掉就没有了）
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(timer);
  }, [flash]);

  const copy = (what: "link" | "message"): void => {
    const text = what === "link" ? link : linkMessage({ portal: issued.portal, kind: issued.kind, name: issued.name, email: issued.email, link, expiresAt: issued.expiresAt });
    const done = (): void => {
      setCopied(true);
      setFailed(false);
      setConfirming(false);
      setFlash(what);
      setAnnounce(what === "link" ? "链接已复制" : "链接和说明已复制");
    };
    const refused = (): void => {
      // 浏览器不让写剪贴板：把文本框里的链接全选好，让人自己按 Ctrl / ⌘ + C
      setFailed(true);
      setAnnounce("");
      box.current?.focus();
      box.current?.select();
    };
    if (!navigator.clipboard?.writeText) return refused();
    navigator.clipboard.writeText(text).then(done, refused);
  };

  return (
    <Dialog
      open
      sealed
      size="form"
      title={`${label}（只显示这一次）`}
      describedBy={noteId}
      onClose={onClose}
      footer={
        confirming ? (
          <div className="link-dialog__confirm" role="alert">
            <span className="link-dialog__confirm-text">
              <Icon name="alert-triangle" />
              还没有复制过这条链接。关闭以后无法再看到，只能重新发起。
            </span>
            <Button variant="text" className="button--danger-text" onClick={onClose}>
              仍然关闭
            </Button>
            <Button variant="secondary" data-refocus onClick={() => setConfirming(false)}>
              回去复制
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            onClick={() => {
              if (copied) return onClose();
              setConfirming(true);
              requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-refocus]")?.focus());
            }}
          >
            我已经发给对方，关闭
          </Button>
        )
      }
    >
      <p className="visually-hidden">这个对话框只能用最下面的按钮关闭。</p>
      <p className="link-dialog__whom">
        给 <strong>{issued.name}</strong>（{issued.email}）· {issued.whom}
      </p>
      <textarea
        ref={box}
        className="input textarea link-dialog__link"
        rows={4}
        readOnly
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        value={link}
        onCopy={() => {
          setCopied(true);
          setConfirming(false);
        }}
      />
      <div className="link-dialog__actions">
        <Button variant="primary" data-autofocus onClick={() => copy("link")}>
          {flash === "link" ? (
            <>
              <Icon name="check" />
              已复制
            </>
          ) : (
            "复制链接"
          )}
        </Button>
        <Button variant="secondary" onClick={() => copy("message")}>
          {flash === "message" ? (
            <>
              <Icon name="check" />
              已复制
            </>
          ) : (
            "复制链接和说明"
          )}
        </Button>
      </div>
      <div role="status" className="visually-hidden">
        {announce}
      </div>
      <div role="alert">{failed && <p className="field__error link-dialog__failed">没有复制成功。链接已经选中，请按 Ctrl + C（Mac 上是 ⌘ + C）复制。</p>}</div>
      <div id={noteId}>
        <Alert kind="warning">
          <strong className="alert__title">系统不会发邮件。</strong>
          <span>请你自己把链接发给对方本人（邮件、LINE、企业微信等你们平时用的方式）。</span>
        </Alert>
      </div>
      <ul className="link-dialog__notes">
        <li>{expiryText(issued.kind, issued.expiresAt)}</li>
        <li>{`拿到链接的人就能给这个账号设密码并登录${PORTALS[issued.portal].name}，不要发到群里。`}</li>
        <li>关闭以后无法再看到这条链接。对方没收到或过期了，可以重新发起，旧链接会作废。</li>
        {issued.kind === "reset" && (
          <>
            <li>发出链接不会改掉对方现在的密码；对方用它设了新密码以后，旧密码才失效，他在所有设备上都要重新登录。</li>
            <li>再发一次会让这条链接作废。</li>
          </>
        )}
      </ul>
    </Dialog>
  );
}

/** 发起时网络不通、超时、服务器出错：不知道有没有成功（2.4）。 */
export const UNSURE_TEXT = "请检查网络后再试一次。如果其实已经成功了，再试一次会发出一条新的链接，之前那条作废——没有影响，因为它还没有交到任何人手里。";
