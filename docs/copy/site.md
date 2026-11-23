# 官网（客人预订）

由 `pnpm copy:export` 从代码生成，不要手改。本区域共 862 条：写死 636 条，已走 key 226 条。列的意思见 [README](README.md)。

## 页面

- [预订页（/book）](#预订页book)（215 条）
- [多日行程报价页（/book/trip）](#多日行程报价页booktrip)（5 条）
- [订单页（查订单、管理订单）](#订单页查订单管理订单)（71 条）
- [官网外框（页头、页脚、出错页）](#官网外框页头页脚出错页)（15 条）
- [法律文案（特定商取引法に基づく表記、キャンセルポリシー、プライバシーポリシー）](#法律文案特定商取引法に基づく表記キャンセルポリシープライバシーポリシー)（92 条）
- [多个页面共用：全屏选择页（FullScreenSheet.tsx）](#多个页面共用全屏选择页fullscreensheettsx)（1 条）
- [多个页面共用：预订草稿 → 新预订页的状态（booking-draft.ts）](#多个页面共用预订草稿--新预订页的状态booking-draftts)（3 条）
- [多个页面共用：官网报不出价时「留下联系方式、人工报价」（manual-quote-form.ts）](#多个页面共用官网报不出价时留下联系方式人工报价manual-quote-formts)（13 条）
- [多个页面共用：新预订页每一步的按钮条（step-bar-texts.ts）](#多个页面共用新预订页每一步的按钮条step-bar-textsts)（4 条）
- [多个页面共用：官网行程报价页 /book/trip（trip-texts.ts）](#多个页面共用官网行程报价页-booktriptrip-textsts)（202 条）
- [多个页面共用：官网的地图选点（GoogleMapPicker.tsx）](#多个页面共用官网的地图选点googlemappickertsx)（3 条）
- [多个页面共用：官网报不出价时的「留下联系方式、人工报价」和「通过 What…（ManualQuote.tsx）](#多个页面共用官网报不出价时的留下联系方式人工报价和通过-whatmanualquotetsx)（10 条）
- [多个页面共用：官网订单页的各个区块（OrderSections.tsx）](#多个页面共用官网订单页的各个区块ordersectionstsx)（182 条）
- [多个页面共用：官网的地图选点（SiteMapPicker.tsx）](#多个页面共用官网的地图选点sitemappickertsx)（5 条）
- [多个页面共用：新预订页的一个地址框（PlaceField.tsx）](#多个页面共用新预订页的一个地址框placefieldtsx)（26 条）
- [多个页面共用：包车的对外价明细（PriceBreakdown.tsx）](#多个页面共用包车的对外价明细pricebreakdowntsx)（2 条）
- [多个页面共用：「乘客 / 行李」合并栏（TravellersField.tsx）](#多个页面共用乘客--行李合并栏travellersfieldtsx)（7 条）
- [多个页面共用：新预订页的「页面外壳」（booking-shell.tsx）](#多个页面共用新预订页的页面外壳booking-shelltsx)（3 条）
- [多个页面共用：手机触屏上的新预订页（full-screen.tsx）](#多个页面共用手机触屏上的新预订页full-screentsx)（3 条）

## 预订页（/book）

文件：`apps/web/src/lib/checkout-texts.ts`、`apps/web/src/lib/itinerary-warnings.ts`、`apps/web/src/lib/site-order-form.ts`、`apps/web/src/lib/terminal-from-name.ts`、`apps/web/src/pages/book/new/BookNewPage.tsx`、`apps/web/src/pages/book/new/CheckoutParts.tsx`、`apps/web/src/pages/book/new/SeatMap.tsx`、`apps/web/src/pages/book/new/VehicleList.tsx`、`apps/web/src/pages/book/new/WaypointsField.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `checkout.tripTitle` | 已走 key | 行程 | 标题 | [checkout-texts.ts:20](../../apps/web/src/lib/checkout-texts.ts#L20) |
| `checkout.vehicle` | 已走 key | 车型 | 文字 | [checkout-texts.ts:21](../../apps/web/src/lib/checkout-texts.ts#L21) |
| `checkout.passengerTitle` | 已走 key | 乘客信息 | 标题 | [checkout-texts.ts:22](../../apps/web/src/lib/checkout-texts.ts#L22) |
| `checkout.priceTitle` | 已走 key | 价格和总价 | 标题 | [checkout-texts.ts:23](../../apps/web/src/lib/checkout-texts.ts#L23) |
| `checkout.termsTitle` | 已走 key | 取消政策和注意事项 | 标题 | [checkout-texts.ts:24](../../apps/web/src/lib/checkout-texts.ts#L24) |
| `checkout.payDueNote` | 已走 key | 点「去付款」后订单即提交，请在 30 分钟内完成付款，超时订单会自动取消。 | 说明 | [checkout-texts.ts:25](../../apps/web/src/lib/checkout-texts.ts#L25) |
| `checkout.cardNote` | 已走 key | 付款信息由 Stripe 处理，本站不保存卡号。 | 说明 | [checkout-texts.ts:26](../../apps/web/src/lib/checkout-texts.ts#L26) |
| `checkout.payTitle` | 已走 key | 付款 | 标题 | [checkout-texts.ts:27](../../apps/web/src/lib/checkout-texts.ts#L27) |
| `checkout.back` | 已走 key | 上一步 | 文字 | [checkout-texts.ts:28](../../apps/web/src/lib/checkout-texts.ts#L28) |
| `itinerary-warnings.itinerary.longDuration` | 已走 key | 您的行程预计用时 {duration}，已超出司机单日法定工作时长的建议范围。建议适当缩减行程或减少经停点，让旅途更轻松舒适。 | 文字 | [itinerary-warnings.ts:11](../../apps/web/src/lib/itinerary-warnings.ts#L11) |
| `itinerary-warnings.itinerary.longDistance` | 已走 key | 您的行程全程约 {km} 公里，超出单日包车的建议距离，将产生较多超公里费。建议适当缩减行程或减少经停点，让旅途更轻松舒适。 | 文字 | [itinerary-warnings.ts:12](../../apps/web/src/lib/itinerary-warnings.ts#L12) |
| `itinerary-warnings.itinerary.longestByTime` | 已走 key | 耗时最长的一段：{from} → {to}，行驶约 {duration}。 | 文字 | [itinerary-warnings.ts:13](../../apps/web/src/lib/itinerary-warnings.ts#L13) |
| `itinerary-warnings.itinerary.longestByDistance` | 已走 key | 距离最长的一段：{from} → {to}，约 {km} 公里。 | 文字 | [itinerary-warnings.ts:14](../../apps/web/src/lib/itinerary-warnings.ts#L14) |
| `itinerary-warnings.itinerary.waypointLimit` | 已走 key | 最多 {max} 个经停点，更多请联系客服定制。 | 文字 | [itinerary-warnings.ts:15](../../apps/web/src/lib/itinerary-warnings.ts#L15) |
| `site-order-form.e6df44b2` | 写死 | 微信 | 文字 | [site-order-form.ts:9](../../apps/web/src/lib/site-order-form.ts#L9) |
| `site-order-form.d1613827` | 写死 | 同意保存这次付款用的银行卡，用于服务后产生的费用（如超时等候） | 文字 | [site-order-form.ts:66](../../apps/web/src/lib/site-order-form.ts#L66) |
| `site-order-form.76190819` | 写死 | 服务后的费用会先通知您，48 小时内可以在订单页提异议；没有异议才会扣款。 | 说明 | [site-order-form.ts:67](../../apps/web/src/lib/site-order-form.ts#L67) |
| `site-order-form.16865d06` | 写死 | 以 + 和国家码开头，如 +81 90-1234-5678。司机和客服用它联系您 | 文字 | [site-order-form.ts:70](../../apps/web/src/lib/site-order-form.ts#L70) |
| `site-order-form.08e987e8` | 写死 | 订单链接会发到这个邮箱；链接丢了，可以在「查订单」用订单号和这个邮箱重新发 | 文字 | [site-order-form.ts:71](../../apps/web/src/lib/site-order-form.ts#L71) |
| `site-order-form.f997f6fd` | 写死 | 如 NH211。航班延误时司机按实际落地时间等候 | 文字 | [site-order-form.ts:72](../../apps/web/src/lib/site-order-form.ts#L72) |
| `site-order-form.3b04da43` | 写死 | 请填写乘车人姓名 | 文字 | [site-order-form.ts:77](../../apps/web/src/lib/site-order-form.ts#L77) |
| `site-order-form.a828b2c4` | 写死 | 请填写带国家码的手机号，如 +81 90-1234-5678、+86 138 0000 0000 | 文字 | [site-order-form.ts:78](../../apps/web/src/lib/site-order-form.ts#L78) |
| `site-order-form.50d33d09` | 写死 | 请填写正确的邮箱，订单确认和查看链接会发到这里 | 文字 | [site-order-form.ts:79](../../apps/web/src/lib/site-order-form.ts#L79) |
| `site-order-form.35c7679d` | 写死 | 接机要填航班号，司机按航班落地时间等候 | 文字 | [site-order-form.ts:80](../../apps/web/src/lib/site-order-form.ts#L80) |
| `site-order-form.d3e3fc01` | 写死 | 航班号的格式不对，如 NH211、MU523 | 文字 | [site-order-form.ts:81](../../apps/web/src/lib/site-order-form.ts#L81) |
| `site-order-form.da1db7fe` | 写死 | 请选择国际航班还是国内航班：国际航班免费等待更久 | 文字 | [site-order-form.ts:82](../../apps/web/src/lib/site-order-form.ts#L82) |
| `site-order-form.43d51a2d` | 写死 | 请填写下车的地址或酒店名 | 文字 | [site-order-form.ts:83](../../apps/web/src/lib/site-order-form.ts#L83) |
| `site-order-form.e50b1627` | 写死 | 请填写上车的地址或酒店名 | 文字 | [site-order-form.ts:83](../../apps/web/src/lib/site-order-form.ts#L83) |
| `site-order-form.8a27042d` | 写死 | 选了即时通讯就要填账号 | 文字 | [site-order-form.ts:84](../../apps/web/src/lib/site-order-form.ts#L84) |
| `site-order-form.b5f5bf11` | 写死 | 需要同意保存支付方式才能下单 | 文字 | [site-order-form.ts:85](../../apps/web/src/lib/site-order-form.ts#L85) |
| `site-order-form.42a9c64b` | 写死 | 报价已经过了 30 分钟的有效期，请重新查询价格。 | 文字 | [site-order-form.ts:112](../../apps/web/src/lib/site-order-form.ts#L112) |
| `site-order-form.a3901cd6` | 写死 | 这个报价已经下过单了。要再订一辆，请重新查询价格。 | 文字 | [site-order-form.ts:112](../../apps/web/src/lib/site-order-form.ts#L112) |
| `site-order-form.a8434eca` | 写死 | 这辆车刚刚被订完或暂停预订了，请重新查询价格。 | 文字 | [site-order-form.ts:112](../../apps/web/src/lib/site-order-form.ts#L112) |
| `site-order-form.81c55567` | 写死 | 提交的内容不符合要求，请检查后重试。 | 文字 | [site-order-form.ts:124](../../apps/web/src/lib/site-order-form.ts#L124) |
| `site-order-form.953c0e8d` | 写死 | 有几项没有通过检查，请看标红的地方。 | 文字 | [site-order-form.ts:124](../../apps/web/src/lib/site-order-form.ts#L124) |
| `terminal-from-name.b735a89e` | 写死 | (\\d{1,2}\|\[一二三四五六七八九\]) | 文字 | [terminal-from-name.ts:12](../../apps/web/src/lib/terminal-from-name.ts#L12) |
| `BookNewPage.7da32bc5` | 写死 | 送机 | 文字 | [BookNewPage.tsx:167](../../apps/web/src/pages/book/new/BookNewPage.tsx#L167) |
| `BookNewPage.858e47e2` | 写死 | 点对点 | 文字 | [BookNewPage.tsx:167](../../apps/web/src/pages/book/new/BookNewPage.tsx#L167) |
| `BookNewPage.97915a38` | 写死 | 接机 | 文字 | [BookNewPage.tsx:167](../../apps/web/src/pages/book/new/BookNewPage.tsx#L167) |
| `BookNewPage.1079f8e4` | 写死 | 出发地 | 文字 | [BookNewPage.tsx:248](../../apps/web/src/pages/book/new/BookNewPage.tsx#L248)、1138、1503 行 |
| `BookNewPage.28f20d9f` | 写死 | 目的地 | 文字 | [BookNewPage.tsx:248](../../apps/web/src/pages/book/new/BookNewPage.tsx#L248)、1164、1523 行 |
| `BookNewPage.2afd7ec7` | 写死 | 和 | 文字 | [BookNewPage.tsx:248](../../apps/web/src/pages/book/new/BookNewPage.tsx#L248) |
| `BookNewPage.57c54c9f` | 写死 | 上车地点 | 文字 | [BookNewPage.tsx:248](../../apps/web/src/pages/book/new/BookNewPage.tsx#L248)、538、1138、1148、1503 行 |
| `BookNewPage.7b821b8c` | 写死 | 下车地点 | 文字 | [BookNewPage.tsx:248](../../apps/web/src/pages/book/new/BookNewPage.tsx#L248)、538、1164、1175、1523 行 |
| `BookNewPage.0617425f` | 写死 | 链接里的地点{…}没有找到，请在下面重新选择{which}。 | 文字 | [BookNewPage.tsx:249](../../apps/web/src/pages/book/new/BookNewPage.tsx#L249) |
| `BookNewPage.9b45becd` | 写死 | 链接里的地点{…}暂时没有读出来，请稍后刷新页面，或在下面直接选择。 | 文字 | [BookNewPage.tsx:251](../../apps/web/src/pages/book/new/BookNewPage.tsx#L251) |
| `BookNewPage.0f9d8336` | 写死 | 请从候选里选出发地 | 文字 | [BookNewPage.tsx:271](../../apps/web/src/pages/book/new/BookNewPage.tsx#L271) |
| `BookNewPage.af68712f` | 写死 | 请从候选里选上车地点 | 文字 | [BookNewPage.tsx:271](../../apps/web/src/pages/book/new/BookNewPage.tsx#L271) |
| `BookNewPage.45f2175d` | 写死 | 这个地址暂时没有在线报价，请联系客服 | 文字 | [BookNewPage.tsx:272](../../apps/web/src/pages/book/new/BookNewPage.tsx#L272)、539、1178 行 |
| `BookNewPage.12033fa0` | 写死 | 请从候选里选目的地 | 文字 | [BookNewPage.tsx:273](../../apps/web/src/pages/book/new/BookNewPage.tsx#L273) |
| `BookNewPage.537fa825` | 写死 | 请选择下车地点 | 文字 | [BookNewPage.tsx:273](../../apps/web/src/pages/book/new/BookNewPage.tsx#L273) |
| `BookNewPage.4c3726e8` | 写死 | 请选择包车时长 | 文字 | [BookNewPage.tsx:274](../../apps/web/src/pages/book/new/BookNewPage.tsx#L274) |
| `BookNewPage.bde0463b` | 写死 | 请把经停点填完整 | 文字 | [BookNewPage.tsx:275](../../apps/web/src/pages/book/new/BookNewPage.tsx#L275) |
| `BookNewPage.aeafe575` | 写死 | 请选择日期 | 文字 | [BookNewPage.tsx:276](../../apps/web/src/pages/book/new/BookNewPage.tsx#L276) |
| `BookNewPage.5e57ffe8` | 写死 | 请选择时间 | 文字 | [BookNewPage.tsx:277](../../apps/web/src/pages/book/new/BookNewPage.tsx#L277) |
| `BookNewPage.ab1e1208` | 写死 | 客服电话： | 正文 | [BookNewPage.tsx:286](../../apps/web/src/pages/book/new/BookNewPage.tsx#L286) |
| `BookNewPage.94020683` | 写死 | 读取城市 | 文字 | [BookNewPage.tsx:376](../../apps/web/src/pages/book/new/BookNewPage.tsx#L376) |
| `BookNewPage.83e9efc1` | 写死 | 读取包车时长 | 文字 | [BookNewPage.tsx:474](../../apps/web/src/pages/book/new/BookNewPage.tsx#L474) |
| `BookNewPage.db431c6a` | 写死 | 第 {…} 个经停点 | 文字 | [BookNewPage.tsx:538](../../apps/web/src/pages/book/new/BookNewPage.tsx#L538) |
| `BookNewPage.c4c760cd` | 写死 | 查询价格 | 文字 | [BookNewPage.tsx:539](../../apps/web/src/pages/book/new/BookNewPage.tsx#L539) |
| `BookNewPage.083ac3cb` | 写死 | 计算附加服务 | 文字 | [BookNewPage.tsx:768](../../apps/web/src/pages/book/new/BookNewPage.tsx#L768) |
| `BookNewPage.132837ac` | 写死 | 航班号和备注加起来 | 文字 | [BookNewPage.tsx:835](../../apps/web/src/pages/book/new/BookNewPage.tsx#L835) |
| `BookNewPage.54af9e29` | 写死 | 备注 | 文字 | [BookNewPage.tsx:835](../../apps/web/src/pages/book/new/BookNewPage.tsx#L835) |
| `BookNewPage.8f9a408e` | 写死 | {…}最多 {notesMax} 个字，请删短一些。 | 文字 | [BookNewPage.tsx:835](../../apps/web/src/pages/book/new/BookNewPage.tsx#L835) |
| `BookNewPage.8b0d73fb` | 写死 | 请填写乘车人姓名 | 名称 | [BookNewPage.tsx:843](../../apps/web/src/pages/book/new/BookNewPage.tsx#L843) |
| `BookNewPage.312756db` | 写死 | 请填写乘车人的电话或 WhatsApp 号码，以 + 和国家码开头，如 +81 90-1234-5678 | 文字 | [BookNewPage.tsx:845](../../apps/web/src/pages/book/new/BookNewPage.tsx#L845) |
| `BookNewPage.b14479eb` | 写死 | 有几项没有填好，请看标红的地方。 | 文字 | [BookNewPage.tsx:856](../../apps/web/src/pages/book/new/BookNewPage.tsx#L856)、886、978 行 |
| `BookNewPage.712879a2` | 写死 | 请先选择车型。 | 文字 | [BookNewPage.tsx:872](../../apps/web/src/pages/book/new/BookNewPage.tsx#L872) |
| `BookNewPage.744066fe` | 写死 | 这个车型现在加不了所选的附加服务，请减少附加服务或换一个车型。 | 文字 | [BookNewPage.tsx:874](../../apps/web/src/pages/book/new/BookNewPage.tsx#L874)、1621 行 |
| `BookNewPage.7332e8c5` | 写死 | 价格还在计算，请稍等再点「去付款」。 | 文字 | [BookNewPage.tsx:877](../../apps/web/src/pages/book/new/BookNewPage.tsx#L877) |
| `BookNewPage.2ecf7902` | 写死 | 需要同意保存支付方式才能下单 | 文字 | [BookNewPage.tsx:891](../../apps/web/src/pages/book/new/BookNewPage.tsx#L891) |
| `BookNewPage.92721a79` | 写死 | 请先勾选同意保存银行卡，再点「去付款」。 | 文字 | [BookNewPage.tsx:892](../../apps/web/src/pages/book/new/BookNewPage.tsx#L892) |
| `BookNewPage.0ce9063b` | 写死 | 再点一次「去付款」不会重复下单。 | 文字 | [BookNewPage.tsx:917](../../apps/web/src/pages/book/new/BookNewPage.tsx#L917) |
| `BookNewPage.2eaaf754` | 写死 | 提交订单 | 文字 | [BookNewPage.tsx:917](../../apps/web/src/pages/book/new/BookNewPage.tsx#L917) |
| `BookNewPage.95dfcd48` | 写死 | 正在打开预订页 | 名称 | [BookNewPage.tsx:1059](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1059) |
| `BookNewPage.35339cc5` | 写死 | 页面没有打开 | 标题 | [BookNewPage.tsx:1061](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1061) |
| `BookNewPage.4653cb0b` | 写死 | 重试 | 按钮 | [BookNewPage.tsx:1061](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1061)、1065、1217、1290 行 |
| `BookNewPage.597336a1` | 写死 | 暂未开放预订 | 标题 | [BookNewPage.tsx:1063](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1063) |
| `BookNewPage.fd26ebca` | 写死 | 官网的在线预订还没有开放，请稍后再来。已经下过单的客人可以点上方的「查订单」查看订单。 | 说明 | [BookNewPage.tsx:1063](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1063) |
| `BookNewPage.584f1d9b` | 写死 | 城市列表没有读出来 | 标题 | [BookNewPage.tsx:1065](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1065) |
| `BookNewPage.04e51a10` | 写死 | 暂时没有可预订的城市 | 标题 | [BookNewPage.tsx:1067](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1067) |
| `BookNewPage.f163951b` | 写死 | 现在还没有可以在线预订用车的城市，请稍后再来。 | 说明 | [BookNewPage.tsx:1067](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1067) |
| `BookNewPage.0b7d61b4` | 写死 | 用车时间（当地） | 名称 | [BookNewPage.tsx:1078](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1078) |
| `BookNewPage.676c2b63` | 写死 | 上车时间（当地） | 名称 | [BookNewPage.tsx:1078](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1078) |
| `BookNewPage.6e8983b2` | 写死 | 航班落地时间（当地） | 名称 | [BookNewPage.tsx:1078](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1078) |
| `BookNewPage.03007c56` | 写死 | 包车 {itineraryPackage} 小时（按行程） | 名称 | [BookNewPage.tsx:1079](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1079) |
| `BookNewPage.77edee7f` | 写死 | 包车 | 名称 | [BookNewPage.tsx:1079](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1079) |
| `BookNewPage.79429f95` | 写死 | 包车 {packageHours} 小时 | 名称 | [BookNewPage.tsx:1079](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1079) |
| `BookNewPage.dd1f3a80` | 写死 | 包车（按行程） | 名称 | [BookNewPage.tsx:1079](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1079) |
| `BookNewPage.f2cef006` | 写死 |  落地 | 文字 | [BookNewPage.tsx:1080](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1080) |
| `BookNewPage.3a6734be` | 写死 | 预订步骤 | 读屏说明 | [BookNewPage.tsx:1085](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1085) |
| `BookNewPage.b2b70d17` | 写死 | 第 {number} 步：{name}（已完成，回到这一步） | 读屏说明 | [BookNewPage.tsx:1099](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1099) |
| `BookNewPage.63b87d40` | 写死 | 第 {number} 步：{name}{…} | 读屏说明 | [BookNewPage.tsx:1103](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1103) |
| `BookNewPage.c632b0e1` | 写死 | （当前） | 读屏说明 | [BookNewPage.tsx:1103](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1103) |
| `BookNewPage.faf3d664` | 写死 | 你的行程 | 标题 | [BookNewPage.tsx:1117](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1117) |
| `BookNewPage.df7e4bdc` | 写死 | 用车类型 | 表单标签 | [BookNewPage.tsx:1121](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1121)、1499 行 |
| `BookNewPage.ce510457` | 写死 | 包车结束时在哪里下车，价格按上车和下车地点算。 | 说明 | [BookNewPage.tsx:1168](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1168) |
| `BookNewPage.8afe6885` | 写死 | 请选择下车地点，包车现在按上车和下车地点报价。 | 文字 | [BookNewPage.tsx:1169](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1169) |
| `BookNewPage.5b2624a0` | 写死 | 这段行程的包车还没有可以在线预订的套餐，请联系客服 | 正文 | [BookNewPage.tsx:1184](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1184) |
| `BookNewPage.ceb7ca64` | 写死 | 包车时长 | 名称 | [BookNewPage.tsx:1190](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1190)、1209、1225 行 |
| `BookNewPage.c9fb9cff` | 写死 | 请选择大概的时长 | 输入框占位 | [BookNewPage.tsx:1191](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1191) |
| `BookNewPage.ad9420ad` | 写死 | {hours} 小时 | 名称 | [BookNewPage.tsx:1193](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1193)、1212、1229 行 |
| `BookNewPage.e8401c1a` | 写死 | 没有在线报价时，选一个大概的时长，客服报价时会和您确认 | 说明 | [BookNewPage.tsx:1194](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1194) |
| `BookNewPage.644b71e1` | 写死 | 包车时长：按行程自动选套餐 | 正文 | [BookNewPage.tsx:1201](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1201) |
| `BookNewPage.8db00818` | 写死 | 有经停点时，按各段行驶时间和停留时长算出总时长，自动选合适的套餐。 | 正文 | [BookNewPage.tsx:1203](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1203) |
| `BookNewPage.75dc7fa1` | 写死 | 想多留些时间可以选更长的套餐；不能选比预计用时短的 | 说明 | [BookNewPage.tsx:1213](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1213) |
| `BookNewPage.05b10dea` | 写死 | 包车时长没有读出来 | 标题 | [BookNewPage.tsx:1217](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1217) |
| `BookNewPage.08158d8d` | 写死 | 正在读取 | 输入框占位 | [BookNewPage.tsx:1227](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1227) |
| `BookNewPage.1316b921` | 写死 | 先选上车、下车地点 | 输入框占位 | [BookNewPage.tsx:1227](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1227) |
| `BookNewPage.7297716d` | 写死 | 请选择时长 | 输入框占位 | [BookNewPage.tsx:1227](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1227) |
| `BookNewPage.ec13d057` | 写死 | 超出套餐的时长和公里服务后按实际收取 | 说明 | [BookNewPage.tsx:1231](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1231) |
| `BookNewPage.cbba7514` | 写死 | 日期（当地） | 名称 | [BookNewPage.tsx:1237](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1237) |
| `BookNewPage.4ff77eb3` | 写死 | {cityName}的当地时间 | 说明 | [BookNewPage.tsx:1238](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1238) |
| `BookNewPage.e5efcd14` | 写死 | 下一步：选择车型 | 按钮 | [BookNewPage.tsx:1255](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1255) |
| `BookNewPage.55d12785` | 写死 | 改选 {hours} 小时 | 按钮 | [BookNewPage.tsx:1271](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1271) |
| `BookNewPage.51ba1197` | 写死 | 选好上车地点、下车地点、包车时长、日期和时间后，这里会列出能坐下的车型和价格。 | 正文 | [BookNewPage.tsx:1281](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1281) |
| `BookNewPage.f7e12a64` | 写死 | 填好出发地、目的地、日期和时间后，这里会列出能坐下的车型和一口价。 | 正文 | [BookNewPage.tsx:1281](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1281) |
| `BookNewPage.96584c87` | 写死 | 正在查询价格 | 名称 | [BookNewPage.tsx:1283](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1283) |
| `BookNewPage.34617c14` | 写死 | 价格没有查出来 | 标题 | [BookNewPage.tsx:1288](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1288) |
| `BookNewPage.589c19f4` | 写死 | 没有在线报价 | 标题 | [BookNewPage.tsx:1288](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1288) |
| `BookNewPage.2c46d70f` | 写死 | 没有可预订的车 | 标题 | [BookNewPage.tsx:1312](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1312) |
| `BookNewPage.f4f761da` | 写死 | 按价格从低到高 · 坐不下的已隐藏。报价 30 分钟内有效（到当地时间 {…}），过了请重新查询。 | 正文 | [BookNewPage.tsx:1332](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1332) |
| `BookNewPage.ccfebb59` | 写死 | 行程时间表 | 标题 | [BookNewPage.tsx:1338](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1338) |
| `BookNewPage.6373c8ca` | 写死 | 选择车型 | 标题 | [BookNewPage.tsx:1389](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1389) |
| `BookNewPage.4e3fd180` | 写死 | 上一步 | 按钮 | [BookNewPage.tsx:1411](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1411)、1484 行 |
| `BookNewPage.f3aceeb4` | 写死 | 下一步：填写乘客信息 | 按钮 | [BookNewPage.tsx:1417](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1417) |
| `BookNewPage.ed962805` | 写死 | 航班号 | 名称 | [BookNewPage.tsx:1427](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1427)、1560 行 |
| `BookNewPage.0ca939aa` | 写死 | 举牌姓名（选填） | 名称 | [BookNewPage.tsx:1440](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1440) |
| `BookNewPage.8f6f6631` | 写死 | 司机在到达口举的牌子上写的名字，如 ZHANG SAN | 说明 | [BookNewPage.tsx:1440](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1440) |
| `BookNewPage.4bd13f96` | 写死 | 下一步：核对订单 | 按钮 | [BookNewPage.tsx:1489](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1489) |
| `BookNewPage.ddc8b793` | 写死 | 经停点 | 正文 | [BookNewPage.tsx:1508](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1508) |
| `BookNewPage.ab11fa1a` | 写死 | {…} {name}（停留 {…}{…}） | 正文 | [BookNewPage.tsx:1514](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1514) |
| `BookNewPage.81c7a040` | 写死 | 行程时长 | 正文 | [BookNewPage.tsx:1528](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1528) |
| `BookNewPage.0d1cb237` | 写死 | 航班落地（当地时间） | 正文 | [BookNewPage.tsx:1533](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1533) |
| `BookNewPage.4be5ed12` | 写死 | 用车时间（当地时间） | 正文 | [BookNewPage.tsx:1533](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1533) |
| `BookNewPage.115f3614` | 写死 | 乘客 / 行李 | 正文 | [BookNewPage.tsx:1537](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1537) |
| `BookNewPage.14ffadbb` | 写死 | 预订人 | 正文 | [BookNewPage.tsx:1546](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1546) |
| `BookNewPage.9468c573` | 写死 | 乘车人 | 正文 | [BookNewPage.tsx:1546](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1546)、1576 行 |
| `BookNewPage.b323d3f1` | 写死 | 邮箱 | 正文 | [BookNewPage.tsx:1550](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1550) |
| `BookNewPage.3232a5cc` | 写死 | 手机号 | 正文 | [BookNewPage.tsx:1554](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1554) |
| `BookNewPage.5f4d7731` | 写死 | 航班类型 | 正文 | [BookNewPage.tsx:1564](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1564) |
| `BookNewPage.b9e44eec` | 写死 | 免费等待 | 正文 | [BookNewPage.tsx:1568](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1568) |
| `BookNewPage.22028ae5` | 写死 | 不限时 | 正文 | [BookNewPage.tsx:1569](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1569) |
| `BookNewPage.8c34d128` | 写死 | 航班落地后 {freeWait} 分钟 | 正文 | [BookNewPage.tsx:1569](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1569) |
| `BookNewPage.5b8adaaf` | 写死 | 乘车人电话/WhatsApp | 正文 | [BookNewPage.tsx:1580](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1580) |
| `BookNewPage.b7c2e6e8` | 写死 | 举牌姓名 | 正文 | [BookNewPage.tsx:1587](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1587) |
| `BookNewPage.08773378` | 写死 | 给司机的备注 | 正文 | [BookNewPage.tsx:1599](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1599) |
| `BookNewPage.94d63521` | 写死 | 车型和价格 | 标题 | [BookNewPage.tsx:1614](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1614)、1691 行 |
| `BookNewPage.1549869d` | 写死 | 正在重新计算… | 正文 | [BookNewPage.tsx:1620](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1620) |
| `BookNewPage.88966edf` | 写死 | 每确认一步，这里会加上那一步的内容。 | 正文 | [BookNewPage.tsx:1636](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1636) |
| `BookNewPage.ba384a96` | 写死 | 行程 | 标题 | [BookNewPage.tsx:1639](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1639)、1682 行 |
| `BookNewPage.ed1c357b` | 写死 | 乘客信息 | 标题 | [BookNewPage.tsx:1646](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1646)、1699 行 |
| `BookNewPage.a9922481` | 写死 | 修改{what} | 读屏说明 | [BookNewPage.tsx:1654](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1654) |
| `BookNewPage.0af303e3` | 写死 | 修改 | 按钮 | [BookNewPage.tsx:1656](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1656) |
| `BookNewPage.851bbd69` | 写死 | 核对订单 | 标题 | [BookNewPage.tsx:1669](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1669) |
| `BookNewPage.ec517f42` | 写死 | 选的车型现在报不出价了，请点「修改」重新选择车型。 | 正文 | [BookNewPage.tsx:1710](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1710) |
| `BookNewPage.f7748eb6` | 写死 | 正在重新查询价格… | 正文 | [BookNewPage.tsx:1710](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1710) |
| `BookNewPage.629417d3` | 写死 | 法律文案 | 名称 | [BookNewPage.tsx:1732](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1732) |
| `BookNewPage.e51eb20c` | 写死 | 行程摘要 | 正文 | [BookNewPage.tsx:1760](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1760)、1786、1808 行 |
| `BookNewPage.dc4b4482` | 写死 | 还没有确认的内容 | 正文 | [BookNewPage.tsx:1780](../../apps/web/src/pages/book/new/BookNewPage.tsx#L1780) |
| `CheckoutParts.a706b23f` | 写死 | 路线图：{name} → {name}，{text} | 名称 | [CheckoutParts.tsx:37](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L37) |
| `CheckoutParts.876bf27e` | 写死 | 附加服务（选填） | 标题 | [CheckoutParts.tsx:53](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L53) |
| `CheckoutParts.4dbc87b2` | 写死 | 车费 | 正文 | [CheckoutParts.tsx:89](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L89) |
| `CheckoutParts.934f2df8` | 写死 | 公里数 | 正文 | [CheckoutParts.tsx:97](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L97) |
| `CheckoutParts.16d4683c` | 写死 | 附加服务（合计差额） | 正文 | [CheckoutParts.tsx:103](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L103) |
| `CheckoutParts.d6d9a314` | 写死 | 合计 | 正文 | [CheckoutParts.tsx:108](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L108) |
| `CheckoutParts.7ea1a09a` | 写死 | 正在重新计算… | 正文 | [CheckoutParts.tsx:111](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L111) |
| `CheckoutParts.0b632fdc` | 写死 | 这个车型现在加不了所选的附加服务，请减少附加服务或换一个车型。 | 正文 | [CheckoutParts.tsx:112](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L112) |
| `CheckoutParts.0a60cc91` | 写死 | 只影响参考价，实际按订单币种付款 | 说明 | [CheckoutParts.tsx:123](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L123) |
| `CheckoutParts.dffed4d6` | 写死 | 参考币种 | 名称 | [CheckoutParts.tsx:123](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L123) |
| `CheckoutParts.ed90f543` | 写死 | 重新查询价格 | 按钮 | [CheckoutParts.tsx:133](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L133) |
| `CheckoutParts.67357930` | 写死 | 正在提交 | 文字 | [CheckoutParts.tsx:135](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L135) |
| `CheckoutParts.88b74d1d` | 写死 | 去付款 → | 按钮 | [CheckoutParts.tsx:137](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L137) |
| `CheckoutParts.bd18b54b` | 写死 | 支付方式： | 正文 | [CheckoutParts.tsx:147](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L147) |
| `CheckoutParts.7d104503` | 写死 | 银行卡 | 正文 | [CheckoutParts.tsx:151](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L151) |
| `CheckoutParts.6973c147` | 写死 | 乘客信息 | 标题 | [CheckoutParts.tsx:212](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L212) |
| `CheckoutParts.eb1b15b9` | 写死 | 为谁预订 | 表单标签 | [CheckoutParts.tsx:216](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L216) |
| `CheckoutParts.250a5db1` | 写死 | 为自己预订 | 表单标签 | [CheckoutParts.tsx:220](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L220) |
| `CheckoutParts.f0bdd587` | 写死 | 为他人预订 | 表单标签 | [CheckoutParts.tsx:220](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L220) |
| `CheckoutParts.008472ce` | 写死 | 乘车人姓名 | 名称 | [CheckoutParts.tsx:224](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L224)、229 行 |
| `CheckoutParts.fe53f7ea` | 写死 | 预订人姓名 | 名称 | [CheckoutParts.tsx:224](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L224) |
| `CheckoutParts.82bdfc93` | 写死 | 邮箱 | 名称 | [CheckoutParts.tsx:225](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L225) |
| `CheckoutParts.e78a65a3` | 写死 | 手机号（含国家区号） | 名称 | [CheckoutParts.tsx:226](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L226) |
| `CheckoutParts.57f35fc6` | 写死 | 确认邮件仍发给上面的预订人 | 说明 | [CheckoutParts.tsx:229](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L229) |
| `CheckoutParts.2d310e9f` | 写死 | 司机当天联系乘车人用，如 +81 90-1234-5678 | 说明 | [CheckoutParts.tsx:230](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L230) |
| `CheckoutParts.5cbd26ff` | 写死 | 乘车人电话/WhatsApp | 名称 | [CheckoutParts.tsx:230](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L230) |
| `CheckoutParts.56678932` | 写死 | 微信 / LINE / WhatsApp（选填） | 名称 | [CheckoutParts.tsx:236](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L236) |
| `CheckoutParts.d4367956` | 写死 | 不填 | 输入框占位 | [CheckoutParts.tsx:237](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L237) |
| `CheckoutParts.142d663e` | 写死 | 即时通讯账号 | 名称 | [CheckoutParts.tsx:242](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L242) |
| `CheckoutParts.f649dfe7` | 写死 | 给司机的备注（选填） | 表单标签 | [CheckoutParts.tsx:247](../../apps/web/src/pages/book/new/CheckoutParts.tsx#L247) |
| `SeatMap.98b7ab22` | 写死 | 行李 {luggage} 件（{luggageBasis}） | 文字 | [SeatMap.tsx:11](../../apps/web/src/pages/book/new/SeatMap.tsx#L11) |
| `SeatMap.cfa1904c` | 写死 | 乘客座位 {passengers} 个 | 文字 | [SeatMap.tsx:11](../../apps/web/src/pages/book/new/SeatMap.tsx#L11) |
| `SeatMap.f110758e` | 写死 | 人数少时空座位也可以放行李 | 说明 | [SeatMap.tsx:11](../../apps/web/src/pages/book/new/SeatMap.tsx#L11) |
| `SeatMap.b38e2fab` | 写死 | {name}的车内示意图：{seats}，{bags} | 读屏说明 | [SeatMap.tsx:28](../../apps/web/src/pages/book/new/SeatMap.tsx#L28) |
| `SeatMap.7508cb76` | 写死 | 司机 | 正文 | [SeatMap.tsx:34](../../apps/web/src/pages/book/new/SeatMap.tsx#L34) |
| `SeatMap.8ecc648a` | 写死 | 示意图 | 正文 | [SeatMap.tsx:68](../../apps/web/src/pages/book/new/SeatMap.tsx#L68) |
| `VehicleList.46e27444` | 写死 | 包车套餐 | 正文 | [VehicleList.tsx:42](../../apps/web/src/pages/book/new/VehicleList.tsx#L42) |
| `VehicleList.c6725dc2` | 写死 | 公里数 | 正文 | [VehicleList.tsx:49](../../apps/web/src/pages/book/new/VehicleList.tsx#L49) |
| `VehicleList.4a0e10b6` | 写死 | 已选择 | 按钮 | [VehicleList.tsx:55](../../apps/web/src/pages/book/new/VehicleList.tsx#L55) |
| `VehicleList.c84914c4` | 写死 | 选择 | 按钮 | [VehicleList.tsx:55](../../apps/web/src/pages/book/new/VehicleList.tsx#L55) |
| `VehicleList.9620cb9b` | 写死 | 显示全部 {length} 个车型 ▾ | 按钮 | [VehicleList.tsx:91](../../apps/web/src/pages/book/new/VehicleList.tsx#L91) |
| `WaypointsField.7754feee` | 写死 | 第 {…} 个经停点 | 文字 | [WaypointsField.tsx:53](../../apps/web/src/pages/book/new/WaypointsField.tsx#L53)、72 行 |
| `WaypointsField.0074b875` | 写死 | {…} 现在排第 {…}，共 {length} 个 | 提示 | [WaypointsField.tsx:60](../../apps/web/src/pages/book/new/WaypointsField.tsx#L60)、125 行 |
| `WaypointsField.31c84be2` | 写死 | 这个经停点 | 提示 | [WaypointsField.tsx:60](../../apps/web/src/pages/book/new/WaypointsField.tsx#L60)、125 行 |
| `WaypointsField.1ac50101` | 写死 | 已删除{…} | 提示 | [WaypointsField.tsx:72](../../apps/web/src/pages/book/new/WaypointsField.tsx#L72) |
| `WaypointsField.b1d4efc3` | 写死 | 经停点「{name}」 | 提示 | [WaypointsField.tsx:72](../../apps/web/src/pages/book/new/WaypointsField.tsx#L72) |
| `WaypointsField.3ca64a5a` | 写死 | 经停点（选填） | 表单标签 | [WaypointsField.tsx:130](../../apps/web/src/pages/book/new/WaypointsField.tsx#L130) |
| `WaypointsField.c532d03f` | 写死 | 按顺序填想去的景点和每处大概停留多久，最多 {MAX\_WAYPOINTS} 个；价格按经停点所在区域和行程总时长计算。{…} | 正文 | [WaypointsField.tsx:131](../../apps/web/src/pages/book/new/WaypointsField.tsx#L131) |
| `WaypointsField.b0b17a5e` | 写死 | 经停点 {…} | 名称 | [WaypointsField.tsx:158](../../apps/web/src/pages/book/new/WaypointsField.tsx#L158) |
| `WaypointsField.0b2b48bd` | 写死 | 经停点 {…} 停留时长 | 名称 | [WaypointsField.tsx:169](../../apps/web/src/pages/book/new/WaypointsField.tsx#L169) |
| `WaypointsField.bcbf8263` | 写死 | 停留多久 | 输入框占位 | [WaypointsField.tsx:171](../../apps/web/src/pages/book/new/WaypointsField.tsx#L171) |
| `WaypointsField.e5fec948` | 写死 | 把 {name} 上移 | 名称 | [WaypointsField.tsx:202](../../apps/web/src/pages/book/new/WaypointsField.tsx#L202) |
| `WaypointsField.0d9a8743` | 写死 | 把 {name} 下移 | 名称 | [WaypointsField.tsx:203](../../apps/web/src/pages/book/new/WaypointsField.tsx#L203) |
| `WaypointsField.e10a228c` | 写死 | 删除 {name} | 名称 | [WaypointsField.tsx:204](../../apps/web/src/pages/book/new/WaypointsField.tsx#L204) |
| `WaypointsField.222a34f0` | 写死 | 添加经停点 | 按钮 | [WaypointsField.tsx:220](../../apps/web/src/pages/book/new/WaypointsField.tsx#L220) |

## 多日行程报价页（/book/trip）

文件：`apps/web/src/lib/trip-ai.ts`、`apps/web/src/pages/book/trip/TripQuoteResult.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `trip-ai.1c6af00e` | 写死 | {…} 月 {…} 日 | 文字 | [trip-ai.ts:125](../../apps/web/src/lib/trip-ai.ts#L125) |
| `trip-ai.e1969ab0` | 写死 | {rest} 分钟 | 文字 | [trip-ai.ts:132](../../apps/web/src/lib/trip-ai.ts#L132) |
| `trip-ai.0c025e01` | 写死 | {hours} 小时 | 文字 | [trip-ai.ts:133](../../apps/web/src/lib/trip-ai.ts#L133) |
| `trip-ai.67fabc3a` | 写死 | {hours} 小时 {rest} 分钟 | 文字 | [trip-ai.ts:133](../../apps/web/src/lib/trip-ai.ts#L133) |
| `TripQuoteResult.5809e058` | 写死 | {…}月{…}日 | 文字 | [TripQuoteResult.tsx:52](../../apps/web/src/pages/book/trip/TripQuoteResult.tsx#L52) |

## 订单页（查订单、管理订单）

文件：`apps/web/src/pages/book/FeedbackSection.tsx`、`apps/web/src/pages/book/OrderPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `FeedbackSection.df5a203d` | 写死 | 已提交。平台一般 2 小时内答复（用车当天的 15 分钟内），3 个工作日内处理完；答复会显示在这里，请稍后回到这个页面查看。 | 文字 | [FeedbackSection.tsx:25](../../apps/web/src/pages/book/FeedbackSection.tsx#L25) |
| `FeedbackSection.71d81294` | 写死 | 已超过投诉时限：服务结束后 14 天内可以投诉。如果还有问题，请联系客服。 | 提示 | [FeedbackSection.tsx:28](../../apps/web/src/pages/book/FeedbackSection.tsx#L28) |
| `FeedbackSection.eb185bd0` | 写死 | 这一单已经提了很多次，请直接联系客服。 | 提示 | [FeedbackSection.tsx:29](../../apps/web/src/pages/book/FeedbackSection.tsx#L29) |
| `FeedbackSection.195de9aa` | 写死 | 提交 | 文字 | [FeedbackSection.tsx:30](../../apps/web/src/pages/book/FeedbackSection.tsx#L30)、178 行 |
| `FeedbackSection.c3944156` | 写死 | 反馈 | 正文 | [FeedbackSection.tsx:39](../../apps/web/src/pages/book/FeedbackSection.tsx#L39) |
| `FeedbackSection.2e7b049f` | 写死 | 编号 {ticket\_no} · 提交于 {…} | 正文 | [FeedbackSection.tsx:42](../../apps/web/src/pages/book/FeedbackSection.tsx#L42) |
| `FeedbackSection.09ab5fab` | 写死 | 补偿 {…} | 正文 | [FeedbackSection.tsx:46](../../apps/web/src/pages/book/FeedbackSection.tsx#L46) |
| `FeedbackSection.5517d964` | 写死 | ，其中 {…} 原路退回您的银行卡 | 正文 | [FeedbackSection.tsx:47](../../apps/web/src/pages/book/FeedbackSection.tsx#L47) |
| `FeedbackSection.0239a87d` | 写死 | ，{…} 由平台另行支付{…} | 正文 | [FeedbackSection.tsx:48](../../apps/web/src/pages/book/FeedbackSection.tsx#L48) |
| `FeedbackSection.12da934b` | 写死 | （处理中） | 正文 | [FeedbackSection.tsx:48](../../apps/web/src/pages/book/FeedbackSection.tsx#L48) |
| `FeedbackSection.d7dbd261` | 写死 | （已支付） | 正文 | [FeedbackSection.tsx:48](../../apps/web/src/pages/book/FeedbackSection.tsx#L48) |
| `FeedbackSection.b377841f` | 写死 | 平台对「{subject}」的回复 | 读屏说明 | [FeedbackSection.tsx:53](../../apps/web/src/pages/book/FeedbackSection.tsx#L53) |
| `FeedbackSection.00ec19b3` | 写死 | 平台的回复 · {…} | 正文 | [FeedbackSection.tsx:56](../../apps/web/src/pages/book/FeedbackSection.tsx#L56) |
| `FeedbackSection.f4eaa4dc` | 写死 | 请选择是哪类问题 | 文字 | [FeedbackSection.tsx:95](../../apps/web/src/pages/book/FeedbackSection.tsx#L95) |
| `FeedbackSection.0e7f9a18` | 写死 | 请用一句话写是什么问题 | 文字 | [FeedbackSection.tsx:96](../../apps/web/src/pages/book/FeedbackSection.tsx#L96) |
| `FeedbackSection.40bb08de` | 写死 | 请写清楚经过，方便平台核实 | 文字 | [FeedbackSection.tsx:97](../../apps/web/src/pages/book/FeedbackSection.tsx#L97) |
| `FeedbackSection.3ae301af` | 写死 | {FEEDBACK\_SUBMITTED\_TEXT}（编号 {ticket\_no}） | 文字 | [FeedbackSection.tsx:108](../../apps/web/src/pages/book/FeedbackSection.tsx#L108) |
| `FeedbackSection.2023efbb` | 写死 | 投诉和反馈 | 标题 | [FeedbackSection.tsx:124](../../apps/web/src/pages/book/FeedbackSection.tsx#L124) |
| `FeedbackSection.c0fd2955` | 写死 | 对这次用车不满意、东西落在车上，或者有别的问题，可以在这里告诉平台。平台核实后会在这里答复；投诉成立的按统一的赔付标准补偿。 | 正文 | [FeedbackSection.tsx:125](../../apps/web/src/pages/book/FeedbackSection.tsx#L125) |
| `FeedbackSection.007fc2ef` | 写死 | 正在读取已提交的反馈 | 名称 | [FeedbackSection.tsx:126](../../apps/web/src/pages/book/FeedbackSection.tsx#L126) |
| `FeedbackSection.4bbca67d` | 写死 | 已提交的反馈没有读出来。 | 正文 | [FeedbackSection.tsx:129](../../apps/web/src/pages/book/FeedbackSection.tsx#L129) |
| `FeedbackSection.42345af7` | 写死 | 重试 | 按钮 | [FeedbackSection.tsx:132](../../apps/web/src/pages/book/FeedbackSection.tsx#L132) |
| `FeedbackSection.21801896` | 写死 | 已提交的反馈 | 读屏说明 | [FeedbackSection.tsx:136](../../apps/web/src/pages/book/FeedbackSection.tsx#L136) |
| `FeedbackSection.bd2066dc` | 写死 | 是哪类问题 | 标题 | [FeedbackSection.tsx:145](../../apps/web/src/pages/book/FeedbackSection.tsx#L145) |
| `FeedbackSection.1bba31b3` | 写死 | 如「司机迟到了 30 分钟」 | 说明 | [FeedbackSection.tsx:146](../../apps/web/src/pages/book/FeedbackSection.tsx#L146) |
| `FeedbackSection.a5e32d71` | 写死 | 一句话说明 | 名称 | [FeedbackSection.tsx:146](../../apps/web/src/pages/book/FeedbackSection.tsx#L146) |
| `FeedbackSection.e4d92206` | 写死 | 经过 | 表单标签 | [FeedbackSection.tsx:150](../../apps/web/src/pages/book/FeedbackSection.tsx#L150) |
| `FeedbackSection.4460f262` | 写死 | 什么时间、在哪里、发生了什么。平台会联系司机和服务方核实。 | 正文 | [FeedbackSection.tsx:172](../../apps/web/src/pages/book/FeedbackSection.tsx#L172) |
| `FeedbackSection.f62d2073` | 写死 | 正在提交 | 文字 | [FeedbackSection.tsx:176](../../apps/web/src/pages/book/FeedbackSection.tsx#L176) |
| `FeedbackSection.dfec7e19` | 写死 | 取消 | 按钮 | [FeedbackSection.tsx:181](../../apps/web/src/pages/book/FeedbackSection.tsx#L181) |
| `FeedbackSection.38ef16a0` | 写死 | 提交投诉或反馈 | 按钮 | [FeedbackSection.tsx:195](../../apps/web/src/pages/book/FeedbackSection.tsx#L195) |
| `OrderPage.22fd9579` | 写死 | 尝试次数过多，请稍后再试，或联系客服。 | 文字 | [OrderPage.tsx:32](../../apps/web/src/pages/book/OrderPage.tsx#L32) |
| `OrderPage.13a5221f` | 写死 | {…} 小时 | 文字 | [OrderPage.tsx:33](../../apps/web/src/pages/book/OrderPage.tsx#L33) |
| `OrderPage.2f9cabb6` | 写死 | {…} 分钟 | 文字 | [OrderPage.tsx:33](../../apps/web/src/pages/book/OrderPage.tsx#L33) |
| `OrderPage.84650514` | 写死 | {retryAfterSeconds} 秒 | 文字 | [OrderPage.tsx:33](../../apps/web/src/pages/book/OrderPage.tsx#L33) |
| `OrderPage.93e8724f` | 写死 | 尝试次数过多，请 {wait}后再试，或联系客服。 | 文字 | [OrderPage.tsx:34](../../apps/web/src/pages/book/OrderPage.tsx#L34) |
| `OrderPage.0d16fd01` | 写死 | 付款结果已交给银行处理。这个页面没能自动打开您的订单：请在下面填订单号和下单邮箱，我们会把订单链接发到您的邮箱，打开后可以看到付款结果；请不要重复付款。 | 文字 | [OrderPage.tsx:38](../../apps/web/src/pages/book/OrderPage.tsx#L38) |
| `OrderPage.a966a384` | 写死 | 银行返回的结果是这次付款没有成功。这个页面没能自动打开您的订单：请在下面填订单号和下单邮箱，我们会把订单链接发到您的邮箱。订单页会显示最新的付款状态，还是待付款的话可以在那里重新付款。找不到订单号请联系客服。 | 提示 | [OrderPage.tsx:43](../../apps/web/src/pages/book/OrderPage.tsx#L43) |
| `OrderPage.b0008973` | 写死 | 如信息匹配，链接已发送到下单邮箱。请查收邮件（也看看垃圾邮件），打开邮件里的链接查看订单。 | 文字 | [OrderPage.tsx:46](../../apps/web/src/pages/book/OrderPage.tsx#L46) |
| `OrderPage.23097501` | 写死 | 已结束超过 180 天的订单，链接和联系方式可能已按隐私规则清除，收不到新链接，需要帮助请联系客服。 | 说明 | [OrderPage.tsx:49](../../apps/web/src/pages/book/OrderPage.tsx#L49) |
| `OrderPage.21ac6ea1` | 写死 | 订单链接无效或已过期。请填订单号和下单邮箱，我们会把新的订单链接发到您的邮箱。 | 文字 | [OrderPage.tsx:51](../../apps/web/src/pages/book/OrderPage.tsx#L51) |
| `OrderPage.8ba1c0a1` | 写死 | 暂时发不了邮件，请联系客服找回订单。 | 文字 | [OrderPage.tsx:54](../../apps/web/src/pages/book/OrderPage.tsx#L54) |
| `OrderPage.bc8c1a50` | 写死 | 发送订单链接 | 文字 | [OrderPage.tsx:59](../../apps/web/src/pages/book/OrderPage.tsx#L59)、103 行 |
| `OrderPage.ff4d42cd` | 写死 | 订单号是 NZ 开头的 18 位，如 NZ20261026AB12CD34 | 文字 | [OrderPage.tsx:78](../../apps/web/src/pages/book/OrderPage.tsx#L78) |
| `OrderPage.62c981b8` | 写死 | 请填写下单时的邮箱 | 文字 | [OrderPage.tsx:79](../../apps/web/src/pages/book/OrderPage.tsx#L79) |
| `OrderPage.c67bb9d9` | 写死 | 请填写下单时的邮箱。只留了手机号的，请联系客服 | 文字 | [OrderPage.tsx:79](../../apps/web/src/pages/book/OrderPage.tsx#L79) |
| `OrderPage.c3a24862` | 写死 | 订单号 | 名称 | [OrderPage.tsx:98](../../apps/web/src/pages/book/OrderPage.tsx#L98) |
| `OrderPage.e75e7a2c` | 写死 | NZ 开头的 18 位，在下单成功页和订单邮件里 | 说明 | [OrderPage.tsx:98](../../apps/web/src/pages/book/OrderPage.tsx#L98) |
| `OrderPage.ff21d780` | 写死 | 下单时的邮箱 | 名称 | [OrderPage.tsx:99](../../apps/web/src/pages/book/OrderPage.tsx#L99) |
| `OrderPage.b166fcaf` | 写死 | 正在发送 | 文字 | [OrderPage.tsx:101](../../apps/web/src/pages/book/OrderPage.tsx#L101) |
| `OrderPage.445758c8` | 写死 | 收不到邮件？ | 标题 | [OrderPage.tsx:116](../../apps/web/src/pages/book/OrderPage.tsx#L116) |
| `OrderPage.973ec38c` | 写死 | 下单时只留了手机号、邮箱填错了，或者过了十几分钟还没收到邮件，请联系客服。客服核实是您本人后，会把订单链接发给您。 | 正文 | [OrderPage.tsx:117](../../apps/web/src/pages/book/OrderPage.tsx#L117) |
| `OrderPage.68f9bb03` | 写死 | 打电话给客服 {number} | 链接 | [OrderPage.tsx:121](../../apps/web/src/pages/book/OrderPage.tsx#L121) |
| `OrderPage.fa812133` | 写死 | 联系时请提供订单号，并准备好下单时的电话、用车时间等信息，方便核实。 | 正文 | [OrderPage.tsx:125](../../apps/web/src/pages/book/OrderPage.tsx#L125) |
| `OrderPage.0bd70516` | 写死 | 复制链接 | 按钮 | [OrderPage.tsx:139](../../apps/web/src/pages/book/OrderPage.tsx#L139) |
| `OrderPage.bddbbd67` | 写死 | 为保护您的订单，付款时地址栏不显示订单链接。要保存或转发这张单，请用这个按钮。 | 正文 | [OrderPage.tsx:150](../../apps/web/src/pages/book/OrderPage.tsx#L150) |
| `OrderPage.636c53bc` | 写死 | 复制订单链接 | 按钮 | [OrderPage.tsx:154](../../apps/web/src/pages/book/OrderPage.tsx#L154) |
| `OrderPage.02fc01c6` | 写死 | 查订单 · NOZOMI 用车 | 浏览器标题 | [OrderPage.tsx:165](../../apps/web/src/pages/book/OrderPage.tsx#L165)、175、241 行 |
| `OrderPage.8d4f568c` | 写死 | 订单 | 标题 | [OrderPage.tsx:168](../../apps/web/src/pages/book/OrderPage.tsx#L168)、293 行 |
| `OrderPage.63bbab98` | 写死 | 正在读取订单 | 名称 | [OrderPage.tsx:169](../../apps/web/src/pages/book/OrderPage.tsx#L169) |
| `OrderPage.6c1162b0` | 写死 | 查订单 | 标题 | [OrderPage.tsx:179](../../apps/web/src/pages/book/OrderPage.tsx#L179) |
| `OrderPage.ee272d3c` | 写死 | 输入订单号和下单时填的邮箱，我们会把订单链接发到这个邮箱。打开链接就能查看订单、付款、取消或修改。 | 正文 | [OrderPage.tsx:180](../../apps/web/src/pages/book/OrderPage.tsx#L180) |
| `OrderPage.fe46c77b` | 写死 | 订单 {orderNo} · NOZOMI 用车 | 浏览器标题 | [OrderPage.tsx:241](../../apps/web/src/pages/book/OrderPage.tsx#L241) |
| `OrderPage.ec5f5837` | 写死 | 读取订单 | 文字 | [OrderPage.tsx:273](../../apps/web/src/pages/book/OrderPage.tsx#L273) |
| `OrderPage.bdb5d823` | 写死 | 订单没有读出来 | 标题 | [OrderPage.tsx:294](../../apps/web/src/pages/book/OrderPage.tsx#L294) |
| `OrderPage.f7230824` | 写死 | 重试 | 按钮 | [OrderPage.tsx:294](../../apps/web/src/pages/book/OrderPage.tsx#L294) |
| `OrderPage.3897a19c` | 写死 | 订单 {order\_no} | 标题 | [OrderPage.tsx:323](../../apps/web/src/pages/book/OrderPage.tsx#L323) |
| `OrderPage.8f8e16ff` | 写死 | 付款成功，订单已确认。派车后这里会显示司机和车辆。 | 提示 | [OrderPage.tsx:326](../../apps/web/src/pages/book/OrderPage.tsx#L326) |
| `OrderPage.108a0789` | 写死 | 订单已提交。请复制下面的链接保存，之后凭这个链接查看订单；链接丢了，可以在「查订单」填订单号和邮箱，我们会把链接发到您的邮箱。 | 正文 | [OrderPage.tsx:331](../../apps/web/src/pages/book/OrderPage.tsx#L331) |
| `OrderPage.86c1c3bd` | 写死 | 订单已提交。请收藏这个页面，之后凭这个链接查看订单；链接丢了，可以在「查订单」填订单号和邮箱，我们会把链接发到您的邮箱。 | 正文 | [OrderPage.tsx:331](../../apps/web/src/pages/book/OrderPage.tsx#L331) |
| `OrderPage.29439c8c` | 写死 | 返回原网站 | 链接 | [OrderPage.tsx:341](../../apps/web/src/pages/book/OrderPage.tsx#L341) |

## 官网外框（页头、页脚、出错页）

文件：`apps/web/src/pages/book/SiteLayout.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `SiteLayout.c99bf8ba` | 写死 | 用车 | 正文 | [SiteLayout.tsx:76](../../apps/web/src/pages/book/SiteLayout.tsx#L76) |
| `SiteLayout.571ff4c3` | 写死 | 官网 | 读屏说明 | [SiteLayout.tsx:81](../../apps/web/src/pages/book/SiteLayout.tsx#L81) |
| `SiteLayout.1799f126` | 写死 | 预订用车 | 链接 | [SiteLayout.tsx:84](../../apps/web/src/pages/book/SiteLayout.tsx#L84) |
| `SiteLayout.26e410b7` | 写死 | 查订单 | 链接 | [SiteLayout.tsx:87](../../apps/web/src/pages/book/SiteLayout.tsx#L87) |
| `SiteLayout.1f3c87e1` | 写死 | 法律文案 | 读屏说明 | [SiteLayout.tsx:92](../../apps/web/src/pages/book/SiteLayout.tsx#L92) |
| `SiteLayout.0adf9b13` | 写死 | 页面出了点问题 | 标题 | [SiteLayout.tsx:124](../../apps/web/src/pages/book/SiteLayout.tsx#L124) |
| `SiteLayout.7041f03d` | 写死 | 请刷新重试。您的订单不受影响，可以随时在「查订单」里找到。 | 说明 | [SiteLayout.tsx:125](../../apps/web/src/pages/book/SiteLayout.tsx#L125) |
| `SiteLayout.282c9af8` | 写死 | 刷新页面 | 按钮 | [SiteLayout.tsx:129](../../apps/web/src/pages/book/SiteLayout.tsx#L129) |
| `SiteLayout.d060a2cc` | 写死 | 打开页面 | 文字 | [SiteLayout.tsx:165](../../apps/web/src/pages/book/SiteLayout.tsx#L165) |
| `SiteLayout.6df16a83` | 写死 | 官网暂未开放预订，请稍后再来。 | 提示 | [SiteLayout.tsx:178](../../apps/web/src/pages/book/SiteLayout.tsx#L178) |
| `SiteLayout.ab7376b6` | 写死 | 订单链接无效或已过期，请在「查订单」填订单号和下单邮箱，我们会把新链接发到您的邮箱。 | 提示 | [SiteLayout.tsx:179](../../apps/web/src/pages/book/SiteLayout.tsx#L179) |
| `SiteLayout.2b196432` | 写死 | 操作太频繁了，请稍后再试。 | 提示 | [SiteLayout.tsx:180](../../apps/web/src/pages/book/SiteLayout.tsx#L180) |
| `SiteLayout.37509fa2` | 写死 | 操作太频繁了，请 {…}后再试。 | 提示 | [SiteLayout.tsx:180](../../apps/web/src/pages/book/SiteLayout.tsx#L180) |
| `SiteLayout.43c1dcf8` | 写死 | {…} 分钟 | 提示 | [SiteLayout.tsx:180](../../apps/web/src/pages/book/SiteLayout.tsx#L180) |
| `SiteLayout.b44ed1e6` | 写死 | {retryAfterSeconds} 秒 | 提示 | [SiteLayout.tsx:180](../../apps/web/src/pages/book/SiteLayout.tsx#L180) |

## 法律文案（特定商取引法に基づく表記、キャンセルポリシー、プライバシーポリシー）

文件：`apps/web/src/pages/legal/LegalPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `LegalPages.78f487e2` | 写死 | 読み込み中 | 名称 | [LegalPages.tsx:53](../../apps/web/src/pages/legal/LegalPages.tsx#L53) |
| `LegalPages.93b3d1cc` | 写死 | 内容を読み込めませんでした | 标题 | [LegalPages.tsx:56](../../apps/web/src/pages/legal/LegalPages.tsx#L56) |
| `LegalPages.eb8a6663` | 写死 | 通信環境をご確認のうえ、「再読み込み」を押してください。 | 说明 | [LegalPages.tsx:57](../../apps/web/src/pages/legal/LegalPages.tsx#L57) |
| `LegalPages.bc7da5d0` | 写死 | 再読み込み | 按钮 | [LegalPages.tsx:61](../../apps/web/src/pages/legal/LegalPages.tsx#L61) |
| `LegalPages.b5dbce78` | 写死 | 販売事業者 | 文字 | [LegalPages.tsx:121](../../apps/web/src/pages/legal/LegalPages.tsx#L121) |
| `LegalPages.f077a269` | 写死 | 運営統括責任者 | 文字 | [LegalPages.tsx:122](../../apps/web/src/pages/legal/LegalPages.tsx#L122) |
| `LegalPages.f656803f` | 写死 | 所在地 | 文字 | [LegalPages.tsx:123](../../apps/web/src/pages/legal/LegalPages.tsx#L123) |
| `LegalPages.658e6109` | 写死 | 日本国内の連絡先 | 文字 | [LegalPages.tsx:124](../../apps/web/src/pages/legal/LegalPages.tsx#L124) |
| `LegalPages.adc33e7c` | 写死 | 電話番号 | 文字 | [LegalPages.tsx:125](../../apps/web/src/pages/legal/LegalPages.tsx#L125) |
| `LegalPages.436d2d73` | 写死 | メールアドレス | 文字 | [LegalPages.tsx:126](../../apps/web/src/pages/legal/LegalPages.tsx#L126) |
| `LegalPages.2f8603bd` | 写死 | 役務の内容 | 文字 | [LegalPages.tsx:127](../../apps/web/src/pages/legal/LegalPages.tsx#L127) |
| `LegalPages.2fa45482` | 写死 | 空港送迎、地点間送迎、貸切（チャーター）の配車手配。実際の運行は当社提携の運行事業者が行います。 | 文字 | [LegalPages.tsx:127](../../apps/web/src/pages/legal/LegalPages.tsx#L127) |
| `LegalPages.0f7218e7` | 写死 | 販売価格 | 文字 | [LegalPages.tsx:128](../../apps/web/src/pages/legal/LegalPages.tsx#L128) |
| `LegalPages.d674330d` | 写死 | 予約画面に表示する金額（税込）。空港送迎・地点間送迎は高速料金・駐車料込みの確定運賃です。 | 文字 | [LegalPages.tsx:128](../../apps/web/src/pages/legal/LegalPages.tsx#L128) |
| `LegalPages.3a5328e0` | 写死 | 貸切の超過時間・超過距離・高速料金・駐車料、有料待機、当日の立寄り追加・オプション追加があった場合は、サービス後に追加請求します。カード会社が定める手数料等がかかる場合があります。 | 文字 | [LegalPages.tsx:129](../../apps/web/src/pages/legal/LegalPages.tsx#L129) |
| `LegalPages.dfa756ee` | 写死 | 商品代金以外の必要料金 | 文字 | [LegalPages.tsx:129](../../apps/web/src/pages/legal/LegalPages.tsx#L129) |
| `LegalPages.6f2b989c` | 写死 | クレジットカード・デビットカード（Stripe 経由） | 文字 | [LegalPages.tsx:130](../../apps/web/src/pages/legal/LegalPages.tsx#L130) |
| `LegalPages.8825dc46` | 写死 | お支払い方法 | 文字 | [LegalPages.tsx:130](../../apps/web/src/pages/legal/LegalPages.tsx#L130) |
| `LegalPages.25b0feb6` | 写死 | お支払い時期 | 文字 | [LegalPages.tsx:131](../../apps/web/src/pages/legal/LegalPages.tsx#L131) |
| `LegalPages.6e69349d` | 写死 | ご予約時に全額をお支払いいただきます（予約後 30 分以内）。期限を過ぎたご予約は自動的に取り消され、料金はかかりません。日時変更による差額とサービス後の追加請求は、ご同意のうえ保存したカードに請求します。 | 文字 | [LegalPages.tsx:131](../../apps/web/src/pages/legal/LegalPages.tsx#L131) |
| `LegalPages.a562565d` | 写死 | 役務の提供時期 | 文字 | [LegalPages.tsx:132](../../apps/web/src/pages/legal/LegalPages.tsx#L132) |
| `LegalPages.c181ca74` | 写死 | ご予約いただいた日時に提供します。 | 文字 | [LegalPages.tsx:132](../../apps/web/src/pages/legal/LegalPages.tsx#L132) |
| `LegalPages.1aff1922` | 写死 | 役務の性質上、クーリング・オフはありません。キャンセルは下記「キャンセルポリシー」のとおりです。 | 文字 | [LegalPages.tsx:133](../../apps/web/src/pages/legal/LegalPages.tsx#L133) |
| `LegalPages.f55d92e4` | 写死 | キャンセル・返金 | 文字 | [LegalPages.tsx:133](../../apps/web/src/pages/legal/LegalPages.tsx#L133) |
| `LegalPages.2464631f` | 写死 | 動作環境 | 文字 | [LegalPages.tsx:134](../../apps/web/src/pages/legal/LegalPages.tsx#L134) |
| `LegalPages.e9b62d38` | 写死 | 最新版の主要ブラウザ（Chrome、Safari、Edge、Firefox） | 文字 | [LegalPages.tsx:134](../../apps/web/src/pages/legal/LegalPages.tsx#L134) |
| `LegalPages.494f2998` | 写死 | 特定商取引法に基づく表記 | 名称 | [LegalPages.tsx:137](../../apps/web/src/pages/legal/LegalPages.tsx#L137) |
| `LegalPages.62d8ea22` | 写死 | 項目 | 表头 | [LegalPages.tsx:140](../../apps/web/src/pages/legal/LegalPages.tsx#L140) |
| `LegalPages.0adaf9c4` | 写死 | 内容 | 表头 | [LegalPages.tsx:141](../../apps/web/src/pages/legal/LegalPages.tsx#L141) |
| `LegalPages.e46fdf2c` | 写死 | （ご利用日時までの時間に応じ、ご予約総額に対する割合） | 正文 | [LegalPages.tsx:168](../../apps/web/src/pages/legal/LegalPages.tsx#L168) |
| `LegalPages.804f4947` | 写死 | キャンセル料 | 名称 | [LegalPages.tsx:169](../../apps/web/src/pages/legal/LegalPages.tsx#L169) |
| `LegalPages.f093f3ce` | 写死 | サービス | 表头 | [LegalPages.tsx:172](../../apps/web/src/pages/legal/LegalPages.tsx#L172) |
| `LegalPages.177b7768` | 写死 | 車種 | 表头 | [LegalPages.tsx:173](../../apps/web/src/pages/legal/LegalPages.tsx#L173) |
| `LegalPages.6bbdae92` | 写死 | ご予約画面に、そのご予約に適用されるキャンセル料を表示します。 | 正文 | [LegalPages.tsx:198](../../apps/web/src/pages/legal/LegalPages.tsx#L198) |
| `LegalPages.10fa1153` | 写死 | 1. キャンセル方法 | 标题 | [LegalPages.tsx:208](../../apps/web/src/pages/legal/LegalPages.tsx#L208) |
| `LegalPages.23f864c8` | 写死 | 予約確認メールに記載のリンクから、オンラインでキャンセルできます。確定前にキャンセル料を表示します。お客様をお迎えしてサービスが始まった後はキャンセルできません。 | 正文 | [LegalPages.tsx:209](../../apps/web/src/pages/legal/LegalPages.tsx#L209) |
| `LegalPages.474296ce` | 写死 | 2. キャンセル料 | 标题 | [LegalPages.tsx:211](../../apps/web/src/pages/legal/LegalPages.tsx#L211) |
| `LegalPages.e4d5fe5f` | 写死 | 3. ノーショー（無断不乗車） | 标题 | [LegalPages.tsx:214](../../apps/web/src/pages/legal/LegalPages.tsx#L214) |
| `LegalPages.2e4f7132` | 写死 | ご連絡なくお客様がお越しにならなかった場合は、キャンセル扱いとせず、全額をいただきます。 | 正文 | [LegalPages.tsx:215](../../apps/web/src/pages/legal/LegalPages.tsx#L215) |
| `LegalPages.ddf9a8d3` | 写死 | 4. 無料でキャンセルできる場合 | 标题 | [LegalPages.tsx:217](../../apps/web/src/pages/legal/LegalPages.tsx#L217) |
| `LegalPages.559bde90` | 写死 | 航空便の欠航（証明書類をご提出ください） | 正文 | [LegalPages.tsx:219](../../apps/web/src/pages/legal/LegalPages.tsx#L219) |
| `LegalPages.775f26ad` | 写死 | 天災地変等の不可抗力 | 正文 | [LegalPages.tsx:220](../../apps/web/src/pages/legal/LegalPages.tsx#L220) |
| `LegalPages.8559afd9` | 写死 | 運行事業者または当社の都合による場合 | 正文 | [LegalPages.tsx:221](../../apps/web/src/pages/legal/LegalPages.tsx#L221) |
| `LegalPages.f1d9c09c` | 写死 | 日時変更を運行事業者がお断りした場合、または 30 分以内に確認できなかった場合 | 正文 | [LegalPages.tsx:222](../../apps/web/src/pages/legal/LegalPages.tsx#L222) |
| `LegalPages.dec349e3` | 写死 | 5. 返金 | 标题 | [LegalPages.tsx:225](../../apps/web/src/pages/legal/LegalPages.tsx#L225) |
| `LegalPages.3ec2d892` | 写死 | お支払い額からキャンセル料を差し引いた金額を、お支払いに使用されたカードへ返金します。入金までの期間はカード発行会社により異なります（目安：5〜10 営業日）。 | 正文 | [LegalPages.tsx:226](../../apps/web/src/pages/legal/LegalPages.tsx#L226) |
| `LegalPages.8e3c80d5` | 写死 | 6. 日時変更 | 标题 | [LegalPages.tsx:228](../../apps/web/src/pages/legal/LegalPages.tsx#L228) |
| `LegalPages.d3cd6b17` | 写死 | 無料キャンセル期間内で、ドライバーの出発前であれば、日時を変更できます。新しい日時で料金を再計算し、差額は返金または保存したカードへ請求します。ご利用 24 時間前を切ってからの変更は、運行事業者の確認が必要です。 | 正文 | [LegalPages.tsx:229](../../apps/web/src/pages/legal/LegalPages.tsx#L229) |
| `LegalPages.5f0b99c8` | 写死 | 7. サービス後の追加請求 | 标题 | [LegalPages.tsx:231](../../apps/web/src/pages/legal/LegalPages.tsx#L231) |
| `LegalPages.6d626100` | 写死 | 追加料金が発生した場合は、金額と根拠をメールでお知らせします。お知らせから 48 時間以内に異議をお申し出いただけます。異議がない場合は、保存したカードへ請求します。 | 正文 | [LegalPages.tsx:232](../../apps/web/src/pages/legal/LegalPages.tsx#L232) |
| `LegalPages.09c3a587` | 写死 | 米国・日本 | 文字 | [LegalPages.tsx:247](../../apps/web/src/pages/legal/LegalPages.tsx#L247) |
| `LegalPages.0af7f155` | 写死 | 決済・返金・カード保存 | 文字 | [LegalPages.tsx:247](../../apps/web/src/pages/legal/LegalPages.tsx#L247) |
| `LegalPages.24d4f80a` | 写死 | Stripe, Inc.（日本：Stripe Japan 株式会社） | 文字 | [LegalPages.tsx:247](../../apps/web/src/pages/legal/LegalPages.tsx#L247) |
| `LegalPages.3ff9e8d4` | 写死 | 氏名、メール、電話、予約番号、金額 | 文字 | [LegalPages.tsx:247](../../apps/web/src/pages/legal/LegalPages.tsx#L247) |
| `LegalPages.0a6b1be7` | 写死 | 米国 | 文字 | [LegalPages.tsx:248](../../apps/web/src/pages/legal/LegalPages.tsx#L248)、249 行 |
| `LegalPages.88062afa` | 写死 | 入力された住所・位置情報（当社サーバーから送信し、お客様の IP アドレスは送りません） | 文字 | [LegalPages.tsx:248](../../apps/web/src/pages/legal/LegalPages.tsx#L248) |
| `LegalPages.a7cc5e60` | 写死 | 住所検索、距離・所要時間の計算 | 文字 | [LegalPages.tsx:248](../../apps/web/src/pages/legal/LegalPages.tsx#L248) |
| `LegalPages.6cdac432` | 写死 | AI による行程の整理（ご利用の場合のみ） | 文字 | [LegalPages.tsx:249](../../apps/web/src/pages/legal/LegalPages.tsx#L249) |
| `LegalPages.d87958b9` | 写死 | 入力された行程の文章（メール・電話番号等は伏せ字にして送信し、原文は保存しません） | 文字 | [LegalPages.tsx:249](../../apps/web/src/pages/legal/LegalPages.tsx#L249) |
| `LegalPages.83ecc2ec` | 写死 | 予約確認等のメール送信 | 文字 | [LegalPages.tsx:250](../../apps/web/src/pages/legal/LegalPages.tsx#L250) |
| `LegalPages.8f792e28` | 写死 | メールアドレス、氏名、予約内容 | 文字 | [LegalPages.tsx:250](../../apps/web/src/pages/legal/LegalPages.tsx#L250) |
| `LegalPages.0e11022c` | 写死 | お客様のブラウザから直接通信するため IP アドレス | 文字 | [LegalPages.tsx:251](../../apps/web/src/pages/legal/LegalPages.tsx#L251) |
| `LegalPages.751412e7` | 写死 | 画面上の地図表示 | 文字 | [LegalPages.tsx:251](../../apps/web/src/pages/legal/LegalPages.tsx#L251) |
| `LegalPages.3fae57e1` | 写死 | 保存するすべての情報 | 文字 | [LegalPages.tsx:252](../../apps/web/src/pages/legal/LegalPages.tsx#L252) |
| `LegalPages.ea79d8e0` | 写死 | システム・データの保管 | 文字 | [LegalPages.tsx:252](../../apps/web/src/pages/legal/LegalPages.tsx#L252) |
| `LegalPages.f3c334a7` | 写死 | （以下「当社」）は、お客様の個人情報を以下のとおり取り扱います。 | 正文 | [LegalPages.tsx:258](../../apps/web/src/pages/legal/LegalPages.tsx#L258) |
| `LegalPages.217829a2` | 写死 | 1. 取得する情報 | 标题 | [LegalPages.tsx:260](../../apps/web/src/pages/legal/LegalPages.tsx#L260) |
| `LegalPages.1d0be549` | 写死 | ご予約者の氏名、電話番号、メールアドレス | 正文 | [LegalPages.tsx:262](../../apps/web/src/pages/legal/LegalPages.tsx#L262) |
| `LegalPages.f25f1bf0` | 写死 | ご乗車の方の氏名、電話番号、ネームボードの表記（任意） | 正文 | [LegalPages.tsx:263](../../apps/web/src/pages/legal/LegalPages.tsx#L263) |
| `LegalPages.ea664242` | 写死 | メッセージアプリのアカウント（WhatsApp、LINE、WeChat、KakaoTalk のいずれか、任意） | 正文 | [LegalPages.tsx:264](../../apps/web/src/pages/legal/LegalPages.tsx#L264) |
| `LegalPages.a3ec1883` | 写死 | 航空便名、乗降場所（住所・ホテル名・位置情報）、ご利用日時、人数、荷物数、オプション、ご要望 | 正文 | [LegalPages.tsx:265](../../apps/web/src/pages/legal/LegalPages.tsx#L265) |
| `LegalPages.8c8779d5` | 写死 | 旅行予約サイト経由のご予約では、同サイトから上記の情報を受け取ります | 正文 | [LegalPages.tsx:266](../../apps/web/src/pages/legal/LegalPages.tsx#L266) |
| `LegalPages.ae6dd4f8` | 写死 | カード番号は決済代行事業者（Stripe）が直接お預かりし、当社は取得・保存しません。 | 正文 | [LegalPages.tsx:268](../../apps/web/src/pages/legal/LegalPages.tsx#L268) |
| `LegalPages.e45a1e77` | 写死 | 2. 利用目的 | 标题 | [LegalPages.tsx:270](../../apps/web/src/pages/legal/LegalPages.tsx#L270) |
| `LegalPages.80c0a7b0` | 写死 | ご予約の受付・配車・運行、料金の請求・返金、ご予約に関するご連絡、お問い合わせへの対応のために利用します。広告・マーケティングには利用しません。 | 正文 | [LegalPages.tsx:271](../../apps/web/src/pages/legal/LegalPages.tsx#L271) |
| `LegalPages.ebc1f73f` | 写死 | 3. 運行事業者への提供 | 标题 | [LegalPages.tsx:273](../../apps/web/src/pages/legal/LegalPages.tsx#L273) |
| `LegalPages.80ce96c4` | 写死 | お支払い完了後、配車を担当する運行事業者に、配車に必要な情報（ご乗車の方の氏名・電話番号、航空便名、乗降場所等）を提供し、同社が担当ドライバーに伝えます。 | 正文 | [LegalPages.tsx:274](../../apps/web/src/pages/legal/LegalPages.tsx#L274) |
| `LegalPages.b40fd2a0` | 写死 | 4. 業務委託先・外部サービス | 标题 | [LegalPages.tsx:276](../../apps/web/src/pages/legal/LegalPages.tsx#L276) |
| `LegalPages.9240e360` | 写死 | 以下の事業者に、必要な範囲で情報を提供します。一部は日本国外に所在します。 | 正文 | [LegalPages.tsx:277](../../apps/web/src/pages/legal/LegalPages.tsx#L277) |
| `LegalPages.241032fd` | 写死 | 業務委託先・外部サービス | 名称 | [LegalPages.tsx:278](../../apps/web/src/pages/legal/LegalPages.tsx#L278) |
| `LegalPages.ec702f26` | 写死 | 事業者 | 表头 | [LegalPages.tsx:281](../../apps/web/src/pages/legal/LegalPages.tsx#L281) |
| `LegalPages.000ec461` | 写死 | 所在国 | 表头 | [LegalPages.tsx:282](../../apps/web/src/pages/legal/LegalPages.tsx#L282) |
| `LegalPages.a18d0364` | 写死 | 目的 | 表头 | [LegalPages.tsx:283](../../apps/web/src/pages/legal/LegalPages.tsx#L283) |
| `LegalPages.6d7378a2` | 写死 | 提供する情報 | 表头 | [LegalPages.tsx:284](../../apps/web/src/pages/legal/LegalPages.tsx#L284) |
| `LegalPages.ed723d9e` | 写死 | 5. 安全管理と保存期間 | 标题 | [LegalPages.tsx:299](../../apps/web/src/pages/legal/LegalPages.tsx#L299) |
| `LegalPages.3ea86902` | 写死 | 氏名・電話番号・メールアドレス等は暗号化して保存し、閲覧は記録します。ご利用完了から 180 日後に、氏名・電話番号・メールアドレスを自動的に復元できない形で消去します。 | 正文 | [LegalPages.tsx:300](../../apps/web/src/pages/legal/LegalPages.tsx#L300) |
| `LegalPages.0675094d` | 写死 | 6. Cookie | 标题 | [LegalPages.tsx:302](../../apps/web/src/pages/legal/LegalPages.tsx#L302) |
| `LegalPages.e8b2fc6c` | 写死 | 広告・アクセス解析用の Cookie は使用しません。表示設定（明るい／暗い）と決済手続き中の一時情報のみ、お客様のブラウザに保存します。 | 正文 | [LegalPages.tsx:303](../../apps/web/src/pages/legal/LegalPages.tsx#L303) |
| `LegalPages.aa7c1aa1` | 写死 | 7. 開示・訂正・削除のご請求・お問い合わせ | 标题 | [LegalPages.tsx:305](../../apps/web/src/pages/legal/LegalPages.tsx#L305) |
| `LegalPages.5f6ddd16` | 写死 | までご連絡ください。ご本人確認のうえ、法令に従い対応します。 | 正文 | [LegalPages.tsx:308](../../apps/web/src/pages/legal/LegalPages.tsx#L308) |
| `LegalPages.35f07a68` | 写死 | 8. 改定 | 标题 | [LegalPages.tsx:311](../../apps/web/src/pages/legal/LegalPages.tsx#L311) |
| `LegalPages.5687e95c` | 写死 | 本ポリシーを変更する場合は、本ページでお知らせします。（制定日： | 正文 | [LegalPages.tsx:313](../../apps/web/src/pages/legal/LegalPages.tsx#L313) |

## 多个页面共用：全屏选择页（FullScreenSheet.tsx）

用在：官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 预订页（/book）

文件：`apps/web/src/components/FullScreenSheet.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `FullScreenSheet.58c08167` | 写死 | 取消 | 按钮 | [FullScreenSheet.tsx:62](../../apps/web/src/components/FullScreenSheet.tsx#L62) |

## 多个页面共用：预订草稿 → 新预订页的状态（booking-draft.ts）

用在：官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 预订页（/book）

文件：`apps/web/src/lib/booking-draft.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `booking-draft.9fec3833` | 写死 | 只填地点，不要填姓名、电话。 | 说明 | [booking-draft.ts:49](../../apps/web/src/lib/booking-draft.ts#L49) |
| `booking-draft.09d17449` | 写死 | 预订链接已过期或无效，请在下面重新填写行程。 | 文字 | [booking-draft.ts:51](../../apps/web/src/lib/booking-draft.ts#L51) |
| `booking-draft.a51ff6f1` | 写死 | 没能读取预订信息，请重新填写，或稍后刷新页面。 | 提示 | [booking-draft.ts:52](../../apps/web/src/lib/booking-draft.ts#L52) |

## 多个页面共用：官网报不出价时「留下联系方式、人工报价」（manual-quote-form.ts）

用在：官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 预订页（/book）

文件：`apps/web/src/lib/manual-quote-form.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `manual-quote-form.manualQuote.required` | 已走 key | 请至少填一项：邮箱或 WhatsApp | 提示 | [manual-quote-form.ts:51](../../apps/web/src/lib/manual-quote-form.ts#L51) |
| `manual-quote-form.manualQuote.email` | 已走 key | 邮箱的格式不对，请写完整，如 name@example.com | 文字 | [manual-quote-form.ts:52](../../apps/web/src/lib/manual-quote-form.ts#L52) |
| `manual-quote-form.manualQuote.whatsapp` | 已走 key | WhatsApp 号码请以 + 和国家码开头（如日本 +81、中国 +86），共 8 到 15 位数字 | 文字 | [manual-quote-form.ts:53](../../apps/web/src/lib/manual-quote-form.ts#L53) |
| `manual-quote-form.manualQuote.whatsappHint` | 已走 key | 以 + 和国家码开头，如日本 +81、中国 +86；可以有空格 | 说明 | [manual-quote-form.ts:54](../../apps/web/src/lib/manual-quote-form.ts#L54) |
| `manual-quote-form.manualQuote.consent` | 已走 key | 提交即同意客服通过您留下的方式联系您 | 文字 | [manual-quote-form.ts:55](../../apps/web/src/lib/manual-quote-form.ts#L55) |
| `manual-quote-form.manualQuote.success` | 已走 key | 已收到。客服会通过您留下的邮箱或 WhatsApp 联系您报价，请留意消息。 | 文字 | [manual-quote-form.ts:56](../../apps/web/src/lib/manual-quote-form.ts#L56) |
| `manual-quote-form.7136bf73` | 写死 | 上车地点 | 文字 | [manual-quote-form.ts:67](../../apps/web/src/lib/manual-quote-form.ts#L67) |
| `manual-quote-form.cab5f245` | 写死 | 出发地 | 文字 | [manual-quote-form.ts:67](../../apps/web/src/lib/manual-quote-form.ts#L67) |
| `manual-quote-form.c081b56e` | 写死 | 目的地 | 文字 | [manual-quote-form.ts:68](../../apps/web/src/lib/manual-quote-form.ts#L68) |
| `manual-quote-form.71235231` | 写死 | 包车时长 | 文字 | [manual-quote-form.ts:70](../../apps/web/src/lib/manual-quote-form.ts#L70) |
| `manual-quote-form.c02a8b8f` | 写死 | 日期和时间 | 文字 | [manual-quote-form.ts:71](../../apps/web/src/lib/manual-quote-form.ts#L71) |
| `manual-quote-form.740f0dfa` | 写死 | 地图上选的位置 | 名称 | [manual-quote-form.ts:89](../../apps/web/src/lib/manual-quote-form.ts#L89) |
| `manual-quote-form.2f665172` | 写死 | 您好，我想咨询用车报价。 | 提示 | [manual-quote-form.ts:129](../../apps/web/src/lib/manual-quote-form.ts#L129) |

## 多个页面共用：新预订页每一步的按钮条（step-bar-texts.ts）

用在：官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 预订页（/book）

文件：`apps/web/src/lib/step-bar-texts.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `step-bar.label` | 已走 key | 本步操作 | 名称 | [step-bar-texts.ts:10](../../apps/web/src/lib/step-bar-texts.ts#L10) |
| `step-bar.needVehicle` | 已走 key | 请先选择车型 | 文字 | [step-bar-texts.ts:11](../../apps/web/src/lib/step-bar-texts.ts#L11) |
| `step-bar.quoting` | 已走 key | 正在查询价格，查好后请选择车型 | 文字 | [step-bar-texts.ts:12](../../apps/web/src/lib/step-bar-texts.ts#L12) |
| `step-bar.quoteFailed` | 已走 key | 价格没有查出来，请先点「重试」 | 提示 | [step-bar-texts.ts:13](../../apps/web/src/lib/step-bar-texts.ts#L13) |

## 多个页面共用：官网行程报价页 /book/trip（trip-texts.ts）

用在：官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 预订页（/book）

文件：`apps/web/src/lib/trip-texts.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `trip.title` | 已走 key | 多日行程报价 | 标题 | [trip-texts.ts:223](../../apps/web/src/lib/trip-texts.ts#L223) |
| `trip.day` | 已走 key | 第 {n} 天 | 文字 | [trip-texts.ts:224](../../apps/web/src/lib/trip-texts.ts#L224) |
| `trip.addDay` | 已走 key | 加一天 | 文字 | [trip-texts.ts:225](../../apps/web/src/lib/trip-texts.ts#L225) |
| `trip.addStop` | 已走 key | 加一个地点 | 文字 | [trip-texts.ts:226](../../apps/web/src/lib/trip-texts.ts#L226) |
| `trip.quote` | 已走 key | 查看报价 | 文字 | [trip-texts.ts:227](../../apps/web/src/lib/trip-texts.ts#L227) |
| `trip.plan.one_car` | 已走 key | 同一辆车跑完全程 | 文字 | [trip-texts.ts:228](../../apps/web/src/lib/trip-texts.ts#L228) |
| `trip.plan.daily_best` | 已走 key | 每天选最划算的车 | 文字 | [trip-texts.ts:229](../../apps/web/src/lib/trip-texts.ts#L229) |
| `trip.recommended` | 已走 key | 推荐 | 文字 | [trip-texts.ts:230](../../apps/web/src/lib/trip-texts.ts#L230) |
| `trip.unquoted` | 已走 key | 这个方案暂时报不出：{reason} | 文字 | [trip-texts.ts:231](../../apps/web/src/lib/trip-texts.ts#L231) |
| `trip.manual.title` | 已走 key | 这个行程需要客服人工报价 | 标题 | [trip-texts.ts:232](../../apps/web/src/lib/trip-texts.ts#L232) |
| `trip.manual.cta` | 已走 key | 转人工报价 | 文字 | [trip-texts.ts:233](../../apps/web/src/lib/trip-texts.ts#L233) |
| `trip.book` | 已走 key | 预订这个方案 | 文字 | [trip-texts.ts:234](../../apps/web/src/lib/trip-texts.ts#L234) |
| `trip.bookManual` | 已走 key | 提交预订，客服确认 | 文字 | [trip-texts.ts:235](../../apps/web/src/lib/trip-texts.ts#L235) |
| `trip.ai.title` | 已走 key | 一句话描述你的行程 | 标题 | [trip-texts.ts:237](../../apps/web/src/lib/trip-texts.ts#L237) |
| `trip.ai.placeholder` | 已走 key | 例如：11 月 25 日成田接机，先去浅草寺再去新宿酒店，第二天包车 8 小时去日光，第三天送羽田，4 个人 6 件行李 | 输入框占位 | [trip-texts.ts:238](../../apps/web/src/lib/trip-texts.ts#L238) |
| `trip.ai.submit` | 已走 key | 帮我填好 | 按钮 | [trip-texts.ts:239](../../apps/web/src/lib/trip-texts.ts#L239) |
| `trip.ai.working` | 已走 key | 正在整理… | 文字 | [trip-texts.ts:240](../../apps/web/src/lib/trip-texts.ts#L240) |
| `trip.ai.note` | 已走 key | 由 AI 整理，价格由系统按规则计算；请勿填写姓名、电话等个人信息 | 说明 | [trip-texts.ts:241](../../apps/web/src/lib/trip-texts.ts#L241) |
| `trip.ai.replaceConfirm` | 已走 key | 用 AI 整理的结果替换现在填的内容吗？ | 按钮 | [trip-texts.ts:242](../../apps/web/src/lib/trip-texts.ts#L242) |
| `trip.ai.summary` | 已走 key | 已按你的描述填好 {days} 天行程。标黄的地方请补填或确认，然后点「查看报价」 | 说明 | [trip-texts.ts:243](../../apps/web/src/lib/trip-texts.ts#L243) |
| `trip.ai.filled` | 已走 key | AI 填的，可改 | 文字 | [trip-texts.ts:244](../../apps/web/src/lib/trip-texts.ts#L244) |
| `trip.ai.missing` | 已走 key | 请补填 | 文字 | [trip-texts.ts:245](../../apps/web/src/lib/trip-texts.ts#L245) |
| `trip.ai.pickOne` | 已走 key | 找到几个地点，请选一个 | 文字 | [trip-texts.ts:246](../../apps/web/src/lib/trip-texts.ts#L246) |
| `trip.ai.notFound` | 已走 key | 没找到「{name}」，请重新搜索 | 文字 | [trip-texts.ts:247](../../apps/web/src/lib/trip-texts.ts#L247) |
| `trip.ai.vague` | 已走 key | 「{name}」没说是哪一家，请搜索选一家 | 文字 | [trip-texts.ts:248](../../apps/web/src/lib/trip-texts.ts#L248) |
| `trip.ai.unused.FLIGHT_NUMBER` | 已走 key | 航班号 {value}：行程报价暂不用航班号，下单时可以填在备注里 | 文字 | [trip-texts.ts:249](../../apps/web/src/lib/trip-texts.ts#L249) |
| `trip.ai.unused.CHARTER_HOURS` | 已走 key | 你说的「包车 {value} 小时」会按实际路线自动选套餐，报价里能看到 | 文字 | [trip-texts.ts:250](../../apps/web/src/lib/trip-texts.ts#L250) |
| `trip.ai.outOfScope` | 已走 key | 行程里有暂时报不了价的部分（{what}），可以转人工报价 | 文字 | [trip-texts.ts:251](../../apps/web/src/lib/trip-texts.ts#L251) |
| `trip.ai.failed` | 已走 key | 暂时没法自动整理，请直接在下面填写 | 提示 | [trip-texts.ts:252](../../apps/web/src/lib/trip-texts.ts#L252) |
| `trip.ai.dailyLimit` | 已走 key | 今天的自动整理次数已满，请直接填写 | 文字 | [trip-texts.ts:253](../../apps/web/src/lib/trip-texts.ts#L253) |
| `trip.ai.notATrip` | 已走 key | 没看出行程，请写上日期、地点，或直接在下面填写 | 文字 | [trip-texts.ts:254](../../apps/web/src/lib/trip-texts.ts#L254) |
| `trip.ai.tooLong` | 已走 key | 行程较长，请分段报价或转人工 | 文字 | [trip-texts.ts:255](../../apps/web/src/lib/trip-texts.ts#L255) |
| `trip.ai.label` | 已走 key | 行程描述 | 名称 | [trip-texts.ts:257](../../apps/web/src/lib/trip-texts.ts#L257) |
| `trip.ai.count` | 已走 key | {n} / {max} 字 | 文字 | [trip-texts.ts:258](../../apps/web/src/lib/trip-texts.ts#L258) |
| `trip.ai.tooManyChars` | 已走 key | 最多 {max} 字，请删短一些 | 文字 | [trip-texts.ts:259](../../apps/web/src/lib/trip-texts.ts#L259) |
| `trip.ai.empty` | 已走 key | 请先写一句行程 | 空状态 | [trip-texts.ts:260](../../apps/web/src/lib/trip-texts.ts#L260) |
| `trip.ai.replace` | 已走 key | 替换 | 文字 | [trip-texts.ts:261](../../apps/web/src/lib/trip-texts.ts#L261) |
| `trip.ai.cancel` | 已走 key | 取消 | 按钮 | [trip-texts.ts:262](../../apps/web/src/lib/trip-texts.ts#L262) |
| `trip.ai.rateLimited` | 已走 key | 请稍后再试 | 文字 | [trip-texts.ts:263](../../apps/web/src/lib/trip-texts.ts#L263) |
| `trip.ai.rateLimitedSeconds` | 已走 key | 请 {n} 秒后再试 | 文字 | [trip-texts.ts:264](../../apps/web/src/lib/trip-texts.ts#L264) |
| `trip.ai.rateLimitedMinutes` | 已走 key | 请 {n} 分钟后再试 | 文字 | [trip-texts.ts:265](../../apps/web/src/lib/trip-texts.ts#L265) |
| `trip.ai.summaryMissing` | 已走 key | 请补填 | 说明 | [trip-texts.ts:266](../../apps/web/src/lib/trip-texts.ts#L266) |
| `trip.ai.summaryConfirm` | 已走 key | 请确认 | 按钮 | [trip-texts.ts:267](../../apps/web/src/lib/trip-texts.ts#L267) |
| `trip.ai.summaryUnused` | 已走 key | 没有用上的信息 | 说明 | [trip-texts.ts:268](../../apps/web/src/lib/trip-texts.ts#L268) |
| `trip.ai.summaryOutOfScope` | 已走 key | 不在报价范围 | 说明 | [trip-texts.ts:269](../../apps/web/src/lib/trip-texts.ts#L269) |
| `trip.ai.field.date` | 已走 key | 第 1 天的日期 | 文字 | [trip-texts.ts:270](../../apps/web/src/lib/trip-texts.ts#L270) |
| `trip.ai.field.passengers` | 已走 key | 人数（先按 {n} 人填了） | 文字 | [trip-texts.ts:271](../../apps/web/src/lib/trip-texts.ts#L271) |
| `trip.ai.field.luggage` | 已走 key | 行李件数（先按 {n} 件填了） | 文字 | [trip-texts.ts:272](../../apps/web/src/lib/trip-texts.ts#L272) |
| `trip.ai.field.time` | 已走 key | 第 {n} 天的上车时间 | 文字 | [trip-texts.ts:273](../../apps/web/src/lib/trip-texts.ts#L273) |
| `trip.ai.field.start` | 已走 key | 第 {n} 天的上车地点 | 文字 | [trip-texts.ts:274](../../apps/web/src/lib/trip-texts.ts#L274) |
| `trip.ai.field.stop` | 已走 key | 第 {n} 天第 {m} 个中间地点 | 文字 | [trip-texts.ts:275](../../apps/web/src/lib/trip-texts.ts#L275) |
| `trip.ai.field.end` | 已走 key | 第 {n} 天的最后下车地点 | 文字 | [trip-texts.ts:276](../../apps/web/src/lib/trip-texts.ts#L276) |
| `trip.ai.field.stay` | 已走 key | 第 {n} 天第 {m} 个中间地点的停留时长 | 文字 | [trip-texts.ts:277](../../apps/web/src/lib/trip-texts.ts#L277) |
| `trip.ai.field.other` | 已走 key | 标黄的地方 | 文字 | [trip-texts.ts:278](../../apps/web/src/lib/trip-texts.ts#L278) |
| `trip.ai.assume.DATE_FROM_RELATIVE` | 已走 key | 第 1 天的日期按 {value}填 | 文字 | [trip-texts.ts:279](../../apps/web/src/lib/trip-texts.ts#L279) |
| `trip.ai.assume.DATE_YEAR_INFERRED` | 已走 key | 第 1 天的日期按 {value}填（没说年份，取今天以后最近的那天） | 文字 | [trip-texts.ts:280](../../apps/web/src/lib/trip-texts.ts#L280) |
| `trip.ai.assume.stay` | 已走 key | 第 {n} 天第 {m} 个中间地点的停留时长没有对应的选项，请自己选 | 文字 | [trip-texts.ts:281](../../apps/web/src/lib/trip-texts.ts#L281) |
| `trip.ai.assume.other` | 已走 key | {field}是推算出来的 | 文字 | [trip-texts.ts:282](../../apps/web/src/lib/trip-texts.ts#L282) |
| `trip.ai.assume.STAY_DEFAULT` | 已走 key | 没说停留多久的地点先按 {value}填了，可改 | 文字 | [trip-texts.ts:283](../../apps/web/src/lib/trip-texts.ts#L283) |
| `trip.ai.assume.STAY_DEFAULT_MIXED` | 已走 key | 没说停留多久的地点先按常见时长填了，可改 | 文字 | [trip-texts.ts:284](../../apps/web/src/lib/trip-texts.ts#L284) |
| `trip.ai.unused.VEHICLE_TYPE` | 已走 key | 指定车型：报价后在方案里选车型 | 文字 | [trip-texts.ts:285](../../apps/web/src/lib/trip-texts.ts#L285) |
| `trip.ai.unused.DRIVER_LANGUAGE` | 已走 key | 司机语言：下单时可以填在备注里 | 文字 | [trip-texts.ts:286](../../apps/web/src/lib/trip-texts.ts#L286) |
| `trip.ai.unused.CHILD_SEAT` | 已走 key | 儿童座椅：报价后在附加服务里选 | 文字 | [trip-texts.ts:287](../../apps/web/src/lib/trip-texts.ts#L287) |
| `trip.ai.unused.OTHER_REQUEST` | 已走 key | 其他要求：下单时可以填在备注里 | 文字 | [trip-texts.ts:288](../../apps/web/src/lib/trip-texts.ts#L288) |
| `trip.ai.unused.other` | 已走 key | 有一些信息报价用不上，下单时可以填在备注里 | 文字 | [trip-texts.ts:289](../../apps/web/src/lib/trip-texts.ts#L289) |
| `trip.ai.scope.BUS` | 已走 key | 大巴 | 文字 | [trip-texts.ts:290](../../apps/web/src/lib/trip-texts.ts#L290) |
| `trip.ai.scope.ACCESSIBLE_VEHICLE` | 已走 key | 无障碍车 | 文字 | [trip-texts.ts:291](../../apps/web/src/lib/trip-texts.ts#L291) |
| `trip.ai.scope.OVERSEAS` | 已走 key | 海外段 | 文字 | [trip-texts.ts:292](../../apps/web/src/lib/trip-texts.ts#L292) |
| `trip.ai.scope.OTHER` | 已走 key | 其他 | 文字 | [trip-texts.ts:293](../../apps/web/src/lib/trip-texts.ts#L293) |
| `trip.documentTitle` | 已走 key | 多日行程报价 · NOZOMI 用车 | 标题 | [trip-texts.ts:295](../../apps/web/src/lib/trip-texts.ts#L295) |
| `trip.intro` | 已走 key | 按天填写每天的用车时间和要去的地点，我们按整个行程给出报价 | 说明 | [trip-texts.ts:296](../../apps/web/src/lib/trip-texts.ts#L296) |
| `trip.stepsLabel` | 已走 key | 行程报价步骤 | 名称 | [trip-texts.ts:297](../../apps/web/src/lib/trip-texts.ts#L297) |
| `trip.step1` | 已走 key | 填写行程 | 文字 | [trip-texts.ts:298](../../apps/web/src/lib/trip-texts.ts#L298) |
| `trip.step2` | 已走 key | 报价结果 | 文字 | [trip-texts.ts:299](../../apps/web/src/lib/trip-texts.ts#L299) |
| `trip.stepCurrent` | 已走 key | 第 {n} 步：{name}（当前） | 文字 | [trip-texts.ts:300](../../apps/web/src/lib/trip-texts.ts#L300) |
| `trip.stepDone` | 已走 key | 第 {n} 步：{name}（已完成，回到这一步） | 文字 | [trip-texts.ts:301](../../apps/web/src/lib/trip-texts.ts#L301) |
| `trip.stepTodo` | 已走 key | 第 {n} 步：{name} | 文字 | [trip-texts.ts:302](../../apps/web/src/lib/trip-texts.ts#L302) |
| `trip.back` | 已走 key | 上一步 | 文字 | [trip-texts.ts:303](../../apps/web/src/lib/trip-texts.ts#L303) |
| `trip.loadingPage` | 已走 key | 正在打开行程报价页 | 文字 | [trip-texts.ts:304](../../apps/web/src/lib/trip-texts.ts#L304) |
| `trip.pageFailed` | 已走 key | 页面没有打开 | 提示 | [trip-texts.ts:305](../../apps/web/src/lib/trip-texts.ts#L305) |
| `trip.retry` | 已走 key | 重试 | 文字 | [trip-texts.ts:306](../../apps/web/src/lib/trip-texts.ts#L306) |
| `trip.notOpenTitle` | 已走 key | 暂未开放预订 | 标题 | [trip-texts.ts:307](../../apps/web/src/lib/trip-texts.ts#L307) |
| `trip.notOpenText` | 已走 key | 官网的在线预订还没有开放，请稍后再来。 | 文字 | [trip-texts.ts:308](../../apps/web/src/lib/trip-texts.ts#L308) |
| `trip.citiesFailed` | 已走 key | 城市列表没有读出来 | 提示 | [trip-texts.ts:309](../../apps/web/src/lib/trip-texts.ts#L309) |
| `trip.noCitiesTitle` | 已走 key | 暂时没有可预订的城市 | 标题 | [trip-texts.ts:310](../../apps/web/src/lib/trip-texts.ts#L310) |
| `trip.noCitiesText` | 已走 key | 现在还没有可以在线预订用车的城市，请稍后再来。 | 文字 | [trip-texts.ts:311](../../apps/web/src/lib/trip-texts.ts#L311) |
| `trip.tripSection` | 已走 key | 你的行程 | 文字 | [trip-texts.ts:312](../../apps/web/src/lib/trip-texts.ts#L312) |
| `trip.date` | 已走 key | 日期（当地） | 文字 | [trip-texts.ts:313](../../apps/web/src/lib/trip-texts.ts#L313) |
| `trip.dateAuto` | 已走 key | 日期：{date}（接着前一天） | 文字 | [trip-texts.ts:314](../../apps/web/src/lib/trip-texts.ts#L314) |
| `trip.time` | 已走 key | 第 {n} 天 上车时间（当地） | 文字 | [trip-texts.ts:315](../../apps/web/src/lib/trip-texts.ts#L315) |
| `trip.timeHint` | 已走 key | 当天第一个地点的出发时间；之后各点的时间按路线自动推算 | 说明 | [trip-texts.ts:316](../../apps/web/src/lib/trip-texts.ts#L316) |
| `trip.idle` | 已走 key | 这天不用车 | 文字 | [trip-texts.ts:317](../../apps/web/src/lib/trip-texts.ts#L317) |
| `trip.idleHint` | 已走 key | 车和司机留在当地，第二天接着用 | 说明 | [trip-texts.ts:318](../../apps/web/src/lib/trip-texts.ts#L318) |
| `trip.start` | 已走 key | 第 {n} 天 上车地点 | 文字 | [trip-texts.ts:319](../../apps/web/src/lib/trip-texts.ts#L319) |
| `trip.stop` | 已走 key | 第 {n} 天 第 {m} 个地点 | 文字 | [trip-texts.ts:320](../../apps/web/src/lib/trip-texts.ts#L320) |
| `trip.end` | 已走 key | 第 {n} 天 最后下车地点 | 文字 | [trip-texts.ts:321](../../apps/web/src/lib/trip-texts.ts#L321) |
| `trip.stay` | 已走 key | 第 {n} 天 第 {m} 个地点 停留时长 | 文字 | [trip-texts.ts:322](../../apps/web/src/lib/trip-texts.ts#L322) |
| `trip.stayPlaceholder` | 已走 key | 请选择停留时长 | 文字 | [trip-texts.ts:323](../../apps/web/src/lib/trip-texts.ts#L323) |
| `trip.stayNone` | 已走 key | 不停留（只路过） | 文字 | [trip-texts.ts:324](../../apps/web/src/lib/trip-texts.ts#L324) |
| `trip.lodging` | 已走 key | 当晚为司机安排住宿 | 文字 | [trip-texts.ts:325](../../apps/web/src/lib/trip-texts.ts#L325) |
| `trip.lodgingHint` | 已走 key | 您为司机提供当晚住宿时勾选，这一晚不收司机住宿费 | 说明 | [trip-texts.ts:326](../../apps/web/src/lib/trip-texts.ts#L326) |
| `trip.removeDay` | 已走 key | 删除第 {n} 天 | 文字 | [trip-texts.ts:327](../../apps/web/src/lib/trip-texts.ts#L327) |
| `trip.removeStop` | 已走 key | 删除第 {n} 天 第 {m} 个地点 | 文字 | [trip-texts.ts:328](../../apps/web/src/lib/trip-texts.ts#L328) |
| `trip.maxDays` | 已走 key | 最多 {max} 天，更长的行程请联系客服 | 文字 | [trip-texts.ts:329](../../apps/web/src/lib/trip-texts.ts#L329) |
| `trip.maxStops` | 已走 key | 每天最多加 {max} 个中间地点，更多请联系客服 | 文字 | [trip-texts.ts:330](../../apps/web/src/lib/trip-texts.ts#L330) |
| `trip.dayRemoved` | 已走 key | 已删除第 {n} 天 | 文字 | [trip-texts.ts:331](../../apps/web/src/lib/trip-texts.ts#L331) |
| `trip.mapTitle` | 已走 key | 行程地图 | 标题 | [trip-texts.ts:332](../../apps/web/src/lib/trip-texts.ts#L332) |
| `trip.mapAlt` | 已走 key | 第 {n} 天路线图：{chain} | 文字 | [trip-texts.ts:333](../../apps/web/src/lib/trip-texts.ts#L333) |
| `trip.mapFigure` | 已走 key | 第 {n} 天路线图 | 文字 | [trip-texts.ts:334](../../apps/web/src/lib/trip-texts.ts#L334) |
| `trip.mapEmpty` | 已走 key | 选好地点后在这里显示每天的路线 | 空状态 | [trip-texts.ts:335](../../apps/web/src/lib/trip-texts.ts#L335) |
| `trip.mapAside` | 已走 key | 每天的路线 | 文字 | [trip-texts.ts:336](../../apps/web/src/lib/trip-texts.ts#L336) |
| `trip.error.date` | 已走 key | 请选择日期 | 文字 | [trip-texts.ts:338](../../apps/web/src/lib/trip-texts.ts#L338) |
| `trip.error.time` | 已走 key | 请填写上车时间 | 文字 | [trip-texts.ts:339](../../apps/web/src/lib/trip-texts.ts#L339) |
| `trip.error.start` | 已走 key | 请选择上车地点 | 文字 | [trip-texts.ts:340](../../apps/web/src/lib/trip-texts.ts#L340) |
| `trip.error.end` | 已走 key | 请选择最后下车地点 | 文字 | [trip-texts.ts:341](../../apps/web/src/lib/trip-texts.ts#L341) |
| `trip.error.stopPlace` | 已走 key | 请选择这个地点 | 文字 | [trip-texts.ts:342](../../apps/web/src/lib/trip-texts.ts#L342) |
| `trip.error.stay` | 已走 key | 请选择停留时长 | 文字 | [trip-texts.ts:343](../../apps/web/src/lib/trip-texts.ts#L343) |
| `trip.error.firstDayIdle` | 已走 key | 第一天要用车 | 文字 | [trip-texts.ts:344](../../apps/web/src/lib/trip-texts.ts#L344) |
| `trip.error.lastDayIdle` | 已走 key | 最后一天要用车 | 文字 | [trip-texts.ts:345](../../apps/web/src/lib/trip-texts.ts#L345) |
| `trip.error.tooManyPlaces` | 已走 key | 整个行程最多 {max} 个不同的地点，请减少一些地点，或联系客服 | 文字 | [trip-texts.ts:346](../../apps/web/src/lib/trip-texts.ts#L346) |
| `trip.error.summary` | 已走 key | 行程还有没填好的地方，请按提示修改 | 说明 | [trip-texts.ts:347](../../apps/web/src/lib/trip-texts.ts#L347) |
| `trip.error.invalid` | 已走 key | 行程里有填写不对的地方，请检查日期、时间和地点 | 提示 | [trip-texts.ts:348](../../apps/web/src/lib/trip-texts.ts#L348) |
| `trip.creating` | 已走 key | 正在保存行程 | 文字 | [trip-texts.ts:350](../../apps/web/src/lib/trip-texts.ts#L350) |
| `trip.quoting` | 已走 key | 正在按整个行程报价，地点多时要多等一会儿 | 文字 | [trip-texts.ts:351](../../apps/web/src/lib/trip-texts.ts#L351) |
| `trip.resultSection` | 已走 key | 报价结果 | 文字 | [trip-texts.ts:352](../../apps/web/src/lib/trip-texts.ts#L352) |
| `trip.total` | 已走 key | 合计 | 文字 | [trip-texts.ts:353](../../apps/web/src/lib/trip-texts.ts#L353) |
| `trip.vehicleGroup` | 已走 key | 车型：{name} | 文字 | [trip-texts.ts:354](../../apps/web/src/lib/trip-texts.ts#L354) |
| `trip.expired` | 已走 key | 报价已过有效期，请重新报价 | 文字 | [trip-texts.ts:355](../../apps/web/src/lib/trip-texts.ts#L355) |
| `trip.requote` | 已走 key | 重新报价 | 文字 | [trip-texts.ts:356](../../apps/web/src/lib/trip-texts.ts#L356) |
| `trip.degraded` | 已走 key | 行程较长，后面几天按整天用车报价，没有再拆开比较 | 文字 | [trip-texts.ts:357](../../apps/web/src/lib/trip-texts.ts#L357) |
| `trip.unquotedTitle` | 已走 key | 报不出的方案 | 标题 | [trip-texts.ts:358](../../apps/web/src/lib/trip-texts.ts#L358) |
| `trip.unquotedDay` | 已走 key | {plan}（第 {n} 天）： | 文字 | [trip-texts.ts:359](../../apps/web/src/lib/trip-texts.ts#L359) |
| `trip.unquotedWhole` | 已走 key | {plan}： | 文字 | [trip-texts.ts:360](../../apps/web/src/lib/trip-texts.ts#L360) |
| `trip.notQuoted` | 已走 key | 这个行程还没有报价 | 文字 | [trip-texts.ts:361](../../apps/web/src/lib/trip-texts.ts#L361) |
| `trip.manual.hint` | 已走 key | 客服会按您填的行程人工报价 | 说明 | [trip-texts.ts:362](../../apps/web/src/lib/trip-texts.ts#L362) |
| `trip.editTrip` | 已走 key | 修改行程 | 文字 | [trip-texts.ts:363](../../apps/web/src/lib/trip-texts.ts#L363) |
| `trip.dayList` | 已走 key | 每天的行程 | 文字 | [trip-texts.ts:364](../../apps/web/src/lib/trip-texts.ts#L364) |
| `trip.announce.plans` | 已走 key | 报价已出来，共 {n} 个方案 | 文字 | [trip-texts.ts:365](../../apps/web/src/lib/trip-texts.ts#L365) |
| `trip.announce.none` | 已走 key | 这次没有报出方案 | 文字 | [trip-texts.ts:366](../../apps/web/src/lib/trip-texts.ts#L366) |
| `trip.dayHeading` | 已走 key | 第 {n} 天 · {date} | 标题 | [trip-texts.ts:367](../../apps/web/src/lib/trip-texts.ts#L367) |
| `trip.segment.airport_pickup` | 已走 key | 接机 | 文字 | [trip-texts.ts:368](../../apps/web/src/lib/trip-texts.ts#L368) |
| `trip.segment.airport_dropoff` | 已走 key | 送机 | 文字 | [trip-texts.ts:369](../../apps/web/src/lib/trip-texts.ts#L369) |
| `trip.segment.p2p` | 已走 key | 点对点用车 | 文字 | [trip-texts.ts:370](../../apps/web/src/lib/trip-texts.ts#L370) |
| `trip.segment.charter` | 已走 key | 包车 | 文字 | [trip-texts.ts:371](../../apps/web/src/lib/trip-texts.ts#L371) |
| `trip.segment.charterHours` | 已走 key | 包车 {hours} 小时 | 文字 | [trip-texts.ts:372](../../apps/web/src/lib/trip-texts.ts#L372) |
| `trip.segment.idle_day` | 已走 key | 不用车（车和司机留在当地） | 文字 | [trip-texts.ts:373](../../apps/web/src/lib/trip-texts.ts#L373) |
| `trip.segmentTime` | 已走 key | {start}–{end} | 文字 | [trip-texts.ts:374](../../apps/web/src/lib/trip-texts.ts#L374) |
| `trip.otherVehicle` | 已走 key | 这一天换了别的车 | 文字 | [trip-texts.ts:375](../../apps/web/src/lib/trip-texts.ts#L375) |
| `trip.planFees` | 已走 key | 其他费用 | 文字 | [trip-texts.ts:376](../../apps/web/src/lib/trip-texts.ts#L376) |
| `trip.warning.SECOND_DRIVER` | 已走 key | 第 {n} 天用车时间较长，已加第二位司机 | 文字 | [trip-texts.ts:377](../../apps/web/src/lib/trip-texts.ts#L377) |
| `trip.warning.SECOND_DRIVERWhole` | 已走 key | 用车时间较长，已加第二位司机 | 文字 | [trip-texts.ts:378](../../apps/web/src/lib/trip-texts.ts#L378) |
| `trip.warning.SEGMENT_OTHER_VEHICLE` | 已走 key | 第 {n} 天换了别的车 | 文字 | [trip-texts.ts:379](../../apps/web/src/lib/trip-texts.ts#L379) |
| `trip.warning.SEGMENT_OTHER_VEHICLEWhole` | 已走 key | 有几天换了别的车 | 文字 | [trip-texts.ts:380](../../apps/web/src/lib/trip-texts.ts#L380) |
| `trip.warning.WORK_HOURS_HARD_LIMIT` | 已走 key | 第 {n} 天用车时间接近上限 | 文字 | [trip-texts.ts:381](../../apps/web/src/lib/trip-texts.ts#L381) |
| `trip.warning.WORK_HOURS_HARD_LIMITWhole` | 已走 key | 用车时间接近上限 | 文字 | [trip-texts.ts:382](../../apps/web/src/lib/trip-texts.ts#L382) |
| `trip.compare` | 已走 key | 两个方案对比 | 文字 | [trip-texts.ts:383](../../apps/web/src/lib/trip-texts.ts#L383) |
| `trip.manual.cardHint` | 已走 key | 留下邮箱或 WhatsApp，客服按整张行程单报价，不用再填行程 | 说明 | [trip-texts.ts:384](../../apps/web/src/lib/trip-texts.ts#L384) |
| `trip.manual.noTrip` | 已走 key | 第一天的行程不完整，没法转人工报价，请返回修改行程 | 文字 | [trip-texts.ts:385](../../apps/web/src/lib/trip-texts.ts#L385) |
| `trip.manual.unnamedPlace` | 已走 key | 地图上选的位置 | 文字 | [trip-texts.ts:386](../../apps/web/src/lib/trip-texts.ts#L386) |
| `trip.dayListOf` | 已走 key | {plan}：每天的行程 | 文字 | [trip-texts.ts:387](../../apps/web/src/lib/trip-texts.ts#L387) |
| `trip.failure.tooComplex` | 已走 key | 这个行程太复杂，暂时没法在线报价。 | 文字 | [trip-texts.ts:389](../../apps/web/src/lib/trip-texts.ts#L389) |
| `trip.failure.notFound` | 已走 key | 这个行程已过期或不存在，请重新填写。 | 文字 | [trip-texts.ts:390](../../apps/web/src/lib/trip-texts.ts#L390) |
| `trip.failure.rateLimited` | 已走 key | 操作太频繁了，请稍后再试。 | 文字 | [trip-texts.ts:391](../../apps/web/src/lib/trip-texts.ts#L391) |
| `trip.failure.rateLimitedSeconds` | 已走 key | 操作太频繁了，请 {n} 秒后再试。 | 文字 | [trip-texts.ts:392](../../apps/web/src/lib/trip-texts.ts#L392) |
| `trip.failure.rateLimitedMinutes` | 已走 key | 操作太频繁了，请 {n} 分钟后再试。 | 文字 | [trip-texts.ts:393](../../apps/web/src/lib/trip-texts.ts#L393) |
| `trip.failure.quote` | 已走 key | 报价没有查出来 | 文字 | [trip-texts.ts:394](../../apps/web/src/lib/trip-texts.ts#L394) |
| `trip.failure.create` | 已走 key | 行程没有保存 | 文字 | [trip-texts.ts:395](../../apps/web/src/lib/trip-texts.ts#L395) |
| `trip.failure.read` | 已走 key | 行程没有读出来 | 文字 | [trip-texts.ts:396](../../apps/web/src/lib/trip-texts.ts#L396) |
| `trip.action.create` | 已走 key | 保存行程 | 文字 | [trip-texts.ts:397](../../apps/web/src/lib/trip-texts.ts#L397) |
| `trip.action.quote` | 已走 key | 报价 | 文字 | [trip-texts.ts:398](../../apps/web/src/lib/trip-texts.ts#L398) |
| `trip.action.read` | 已走 key | 读取行程 | 文字 | [trip-texts.ts:399](../../apps/web/src/lib/trip-texts.ts#L399) |
| `trip.action.cities` | 已走 key | 读取城市 | 文字 | [trip-texts.ts:400](../../apps/web/src/lib/trip-texts.ts#L400) |
| `trip.action.book` | 已走 key | 打开预订 | 文字 | [trip-texts.ts:401](../../apps/web/src/lib/trip-texts.ts#L401) |
| `trip.book.hint` | 已走 key | 接着填写乘客信息，然后在线付款 | 说明 | [trip-texts.ts:403](../../apps/web/src/lib/trip-texts.ts#L403) |
| `trip.book.busy` | 已走 key | 正在准备预订 | 文字 | [trip-texts.ts:404](../../apps/web/src/lib/trip-texts.ts#L404) |
| `trip.book.failed` | 已走 key | 预订没有打开 | 提示 | [trip-texts.ts:405](../../apps/web/src/lib/trip-texts.ts#L405) |
| `trip.book.priceChanged` | 已走 key | 价格有变化，请重新报价 | 文字 | [trip-texts.ts:406](../../apps/web/src/lib/trip-texts.ts#L406) |
| `trip.book.priceChangedManual` | 已走 key | 价格有变化，请重新报价；也可以转人工报价，由客服按这个方案核对 | 文字 | [trip-texts.ts:407](../../apps/web/src/lib/trip-texts.ts#L407) |
| `trip.book.planGone` | 已走 key | 这个方案已经更新，请重新报价 | 文字 | [trip-texts.ts:408](../../apps/web/src/lib/trip-texts.ts#L408) |
| `trip.book.notSingle` | 已走 key | 这个方案不能直接在线下单，请提交预订，由客服确认 | 文字 | [trip-texts.ts:409](../../apps/web/src/lib/trip-texts.ts#L409) |
| `trip.bookManual.hint` | 已走 key | 留下邮箱或 WhatsApp，客服按这个方案核对后联系您确认价格和预订 | 说明 | [trip-texts.ts:410](../../apps/web/src/lib/trip-texts.ts#L410) |
| `trip.reason.NO_OFFER` | 已走 key | 没有可用的车 | 文字 | [trip-texts.ts:413](../../apps/web/src/lib/trip-texts.ts#L413) |
| `trip.reason.NO_PRODUCT` | 已走 key | 这里暂时没有在线报价 | 文字 | [trip-texts.ts:414](../../apps/web/src/lib/trip-texts.ts#L414) |
| `trip.reason.OUT_OF_SERVICE_AREA` | 已走 key | 有地点不在服务范围内 | 文字 | [trip-texts.ts:415](../../apps/web/src/lib/trip-texts.ts#L415) |
| `trip.reason.ROUTE_UNAVAILABLE` | 已走 key | 路线暂时算不出来 | 文字 | [trip-texts.ts:416](../../apps/web/src/lib/trip-texts.ts#L416) |
| `trip.reason.ONE_CAR_NOT_AVAILABLE` | 已走 key | 没有一辆车能跑完全部日子 | 文字 | [trip-texts.ts:417](../../apps/web/src/lib/trip-texts.ts#L417) |
| `trip.reason.CROSS_CITY_ONE_CAR` | 已走 key | 行程跨了城市，暂时不能同一辆车跑完 | 文字 | [trip-texts.ts:418](../../apps/web/src/lib/trip-texts.ts#L418) |
| `trip.reason.WORK_HOURS_EXCEEDED` | 已走 key | 用车时间太长，司机工作时间不够 | 文字 | [trip-texts.ts:419](../../apps/web/src/lib/trip-texts.ts#L419) |
| `trip.reason.WORK_HOURS_HARD_LIMIT` | 已走 key | 用车时间太长，请拆成两天或减少地点 | 文字 | [trip-texts.ts:420](../../apps/web/src/lib/trip-texts.ts#L420) |
| `trip.reason.SECOND_DRIVER_PRICE_UNAVAILABLE` | 已走 key | 需要第二位司机，暂时报不出价 | 文字 | [trip-texts.ts:421](../../apps/web/src/lib/trip-texts.ts#L421) |
| `trip.reason.LODGING_PRICE_UNAVAILABLE` | 已走 key | 司机住宿费暂时报不出 | 文字 | [trip-texts.ts:422](../../apps/web/src/lib/trip-texts.ts#L422) |
| `trip.reason.IDLE_DAY_PRICE_UNAVAILABLE` | 已走 key | 不用车那天的停驻费暂时报不出 | 文字 | [trip-texts.ts:423](../../apps/web/src/lib/trip-texts.ts#L423) |
| `trip.reason.FEE_PRICE_UNAVAILABLE` | 已走 key | 部分费用暂时报不出 | 文字 | [trip-texts.ts:424](../../apps/web/src/lib/trip-texts.ts#L424) |
| `trip.reason.ITINERARY_TOO_LONG` | 已走 key | 行程太长 | 文字 | [trip-texts.ts:425](../../apps/web/src/lib/trip-texts.ts#L425) |
| `trip.reason.LEAD_TIME_TOO_SHORT` | 已走 key | 离用车时间太近，来不及安排 | 说明 | [trip-texts.ts:426](../../apps/web/src/lib/trip-texts.ts#L426) |
| `trip.reason.SOLD_OUT` | 已走 key | 车已经订满 | 文字 | [trip-texts.ts:427](../../apps/web/src/lib/trip-texts.ts#L427) |
| `trip.reason.CAPACITY_EXCEEDED` | 已走 key | 人数或行李超出了可选车型能坐、能装的范围 | 文字 | [trip-texts.ts:428](../../apps/web/src/lib/trip-texts.ts#L428) |
| `trip.reason.SERVICE_TIME_PASSED` | 已走 key | 用车时间已经过了 | 文字 | [trip-texts.ts:429](../../apps/web/src/lib/trip-texts.ts#L429) |
| `trip.reason.OUTSIDE_SERVICE_TIME` | 已走 key | 用车时间不在服务时间内 | 文字 | [trip-texts.ts:430](../../apps/web/src/lib/trip-texts.ts#L430) |
| `trip.reason.WAYPOINT_NOT_PRICED` | 已走 key | 途经的地点暂时报不出价 | 文字 | [trip-texts.ts:431](../../apps/web/src/lib/trip-texts.ts#L431) |
| `trip.reason.ADDON_NOT_OFFERED` | 已走 key | 所选的附加服务暂时不能提供 | 文字 | [trip-texts.ts:432](../../apps/web/src/lib/trip-texts.ts#L432) |
| `trip.reason.other` | 已走 key | 暂时没有合适的车 | 文字 | [trip-texts.ts:433](../../apps/web/src/lib/trip-texts.ts#L433) |

## 多个页面共用：官网的地图选点（GoogleMapPicker.tsx）

用在：官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 预订页（/book）

文件：`apps/web/src/pages/book/GoogleMapPicker.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `GoogleMapPicker.a4fc5b6b` | 写死 | 地图：点一下选{word}位置，或拖动标记；也可以用方向键移动地图，再按地图下面的「选地图中间这个位置」 | 标题 | [GoogleMapPicker.tsx:94](../../apps/web/src/pages/book/GoogleMapPicker.tsx#L94) |
| `GoogleMapPicker.494298bd` | 写死 | 地图加载中… | 正文 | [GoogleMapPicker.tsx:95](../../apps/web/src/pages/book/GoogleMapPicker.tsx#L95) |
| `GoogleMapPicker.5b2a9960` | 写死 | 选地图中间这个位置 | 按钮 | [GoogleMapPicker.tsx:99](../../apps/web/src/pages/book/GoogleMapPicker.tsx#L99) |

## 多个页面共用：官网报不出价时的「留下联系方式、人工报价」和「通过 What…（ManualQuote.tsx）

用在：官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 预订页（/book）

文件：`apps/web/src/pages/book/ManualQuote.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ManualQuote.a6214d73` | 写死 | 通过 WhatsApp 联系我们 | 正文 | [ManualQuote.tsx:37](../../apps/web/src/pages/book/ManualQuote.tsx#L37) |
| `ManualQuote.7a97c84b` | 写死 | 请先在上面选好{…}，再提交。 | 文字 | [ManualQuote.tsx:72](../../apps/web/src/pages/book/ManualQuote.tsx#L72) |
| `ManualQuote.739b1118` | 写死 | 也可以点下面的「通过 WhatsApp 联系我们」。 | 文字 | [ManualQuote.tsx:97](../../apps/web/src/pages/book/ManualQuote.tsx#L97) |
| `ManualQuote.ae19d727` | 写死 | 提交 | 文字 | [ManualQuote.tsx:97](../../apps/web/src/pages/book/ManualQuote.tsx#L97)、131 行 |
| `ManualQuote.295ef826` | 写死 | 请客服人工报价 | 标题 | [ManualQuote.tsx:108](../../apps/web/src/pages/book/ManualQuote.tsx#L108) |
| `ManualQuote.8c9c249c` | 写死 | 留下邮箱或 WhatsApp（至少一项），客服核对行程后联系您报价。行程会自动带上，不用再填。 | 正文 | [ManualQuote.tsx:116](../../apps/web/src/pages/book/ManualQuote.tsx#L116) |
| `ManualQuote.5ccced45` | 写死 | 邮箱 | 名称 | [ManualQuote.tsx:119](../../apps/web/src/pages/book/ManualQuote.tsx#L119) |
| `ManualQuote.cb84395a` | 写死 | WhatsApp | 名称 | [ManualQuote.tsx:120](../../apps/web/src/pages/book/ManualQuote.tsx#L120) |
| `ManualQuote.bd1d66f0` | 写死 | 网站（请留空） | 表单标签 | [ManualQuote.tsx:125](../../apps/web/src/pages/book/ManualQuote.tsx#L125) |
| `ManualQuote.a98f88ca` | 写死 | 正在提交 | 文字 | [ManualQuote.tsx:129](../../apps/web/src/pages/book/ManualQuote.tsx#L129) |

## 多个页面共用：官网订单页的各个区块（OrderSections.tsx）

用在：官网（客人预订） · 订单页（查订单、管理订单）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）

文件：`apps/web/src/pages/book/OrderSections.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `OrderSections.c463ca2c` | 写死 | 机场 | 名称 | [OrderSections.tsx:90](../../apps/web/src/pages/book/OrderSections.tsx#L90) |
| `OrderSections.1144d4fe` | 写死 | 这张订单现在不能付款了（可能已超过付款期限），订单状态马上会更新。 | 文字 | [OrderSections.tsx:113](../../apps/web/src/pages/book/OrderSections.tsx#L113) |
| `OrderSections.a265b86c` | 写死 | 上次付款没有完成，请重新付款。 | 提示 | [OrderSections.tsx:115](../../apps/web/src/pages/book/OrderSections.tsx#L115) |
| `OrderSections.3400b992` | 写死 | 没有连上 Stripe，这次付款可能没有提交。请检查网络后再点「付款」；同一张订单不会被扣两次。 | 文字 | [OrderSections.tsx:116](../../apps/web/src/pages/book/OrderSections.tsx#L116) |
| `OrderSections.89215c41` | 写死 | 银行正在处理这笔付款，处理完订单会自动确认（通常几分钟内），页面会自动更新，请不要重复付款。 | 文字 | [OrderSections.tsx:119](../../apps/web/src/pages/book/OrderSections.tsx#L119) |
| `OrderSections.fdea7a40` | 写死 | 付款成功，等待确认。订单通常几秒钟内确认，页面会自动更新，请不要重复付款。 | 文字 | [OrderSections.tsx:119](../../apps/web/src/pages/book/OrderSections.tsx#L119) |
| `OrderSections.ccc3a38c` | 写死 | {head}确认比平时慢：您可以先关掉页面，稍后再打开这个链接查看；有疑问请联系客服。 | 文字 | [OrderSections.tsx:120](../../apps/web/src/pages/book/OrderSections.tsx#L120) |
| `OrderSections.af35b579` | 写死 | 上次付款没有成功：{lastError} | 文字 | [OrderSections.tsx:214](../../apps/web/src/pages/book/OrderSections.tsx#L214) |
| `OrderSections.af9b841e` | 写死 | 付款组件没有加载出来，请检查网络后点「重新加载」。 | 文字 | [OrderSections.tsx:221](../../apps/web/src/pages/book/OrderSections.tsx#L221) |
| `OrderSections.ce282679` | 写死 | 准备付款 | 文字 | [OrderSections.tsx:221](../../apps/web/src/pages/book/OrderSections.tsx#L221) |
| `OrderSections.43646cad` | 写死 | 付款没有完成。请稍后再试；一直不行请联系客服。 | 文字 | [OrderSections.tsx:279](../../apps/web/src/pages/book/OrderSections.tsx#L279) |
| `OrderSections.56072186` | 写死 | 付款没有成功：{message} | 文字 | [OrderSections.tsx:279](../../apps/web/src/pages/book/OrderSections.tsx#L279) |
| `OrderSections.bd72dc54` | 写死 | 请在当地时间 {due} 前付款，过时订单会自动取消。付款信息由 Stripe 处理，本站不保存卡号。 | 正文 | [OrderSections.tsx:293](../../apps/web/src/pages/book/OrderSections.tsx#L293) |
| `OrderSections.35e165df` | 写死 | 正在加载付款组件 | 名称 | [OrderSections.tsx:297](../../apps/web/src/pages/book/OrderSections.tsx#L297) |
| `OrderSections.a03e2791` | 写死 | 重新加载 | 按钮 | [OrderSections.tsx:298](../../apps/web/src/pages/book/OrderSections.tsx#L298) |
| `OrderSections.fb9ac376` | 写死 | 确认付款 | 读屏说明 | [OrderSections.tsx:301](../../apps/web/src/pages/book/OrderSections.tsx#L301) |
| `OrderSections.cb093359` | 写死 | 确认支付 {…}？ | 正文 | [OrderSections.tsx:302](../../apps/web/src/pages/book/OrderSections.tsx#L302) |
| `OrderSections.c4bc0138` | 写死 | 如果银行要求验证，会弹出银行的验证窗口，请按提示完成。 | 正文 | [OrderSections.tsx:303](../../apps/web/src/pages/book/OrderSections.tsx#L303) |
| `OrderSections.6de825e1` | 写死 | 正在付款 | 文字 | [OrderSections.tsx:305](../../apps/web/src/pages/book/OrderSections.tsx#L305) |
| `OrderSections.25bdc23e` | 写死 | 确认支付 | 按钮 | [OrderSections.tsx:307](../../apps/web/src/pages/book/OrderSections.tsx#L307) |
| `OrderSections.8e32606c` | 写死 | 返回 | 按钮 | [OrderSections.tsx:310](../../apps/web/src/pages/book/OrderSections.tsx#L310) |
| `OrderSections.3e4c8896` | 写死 | 正在检查 | 文字 | [OrderSections.tsx:315](../../apps/web/src/pages/book/OrderSections.tsx#L315) |
| `OrderSections.ddd43d4a` | 写死 | 付款 {…} | 按钮 | [OrderSections.tsx:316](../../apps/web/src/pages/book/OrderSections.tsx#L316) |
| `OrderSections.1a7dee4c` | 写死 | 付款 | 标题 | [OrderSections.tsx:348](../../apps/web/src/pages/book/OrderSections.tsx#L348) |
| `OrderSections.e7f4081c` | 写死 | 正在读取付款方式 | 名称 | [OrderSections.tsx:350](../../apps/web/src/pages/book/OrderSections.tsx#L350) |
| `OrderSections.5a24acfd` | 写死 | 付款暂未开放：订单已为您保留到当地时间 {due}，到时没有付款会自动取消。付款开放后可以回到这个页面付款。 | 提示 | [OrderSections.tsx:353](../../apps/web/src/pages/book/OrderSections.tsx#L353) |
| `OrderSections.4f9d24bd` | 写死 | 点对点 | 名称 | [OrderSections.tsx:368](../../apps/web/src/pages/book/OrderSections.tsx#L368) |
| `OrderSections.3bc1336c` | 写死 | 包车 | 名称 | [OrderSections.tsx:369](../../apps/web/src/pages/book/OrderSections.tsx#L369) |
| `OrderSections.7b8191a1` | 写死 | 下车地点 | 名称 | [OrderSections.tsx:369](../../apps/web/src/pages/book/OrderSections.tsx#L369) |
| `OrderSections.b7336892` | 写死 | 上车地点 | 名称 | [OrderSections.tsx:369](../../apps/web/src/pages/book/OrderSections.tsx#L369) |
| `OrderSections.2f5b77f5` | 写死 | 送机 | 名称 | [OrderSections.tsx:371](../../apps/web/src/pages/book/OrderSections.tsx#L371) |
| `OrderSections.4bafdfdc` | 写死 | 接机 | 名称 | [OrderSections.tsx:371](../../apps/web/src/pages/book/OrderSections.tsx#L371) |
| `OrderSections.008cef32` | 写死 | 行程 | 标题 | [OrderSections.tsx:380](../../apps/web/src/pages/book/OrderSections.tsx#L380) |
| `OrderSections.4c188bdf` | 写死 | 经停点 | 名称 | [OrderSections.tsx:389](../../apps/web/src/pages/book/OrderSections.tsx#L389) |
| `OrderSections.ecc98ba4` | 写死 | 包车行程 | 名称 | [OrderSections.tsx:390](../../apps/web/src/pages/book/OrderSections.tsx#L390) |
| `OrderSections.87bc42c6` | 写死 | {…}（{…}当地时间） | 正文 | [OrderSections.tsx:395](../../apps/web/src/pages/book/OrderSections.tsx#L395) |
| `OrderSections.0b0e3ce3` | 写死 | 航班号 | 名称 | [OrderSections.tsx:397](../../apps/web/src/pages/book/OrderSections.tsx#L397)、804、953 行 |
| `OrderSections.f1a4c66e` | 写死 | 车型 | 名称 | [OrderSections.tsx:398](../../apps/web/src/pages/book/OrderSections.tsx#L398) |
| `OrderSections.4c71c5b3` | 写死 | 人数 / 行李 | 名称 | [OrderSections.tsx:400](../../apps/web/src/pages/book/OrderSections.tsx#L400) |
| `OrderSections.d23d41b9` | 写死 | {passengers} 人 / {luggage} 件 | 正文 | [OrderSections.tsx:401](../../apps/web/src/pages/book/OrderSections.tsx#L401) |
| `OrderSections.5502f689` | 写死 | 预订人 | 名称 | [OrderSections.tsx:404](../../apps/web/src/pages/book/OrderSections.tsx#L404) |
| `OrderSections.e62a0bac` | 写死 | 乘车人 | 名称 | [OrderSections.tsx:404](../../apps/web/src/pages/book/OrderSections.tsx#L404)、409 行 |
| `OrderSections.04682a49` | 写死 | 乘车人手机号 | 名称 | [OrderSections.tsx:405](../../apps/web/src/pages/book/OrderSections.tsx#L405) |
| `OrderSections.b58a31b9` | 写死 | 预订人手机号 | 名称 | [OrderSections.tsx:405](../../apps/web/src/pages/book/OrderSections.tsx#L405) |
| `OrderSections.374031e9` | 写死 | 预订人邮箱 | 名称 | [OrderSections.tsx:406](../../apps/web/src/pages/book/OrderSections.tsx#L406) |
| `OrderSections.6154dc2f` | 写死 | 乘车人邮箱 | 名称 | [OrderSections.tsx:406](../../apps/web/src/pages/book/OrderSections.tsx#L406) |
| `OrderSections.6e56b055` | 写死 | 乘车人电话 / WhatsApp | 名称 | [OrderSections.tsx:410](../../apps/web/src/pages/book/OrderSections.tsx#L410) |
| `OrderSections.afa4cce7` | 写死 | 举牌姓名 | 名称 | [OrderSections.tsx:411](../../apps/web/src/pages/book/OrderSections.tsx#L411) |
| `OrderSections.22414b25` | 写死 | 备注 | 名称 | [OrderSections.tsx:412](../../apps/web/src/pages/book/OrderSections.tsx#L412)、804 行 |
| `OrderSections.a9c7a311` | 写死 | 总价 | 名称 | [OrderSections.tsx:413](../../apps/web/src/pages/book/OrderSections.tsx#L413) |
| `OrderSections.a1ea889f` | 写死 | 公里数 | 名称 | [OrderSections.tsx:419](../../apps/web/src/pages/book/OrderSections.tsx#L419) |
| `OrderSections.c404e4c6` | 写死 | 费用说明 | 名称 | [OrderSections.tsx:420](../../apps/web/src/pages/book/OrderSections.tsx#L420) |
| `OrderSections.664515ac` | 写死 | 免费等待 | 名称 | [OrderSections.tsx:421](../../apps/web/src/pages/book/OrderSections.tsx#L421) |
| `OrderSections.95e87b03` | 写死 | 服务方 | 名称 | [OrderSections.tsx:422](../../apps/web/src/pages/book/OrderSections.tsx#L422) |
| `OrderSections.cf518019` | 写死 | 订单进度 | 标题 | [OrderSections.tsx:430](../../apps/web/src/pages/book/OrderSections.tsx#L430) |
| `OrderSections.30c6c4a4` | 写死 | 司机和车辆 | 标题 | [OrderSections.tsx:448](../../apps/web/src/pages/book/OrderSections.tsx#L448) |
| `OrderSections.be2a4160` | 写死 | 司机 | 名称 | [OrderSections.tsx:452](../../apps/web/src/pages/book/OrderSections.tsx#L452) |
| `OrderSections.78ae6bfa` | 写死 | 用车前 24 小时显示 | 正文 | [OrderSections.tsx:453](../../apps/web/src/pages/book/OrderSections.tsx#L453) |
| `OrderSections.ab8c72ec` | 写死 | 司机电话 | 名称 | [OrderSections.tsx:453](../../apps/web/src/pages/book/OrderSections.tsx#L453) |
| `OrderSections.8202a1ed` | 写死 | 车辆 | 名称 | [OrderSections.tsx:457](../../apps/web/src/pages/book/OrderSections.tsx#L457) |
| `OrderSections.a7b806f5` | 写死 | 已确认落地，司机会按这个时间开始免费等待。 | 文字 | [OrderSections.tsx:480](../../apps/web/src/pages/book/OrderSections.tsx#L480) |
| `OrderSections.40ccd5b6` | 写死 | 确认落地 | 文字 | [OrderSections.tsx:483](../../apps/web/src/pages/book/OrderSections.tsx#L483) |
| `OrderSections.b51ba341` | 写死 | 离航班计划到达还早，落地后再点「我已落地」。 | 文字 | [OrderSections.tsx:483](../../apps/web/src/pages/book/OrderSections.tsx#L483) |
| `OrderSections.604a07c0` | 写死 | 航班落地 | 标题 | [OrderSections.tsx:490](../../apps/web/src/pages/book/OrderSections.tsx#L490) |
| `OrderSections.25654b8a` | 写死 | 计划到达：当地时间 {…} | 正文 | [OrderSections.tsx:492](../../apps/web/src/pages/book/OrderSections.tsx#L492) |
| `OrderSections.874fdc09` | 写死 | 您已确认落地：当地时间 {…}。 | 正文 | [OrderSections.tsx:495](../../apps/web/src/pages/book/OrderSections.tsx#L495) |
| `OrderSections.c5a32b70` | 写死 | 付款后，航班落地时可以在这里点「我已落地」。 | 正文 | [OrderSections.tsx:498](../../apps/web/src/pages/book/OrderSections.tsx#L498) |
| `OrderSections.c21d7aab` | 写死 | 航班落地后请点「我已落地」，司机按这个时间开始免费等待。当地时间 {…} 起可以点。 | 正文 | [OrderSections.tsx:499](../../apps/web/src/pages/book/OrderSections.tsx#L499) |
| `OrderSections.f10ffebd` | 写死 | 确认已落地 | 读屏说明 | [OrderSections.tsx:502](../../apps/web/src/pages/book/OrderSections.tsx#L502)、507 行 |
| `OrderSections.9e9c55c5` | 写死 | 确认您的航班已经落地？时间按现在记录，提交后不能修改。 | 正文 | [OrderSections.tsx:503](../../apps/web/src/pages/book/OrderSections.tsx#L503) |
| `OrderSections.efed6212` | 写死 | 正在提交 | 文字 | [OrderSections.tsx:505](../../apps/web/src/pages/book/OrderSections.tsx#L505)、600、1012 行 |
| `OrderSections.f0aaed77` | 写死 | 还没有 | 按钮 | [OrderSections.tsx:510](../../apps/web/src/pages/book/OrderSections.tsx#L510) |
| `OrderSections.8ebf57b0` | 写死 | 落地后点一下，司机会按这个时间开始免费等待，并知道您快出来了。 | 正文 | [OrderSections.tsx:515](../../apps/web/src/pages/book/OrderSections.tsx#L515) |
| `OrderSections.75dd3eb9` | 写死 | 我已落地 | 按钮 | [OrderSections.tsx:519](../../apps/web/src/pages/book/OrderSections.tsx#L519) |
| `OrderSections.16381122` | 写死 | 请写一下为什么有异议，如「司机没有等那么久」 | 提示 | [OrderSections.tsx:529](../../apps/web/src/pages/book/OrderSections.tsx#L529) |
| `OrderSections.186e9e61` | 写死 | 异议已提交，这一项先不扣款，平台审核后会通知您。 | 文字 | [OrderSections.tsx:549](../../apps/web/src/pages/book/OrderSections.tsx#L549) |
| `OrderSections.edac9183` | 写死 | 提交异议 | 文字 | [OrderSections.tsx:552](../../apps/web/src/pages/book/OrderSections.tsx#L552)、602 行 |
| `OrderSections.657dcb72` | 写死 | 如果有异议，请在当地时间 {…} 前提出；没有异议到时会从下单时保存的银行卡扣款。 | 正文 | [OrderSections.tsx:565](../../apps/web/src/pages/book/OrderSections.tsx#L565) |
| `OrderSections.7d07f280` | 写死 | 异议的理由 | 表单标签 | [OrderSections.tsx:573](../../apps/web/src/pages/book/OrderSections.tsx#L573) |
| `OrderSections.70b533bb` | 写死 | 写清楚哪里不对，平台审核时会看。 | 正文 | [OrderSections.tsx:597](../../apps/web/src/pages/book/OrderSections.tsx#L597) |
| `OrderSections.a3a2fe3f` | 写死 | 取消 | 按钮 | [OrderSections.tsx:605](../../apps/web/src/pages/book/OrderSections.tsx#L605)、1058 行 |
| `OrderSections.f1213030` | 写死 | 提异议 | 按钮 | [OrderSections.tsx:611](../../apps/web/src/pages/book/OrderSections.tsx#L611) |
| `OrderSections.c7ebc1ae` | 写死 | 服务后的费用 | 标题 | [OrderSections.tsx:620](../../apps/web/src/pages/book/OrderSections.tsx#L620) |
| `OrderSections.1a1a95a3` | 写死 | 服务结束后，司机报了下面的费用（附凭证）。提交后 48 小时内可以提异议；有异议的先不扣款，由平台审核。 | 正文 | [OrderSections.tsx:621](../../apps/web/src/pages/book/OrderSections.tsx#L621) |
| `OrderSections.88f4e335` | 写死 | 上车地址不能为空 | 提示 | [OrderSections.tsx:698](../../apps/web/src/pages/book/OrderSections.tsx#L698) |
| `OrderSections.cc8dc91c` | 写死 | 下车地址不能为空 | 提示 | [OrderSections.tsx:702](../../apps/web/src/pages/book/OrderSections.tsx#L702) |
| `OrderSections.0b1e1cb5` | 写死 | 人数填 1 以上的整数 | 提示 | [OrderSections.tsx:707](../../apps/web/src/pages/book/OrderSections.tsx#L707)、749、795 行 |
| `OrderSections.6e8fd00e` | 写死 | 行李填 0 以上的整数 | 提示 | [OrderSections.tsx:711](../../apps/web/src/pages/book/OrderSections.tsx#L711)、750、796 行 |
| `OrderSections.5ea5d4ea` | 写死 | 用车日期和时间写得不对 | 提示 | [OrderSections.tsx:716](../../apps/web/src/pages/book/OrderSections.tsx#L716) |
| `OrderSections.6ea687d9` | 写死 | 请填写乘车人姓名 | 文字 | [OrderSections.tsx:737](../../apps/web/src/pages/book/OrderSections.tsx#L737)、788 行 |
| `OrderSections.38874190` | 写死 | 请填写带国家码的手机号，如 +81 90-1234-5678、+86 138 0000 0000 | 文字 | [OrderSections.tsx:738](../../apps/web/src/pages/book/OrderSections.tsx#L738)、789 行 |
| `OrderSections.a5c08609` | 写死 | 请填写正确的邮箱，如 name@example.com | 文字 | [OrderSections.tsx:739](../../apps/web/src/pages/book/OrderSections.tsx#L739)、790 行 |
| `OrderSections.397abae2` | 写死 | 接机要填航班号，司机按航班落地时间等候 | 文字 | [OrderSections.tsx:741](../../apps/web/src/pages/book/OrderSections.tsx#L741)、791 行 |
| `OrderSections.338379dd` | 写死 | 航班号的格式不对，如 NH211、MU523 | 文字 | [OrderSections.tsx:742](../../apps/web/src/pages/book/OrderSections.tsx#L742)、791 行 |
| `OrderSections.346fda68` | 写死 | 请填写上车的地址或酒店名 | 文字 | [OrderSections.tsx:747](../../apps/web/src/pages/book/OrderSections.tsx#L747) |
| `OrderSections.bb03d278` | 写死 | 请填写下车的地址或酒店名 | 文字 | [OrderSections.tsx:747](../../apps/web/src/pages/book/OrderSections.tsx#L747) |
| `OrderSections.ead0fba5` | 写死 | 请选择日期 | 文字 | [OrderSections.tsx:752](../../apps/web/src/pages/book/OrderSections.tsx#L752) |
| `OrderSections.e18bd36a` | 写死 | 请选择时间 | 文字 | [OrderSections.tsx:753](../../apps/web/src/pages/book/OrderSections.tsx#L753)、794 行 |
| `OrderSections.1cd2d37b` | 写死 | 这个时间在当地不存在（夏令时调整），请换一个时间 | 文字 | [OrderSections.tsx:755](../../apps/web/src/pages/book/OrderSections.tsx#L755) |
| `OrderSections.ca0d5f1c` | 写死 | 这个时间已经过了，请选一个以后的时间 | 文字 | [OrderSections.tsx:756](../../apps/web/src/pages/book/OrderSections.tsx#L756)、903 行 |
| `OrderSections.17636b62` | 写死 | 太长了 | 文字 | [OrderSections.tsx:778](../../apps/web/src/pages/book/OrderSections.tsx#L778) |
| `OrderSections.5e9aed90` | 写死 | 格式不对 | 文字 | [OrderSections.tsx:778](../../apps/web/src/pages/book/OrderSections.tsx#L778) |
| `OrderSections.b2b444b3` | 写死 | 必填 | 文字 | [OrderSections.tsx:778](../../apps/web/src/pages/book/OrderSections.tsx#L778) |
| `OrderSections.606e3f9d` | 写死 | 请填写{place}的地址或酒店名 | 提示 | [OrderSections.tsx:786](../../apps/web/src/pages/book/OrderSections.tsx#L786) |
| `OrderSections.e6fd1a60` | 写死 | 地址太长了，最多 {addressMax} 个字，写酒店名或主要地址就可以 | 文字 | [OrderSections.tsx:786](../../apps/web/src/pages/book/OrderSections.tsx#L786) |
| `OrderSections.b0c9f479` | 写死 | 姓名太长了，最多 {nameMax} 个字 | 文字 | [OrderSections.tsx:788](../../apps/web/src/pages/book/OrderSections.tsx#L788) |
| `OrderSections.d4d8503b` | 写死 | 请填写带国家码的手机号，如 +81 90-1234-5678 | 提示 | [OrderSections.tsx:789](../../apps/web/src/pages/book/OrderSections.tsx#L789) |
| `OrderSections.72faacfa` | 写死 | 请填写邮箱，如 name@example.com | 提示 | [OrderSections.tsx:790](../../apps/web/src/pages/book/OrderSections.tsx#L790) |
| `OrderSections.9335f538` | 写死 | 邮箱太长了，最多 {emailMax} 个字符 | 文字 | [OrderSections.tsx:790](../../apps/web/src/pages/book/OrderSections.tsx#L790) |
| `OrderSections.43f17569` | 写死 | 上车 | 文字 | [OrderSections.tsx:792](../../apps/web/src/pages/book/OrderSections.tsx#L792) |
| `OrderSections.e91c65a3` | 写死 | 下车 | 文字 | [OrderSections.tsx:793](../../apps/web/src/pages/book/OrderSections.tsx#L793) |
| `OrderSections.90831b97` | 写死 | 用车日期和时间写得不对，请重新选择 | 提示 | [OrderSections.tsx:794](../../apps/web/src/pages/book/OrderSections.tsx#L794) |
| `OrderSections.13d395f0` | 写死 | 请填写人数 | 提示 | [OrderSections.tsx:795](../../apps/web/src/pages/book/OrderSections.tsx#L795) |
| `OrderSections.53a00927` | 写死 | 备注太长了，最多 {notesMax} 个字，请删短一些 | 文字 | [OrderSections.tsx:797](../../apps/web/src/pages/book/OrderSections.tsx#L797) |
| `OrderSections.4aae38d7` | 写死 | {…}没有通过检查，请检查后再提交 | 文字 | [OrderSections.tsx:801](../../apps/web/src/pages/book/OrderSections.tsx#L801) |
| `OrderSections.14e3d53b` | 写死 | 手机号 | 文字 | [OrderSections.tsx:804](../../apps/web/src/pages/book/OrderSections.tsx#L804) |
| `OrderSections.1742c048` | 写死 | 人数 | 文字 | [OrderSections.tsx:804](../../apps/web/src/pages/book/OrderSections.tsx#L804)、984 行 |
| `OrderSections.2bc3ad1a` | 写死 | 下车地址 | 文字 | [OrderSections.tsx:804](../../apps/web/src/pages/book/OrderSections.tsx#L804) |
| `OrderSections.3ce491b0` | 写死 | 上车地址 | 文字 | [OrderSections.tsx:804](../../apps/web/src/pages/book/OrderSections.tsx#L804) |
| `OrderSections.61302c23` | 写死 | 行李 | 文字 | [OrderSections.tsx:804](../../apps/web/src/pages/book/OrderSections.tsx#L804) |
| `OrderSections.8711ed6f` | 写死 | 航班类型 | 文字 | [OrderSections.tsx:804](../../apps/web/src/pages/book/OrderSections.tsx#L804) |
| `OrderSections.8e4cc590` | 写死 | 时间 | 文字 | [OrderSections.tsx:804](../../apps/web/src/pages/book/OrderSections.tsx#L804) |
| `OrderSections.e5294fb5` | 写死 | 邮箱 | 文字 | [OrderSections.tsx:804](../../apps/web/src/pages/book/OrderSections.tsx#L804)、952 行 |
| `OrderSections.e5585719` | 写死 | 日期 | 文字 | [OrderSections.tsx:804](../../apps/web/src/pages/book/OrderSections.tsx#L804) |
| `OrderSections.f61f02e7` | 写死 | 姓名 | 名称 | [OrderSections.tsx:804](../../apps/web/src/pages/book/OrderSections.tsx#L804) |
| `OrderSections.b28fa59a` | 写死 | 有几项没有填好，请看标红的地方。 | 文字 | [OrderSections.tsx:822](../../apps/web/src/pages/book/OrderSections.tsx#L822) |
| `OrderSections.ae70f997` | 写死 | 没有改动。 | 文字 | [OrderSections.tsx:880](../../apps/web/src/pages/book/OrderSections.tsx#L880)、896 行 |
| `OrderSections.4d22c637` | 写死 | 已修改。 | 文字 | [OrderSections.tsx:892](../../apps/web/src/pages/book/OrderSections.tsx#L892) |
| `OrderSections.53bf1de2` | 写死 | 正在补收差价，稍后查看结果。 | 文字 | [OrderSections.tsx:892](../../apps/web/src/pages/book/OrderSections.tsx#L892) |
| `OrderSections.e3d4ad75` | 写死 | 修改已提交，等服务方确认。确认之前原预约仍然有效，结果会发邮件告诉您，也会显示在这里。{…} | 文字 | [OrderSections.tsx:892](../../apps/web/src/pages/book/OrderSections.tsx#L892) |
| `OrderSections.e9599a7c` | 写死 | 姓名、电话、邮箱、备注的修改已直接生效。 | 文字 | [OrderSections.tsx:892](../../apps/web/src/pages/book/OrderSections.tsx#L892) |
| `OrderSections.837bc7bd` | 写死 | 订单刚刚有了变化，请刷新页面后再改一次。 | 文字 | [OrderSections.tsx:897](../../apps/web/src/pages/book/OrderSections.tsx#L897) |
| `OrderSections.394dcf39` | 写死 | 上一次的修改还在等服务方确认。姓名、电话、邮箱随时可以直接改，备注在免费取消期内可以改，其他内容要等这次有结果。 | 文字 | [OrderSections.tsx:898](../../apps/web/src/pages/book/OrderSections.tsx#L898) |
| `OrderSections.35b10142` | 写死 | 提交的内容不符合要求，请检查后重试。 | 文字 | [OrderSections.tsx:912](../../apps/web/src/pages/book/OrderSections.tsx#L912) |
| `OrderSections.d0fe4aff` | 写死 | 有几项没有通过检查，请看标红的地方。 | 文字 | [OrderSections.tsx:912](../../apps/web/src/pages/book/OrderSections.tsx#L912) |
| `OrderSections.98977fe0` | 写死 | 改期后价格变高，补差价没有扣款成功，订单没有修改。可以换一个时间，或取消后重新预订。 | 文字 | [OrderSections.tsx:913](../../apps/web/src/pages/book/OrderSections.tsx#L913) |
| `OrderSections.dca10002` | 写死 | 修改订单 | 文字 | [OrderSections.tsx:914](../../apps/web/src/pages/book/OrderSections.tsx#L914)、921、946 行 |
| `OrderSections.2e159256` | 写死 | 修改待确认：服务方确认之前，原预约仍然有效，用车时间和其他内容都不变。姓名、电话、邮箱随时可以改，备注在免费取消期内可以改，其他内容要等这次有结果。 | 提示 | [OrderSections.tsx:923](../../apps/web/src/pages/book/OrderSections.tsx#L923) |
| `OrderSections.05121723` | 写死 | 您的修改没有通过，原预约不变，补过的差价会原路退回。如果不想继续用车，可以按取消政策在下面取消。 | 提示 | [OrderSections.tsx:924](../../apps/web/src/pages/book/OrderSections.tsx#L924) |
| `OrderSections.4924d700` | 写死 | 您的修改没有通过，原预约不变，补过的差价会原路退回。 | 提示 | [OrderSections.tsx:924](../../apps/web/src/pages/book/OrderSections.tsx#L924) |
| `OrderSections.c0c898ca` | 写死 | 您的修改没有通过，原预约不变，补过的差价会原路退回。如果不想继续用车，可以在下面免费取消。 | 提示 | [OrderSections.tsx:924](../../apps/web/src/pages/book/OrderSections.tsx#L924) |
| `OrderSections.383473c3` | 写死 | 退还 | 正文 | [OrderSections.tsx:933](../../apps/web/src/pages/book/OrderSections.tsx#L933) |
| `OrderSections.6e5ab0d2` | 写死 | 补收 | 正文 | [OrderSections.tsx:933](../../apps/web/src/pages/book/OrderSections.tsx#L933) |
| `OrderSections.8348db0e` | 写死 | 乘车人、航班号随时可以改 | 正文 | [OrderSections.tsx:943](../../apps/web/src/pages/book/OrderSections.tsx#L943) |
| `OrderSections.a00589ca` | 写死 | 乘车人随时可以改 | 正文 | [OrderSections.tsx:943](../../apps/web/src/pages/book/OrderSections.tsx#L943) |
| `OrderSections.f71ed544` | 写死 | {…}；地址、备注、人数行李和用车时间在免费取消期内可以改，改时间会按新时间重新计价（多退少补）。换车型请取消后重新预订。 | 正文 | [OrderSections.tsx:943](../../apps/web/src/pages/book/OrderSections.tsx#L943) |
| `OrderSections.49a502f4` | 写死 | 乘车人姓名 | 名称 | [OrderSections.tsx:950](../../apps/web/src/pages/book/OrderSections.tsx#L950) |
| `OrderSections.b411d21f` | 写死 | 以 + 和国家码开头，如 +81 90-1234-5678 | 说明 | [OrderSections.tsx:951](../../apps/web/src/pages/book/OrderSections.tsx#L951) |
| `OrderSections.be7510f5` | 写死 | 手机号（带国家码） | 名称 | [OrderSections.tsx:951](../../apps/web/src/pages/book/OrderSections.tsx#L951) |
| `OrderSections.24c160de` | 写死 | 如 NH211 | 说明 | [OrderSections.tsx:953](../../apps/web/src/pages/book/OrderSections.tsx#L953) |
| `OrderSections.fa26c2be` | 写死 | 航班号（选填） | 名称 | [OrderSections.tsx:953](../../apps/web/src/pages/book/OrderSections.tsx#L953) |
| `OrderSections.ed3a33cf` | 写死 | 行李（件） | 名称 | [OrderSections.tsx:985](../../apps/web/src/pages/book/OrderSections.tsx#L985) |
| `OrderSections.9d438737` | 写死 | 备注（选填） | 表单标签 | [OrderSections.tsx:990](../../apps/web/src/pages/book/OrderSections.tsx#L990) |
| `OrderSections.519a0f29` | 写死 | 最多 {notesMax} 字 | 正文 | [OrderSections.tsx:1008](../../apps/web/src/pages/book/OrderSections.tsx#L1008) |
| `OrderSections.df615def` | 写死 | 提交修改 | 按钮 | [OrderSections.tsx:1014](../../apps/web/src/pages/book/OrderSections.tsx#L1014) |
| `OrderSections.90ef4cc4` | 写死 | 不改了 | 按钮 | [OrderSections.tsx:1026](../../apps/web/src/pages/book/OrderSections.tsx#L1026) |
| `OrderSections.73c57f43` | 写死 | 订单还没有付款，取消不收任何费用。 | 文字 | [OrderSections.tsx:1040](../../apps/web/src/pages/book/OrderSections.tsx#L1040) |
| `OrderSections.dad027b2` | 写死 | 按取消政策，现在取消免费，全额退还 {…}，原路退回银行卡。 | 文字 | [OrderSections.tsx:1042](../../apps/web/src/pages/book/OrderSections.tsx#L1042) |
| `OrderSections.35fdff9d` | 写死 | 按取消政策，现在取消不退款（取消费 {…}）。 | 文字 | [OrderSections.tsx:1044](../../apps/web/src/pages/book/OrderSections.tsx#L1044) |
| `OrderSections.715af313` | 写死 | 按取消政策，现在取消扣 {…}，退还 {…}，原路退回银行卡。 | 文字 | [OrderSections.tsx:1045](../../apps/web/src/pages/book/OrderSections.tsx#L1045) |
| `OrderSections.18f9e8a9` | 写死 | 退款遇到问题，平台财务会处理并联系您 | 提示 | [OrderSections.tsx:1048](../../apps/web/src/pages/book/OrderSections.tsx#L1048) |
| `OrderSections.adb63e25` | 写死 | 已退款 | 文字 | [OrderSections.tsx:1048](../../apps/web/src/pages/book/OrderSections.tsx#L1048) |
| `OrderSections.c4c988b7` | 写死 | 退款处理中（几天内到账） | 文字 | [OrderSections.tsx:1048](../../apps/web/src/pages/book/OrderSections.tsx#L1048) |
| `OrderSections.3e33e70d` | 写死 | 取消原因 | 名称 | [OrderSections.tsx:1061](../../apps/web/src/pages/book/OrderSections.tsx#L1061) |
| `OrderSections.79c4567e` | 写死 | 已取消 | 正文 | [OrderSections.tsx:1061](../../apps/web/src/pages/book/OrderSections.tsx#L1061) |
| `OrderSections.5c538672` | 写死 | 取消费 | 名称 | [OrderSections.tsx:1062](../../apps/web/src/pages/book/OrderSections.tsx#L1062) |
| `OrderSections.a6a14e10` | 写死 | 退款 | 名称 | [OrderSections.tsx:1063](../../apps/web/src/pages/book/OrderSections.tsx#L1063) |
| `OrderSections.ed63f28d` | 写死 | 这张订单现在不能在网上取消了，请联系客服。 | 文字 | [OrderSections.tsx:1076](../../apps/web/src/pages/book/OrderSections.tsx#L1076) |
| `OrderSections.b3b7cc10` | 写死 | 计算退款 | 文字 | [OrderSections.tsx:1079](../../apps/web/src/pages/book/OrderSections.tsx#L1079) |
| `OrderSections.fd1e8db7` | 写死 | 订单已取消。 | 文字 | [OrderSections.tsx:1091](../../apps/web/src/pages/book/OrderSections.tsx#L1091) |
| `OrderSections.5c1c0e63` | 写死 | 取消订单 | 文字 | [OrderSections.tsx:1094](../../apps/web/src/pages/book/OrderSections.tsx#L1094)、1101、1108 行 |
| `OrderSections.485c8d84` | 写死 | 取消政策：{…}（按订单总价计算）。 | 正文 | [OrderSections.tsx:1103](../../apps/web/src/pages/book/OrderSections.tsx#L1103) |
| `OrderSections.f31998ec` | 写死 | 正在计算 | 文字 | [OrderSections.tsx:1106](../../apps/web/src/pages/book/OrderSections.tsx#L1106) |
| `OrderSections.96f89822` | 写死 | 修改没有被确认，免费取消 | 按钮 | [OrderSections.tsx:1112](../../apps/web/src/pages/book/OrderSections.tsx#L1112) |
| `OrderSections.a44c0768` | 写死 | 确认取消订单 | 读屏说明 | [OrderSections.tsx:1116](../../apps/web/src/pages/book/OrderSections.tsx#L1116)、1122 行 |
| `OrderSections.3a33f659` | 写死 | 取消后不能恢复，要用车需要重新预订。 | 正文 | [OrderSections.tsx:1118](../../apps/web/src/pages/book/OrderSections.tsx#L1118) |
| `OrderSections.fedab93d` | 写死 | 正在取消 | 文字 | [OrderSections.tsx:1120](../../apps/web/src/pages/book/OrderSections.tsx#L1120) |
| `OrderSections.c7644ce6` | 写死 | 不取消了 | 按钮 | [OrderSections.tsx:1125](../../apps/web/src/pages/book/OrderSections.tsx#L1125) |
| `OrderSections.2031d2bf` | 写死 | 需要帮助 | 标题 | [OrderSections.tsx:1142](../../apps/web/src/pages/book/OrderSections.tsx#L1142) |
| `OrderSections.42b6366d` | 写死 | 对订单有疑问、找不到司机，或者要改网上改不了的内容，请打电话给客服。 | 正文 | [OrderSections.tsx:1143](../../apps/web/src/pages/book/OrderSections.tsx#L1143) |
| `OrderSections.b5d8f462` | 写死 | 打电话给客服 {phone} | 链接 | [OrderSections.tsx:1146](../../apps/web/src/pages/book/OrderSections.tsx#L1146) |
| `OrderSections.1a00e9d3` | 写死 | 联系时请提供订单号 {order\_no}。 | 正文 | [OrderSections.tsx:1149](../../apps/web/src/pages/book/OrderSections.tsx#L1149) |

## 多个页面共用：官网的地图选点（SiteMapPicker.tsx）

用在：官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 预订页（/book）

文件：`apps/web/src/pages/book/SiteMapPicker.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `SiteMapPicker.0532bbab` | 写死 | 地图：点一下选{word}位置，或拖动标记；也可以用方向键移动地图、加号减号缩放，再按地图下面的「选地图中间这个位置」 | 读屏说明 | [SiteMapPicker.tsx:134](../../apps/web/src/pages/book/SiteMapPicker.tsx#L134) |
| `SiteMapPicker.4551a538` | 写死 | 放大地图 | 读屏说明 | [SiteMapPicker.tsx:161](../../apps/web/src/pages/book/SiteMapPicker.tsx#L161) |
| `SiteMapPicker.ef19acb1` | 写死 | 缩小地图 | 读屏说明 | [SiteMapPicker.tsx:164](../../apps/web/src/pages/book/SiteMapPicker.tsx#L164) |
| `SiteMapPicker.4ceda6a1` | 写死 | 地图没有加载出来。可以用上面的搜索、常用地点，或直接填写地址和坐标。 | 正文 | [SiteMapPicker.tsx:168](../../apps/web/src/pages/book/SiteMapPicker.tsx#L168) |
| `SiteMapPicker.6df8dc07` | 写死 | 选地图中间这个位置 | 按钮 | [SiteMapPicker.tsx:192](../../apps/web/src/pages/book/SiteMapPicker.tsx#L192) |

## 多个页面共用：新预订页的一个地址框（PlaceField.tsx）

用在：官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 预订页（/book）

文件：`apps/web/src/pages/book/new/PlaceField.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PlaceField.fc872f45` | 写死 | 今天的地址提示次数用完了 | 文字 | [PlaceField.tsx:35](../../apps/web/src/pages/book/new/PlaceField.tsx#L35) |
| `PlaceField.53ffb5ec` | 写死 | 车站 | 文字 | [PlaceField.tsx:53](../../apps/web/src/pages/book/new/PlaceField.tsx#L53) |
| `PlaceField.c00e886a` | 写死 | 机场 | 文字 | [PlaceField.tsx:53](../../apps/web/src/pages/book/new/PlaceField.tsx#L53) |
| `PlaceField.5b6ec7a2` | 写死 | 也可以在地图上选点。 | 文字 | [PlaceField.tsx:59](../../apps/web/src/pages/book/new/PlaceField.tsx#L59) |
| `PlaceField.329919e4` | 写死 | 地址提示暂时用不了 | 文字 | [PlaceField.tsx:181](../../apps/web/src/pages/book/new/PlaceField.tsx#L181) |
| `PlaceField.5cf47b46` | 写死 | {head}，下面只有平台的机场和车站{…} | 文字 | [PlaceField.tsx:183](../../apps/web/src/pages/book/new/PlaceField.tsx#L183) |
| `PlaceField.35330cef` | 写死 | {head}。{…}输入机场、车站的名称。 | 文字 | [PlaceField.tsx:184](../../apps/web/src/pages/book/new/PlaceField.tsx#L184) |
| `PlaceField.6f380d23` | 写死 | 请 | 文字 | [PlaceField.tsx:184](../../apps/web/src/pages/book/new/PlaceField.tsx#L184) |
| `PlaceField.7cde6385` | 写死 | 请在地图上选点，或 | 文字 | [PlaceField.tsx:184](../../apps/web/src/pages/book/new/PlaceField.tsx#L184) |
| `PlaceField.88e17cc3` | 写死 | 地址提示暂时用不了。 | 文字 | [PlaceField.tsx:194](../../apps/web/src/pages/book/new/PlaceField.tsx#L194) |
| `PlaceField.be6f8886` | 写死 | 输入太快了，请稍等几秒再输入。 | 文字 | [PlaceField.tsx:194](../../apps/web/src/pages/book/new/PlaceField.tsx#L194) |
| `PlaceField.05a93f14` | 写死 | {PLACES\_DAILY\_LIMIT\_TEXT}，没有取到这个地点的位置，请选平台的机场、车站。 | 文字 | [PlaceField.tsx:221](../../apps/web/src/pages/book/new/PlaceField.tsx#L221) |
| `PlaceField.9bb319a9` | 写死 | 没有取到这个地点的位置，请换一个候选。 | 文字 | [PlaceField.tsx:221](../../apps/web/src/pages/book/new/PlaceField.tsx#L221) |
| `PlaceField.5be4fe4c` | 写死 | 没有取到这个地点的位置，请稍后再选一次。{…} | 文字 | [PlaceField.tsx:232](../../apps/web/src/pages/book/new/PlaceField.tsx#L232) |
| `PlaceField.a4c81089` | 写死 | 已选好地图上的位置。 | 文字 | [PlaceField.tsx:248](../../apps/web/src/pages/book/new/PlaceField.tsx#L248)、262、272 行 |
| `PlaceField.406d4d0a` | 写死 | 已填入这个位置的地址。 | 文字 | [PlaceField.tsx:269](../../apps/web/src/pages/book/new/PlaceField.tsx#L269) |
| `PlaceField.f02bd7f9` | 写死 | 请至少输入 2 个字，如酒店名、地址或机场 | 文字 | [PlaceField.tsx:300](../../apps/web/src/pages/book/new/PlaceField.tsx#L300) |
| `PlaceField.4c6234bf` | 写死 | 正在查找… | 文字 | [PlaceField.tsx:301](../../apps/web/src/pages/book/new/PlaceField.tsx#L301) |
| `PlaceField.08d7028f` | 写死 | 找到 {length} 个地点，用 ↑↓ 选择、回车确认。 | 文字 | [PlaceField.tsx:302](../../apps/web/src/pages/book/new/PlaceField.tsx#L302) |
| `PlaceField.35c9d3de` | 写死 | 没有找到。请换个说法（如酒店的英文名、地址）。{…} | 文字 | [PlaceField.tsx:303](../../apps/web/src/pages/book/new/PlaceField.tsx#L303) |
| `PlaceField.1a115143` | 写死 | {label}的候选 | 读屏说明 | [PlaceField.tsx:349](../../apps/web/src/pages/book/new/PlaceField.tsx#L349) |
| `PlaceField.dace264d` | 写死 | 地图加载不出来（可能是网络原因）。请用上面的搜索找到地址；门牌、楼层等可以写在下单时的「给司机的备注」里。 | 正文 | [PlaceField.tsx:371](../../apps/web/src/pages/book/new/PlaceField.tsx#L371) |
| `PlaceField.faffd893` | 写死 | {label}的地图 | 读屏说明 | [PlaceField.tsx:374](../../apps/web/src/pages/book/new/PlaceField.tsx#L374) |
| `PlaceField.9c77f1b0` | 写死 | 在地图上选点 | 按钮 | [PlaceField.tsx:377](../../apps/web/src/pages/book/new/PlaceField.tsx#L377) |
| `PlaceField.ed43cbb1` | 写死 | 收起地图 | 按钮 | [PlaceField.tsx:377](../../apps/web/src/pages/book/new/PlaceField.tsx#L377) |
| `PlaceField.2deee099` | 写死 | 点按输入地址 | 输入框占位 | [PlaceField.tsx:421](../../apps/web/src/pages/book/new/PlaceField.tsx#L421) |

## 多个页面共用：包车的对外价明细（PriceBreakdown.tsx）

用在：官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）

文件：`apps/web/src/pages/book/new/PriceBreakdown.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PriceBreakdown.fd820c27` | 写死 | 价格明细 | 读屏说明 | [PriceBreakdown.tsx:11](../../apps/web/src/pages/book/new/PriceBreakdown.tsx#L11) |
| `PriceBreakdown.b3f98689` | 写死 | 合计 | 正文 | [PriceBreakdown.tsx:23](../../apps/web/src/pages/book/new/PriceBreakdown.tsx#L23) |

## 多个页面共用：「乘客 / 行李」合并栏（TravellersField.tsx）

用在：官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 预订页（/book）

文件：`apps/web/src/pages/book/new/TravellersField.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `TravellersField.89b971f0` | 写死 | 减少{label} | 读屏说明 | [TravellersField.tsx:19](../../apps/web/src/pages/book/new/TravellersField.tsx#L19) |
| `TravellersField.59784381` | 写死 | 增加{label} | 读屏说明 | [TravellersField.tsx:25](../../apps/web/src/pages/book/new/TravellersField.tsx#L25) |
| `TravellersField.aed0c731` | 写死 | 乘客 / 行李 | 正文 | [TravellersField.tsx:41](../../apps/web/src/pages/book/new/TravellersField.tsx#L41) |
| `TravellersField.60d20adb` | 写死 | 人 | 文字 | [TravellersField.tsx:47](../../apps/web/src/pages/book/new/TravellersField.tsx#L47) |
| `TravellersField.92c51fbe` | 写死 | 乘客 | 名称 | [TravellersField.tsx:47](../../apps/web/src/pages/book/new/TravellersField.tsx#L47) |
| `TravellersField.02e7b080` | 写死 | 行李 | 名称 | [TravellersField.tsx:48](../../apps/web/src/pages/book/new/TravellersField.tsx#L48) |
| `TravellersField.d679b22c` | 写死 | 件 | 文字 | [TravellersField.tsx:48](../../apps/web/src/pages/book/new/TravellersField.tsx#L48) |

## 多个页面共用：新预订页的「页面外壳」（booking-shell.tsx）

用在：官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）

文件：`apps/web/src/pages/book/new/booking-shell.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `booking-shell.99e48b29` | 写死 | 预订用车 · NOZOMI 用车 | 标题 | [booking-shell.tsx:44](../../apps/web/src/pages/book/new/booking-shell.tsx#L44) |
| `booking-shell.6bd11448` | 写死 | 预订接送车 | 标题 | [booking-shell.tsx:47](../../apps/web/src/pages/book/new/booking-shell.tsx#L47) |
| `booking-shell.1f18f529` | 写死 | 输入出发地和目的地，马上看到所有车型的一口价 | 正文 | [booking-shell.tsx:48](../../apps/web/src/pages/book/new/booking-shell.tsx#L48) |

## 多个页面共用：手机触屏上的新预订页（full-screen.tsx）

用在：官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 预订页（/book）

文件：`apps/web/src/pages/book/new/full-screen.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `full-screen.6e1e7fb8` | 写死 | 点按选择日期 | 输入框占位 | [full-screen.tsx:105](../../apps/web/src/pages/book/new/full-screen.tsx#L105) |
| `full-screen.fa4b2959` | 写死 | 点按选择时间 | 输入框占位 | [full-screen.tsx:105](../../apps/web/src/pages/book/new/full-screen.tsx#L105) |
| `full-screen.c4e49830` | 写死 | 确定 | 按钮 | [full-screen.tsx:145](../../apps/web/src/pages/book/new/full-screen.tsx#L145) |
