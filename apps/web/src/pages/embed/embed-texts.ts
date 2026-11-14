/**
 * 嵌入预订页自己那一层（标题、卖方说明、读草稿 / 订单的各种状态、订单页的说明）的文案，中 / 日 / 英（M9E-16 起）。
 * 中间复用的 `/book/new` 四步和订单区块现在只有中文；它们的三语是 M9E-18（ADR 0095 第四节第 3 小节），到时候按同样的表写。
 */
export type EmbedLang = "zh" | "ja" | "en";

type Keys =
  | "title"
  | "loading"
  | "seller"
  | "expired"
  | "failed"
  | "topLevel"
  | "goToSite"
  | "badAddress"
  | "orderPlaced"
  | "orderPending"
  | "payInNewWindow"
  | "openOrder"
  | "manageNote"
  | "paid"
  | "cancelled"
  | "orderMissing"
  | "lookup"
  | "orderFailed"
  | "retry"
  | "orderNo";

export type EmbedTexts = Readonly<Record<Keys, string>>;

export const EMBED_TEXTS: Readonly<Record<EmbedLang, EmbedTexts>> = {
  zh: {
    title: "NOZOMI 用车预订",
    loading: "正在读取预订内容…",
    seller: "本预订由 NOZOMI 提供并收款。",
    expired: "这次查询已过期，请在上方重新查询。",
    failed: "预订内容暂时读不出来，请稍后刷新，或到主站预订。",
    topLevel: "请在合作网站上预订，或到 NOZOMI 主站预订。",
    goToSite: "到 NOZOMI 主站预订",
    badAddress: "预订页的地址不完整，请回到合作网站重新打开。",
    orderPlaced: "订单已提交，还没有付款。",
    orderPending: "请在新窗口打开订单页完成付款，付完回到这里，这一页会自动更新。30 分钟内没有付款，订单会自动取消。",
    payInNewWindow: "在新窗口打开订单页付款",
    openOrder: "在新窗口打开订单页",
    manageNote: "取消、修改订单请在新窗口打开订单页操作。订单链接也会发到您的邮箱。",
    paid: "付款已提交。订单确认后会发邮件通知您，派车后可以在订单页看到司机和车辆。",
    cancelled: "这张订单已取消。",
    orderMissing: "这里找不到刚才的订单了。请用邮件里的链接，或到主站「查订单」找回。",
    lookup: "到主站查订单",
    orderFailed: "订单暂时读不出来，请稍后重试。",
    retry: "重试",
    orderNo: "订单号",
  },
  ja: {
    title: "NOZOMI 配車予約",
    loading: "予約内容を読み込んでいます…",
    seller: "この予約は NOZOMI が提供し、代金を受け取ります。",
    expired: "この検索の有効期限が切れました。上の「もう一度検索」からやり直してください。",
    failed: "予約内容を読み込めませんでした。しばらくしてから再読み込みするか、本サイトでご予約ください。",
    topLevel: "提携サイト、または NOZOMI 本サイトでご予約ください。",
    goToSite: "NOZOMI 本サイトで予約",
    badAddress: "予約ページのアドレスが不完全です。提携サイトからもう一度開いてください。",
    orderPlaced: "ご注文を受け付けました。お支払いはまだです。",
    orderPending: "新しいウィンドウで注文ページを開いてお支払いください。お支払い後にこの画面へ戻ると自動で更新されます。30 分以内にお支払いがない場合、ご注文は自動でキャンセルされます。",
    payInNewWindow: "新しいウィンドウで注文ページを開いて支払う",
    openOrder: "新しいウィンドウで注文ページを開く",
    manageNote: "キャンセル・変更は新しいウィンドウで注文ページを開いて行ってください。注文ページのリンクはメールでもお送りします。",
    paid: "お支払いを受け付けました。ご注文が確定するとメールでお知らせします。配車後は注文ページでドライバーと車両をご確認いただけます。",
    cancelled: "このご注文はキャンセルされました。",
    orderMissing: "先ほどのご注文をここで表示できません。メールのリンク、または本サイトの「注文照会」からご確認ください。",
    lookup: "本サイトで注文を照会",
    orderFailed: "ご注文を読み込めませんでした。しばらくしてからもう一度お試しください。",
    retry: "再試行",
    orderNo: "注文番号",
  },
  en: {
    title: "NOZOMI ride booking",
    loading: "Loading your booking…",
    seller: "This booking is provided and charged by NOZOMI.",
    expired: "This search has expired. Please search again above.",
    failed: "We can't load your booking right now. Please refresh later or book on our site.",
    topLevel: "Please book on our partner's site or on the NOZOMI site.",
    goToSite: "Book on the NOZOMI site",
    badAddress: "This booking page address is incomplete. Please open it again from our partner's site.",
    orderPlaced: "Your order has been placed but not paid yet.",
    orderPending: "Please open the order page in a new window to pay, then come back here — this page updates by itself. Unpaid orders are cancelled after 30 minutes.",
    payInNewWindow: "Open the order page in a new window to pay",
    openOrder: "Open the order page in a new window",
    manageNote: "To cancel or change the order, open the order page in a new window. We also email you the link.",
    paid: "Your payment has been submitted. We'll email you once the order is confirmed; driver and vehicle details appear on the order page after dispatch.",
    cancelled: "This order has been cancelled.",
    orderMissing: "We can't show that order here any more. Please use the link in your email, or look it up on our site.",
    lookup: "Look up your order",
    orderFailed: "We can't load your order right now. Please try again later.",
    retry: "Retry",
    orderNo: "Order no.",
  },
};
