# 登录和账号（两个后台共用）

由 `pnpm copy:export` 从代码生成，不要手改。本区域共 98 条：写死 98 条，已走 key 0 条。列的意思见 [README](README.md)。

## 页面

- [登录](#登录)（27 条）
- [设置密码（接受邀请、重设密码）](#设置密码接受邀请重设密码)（19 条）
- [修改密码](#修改密码)（19 条）
- [两步验证](#两步验证)（20 条）
- [找不到页面](#找不到页面)（4 条）
- [多个页面共用：表单字段的前端校验（validation.ts）](#多个页面共用表单字段的前端校验validationts)（9 条）

## 登录

文件：`apps/web/src/pages/LoginPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `LoginPage.76cdaa92` | 写死 | 邮箱或密码不正确。 | 文字 | [LoginPage.tsx:22](../../apps/web/src/pages/LoginPage.tsx#L22) |
| `LoginPage.824a9dee` | 写死 | 账号已停用，请联系管理员。 | 文字 | [LoginPage.tsx:29](../../apps/web/src/pages/LoginPage.tsx#L29) |
| `LoginPage.3ed0f45b` | 写死 | 你现在所在的网络不在这个账号允许的范围内。请连上公司网络（或指定的网络）后再登录；需要调整的话，请联系超级管理员。 | 文字 | [LoginPage.tsx:32](../../apps/web/src/pages/LoginPage.tsx#L32) |
| `LoginPage.67963935` | 写死 | 验证码不正确或已失效。请重新输入，或重新发送一封。 | 文字 | [LoginPage.tsx:35](../../apps/web/src/pages/LoginPage.tsx#L35) |
| `LoginPage.c57b3425` | 写死 | 现在不能发送邮箱验证码，请用密码登录。 | 文字 | [LoginPage.tsx:37](../../apps/web/src/pages/LoginPage.tsx#L37) |
| `LoginPage.c4c50afa` | 写死 | 密码登录已关闭，请用邮箱验证码登录。 | 文字 | [LoginPage.tsx:39](../../apps/web/src/pages/LoginPage.tsx#L39) |
| `LoginPage.069c214d` | 写死 | 如果这个邮箱是{portalName}的账号，验证码已经发过去了，{…} 分钟内有效。没收到的话看看垃圾邮件；运营后台和供应商后台是两个入口，账号不通用。 | 文字 | [LoginPage.tsx:43](../../apps/web/src/pages/LoginPage.tsx#L43) |
| `LoginPage.6a73f877` | 写死 | 登录已过期，请重新登录。 | 文字 | [LoginPage.tsx:47](../../apps/web/src/pages/LoginPage.tsx#L47) |
| `LoginPage.9fddad92` | 写死 | 已退出登录。 | 文字 | [LoginPage.tsx:48](../../apps/web/src/pages/LoginPage.tsx#L48) |
| `LoginPage.5c3145f7` | 写死 | 密码已设置，请登录。 | 文字 | [LoginPage.tsx:49](../../apps/web/src/pages/LoginPage.tsx#L49) |
| `LoginPage.4a6c06bd` | 写死 | 密码已重设，请用新密码登录。 | 文字 | [LoginPage.tsx:50](../../apps/web/src/pages/LoginPage.tsx#L50) |
| `LoginPage.7f7f4ab4` | 写死 | 登录 · NOZOMI {name} | 浏览器标题 | [LoginPage.tsx:133](../../apps/web/src/pages/LoginPage.tsx#L133) |
| `LoginPage.8e2b1a9d` | 写死 | 系统暂时无法登录，请稍后再试。 | 文字 | [LoginPage.tsx:215](../../apps/web/src/pages/LoginPage.tsx#L215)、306 行 |
| `LoginPage.097bb3df` | 写死 | 系统暂时无法发送验证码，请稍后再试。 | 文字 | [LoginPage.tsx:275](../../apps/web/src/pages/LoginPage.tsx#L275) |
| `LoginPage.1b4cce49` | 写死 | 正在确认登录状态 | 名称 | [LoginPage.tsx:351](../../apps/web/src/pages/LoginPage.tsx#L351) |
| `LoginPage.895755a4` | 写死 | 邮箱 | 名称 | [LoginPage.tsx:358](../../apps/web/src/pages/LoginPage.tsx#L358)、434 行 |
| `LoginPage.4cb9762f` | 写死 | 验证码 | 名称 | [LoginPage.tsx:377](../../apps/web/src/pages/LoginPage.tsx#L377) |
| `LoginPage.7623f675` | 写死 | 正在发送… | 文字 | [LoginPage.tsx:393](../../apps/web/src/pages/LoginPage.tsx#L393)、405 行 |
| `LoginPage.1eb7f69d` | 写死 | 发送验证码 | 按钮 | [LoginPage.tsx:395](../../apps/web/src/pages/LoginPage.tsx#L395) |
| `LoginPage.bfcfb439` | 写死 | 正在登录… | 文字 | [LoginPage.tsx:397](../../apps/web/src/pages/LoginPage.tsx#L397)、461 行 |
| `LoginPage.2b11a684` | 写死 | 登录 | 按钮 | [LoginPage.tsx:399](../../apps/web/src/pages/LoginPage.tsx#L399)、463 行 |
| `LoginPage.196b2a21` | 写死 | 重新发送（{seconds} 秒） | 按钮 | [LoginPage.tsx:406](../../apps/web/src/pages/LoginPage.tsx#L406) |
| `LoginPage.76950c5a` | 写死 | 重新发送 | 按钮 | [LoginPage.tsx:406](../../apps/web/src/pages/LoginPage.tsx#L406) |
| `LoginPage.c2c0fa2d` | 写死 | 换一个邮箱 | 按钮 | [LoginPage.tsx:410](../../apps/web/src/pages/LoginPage.tsx#L410) |
| `LoginPage.164378cb` | 写死 | 改用密码 | 按钮 | [LoginPage.tsx:424](../../apps/web/src/pages/LoginPage.tsx#L424) |
| `LoginPage.6b602fdf` | 写死 | 密码 | 名称 | [LoginPage.tsx:450](../../apps/web/src/pages/LoginPage.tsx#L450) |
| `LoginPage.e9d0459f` | 写死 | 改用邮箱验证码 | 按钮 | [LoginPage.tsx:479](../../apps/web/src/pages/LoginPage.tsx#L479) |

## 设置密码（接受邀请、重设密码）

文件：`apps/web/src/pages/SetPasswordPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `SetPasswordPage.00cd1e54` | 写死 | 设置密码 | 标题 | [SetPasswordPage.tsx:31](../../apps/web/src/pages/SetPasswordPage.tsx#L31)、177 行 |
| `SetPasswordPage.dac6e174` | 写死 | 为你的账号设置登录密码。设置后用收到邀请的邮箱登录。 | 说明 | [SetPasswordPage.tsx:32](../../apps/web/src/pages/SetPasswordPage.tsx#L32) |
| `SetPasswordPage.f093f46b` | 写死 | 设置密码并继续 | 按钮 | [SetPasswordPage.tsx:33](../../apps/web/src/pages/SetPasswordPage.tsx#L33) |
| `SetPasswordPage.598f42f0` | 写死 | 邀请链接已失效 | 标题 | [SetPasswordPage.tsx:34](../../apps/web/src/pages/SetPasswordPage.tsx#L34) |
| `SetPasswordPage.bb4c79b2` | 写死 | 链接可能已过期或已经使用过。请联系邀请你的管理员重新发送。 | 说明 | [SetPasswordPage.tsx:35](../../apps/web/src/pages/SetPasswordPage.tsx#L35) |
| `SetPasswordPage.bbeb1076` | 写死 | 重设密码 | 标题 | [SetPasswordPage.tsx:40](../../apps/web/src/pages/SetPasswordPage.tsx#L40) |
| `SetPasswordPage.7545297e` | 写死 | 为你的账号设置一个新密码。设置后，这个账号在所有设备上的登录都会退出。 | 说明 | [SetPasswordPage.tsx:41](../../apps/web/src/pages/SetPasswordPage.tsx#L41) |
| `SetPasswordPage.d57d724d` | 写死 | 设置新密码并继续 | 按钮 | [SetPasswordPage.tsx:42](../../apps/web/src/pages/SetPasswordPage.tsx#L42) |
| `SetPasswordPage.4a57c7e2` | 写死 | 重置链接已失效 | 标题 | [SetPasswordPage.tsx:43](../../apps/web/src/pages/SetPasswordPage.tsx#L43) |
| `SetPasswordPage.f3ee8d2a` | 写死 | 链接可能已过期或已经使用过。请联系管理员重新发送。 | 说明 | [SetPasswordPage.tsx:44](../../apps/web/src/pages/SetPasswordPage.tsx#L44) |
| `SetPasswordPage.a8fddcf0` | 写死 | 去登录 | 按钮 | [SetPasswordPage.tsx:111](../../apps/web/src/pages/SetPasswordPage.tsx#L111) |
| `SetPasswordPage.12d7a040` | 写死 | 正在核对链接 | 名称 | [SetPasswordPage.tsx:121](../../apps/web/src/pages/SetPasswordPage.tsx#L121) |
| `SetPasswordPage.77f27563` | 写死 | 加载失败 | 标题 | [SetPasswordPage.tsx:131](../../apps/web/src/pages/SetPasswordPage.tsx#L131) |
| `SetPasswordPage.373210c3` | 写死 | 请检查网络后重试。 | 说明 | [SetPasswordPage.tsx:132](../../apps/web/src/pages/SetPasswordPage.tsx#L132) |
| `SetPasswordPage.d926e285` | 写死 | 重试 | 按钮 | [SetPasswordPage.tsx:136](../../apps/web/src/pages/SetPasswordPage.tsx#L136) |
| `SetPasswordPage.c7c46a90` | 写死 | 密码不符合要求，请换一个再试。 | 错误提示 | [SetPasswordPage.tsx:174](../../apps/web/src/pages/SetPasswordPage.tsx#L174) |
| `SetPasswordPage.a8d08f75` | 写死 | 新密码 | 名称 | [SetPasswordPage.tsx:190](../../apps/web/src/pages/SetPasswordPage.tsx#L190) |
| `SetPasswordPage.7fd9ed91` | 写死 | 再输入一次 | 名称 | [SetPasswordPage.tsx:209](../../apps/web/src/pages/SetPasswordPage.tsx#L209) |
| `SetPasswordPage.37647e98` | 写死 | 正在设置… | 文字 | [SetPasswordPage.tsx:223](../../apps/web/src/pages/SetPasswordPage.tsx#L223) |

## 修改密码

文件：`apps/web/src/pages/ChangePasswordPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ChangePasswordPage.46662d1d` | 写死 | 当前密码 | 名称 | [ChangePasswordPage.tsx:26](../../apps/web/src/pages/ChangePasswordPage.tsx#L26) |
| `ChangePasswordPage.5a432cbd` | 写死 | 临时密码 | 名称 | [ChangePasswordPage.tsx:26](../../apps/web/src/pages/ChangePasswordPage.tsx#L26) |
| `ChangePasswordPage.23369107` | 写死 | 修改密码 | 标题 | [ChangePasswordPage.tsx:27](../../apps/web/src/pages/ChangePasswordPage.tsx#L27)、103 行 |
| `ChangePasswordPage.97261bd3` | 写死 | 设置新密码 | 标题 | [ChangePasswordPage.tsx:27](../../apps/web/src/pages/ChangePasswordPage.tsx#L27) |
| `ChangePasswordPage.ea3d9298` | 写死 | 请输入{currentName} | 提示 | [ChangePasswordPage.tsx:48](../../apps/web/src/pages/ChangePasswordPage.tsx#L48) |
| `ChangePasswordPage.8b1760b0` | 写死 | 新密码已生效，临时密码已作废。 | 提示 | [ChangePasswordPage.tsx:78](../../apps/web/src/pages/ChangePasswordPage.tsx#L78) |
| `ChangePasswordPage.756397ee` | 写死 | 密码已修改。这个账号在其他设备上的登录已全部退出。 | 文字 | [ChangePasswordPage.tsx:88](../../apps/web/src/pages/ChangePasswordPage.tsx#L88) |
| `ChangePasswordPage.d568ab3e` | 写死 | {currentName}不正确，请重新输入 | 错误提示 | [ChangePasswordPage.tsx:92](../../apps/web/src/pages/ChangePasswordPage.tsx#L92) |
| `ChangePasswordPage.55a7c984` | 写死 | 新密码不能和{currentName}相同 | 错误提示 | [ChangePasswordPage.tsx:96](../../apps/web/src/pages/ChangePasswordPage.tsx#L96) |
| `ChangePasswordPage.91385633` | 写死 | 密码不符合要求，请换一个再试。 | 错误提示 | [ChangePasswordPage.tsx:100](../../apps/web/src/pages/ChangePasswordPage.tsx#L100) |
| `ChangePasswordPage.48e8a72f` | 写死 | 你正在使用临时密码，请先设置新密码。设置完成前不能使用其他功能。 | 提示 | [ChangePasswordPage.tsx:115](../../apps/web/src/pages/ChangePasswordPage.tsx#L115) |
| `ChangePasswordPage.15acecf7` | 写死 | 加载失败 | 标题 | [ChangePasswordPage.tsx:121](../../apps/web/src/pages/ChangePasswordPage.tsx#L121) |
| `ChangePasswordPage.0a0a162e` | 写死 | 请检查网络后重试。 | 说明 | [ChangePasswordPage.tsx:122](../../apps/web/src/pages/ChangePasswordPage.tsx#L122) |
| `ChangePasswordPage.afddec43` | 写死 | 重试 | 按钮 | [ChangePasswordPage.tsx:126](../../apps/web/src/pages/ChangePasswordPage.tsx#L126) |
| `ChangePasswordPage.c3a4521a` | 写死 | 就是别人交给你的那串临时密码，区分大小写，中间的连字符也要输入。 | 说明 | [ChangePasswordPage.tsx:139](../../apps/web/src/pages/ChangePasswordPage.tsx#L139) |
| `ChangePasswordPage.b8e68a52` | 写死 | 新密码 | 名称 | [ChangePasswordPage.tsx:164](../../apps/web/src/pages/ChangePasswordPage.tsx#L164) |
| `ChangePasswordPage.c60afea4` | 写死 | 再输入一次新密码 | 名称 | [ChangePasswordPage.tsx:182](../../apps/web/src/pages/ChangePasswordPage.tsx#L182) |
| `ChangePasswordPage.cac24b49` | 写死 | 保存中… | 文字 | [ChangePasswordPage.tsx:195](../../apps/web/src/pages/ChangePasswordPage.tsx#L195) |
| `ChangePasswordPage.4cdd6bd5` | 写死 | 保存新密码 | 按钮 | [ChangePasswordPage.tsx:197](../../apps/web/src/pages/ChangePasswordPage.tsx#L197) |

## 两步验证

文件：`apps/web/src/pages/SecondFactorPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `SecondFactorPage.5778c9d4` | 写死 | 两步验证 · NOZOMI 运营后台 | 浏览器标题 | [SecondFactorPage.tsx:22](../../apps/web/src/pages/SecondFactorPage.tsx#L22) |
| `SecondFactorPage.ca17cc25` | 写死 | 绑定两步验证 · NOZOMI 运营后台 | 浏览器标题 | [SecondFactorPage.tsx:22](../../apps/web/src/pages/SecondFactorPage.tsx#L22) |
| `SecondFactorPage.81888192` | 写死 | 两步验证 | 标题 | [SecondFactorPage.tsx:26](../../apps/web/src/pages/SecondFactorPage.tsx#L26) |
| `SecondFactorPage.e7ad6f4e` | 写死 | 绑定两步验证 | 标题 | [SecondFactorPage.tsx:26](../../apps/web/src/pages/SecondFactorPage.tsx#L26) |
| `SecondFactorPage.eea4133e` | 写死 | 退出登录 | 按钮 | [SecondFactorPage.tsx:35](../../apps/web/src/pages/SecondFactorPage.tsx#L35) |
| `SecondFactorPage.04850cce` | 写死 | 恢复码已经用完了。 | 正文 | [SecondFactorPage.tsx:82](../../apps/web/src/pages/SecondFactorPage.tsx#L82) |
| `SecondFactorPage.74ac76ee` | 写死 | 恢复码只剩 {remaining} 个了。 | 正文 | [SecondFactorPage.tsx:82](../../apps/web/src/pages/SecondFactorPage.tsx#L82) |
| `SecondFactorPage.49eb3aa2` | 写死 | 进去以后请在右上角账号菜单的「账号安全」里重新生成一组，或者换上新手机的验证器。 | 正文 | [SecondFactorPage.tsx:83](../../apps/web/src/pages/SecondFactorPage.tsx#L83) |
| `SecondFactorPage.d1598386` | 写死 | 知道了，继续 | 按钮 | [SecondFactorPage.tsx:88](../../apps/web/src/pages/SecondFactorPage.tsx#L88) |
| `SecondFactorPage.42429e3e` | 写死 | 输入你保存的恢复码中的一个。用过的恢复码就作废了。 | 正文 | [SecondFactorPage.tsx:95](../../apps/web/src/pages/SecondFactorPage.tsx#L95) |
| `SecondFactorPage.ef5fb3bf` | 写死 | 为了保护平台数据，运营后台每次登录都要输入验证器上的动态码。 | 正文 | [SecondFactorPage.tsx:95](../../apps/web/src/pages/SecondFactorPage.tsx#L95) |
| `SecondFactorPage.02e68d1e` | 写死 | 恢复码 | 名称 | [SecondFactorPage.tsx:100](../../apps/web/src/pages/SecondFactorPage.tsx#L100) |
| `SecondFactorPage.3a80ece1` | 写死 | 正在验证… | 文字 | [SecondFactorPage.tsx:115](../../apps/web/src/pages/SecondFactorPage.tsx#L115) |
| `SecondFactorPage.32aa7e92` | 写死 | 验证 | 按钮 | [SecondFactorPage.tsx:117](../../apps/web/src/pages/SecondFactorPage.tsx#L117) |
| `SecondFactorPage.80e29453` | 写死 | 用验证器的动态码 | 按钮 | [SecondFactorPage.tsx:130](../../apps/web/src/pages/SecondFactorPage.tsx#L130) |
| `SecondFactorPage.dc9d5570` | 写死 | 手机不在身边？用恢复码 | 按钮 | [SecondFactorPage.tsx:130](../../apps/web/src/pages/SecondFactorPage.tsx#L130) |
| `SecondFactorPage.29722667` | 写死 | 恢复码也找不到了：请另一位超级管理员在「平台员工」里重置你的两步验证。 | 正文 | [SecondFactorPage.tsx:133](../../apps/web/src/pages/SecondFactorPage.tsx#L133) |
| `SecondFactorPage.71268888` | 写死 | 重试 | 按钮 | [SecondFactorPage.tsx:189](../../apps/web/src/pages/SecondFactorPage.tsx#L189) |
| `SecondFactorPage.40dffa6b` | 写死 | 正在生成二维码 | 名称 | [SecondFactorPage.tsx:193](../../apps/web/src/pages/SecondFactorPage.tsx#L193) |
| `SecondFactorPage.8992c3e9` | 写死 | 运营后台必须开启两步验证：以后每次登录，除了密码，还要输入手机验证器上的 6 位动态码。只需要设置这一次。 | 正文 | [SecondFactorPage.tsx:196](../../apps/web/src/pages/SecondFactorPage.tsx#L196) |

## 找不到页面

文件：`apps/web/src/pages/NotFoundPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `NotFoundPage.c8147a8d` | 写死 | 找不到这个页面 · NOZOMI {name} | 浏览器标题 | [NotFoundPage.tsx:10](../../apps/web/src/pages/NotFoundPage.tsx#L10) |
| `NotFoundPage.3d4deec7` | 写死 | 找不到这个页面 | 名称 | [NotFoundPage.tsx:12](../../apps/web/src/pages/NotFoundPage.tsx#L12)、16 行 |
| `NotFoundPage.dd9ee831` | 写死 | 它可能已被删除，或链接有误。 | 说明 | [NotFoundPage.tsx:17](../../apps/web/src/pages/NotFoundPage.tsx#L17) |
| `NotFoundPage.e6998b59` | 写死 | 回到首页 | 按钮 | [NotFoundPage.tsx:21](../../apps/web/src/pages/NotFoundPage.tsx#L21) |

## 多个页面共用：表单字段的前端校验（validation.ts）

用在：登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 登录；登录和账号（两个后台共用） · 设置密码（接受邀请、重设密码）

文件：`apps/web/src/lib/validation.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `validation.ec7db13f` | 写死 | 请输入邮箱 | 文字 | [validation.ts:11](../../apps/web/src/lib/validation.ts#L11) |
| `validation.f340b3c9` | 写死 | 邮箱格式不正确 | 文字 | [validation.ts:12](../../apps/web/src/lib/validation.ts#L12) |
| `validation.13852e3a` | 写死 | 请输入密码 | 文字 | [validation.ts:17](../../apps/web/src/lib/validation.ts#L17) |
| `validation.a8d5937d` | 写死 | 请输入验证码 | 文字 | [validation.ts:30](../../apps/web/src/lib/validation.ts#L30) |
| `validation.7d952e7b` | 写死 | 验证码是 6 位数字 | 文字 | [validation.ts:31](../../apps/web/src/lib/validation.ts#L31) |
| `validation.aa1153b7` | 写死 | 请输入新密码 | 文字 | [validation.ts:36](../../apps/web/src/lib/validation.ts#L36) |
| `validation.e6035bfd` | 写死 | 请再输入一次新密码 | 文字 | [validation.ts:41](../../apps/web/src/lib/validation.ts#L41) |
| `validation.ef42b5ef` | 写死 | 两次输入的密码不一致 | 文字 | [validation.ts:42](../../apps/web/src/lib/validation.ts#L42) |
| `validation.8ab07748` | 写死 | 至少 {PASSWORD\_MIN\_LENGTH} 个字符，包含小写字母、大写字母、数字、符号中的至少三类，不能包含邮箱名。 | 说明 | [validation.ts:47](../../apps/web/src/lib/validation.ts#L47) |
