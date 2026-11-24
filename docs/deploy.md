# 部署与运维手册

给项目负责人看的操作说明：第一次怎么上线、平时怎么部署、怎么看状态、出问题怎么办、备份在哪、怎么恢复。技术决策见 `docs/adr/0007-vps-deployment.md`，每一项密钥去哪里找见 `docs/secrets.md`。

**一句话**：代码合并到 main 并且自动检查通过后，会自动部署到测试环境；正式环境要你在 GitHub 上手动点一次并批准。新版本如果起不来，会自动换回上一个版本。

服务器上每个环境的东西都在一个目录里（下文用「环境目录」指它）：

- 测试环境：`/opt/nozomi/staging/`
- 正式环境：`/opt/nozomi/production/`

**服务器上已经跑着别的网站**（80 和 443 端口已经被占用）时，做法有几处不同：先读「八、服务器上已有别的网站时」，再回来按第一节做。

## 一、第一次上线（每台服务器做一次）

按顺序做。每一步都只需要你在网页上点，或在自己电脑上运行一条命令；**不需要把任何密钥发给 Claude**。

### 1. 准备服务器和域名

1. 一台 VPS：系统选 Ubuntu 22.04 或 24.04（CentOS Stream / RHEL / Rocky Linux / AlmaLinux 的 9、10 也支持），至少 2 核 CPU、4 GB 内存、40 GB 硬盘。
2. 域名：在域名服务商的 DNS 设置里加一条 **A 记录**，指向这台 VPS 的公网 IP。
3. VPS 服务商控制台的防火墙（如果开了的话）：放行 SSH 端口（默认 22）、80、443。

### 2. 生成一把部署专用的钥匙

在你自己的电脑上打开终端，运行：

```bash
ssh-keygen -t ed25519 -f nozomi-deploy -N "" -C nozomi-deploy
```

会得到两个文件：`nozomi-deploy`（私钥，下一步填进 GitHub）和 `nozomi-deploy.pub`（公钥，填到服务器）。

把**公钥**加到服务器上：Hostinger 的入口是 hPanel → VPS → 管理 → 设置 → SSH 密钥 → 添加，把 `nozomi-deploy.pub` 的那一行粘贴进去。

再在自己电脑上运行下面这条命令，记下输出（下一步要用）：

```bash
ssh-keyscan -p SSH端口 服务器IP
```

### 3. 在 GitHub 上填这个环境的配置

仓库页面 → Settings → Environments → 新建环境（名字必须是 `staging` 或 `production`）→ 点进去，按 `docs/secrets.md`「一、填在 GitHub 上的」填：

- Environment secrets 5 项：`VPS_HOST`、`VPS_SSH_PORT`、`VPS_SSH_USER`（**第一次填 `root`**）、`VPS_SSH_PRIVATE_KEY`、`VPS_SSH_KNOWN_HOSTS`
- Environment variables：`APP_DOMAIN`（必填）、`ACME_EMAIL`（可选）。服务器上已有别的网站时再加 `EDGE_MODE` 和 `EDGE_LISTEN`（见第八节）

填完后把电脑上的 `nozomi-deploy` 和 `nozomi-deploy.pub` 两个文件删掉。

正式环境（`production`）另外做两件事：勾上 **Required reviewers** 并选你自己；在 **Deployment branches and tags** 里选 Selected branches 并只加 `main`。

### 4. 运行「服务器初始化」

仓库页面 → Actions → 左侧选 **Server init** → Run workflow → 选环境 → Run。

它会自动完成：安装 Docker（已经装好的不会重装或升级）、创建部署专用账号 `nozomi`、建好环境目录、**自动生成两个数据库密码和登录签名密钥**、开启服务器防火墙（只放行 SSH、80、443）、装好每日数据库备份。大约 3 分钟。可以重复运行，已经生成的密钥不会被覆盖。

它**不会**做的事：不升级系统已有的软件，不改 SSH 的登录设置，不改任何账号的密码。服务器上已有别的网站时（`EDGE_MODE` 是 `behind-proxy`），它也不碰防火墙。

### 5. 把登录账号从 root 换成 nozomi

初始化成功后：Settings → Environments → 对应环境 → 把 `VPS_SSH_USER` 的值改成 `nozomi`。以后部署都用这个专用账号。

### 6. 第一次部署

仓库页面 → Actions → 左侧选 **Deploy** → Run workflow → 选环境 → Run。大约 5 分钟（第一次要申请 HTTPS 证书）。

完成后用浏览器打开 `https://你的域名/health`，看到 `"status":"ok"` 就是上线了。其中 Stripe 和谷歌地图会显示「未配置」——这是正常的，见下一步。

再打开 `https://你的域名/`，应该看到供应商后台的登录页；运营后台的登录页在 `https://你的域名/platform/login`。现在还没有任何账号，下一步创建。

### 7. 创建第一个平台管理员

系统里没有任何预置账号。第一次部署成功后，用部署用户登录服务器，运行（把邮箱和姓名换成你自己的）：

```bash
/opt/nozomi/staging/current/bin/compose.sh exec api node apps/api/src/cli/admin-create.ts --email 你的邮箱 --name 你的姓名
```

按提示输入两遍密码（输入时不显示）。密码至少 12 个字符，大写、小写、数字、符号里至少有三种。之后就可以打开 `https://你的域名/platform/login`，用这个邮箱和密码登录运营后台。

第一次登录时，输完密码后页面会引导你绑定两步验证（ADR 0030）：在手机上装一个验证器 App（Google Authenticator、Microsoft Authenticator 等），扫页面上的二维码，输入 App 里的 6 位数字，然后把页面给出的 10 个恢复码存好。以后每次登录都要输入 App 里的动态码。

忘了密码时，在服务器上运行同样写法的 `admin-reset-password.ts --email 你的邮箱` 重设。
手机和恢复码都丢了、又没有另一位超级管理员能在后台帮你重置时，运行同样写法的 `admin-reset-2fa.ts --email 你的邮箱`，下次登录重新绑定。
被自己设的 IP 白名单挡在门外时，运行 `admin-clear-ip-allowlist.ts --email 你的邮箱`。

### 8. 以后再做：填 Stripe 和谷歌地图的密钥

这两项不填，程序也能运行（收款、里程报价这两类功能不可用，`/health` 里显示「未配置」）。正式环境开始接单之前必须填好。

**推荐的填法：在运营后台填**（ADR 0041，只有超级管理员能填）：运营后台 → 系统设置 → 系统状态 → 在「谷歌地图」或「Stripe 支付」这一行点「填写」，把密钥粘贴进去保存，再点「测试一下」确认可用。
保存后立即生效，不用登录服务器、不用重新部署。后台填写的优先于服务器 `.env` 里的；在后台点「清空」就回到 `.env` 里的值。每一项去哪里找见 `docs/secrets.md`。

另一种填法是写进服务器的 `.env`：用 `nozomi` 账号登录服务器，编辑环境目录下的 `.env` 文件，把对应的空行填上，然后让它生效：

```bash
/opt/nozomi/staging/current/bin/compose.sh up -d --wait
```

### 9. 以后再做：配置地图底图

供应商后台的区域页面上有地图。不配置底图页面也能用（图形画在空白背景上，旁边有坐标表）；配置之后才有地图背景。

用 `nozomi` 账号登录服务器，编辑环境目录下的 `.env`，填这两行（测试环境用 OpenStreetMap 的免费底图，不需要注册和密钥）：

```
MAP_TILE_URL_TEMPLATE=https://tile.openstreetmap.org/{z}/{x}/{y}.png
MAP_TILE_ATTRIBUTION=© OpenStreetMap 贡献者|https://www.openstreetmap.org/copyright
```

这两行要顶格写成「变量名=值」：不加 `export`、引号，等号两边不留空格，行尾不写注释。写法不标准时下面的命令会停下并说明是哪一行（否则会出现地图一片灰却没有任何报错的情况）。

然后让它生效（和上一节同一条命令）：

```bash
/opt/nozomi/staging/current/bin/compose.sh up -d --wait
```

- 这两项不是密钥，值会发给浏览器。地址填错（不是 `https://` 开头、带了引号或空格）时这条命令会直接报错并说明，不会带着错误的配置启动。
- 网页的安全策略会自动只放行这一个图片来源，不用另外设置；去掉这两行的值再执行一次，就回到没有底图。
- OpenStreetMap 的免费底图不保证可用、在中国大陆的网络下常常很慢，**只适合测试环境**。正式环境用哪家底图需要你定（`docs/adr/0015-areas.md`「地图底图」）。
- 使用它意味着：打开区域页面时，你的浏览器会直接向 OpenStreetMap 的服务器请求地图图片，对方能看到你的 IP 和测试环境的域名（看不到账号、区域内容和页面路径）。

### 10. 正式环境开放预订前：填法律文案的待补项（M9E-24，ADR 0107）

官网和嵌入页有三份日文法律文案（特定商取引法に基づく表記、キャンセルポリシー、プライバシーポリシー），正文是你确认过的稿子（`docs/legal/`）。稿子里【 】的 10 项要在运营后台填：

运营后台 → 官网设置 → 「法律文案的待补项」（只有超级管理员能改）：销售主体、日本国内联系方式、联系邮箱、邮件服务商 / 地图底图服务商 / 服务器服务商及各自所在国、公开日。

- **正式环境没填齐时官网不开放预订**（页面显示「暂未开放」，嵌入页同样不能下单）；填齐后马上开放，不用重新部署。`https://你的域名/health` 里的 `legal` 是 `"state":"complete"` 就是填齐了，`"incomplete"` 是还缺。
- 测试环境不要求填齐：没填的地方页面上显示「未設定」。
- 取消费的表不在这里填：页面按运营后台「取消政策」实时显示。上线前看一眼那里的数字是不是你要的。

## 二、平时怎么部署

- **测试环境**：什么都不用做。代码合并到 main、自动检查（CI）通过后，自动部署。
- **正式环境**：Actions → Deploy → Run workflow → 环境选 `production` → Run，然后在弹出的审批里点 Approve。只能部署 main 上已经通过检查的最新版本。

每次部署自动做这些事：构建两个镜像（后端程序、网页前端）→ 上传到服务器 → 备份数据库 → 核对数据库的应用账号 → 更新数据库结构 → 启动新版本 → 检查健康 → 从外网访问一次确认。切换新旧版本时服务会中断几秒钟。

**数据库的两个账号**（不用你操作，知道有这回事即可）：程序平时运行用的是一个权限最小的「应用账号」，它改不了数据库结构，也改不了、删不了操作日志；更新数据库结构、备份和恢复用另一个「迁移账号」。两个账号的密码都是自动生成的，程序运行的容器里拿不到迁移账号的密码。程序启动时会自己检查：如果发现自己用的是权限过大的账号，会拒绝启动（这次部署按失败处理，线上仍是旧版本）。

**网页前端和后端是一起部署的**：一个版本包含两个镜像——后端程序，以及带着网页前端的反向代理。它们总是同一个版本，一起上线；新版本起不来时一起换回上一个版本。服务器上原来只有后端的那次部署不需要任何处理，照常部署即可，不需要重新运行 Server init。

**从更早的版本升级**（服务器是在有「应用账号」之前初始化的）：照常部署即可，不需要重新运行 Server init，也不需要登录服务器。那一次部署会自动在 `.env` 里补上 `POSTGRES_APP_PASSWORD`、在数据库里建好应用账号，然后切换到新版本。

## 三、怎么看状态

**在 GitHub 上**（不用登录服务器）：Actions → Deploy，最上面一条就是最近一次部署。

| 你看到的 | 意思 |
| --- | --- |
| 绿色，摘要写「已部署到 …」 | 部署成功 |
| 绿色但有黄色警告「测试环境没有部署」，后两步是灰色（已跳过） | 这个环境的服务器信息还没填全，**这次没有部署**。按「第一次上线」补齐 |
| 红色 | 部署失败，见下一节 |

**打开网址**：`https://你的域名/` 是登录页（供应商后台；运营后台在 `/platform/login`）。`https://你的域名/health` 是程序的自检结果。`status` 是 `ok` 表示程序、数据库都正常；`integrations` 里能看到每个第三方账号是「已配置」还是「未配置」。`database` 里的 `errorCode` 如果是 `DB_ROLE_UNSAFE`，意思是程序连数据库用的账号权限过大、程序拒绝用它干活——正常部署不会出现，出现了请告诉 Claude。

**在服务器上**（用 `nozomi` 账号登录）：

```bash
/opt/nozomi/staging/current/bin/compose.sh ps                      # 三个容器（数据库 db、后端 api、反向代理和网页前端 caddy）是否都在运行、是否健康
/opt/nozomi/staging/current/bin/compose.sh logs --tail 100 api     # 程序最近的日志
/opt/nozomi/staging/current/bin/compose.sh exec api node packages/config/src/cli.ts   # 哪些密钥已配置（只显示打了码的片段）
```

## 四、出问题怎么办

部署失败时，Actions 里红色那一步的标题会告诉你是下面哪一种：

| 标题 | 线上现在是什么状态 | 你需要做什么 |
| --- | --- | --- |
| 部署失败，线上仍是旧版本 | 旧版本照常运行，没受影响 | 不用紧急处理。告诉 Claude，修复后重新部署 |
| 部署失败，已自动回退 | 已自动换回上一个版本，运行正常 | 同上 |
| 外网访问不到新版本 | 已自动换回上一个版本（第一次部署时没有可换的，保持原样） | 多半是域名解析、服务商防火墙或证书的问题，按提示检查 |
| （黄色警告）部署成功，但从外网还访问不到 | 只在「服务器上已有别的网站」的模式下出现。新版本已经在运行，**没有回退** | 问题在原有的那个反向代理：还没有把域名转过来，或证书没配好。见第八节 |
| 部署失败，服务可能不可用 | 新旧版本都不健康，**网站可能打不开** | 立即告诉 Claude。可以先尝试下面的「手动回退」 |
| 部署没有执行 / 连接服务器的配置有问题 | 线上没有被改动 | 按提示检查 GitHub 上的环境配置 |

**手动回退到上一个版本**（在服务器上，用 `nozomi` 账号）：

```bash
/opt/nozomi/staging/current/bin/deploy.sh rollback
```

回退只能退一步。退完后要再往前走，就重新部署。

**关于回退的一个限制**：数据库结构只能往前改，不能自动退回。如果失败的那次部署已经改了数据库结构，旧版本程序会因为「不认识新结构」而在 `/health` 里报不健康。这时有两条路：修复后重新部署新版本（通常选这个）；或者用部署前自动做的那份备份恢复数据库（会丢掉备份之后产生的数据，见下一节）。

## 五、备份与恢复

**备份在哪**：服务器上环境目录的 `backups/` 里，例如 `/opt/nozomi/staging/backups/`。文件名带类型和时间（UTC）：

- `…-daily-…`：每天凌晨 03:17（服务器时间）自动做一次
- `…-pre-deploy-…`：每次部署、改数据库结构之前自动做一次
- `…-pre-restore-…`：每次恢复之前自动做一次（万一恢复错了还能回来）

所有备份保留 14 天，过期自动删除。

**重要**：这些整库备份只存在这台服务器上。另外还有一套「恢复到任意时间点」的备份，配好对象存储后会加密传到异地，见下一节。

**手动立刻备份一次**：

```bash
/opt/nozomi/staging/current/bin/backup.sh daily
```

**恢复**（会清空当前数据库，用备份里的数据替换；需要你输入环境名确认）：

```bash
ls -lh /opt/nozomi/staging/backups/                                  # 先看有哪些备份
/opt/nozomi/staging/current/bin/restore.sh /opt/nozomi/staging/backups/要恢复的文件名
```

恢复期间网站不可用（通常不到一分钟）。恢复完成后脚本会自己检查服务是否健康并告诉你结果。恢复用迁移账号导入数据，并在导入前重新核对应用账号；恢复后程序仍然用权限最小的应用账号运行（恢复到一台全新的服务器上也一样）。

**看每日备份有没有在正常运行**：`ls -lh` 看 `backups/` 里最新的 `daily` 文件是不是昨晚的；或运行 `journalctl -t nozomi-backup --since yesterday`。

## 五之二、恢复到任意时间点（ADR 0105）

除了上面每天一份的整库备份，数据库还会**一直**把改动记录（WAL）存下来，每天再做一次「基础备份」。有了这两样，可以把数据库恢复到过去 7 天里的**任意一秒**——比如「今天 10:15 有人误删了一批订单，恢复到 10:14 的样子」。配好对象存储之后，这些都会加密传到另一个地方，服务器整台坏了也找得回来（异地能回到最近 35 天里的任意时间）。

以下命令都用 `nozomi` 账号在服务器上运行。测试环境的路径是 `/opt/nozomi/staging/`，正式环境把 `staging` 换成 `production`。

### 看备份是否正常

```bash
/opt/nozomi/staging/current/bin/pitr-status.sh
```

每一行是「正常」「提示」或「异常」，最后一行是「全部正常」或「共 N 项异常」。它检查：改动记录在不断存下来、没有卡住；最近一次基础备份不超过 26 小时；异地（配了的话）最近一次成功不超过 60 分钟。服务器每 15 分钟自动检查一次，记录在系统日志里：

```bash
journalctl -t nozomi-pitr --since today
```

**测试环境现在的情况**：每天的基础备份和每 15 分钟的检查要**重新运行一次「服务器初始化」**（GitHub → Actions → 服务器初始化，和第一次一样，已有的东西不会被改动）才装上。在那之前，每次部署成功后会自动补做基础备份，所以不重新初始化也能用，只是没有定时检查。

### 恢复到某个时间点

**第 1 步：先恢复到一个临时数据库里看看（网站不受任何影响）**

```bash
/opt/nozomi/staging/current/bin/pitr-restore.sh '2026-11-22 10:14:00+09:00'
```

时间**必须带时区**：东京时间写 `+09:00`，UTC 写 `Z`（例如 `'2026-11-22 01:14:00Z'`）。恢复的结果是：这个时间之前保存的都在，之后的都不在。几 GB 的库通常 5–15 分钟。

完成后它会打印三条命令：怎么进去查看、怎么用它替换正式数据、怎么删掉临时数据库。进去查看：

```bash
/opt/nozomi/staging/current/bin/compose.sh exec pitr-restore psql -U nozomi -d nozomi
```

看错了时间就换一个时间再运行第 1 步（会自动把上一次的临时数据库清掉）。

**第 2 步：确认没问题，用它替换正式数据（网站会中断几分钟）**

```bash
/opt/nozomi/staging/current/bin/pitr-restore.sh '2026-11-22 10:14:00+09:00' --apply
```

会让你输入环境名确认。之后的过程和上一节「恢复」完全一样：停服务 → 先把**当前**的数据再备份一份（`pre-restore`，万一选错了时间还能回来）→ 换成恢复出来的数据 → 启动并检查健康。恢复出来的数据也会留一份在 `backups/` 里（文件名带 `pitr`）。

**不用了就删掉临时数据库**：`/opt/nozomi/staging/current/bin/pitr-restore.sh --cleanup`

**常见提示**：

- 「必须带时区」：时间后面加上 `+09:00` 或 `Z`。
- 「恢复不到比它更早的时间」：本机只保留 7 天；更早的要从异地取回（见下面）。
- 「归档里没有晚于这个时间的提交」：你选的时间之后数据库没有任何新的改动，所以没法确认停在哪里。换一个稍早一点的时间，或者写 `latest`（恢复到最后的时刻）。

### 服务器整台坏了：在新服务器上恢复

1. 按「一、第一次上线」开一台新服务器、初始化、部署（这时数据库是空的）。
2. 把旧服务器 `.env` 里的五项异地配置（`OFFSITE_BACKUP_*`）原样填进新服务器的 `.env`——加密口令用你另外保存的那一份。
3. 从异地取回：

```bash
/opt/nozomi/production/current/bin/pitr-offsite.sh fetch
```

   最后几行会列出「取回来的」数据库实例和要用的命令，形如 `pitr-restore.sh latest --system 7412…`（那串数字是旧服务器上数据库的编号）。

4. 照它给的命令恢复，先看一眼，确认后替换：

```bash
/opt/nozomi/production/current/bin/pitr-restore.sh latest --system <上一步显示的编号>
/opt/nozomi/production/current/bin/pitr-restore.sh latest --system <上一步显示的编号> --apply
```

`latest` 是异地最后一次同步时的样子（最多比出事时早 16 分钟左右）；也可以把 `latest` 换成一个具体时间。**一定要带 `--system`**：新服务器自己也有一份（空的）备份，不带的话 `latest` 会选到它。

### 需要你做的（异地备份，正式上线前必须做）

在这之前，「恢复到任意时间点」的备份只在服务器本机，服务器整台坏了会一起丢。

1. **选一家对象存储**（S3 兼容的都可以，以后可以换）。按几 GB 的库估算，异地大约要存 10–50 GB：

   | 服务商 | 大约每月费用 | 说明 |
   | --- | --- | --- |
   | Cloudflare R2（推荐） | 0–1 美元 | 每月前 10 GB 免费；取回数据不收流量费 |
   | Backblaze B2 | 0–0.3 美元 | 每 TB 每月约 6 美元，前 10 GB 免费；取回流量每月有免费额度 |
   | AWS S3（东京区域） | 约 0.3–1.3 美元 | 每 GB 每月约 0.025 美元；取回要另付流量费（每 GB 约 0.11 美元） |

   建议选和服务器**不是同一家**的服务商。不推荐 Wasabi（最少按 1 TB 收费）。

2. **在它的控制台里**：建一个存储桶（例如 `nozomi-backup`，不要公开）；建一把**只能读写这一个存储桶**的访问密钥。

3. **自己生成一个加密口令**：在密码管理器里生成一个 40 位以上的随机密码，**保存在密码管理器里**。服务器整台没了的时候，没有这个口令，异地备份谁也解不开。

4. **用 `nozomi` 账号登录服务器，编辑 `.env`**（`/opt/nozomi/production/.env`，测试环境是 `/opt/nozomi/staging/.env`），填这几项（填法见 `docs/secrets.md`）：

   ```
   OFFSITE_BACKUP_REPOSITORY=s3:https://<服务商给的 S3 地址>/<存储桶名>/production
   OFFSITE_BACKUP_ACCESS_KEY_ID=<访问密钥 ID>
   OFFSITE_BACKUP_SECRET_ACCESS_KEY=<访问密钥>
   OFFSITE_BACKUP_PASSWORD=<第 3 步的加密口令>
   ```

   不用重新部署，下一个 15 分钟就会开始同步。想立刻试一次：`/opt/nozomi/production/current/bin/pitr-offsite.sh sync`，然后运行 `pitr-status.sh` 看到「异地备份最近一次成功」就好了。**不要把这些值发在聊天里。**

5. **可选：开一个「心跳」监控，备份停了会通知你**。在 Healthchecks（免费版就够）这类监控服务里建一个检查，周期 15 分钟、宽限 30 分钟，把它给的地址填进 `.env` 的 `BACKUP_HEARTBEAT_URL`。备份全部正常时服务器每 15 分钟访问它一次；超过 45 分钟没收到（备份停了、服务器宕机），它会发邮件给你。

测试环境可以不配异地（不配照常工作）；**正式环境没配时，备份状态会一直显示「异常」**。

### 每季度演练一次

在测试环境选一个过去的时间，做上面的「第 1 步」（不加 `--apply`，不影响测试环境），进去看数据是不是那个时间的样子，然后 `--cleanup`。正式环境上线后同样做一遍。CI 每次也会在容器里自动演练一遍（`deploy/ci/pitr-drill.sh`）。

## 六、可选的加固（由你决定，不是必须）

初始化流程**不会**替你改下面这些，因为改错了可能把你自己锁在服务器外面。确认用 `nozomi` 账号部署正常之后，可以考虑：

1. **禁止 root 用 SSH 登录、禁止密码登录**（只允许密钥）。做之前先确认你自己有一把能登录的密钥，并保留服务商控制台的网页终端作为后路。注意：做了之后再运行「服务器初始化」需要临时恢复 root 登录。
2. **定期更换部署钥匙**：重新做「第一次上线」的第 2、3 步，再运行一次 Server init（它会把新公钥加进 `nozomi` 账号），最后登录服务器从 `/home/nozomi/.ssh/authorized_keys` 里删掉旧的那一行。
3. 怀疑部署钥匙泄露时：立即从服务器的 `authorized_keys` 里删掉对应那一行，再按上一条换新的。

## 七、需要知道的几件事

- `.env` 里的 `POSTGRES_PASSWORD`、`POSTGRES_APP_PASSWORD` 和 `AUTH_JWT_SECRET` 是自动生成的，**不要改、不要删**。数据库是用这些密码建的，改了程序就连不上。
- 部署账号 `nozomi` 能管理服务器上的全部容器，权限很大；它没有密码，只能用部署钥匙登录。所以部署钥匙只放在 GitHub 的 Environment secrets 里，不要另存。
- 服务器上只保留当前和上一个两个版本，更早的自动清理。
- 测试环境服务器信息没填全时，GitHub 的 Deployments 列表里仍会多出一条 staging 记录（那是「检查配置」这一步留下的），是否真的部署了以 Actions 里的摘要为准。

### 更换数据加密密钥（`DATA_ENCRYPTION_KEY`，ADR 0106）

这把密钥加密了乘客的姓名电话邮箱、人工报价的联系方式、供应商的收款账号和 Webhook 签名密钥、平台员工的两步验证密钥、后台填写的第三方密钥。**平时不要动它**；怀疑泄露时按下面换，负责人不用参与。**不能直接改 `DATA_ENCRYPTION_KEY` 的值**：那样以上数据全部解不开。

换的时候要同时留着旧密钥，等旧数据都重新加密完再删。用部署用户登录服务器（环境名按实际替换），全程不在屏幕上显示密钥：

```bash
cd /opt/nozomi/staging
cp -p .env .env.before-key-rotation                      # 留一份，回退用；权限保持 600
old="$(sed -n 's/^DATA_ENCRYPTION_KEY=//p' .env)"
new="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
sed -i "s/^DATA_ENCRYPTION_KEY=.*/DATA_ENCRYPTION_KEY=$new/" .env
printf 'DATA_ENCRYPTION_KEY_PREVIOUS=%s\n' "$old" >>.env
unset old new
current/bin/compose.sh up -d api                         # 带着两把密钥重启：旧数据照常能读
current/bin/compose.sh run --rm data-key-rotation        # 只看数量：每张表还有几行是旧密钥、几行两把都解不开
current/bin/compose.sh run --rm data-key-rotation --execute
current/bin/compose.sh exec api node apps/api/src/cli/passenger-backfill.ts --verify
```

- `--execute` 最后一行是「全部换成新密钥了」，`--verify` 是「数据全部一致」，才删旧密钥：从 `.env` 删掉 `DATA_ENCRYPTION_KEY_PREVIOUS` 那一行，再 `current/bin/compose.sh up -d api`。
- 还有「旧密钥」的行：重新运行 `--execute`（刚好被业务锁着的行这一轮会跳过）。有「两把都解不开」的行：先不要删旧密钥，把输出贴给 Claude。
- 期间要部署新版本照常部署：`.env` 里的两行会一起带上。
- **回退**（删旧密钥之前随时可以，数据不丢）：把 `.env` 里两行的值对调（旧的放回 `DATA_ENCRYPTION_KEY`、新的放到 `DATA_ENCRYPTION_KEY_PREVIOUS`），`current/bin/compose.sh up -d api`，再 `run --rm data-key-rotation --execute` 换回旧密钥，最后删掉 `DATA_ENCRYPTION_KEY_PREVIOUS`。**不要直接拿 `.env.before-key-rotation` 覆盖回去**：已经换成新密钥的行会读不出来。
- `.env.before-key-rotation` 里是旧密钥：**和换密钥之前的数据库备份一起保管，到这些备份过期再删**；用旧备份恢复时要用旧密钥。
- 收款账号：换的过程中转账文件照常生成和下载，不用先处理完。

### 乘客信息加密存储（ADR 0057）

乘客的姓名、电话、邮箱现在同时存明文和密文，读的是密文。**不用填新的密钥**，用现有的 `DATA_ENCRYPTION_KEY`。新版本部署后，后台任务会在 30 秒内开始把旧数据加密，之后每小时查一次。

**看进度**（用部署用户登录服务器，环境名按实际替换）：

```bash
/opt/nozomi/staging/current/bin/compose.sh exec api node apps/api/src/cli/passenger-backfill.ts            # 默认只看数量，不改数据
/opt/nozomi/staging/current/bin/compose.sh exec api node apps/api/src/cli/passenger-backfill.ts --execute  # 手工跑一轮，可以反复运行，可以中断
/opt/nozomi/staging/current/bin/compose.sh exec api node apps/api/src/cli/passenger-backfill.ts --verify   # 核对每行密文解得开、和明文一致，只读
```

**出问题时退回明文**（第 6 步之前随时可以，不丢数据）：

1. 把 `PASSENGER_READ_SOURCE=plaintext` 写进服务器的 `.env`，重启 API。读取立刻回到明文列，密文继续写。明文列只有占位 `[已加密]` 的行（「不再写明文」 那段时间写的）仍读密文，所以来回切读到的内容相同。
2. 如果要退回旧版本的代码：直接部署旧版本，迁移 0200 只加了列，不影响旧代码。旧代码只改明文，数据库的触发器会让对应的密文作废。
3. 修好后把 `PASSENGER_READ_SOURCE` 改回 `ciphertext`（或删掉这一行），重新部署新版本。回填任务会把旧版本期间写的内容补上。

**后续步骤：清掉明文（第 6 步，这一轮没有做，不可逆）**。要满足这些才能做，并且先备份：

1. 至少观察一个发布周期，日志里没有 `passenger.decrypt_failed`、`passenger.cipher_mismatch`。
2. `passenger-backfill.ts --verify` 输出「全部一致」。
3. 负责人知道：运营按乘客筛选将只认整串的邮箱、电话、姓名，不能再部分匹配（ADR 0057「运营筛选」）。
4. 密钥已经和数据库备份分开保管，做过一次「只有备份没有密钥解不开、备份加密钥能恢复」的恢复演练。

然后：

1. 把 `PASSENGER_PLAINTEXT_WRITE=false` 写进 `.env` 重启，新写入的明文列只有占位 `[已加密]`。服务启动后会自动核对一次，还有没回填或不一致的行就记错误日志 `passenger.plaintext_retired_not_ready`（不挡启动），看到就先把开关改回 `true`。
2. 再跑一次 `--verify`。
3. 新增一个迁移：把四个明文位置（`orders.passenger`、`order_changes` 的 `before` / `after` 里的 `passenger`、`webhook_deliveries.event_data` 里的 `passenger`、给客人的 `notifications.recipient`）换成占位，去掉四个 `*_cipher_sync` 触发器。这个迁移还没写。
4. 按备份周期淘汰加密之前的旧备份，旧备份里仍有明文。

## 八、服务器上已有别的网站时

**什么时候看这一节**：这台服务器上已经有别的网站或服务在运行，80 和 443 端口被它的反向代理（通常是 nginx）占着，而你希望两套共存。目前的测试环境就是这种情况。正式环境是独立的服务器，不需要这一节。

**怎么共存**：原来的 nginx 继续占 80 和 443，HTTPS 证书也继续由它负责。NOZOMI 只在服务器「本机内部」的一个端口上提供服务（外网直接连不到），由那个 nginx 按域名把请求转过来。NOZOMI 用自己独立的数据库、容器和目录，不碰原有服务的任何东西；隔离的边界和已知限制见 ADR 0007「与其他服务共用一台机器」。

### 1. 多设两个变量

在 GitHub 这个环境的 **Environment variables** 里（手工部署时是同名的环境变量）：

| 变量名 | 填什么 |
| --- | --- |
| `EDGE_MODE` | `behind-proxy` |
| `EDGE_LISTEN` | `127.0.0.1:18080`。前半段固定是 `127.0.0.1`（只在本机内部可见）；后半段挑一个这台机器上没人用的端口，18080 被占了就换一个 |

`APP_DOMAIN` 照常填 NOZOMI 用的域名。`ACME_EMAIL` 在这个模式下用不到，不用填。

设了这两个变量之后，和第一节的不同只有这些：

- **服务器初始化**不碰防火墙（原有服务的端口保持原样），也不重装、不升级已经装好的 Docker。
- **部署**成不成功，以「在服务器本机访问 `EDGE_LISTEN` 的 `/health`」为准。从外网打不开网址时只给一条黄色警告，不算失败、不会回退——那说明下面第 2 步还没做好。
- 第一节第 1 步里「服务商防火墙放行 80、443」不用再做（原有网站已经在用了）。

### 2. 在原有的 nginx 里加一段配置（你自己做，不在自动流程里）

这一步改的是原有服务的 nginx，自动流程不会、也不应该去动它。把下面两段加进它的配置（域名换成 NOZOMI 的域名，证书路径换成实际的路径，端口和 `EDGE_LISTEN` 保持一致），然后让 nginx 重新加载配置。

```nginx
# 80 端口：申请证书时的校验请求留给证书工具，其余一律跳到 HTTPS
server {
    listen 80;
    server_name nozomi-staging.example.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;    # 换成申请证书时用的校验目录
    }
    location / {
        return 301 https://$host$request_uri;
    }
}

# 443 端口：HTTPS 到这里为止，后面用普通 HTTP 转给本机的 NOZOMI
server {
    listen 443 ssl;
    server_name nozomi-staging.example.com;

    ssl_certificate     /etc/letsencrypt/live/nozomi-staging.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nozomi-staging.example.com/privkey.pem;

    # 请求体上限：不小于 2m（NOZOMI 自己的上限是 1 MB，超出时由它返回统一格式的错误）
    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:18080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

几点说明：

- **三个 `proxy_set_header` 一个都不能少，也不要改写法。** `X-Forwarded-For` 必须用 `$proxy_add_x_forwarded_for`（在原有内容后面追加访问者的地址）：NOZOMI 靠它在操作日志里记下访问者的真实地址，并按地址限制登录尝试次数。写成别的，日志里的地址就是错的。
- **不要在这里加 `Strict-Transport-Security` 这类安全响应头**，NOZOMI 自己会加，重复反而出问题。
- 这个 nginx 必须和 NOZOMI 在同一台机器上，并且能访问本机的 `127.0.0.1`（直接装在系统里的 nginx、用「主机网络」运行的 nginx 容器都可以）。
- 如果这个 nginx 前面还有一层（例如 CDN），请先告诉 Claude：层数变了，记录访问者地址的方式要跟着调整。
- **证书在 nginx 那边**：申请、续期都由它负责。证书续期后要让 nginx 重新加载才会生效，这件事 NOZOMI 的自动流程不管，也发现不了证书过期。
- **不要在这个 nginx 里给 NOZOMI 的域名加缓存或改写路径**（例如 `proxy_cache`、`try_files`、`location /assets`）：哪些路径是接口、哪些是网页、各自缓存多久，NOZOMI 自己已经处理好了，整个域名原样转过来即可。

做完后用浏览器打开 `https://你的域名/health`，看到 `"status":"ok"` 就是通了；打开 `https://你的域名/` 能看到登录页。

### 3. 手工做第一次初始化和部署（GitHub 上的流程还不能用时）

GitHub 上的 Server init / Deploy 要等代码合并到 main 之后才能用。在那之前，可以在一台装了 Docker 和 git 的电脑上手工做，效果完全一样（服务器上执行的是同一套脚本），之后改用 GitHub 的流程时什么都不用迁移。

先在这台电脑上准备好两样东西（第一节第 2 步）：一把部署专用的钥匙（`nozomi-deploy` 和 `nozomi-deploy.pub` 两个文件），和保存了 `ssh-keyscan` 输出的服务器身份指纹文件。然后在代码目录里设置连接信息（**这些值只留在你自己的终端里，不要写进任何文件，也不要发到聊天里**）：

```bash
export NOZOMI_SSH_HOST=服务器IP
export NOZOMI_SSH_PORT=22
export NOZOMI_SSH_KNOWN_HOSTS_FILE=保存了 ssh-keyscan 输出的文件的路径
export APP_DOMAIN=NOZOMI的域名
export EDGE_MODE=behind-proxy
export EDGE_LISTEN=127.0.0.1:18080
```

初始化（用 root，做一次）。root 用你平时登录这台服务器的那把钥匙；部署专用的钥匙只把**公钥**交给它，登记到新建的 `nozomi` 账号名下——这样部署钥匙从头到尾登录不了 root：

```bash
NOZOMI_SSH_USER=root NOZOMI_SSH_KEY_FILE=你登录root用的私钥路径 \
  NOZOMI_DEPLOY_PUBLIC_KEY_FILE=nozomi-deploy.pub路径 \
  deploy/client/push-local.sh staging init
```

部署（用初始化建好的 `nozomi` 账号和部署专用的钥匙；以后每次手工部署都是这一条）：

```bash
NOZOMI_SSH_USER=nozomi NOZOMI_SSH_KEY_FILE=nozomi-deploy私钥路径 \
  deploy/client/push-local.sh staging deploy
```

以后改用 GitHub 的流程时，把这把部署钥匙填进 Environment secrets、`VPS_SSH_USER` 直接填 `nozomi` 即可，不需要再运行 Server init。

部署的是当前检出的那个提交（有没提交的改动时会拒绝执行）。它会在本机构建两个镜像（后端程序、网页前端；需要 Docker 23 或更新的版本）、直接传到服务器（不经过任何镜像仓库）、然后走和自动部署一样的流程：备份 → 更新数据库结构 → 启动 → 检查健康，不健康自动换回上一个版本。最后一行会告诉你结果；如果提示「从外网还访问不到」，说明第 2 步的 nginx 配置还没做或证书还没好，NOZOMI 本身已经在运行。部署成功并且 nginx 配好之后，打开 `https://你的域名/` 就是登录页。

之后的步骤（创建第一个平台管理员、填 Stripe 和谷歌地图的密钥）和第一节第 7、8 步一样。

### 4. CentOS / RHEL 系统的说明

- 初始化脚本支持 CentOS Stream、RHEL、Rocky Linux、AlmaLinux 的 9 和 10，做的事情和 Ubuntu 上一样；软件用 dnf 安装，定时任务用系统的 crond（没装会自动装上并启用）。
- 需要脚本管理防火墙时（独占一台服务器的模式），这类系统用的是 firewalld；`behind-proxy` 模式下不安装、不启用、不改任何防火墙规则。
- **内核模块**：Docker 让容器之间按名字互相找到（程序就是这样找数据库的）要用到几个内核模块，这类系统把它们放在 `kernel-modules-extra` 软件包里，精简安装的机器上可能没有。初始化会检查（只检查，不安装）；缺了会报错并停下，部署时也会在「确认容器之间能按服务名互访」这一步报同样的原因。处理办法由服务器管理员来做：安装和「正在运行的内核」版本一致的 `kernel-modules-extra`（`dnf install kernel-modules-extra-$(uname -r)`）；软件源里已经没有这个版本时，升级内核并**重启服务器**（会中断这台机器上的其他服务，请安排好时间）。
- SELinux：脚本只查看并报告它的状态，不会去改。目前的测试服务器 SELinux 是关闭的；如果换到一台 SELinux 开着的机器，请先告诉 Claude 做一次验证（这种情况还没有实测过）。

### 5. 需要知道的限制

- 部署账号 `nozomi` 能管理这台服务器上的**所有**容器，包括原有服务的。自动流程只操作 NOZOMI 自己的，但这把部署钥匙要像服务器的 root 密码一样保管。
- 原有的 nginx 停了、配置被改掉、或证书过期，NOZOMI 的网址就打不开，而 GitHub 上的部署记录仍然是绿的（最多一条黄色警告）。网址打不开时先查那个 nginx。
- 两套服务共用这台机器的内存和硬盘，一边占满会影响另一边。

## 九、在测试环境跑只读核对

**一句话**：在 GitHub 上点一个按钮，回放测试环境最近 N 天（默认 30 天）的询价，确认「原来报得出的价」一处都没变。不用登录服务器，不改任何数据。技术决定见 `docs/adr/0086-staging-readonly-check-via-api.md`。

它做的事和服务器上的 `pnpm areas:role-preview --json` 完全一样（M8-20 区域用途、M8-30 报价优先级的回放），只是改成 GitHub 用一个只读的平台账号，经 HTTPS 调用测试环境的只读接口。

### 第一次准备（做一次）

1. 在测试环境的运营后台：角色 → 新建自建角色，名字如「只读核对」，**只勾「报价试算」**，数据范围不限制（限制了范围的角色用不了这个核对）。
2. 员工 → 邀请一个专用账号（用一个你收得到信的邮箱），角色选「只读核对」。用它登录一次：设好密码、绑定两步验证。绑定时页面上的「密钥」（二维码下面那串字母和数字）要记下来，下一步要填。
3. GitHub 仓库 → Settings → Environments → `staging` → Add environment secret，填 3 项：`STAGING_READONLY_EMAIL`、`STAGING_READONLY_PASSWORD`、`STAGING_READONLY_TOTP`。每一项是什么见 `docs/secrets.md`「测试环境只读核对的账号」。

### 每次怎么跑

1. GitHub 仓库 → Actions → 左侧选 **Staging readonly check** → 右侧 **Run workflow**。
2. 「回放最近几天的询价」保持 `30`（或填 1 到 90 之间的数）；「回放的截止时间」平时留空（= 现在）→ **Run workflow**。
3. 一两分钟后看结果：

| 你看到的 | 意思 |
| --- | --- |
| 绿色，摘要写「0 处变化，通过」 | 原来报得出的价一处都没变 |
| 红色，摘要写「有变化，不通过」 | 有询价的结果变了。摘要和产物 `staging-readonly-check-summary` 里只有计数；具体是哪条询价、哪个商品，由有权限的人登录后调接口看（见下面「需要知道的」），或告诉 Claude |
| 红色，日志第一行写「没有配置」 | 上面第 3 步的 secrets 没填全，日志里写了缺哪几项 |
| 红色，日志写「登录失败」「两步验证失败」「取清单失败」 | 按日志里括号中的提示处理（密码不对、密钥不对、角色没有「报价试算」、测试环境还没部署这个功能等） |

### 需要知道的

- 只读：回放在数据库的只读事务里算，不写业务数据。每次运行会在运营后台的操作日志里留一条（对象「区域」、操作「查看」），能看到是谁、回放了几天。
- 每个账号 10 分钟最多跑 3 次，再多会提示「请求过于频繁」。
- 回放超过 45 秒算不完时，这次没有结果，提示把天数改小再试（数据库里单条查询的时限也跟着收，不会拖过 45 秒太多）。
- 只针对测试环境；正式环境没有这个按钮。
- **报价引擎改动前后比对**（如包车「途经加价」）：部署前、部署后各跑一次，两次的天数一样、「回放的截止时间」填同一个值（如部署前一刻的 `2026-11-13T00:00:00Z`），比较摘要里的「报价结果摘要值」和「数据状态摘要」：数据状态摘要一样时，报价结果摘要值必须一样（一样 = 这批报价逐分不变）；数据状态摘要不一样说明两次之间供应商改了价格或区域，这次比对无效，要重跑（ADR 0086）。
  - 「部署前」那次必须跑在**已经部署了摘要功能（M9W-00，PR #188）、还没部署引擎改动**的测试环境上；途经加价那个 PR 不能改 `apps/api/src/services/replay-digest.ts` 里 `offerParts` 的字段，否则两次的口径不同，摘要不能比。
- **仓库是公开的，Actions 的摘要和产物任何 GitHub 用户都能看、能下载**。所以它们只写计数：回放了多少条询价、两项变化各几处、新报出的价按计价方式各几个、天数和时间，以及两个摘要值（SHA-256，反推不出价格）；不写供应商名称、商品编号、区域名称、价格、规则编号。完整清单不落盘、不打印。
- 要看明细（哪条询价、哪个商品、之前和之后的结算价）：由有「报价试算」权限、数据范围不限的人登录测试环境后，调用 `GET /platform/v1/reports/area-role-preview?days=30`（同样只读、同样留操作日志、同样限速），或由 Claude 按这个方法查。
- 清单本身没有客人的姓名、联系方式和坐标。

## 十、测试环境执行三层区域迁移

**一句话**：包车的价格表从「按服务区域填套餐价 + 区域加价里带途经加价」换成三层（整商品套餐价、行程加价、上下车加价）。换表要把已有数据搬一次，这件事只在测试环境做，由部署流水线执行，不用登录服务器。技术决定见 `docs/adr/0093-charter-three-layer-areas.md` 第六节。

它做的事：每个还没迁移过的包车商品，把服务区域里名字（中文名）正好是「东京市内」的那个区域（所有包车商品都先这样找；没有这个区域的商品取优先级排第一的服务区域）的套餐价复制成整商品套餐价——这个区域一条套餐价都没有的商品不迁（报告里是 `no_package`，日志计数是「没有套餐价跳过 N」，dry-run 时逐个看）；上下车加价行里设了途经加价的，复制成同金额的行程加价；然后把商品标成「已迁移」。**只新增，不改、不删任何已有的价格**。已经迁移过的商品跳过，可以重复执行。

### 前提

- 这个功能（M9P-05）的代码已经部署到测试环境。还没部署时不要设变量：旧版本不认识新的价格方式。
- **M9P-07 的价格页已经上线**（迁移过的商品按三张新表显示、旧行只读）。上线之前不要设变量：旧价格页不认识迁移过的商品，供应商会看不懂、改不了价格。

### 每次怎么做

1. GitHub 仓库 → Settings → Environments → `staging` → Environment variables → 新建 `CHARTER_THREE_LAYER_MIGRATION`，值填 `dry-run`。
2. Actions → 左侧选 **Deploy** → **Run workflow**（选 `staging`）。部署日志里「执行包车三层区域的数据迁移」下面有一行计数：迁移几个商品、新建几条套餐价和行程加价、报告里各类问题几条。`dry-run` 不改任何数据。
3. 计数没问题，把变量的值改成 `apply`，再 **Run workflow** 部署一次。
4. **部署一结束就删掉这个变量**（同一次操作里做完，不要留到下一次合并）。
5. 部署前、部署后各跑一次「在测试环境跑只读核对」（同一个截止时间、同样的天数），比对变化的询价（ADR 0093 第六节第 5 小节）。

### 需要知道的

- **报告在哪**：完整报告（每个商品的套餐价不一致、服务区域上的上下车加价、重叠的区域和面积、只有途经加价的行、空格、行程加价和业务方已定金额不一致的区域）写在服务器上本环境部署目录下的 `reports/`（例如 `/opt/nozomi/staging/reports/charter-three-layer-apply-….json`），目录权限 700，只有部署账号能看。仓库是公开的，部署日志谁都能看，所以日志里只有计数，不写商品、区域和金额。
- 运营要处理的条目（重叠、服务区域上的上下车加价、不一致的套餐价）在区域页、价格页里本来就看得到；「套餐价不一致」的逐条明细，迁移后在价格页（或接口 `GET /tenant/v1/products/{id}/charter-migration-diff`、`GET /platform/v1/products/{id}/charter-migration-diff`）随时现算。
- **失败怎么办**：迁移出错时整次撤销（一条都不写）、这次部署中止，线上仍是旧版本。看日志里的错误码，告诉 Claude。
- 只在测试环境：`production` 设了这个变量，部署会直接报错停下。

## 测试环境执行区域重叠清理（ADR 0102）

和上面的三层迁移同一套做法，变量名是 `AREA_OVERLAP_CLEANUP`。前提：ADR 0102 的区域分类（迁移 0630）和清理脚本（迁移 0640）都已部署到测试环境。

1. GitHub 仓库 → Settings → Environments → `staging` → Environment variables → 新建 `AREA_OVERLAP_CLEANUP`，值填 `dry-run`。
2. Actions → 左侧选 **Deploy** → **Run workflow**（选 `staging`）。部署日志里「执行区域重叠清理」下面有一行计数：标成平台共享几个、停用没人用的重复几个、包车三层重叠清理前几处、切掉几对、没解决几对、清理后几处。`dry-run` 不改任何数据。
3. 计数没问题，把值改成 `apply`，再 **Run workflow** 部署一次。
4. **部署一结束就删掉这个变量**。
5. 清理前后各跑一次只读回放（同一个截止时间、同样的天数），逐条比对价格变化。

- **明细在哪**：清理前每个区域的整行、图形和全部关联存在数据库表 `area_cleanup_backups`（按批次号，日志里有），每次执行的计数和改动编号在 `area_cleanup_runs`。日志里只有计数，不写区域名称和价格。
- **失败怎么办**：出错时整次撤销、这次部署中止，线上仍是旧版本。
- 只在测试环境：`production` 设了这个变量，部署会直接报错停下。

## 测试环境执行包车旧价格清理（M9P-12）

**一句话**：三层迁移以后，迁移过的包车商品还留着两类不再参与报价的旧数据——按服务区域的旧套餐价、③上下车加价行里的途经加价。验证通过、业主同意（2026-11-18）后把它们清掉。只动迁移过三层的商品，没迁移过的（正式站全部是）一条不碰。做法和上面两个一样，变量名是 `LEGACY_PRICE_CLEANUP`。前提：迁移 0650 已部署到测试环境。

1. GitHub 仓库 → Settings → Environments → `staging` → Environment variables → 新建 `LEGACY_PRICE_CLEANUP`，值填 `dry-run`。
2. Actions → 左侧选 **Deploy** → **Run workflow**（选 `staging`）。部署日志里「执行包车旧价格清理」下面有一行计数：迁移过的商品几个（没迁移过的几个不动）、有改动几个、删掉几条旧套餐价、几条③行去掉途经加价（其中上下车加价都是 0 的几条）、只在旧行里有的车型组 × 时长几个。`dry-run` 不改任何数据。
3. 计数没问题，把值改成 `apply`，再 **Run workflow** 部署一次。
4. **部署一结束就删掉这个变量**。
5. 清理前后各跑一次只读回放（同一个截止时间、同样的天数），应 0 变化。

- **会变的地方**：报价不变；官网包车「可选时长」里只在旧行里有的时长不再列出（这些时长本来就报不出）；后台价格页不再显示「旧的按区域套餐价（只读）」；三层迁移不能再靠旧行回退，要回退从备份表恢复。
- **明细在哪**：每条删掉 / 改掉的价格规则的整行存在数据库表 `legacy_price_cleanup_backups`（按批次号，日志里有），每次执行的计数和改动编号在 `legacy_price_cleanup_runs`；每条改动都有审计（操作人是系统、来源是命令行）。日志里只有计数，不写金额。
- **失败怎么办**：出错时整次撤销、这次部署中止，线上仍是旧版本。
- 只在测试环境：`production` 设了这个变量，部署会直接报错停下。


## 主数据导入（M8-47b）

机场、城市、机场的中文名 / 日文名和搜索别名从公开数据源导入（OurAirports 公有领域、GeoNames CC BY 4.0）。导入程序只给库里空着的填、可以反复运行。新版本带来新的导入内容时（例如 M8-47 的机场搜索别名，让官网输入「羽田」能找到平台的羽田机场），在每个环境运行一次。

**目前只开放测试环境**（监工 2026-11-24 决定）；正式环境要用时另开任务，经负责人确认后再加选项。

### 每次怎么做

1. 仓库 → **Actions** → 左边选 **Masterdata import** → 右边 **Run workflow**。
2. 分支选 **main**；环境只有 staging；「导入什么数据」选 `airport-names`（机场中文、日文名和搜索别名）、`airports`（机场）或 `cities`（城市）；国家码填两位大写字母、逗号分隔，例如 `JP,KR`。
3. **第一次不勾「写入数据库」**，点 Run workflow。这是试运行：只显示将要新增、更新多少条，数据库不变。
4. 跑完点进这次运行，摘要里就是结果；同样的内容在页面底部 **Artifacts** 里可以下载（保留 30 天）。
5. 结果核对过、确认可以写入后，同样的选项**勾上「写入数据库」**再运行一次。再运行一次试运行，应显示没有要填的。

### 需要知道的

- 实际执行的是 `deploy/client/remote.sh masterdata`：在服务器当前运行版本的 API 容器里执行 `node apps/api/src/cli/masterdata-import-<数据>.ts --country <国家码> [--dry-run]`，和在服务器上手工执行同一条命令一样。
- 和部署用同一个排队组：部署正在进行时，导入会等部署完再开始，不会同时进行。
- 导入程序从服务器上直接下载数据源文件（GeoNames 每个国家几 MB），服务器要能访问外网。
- 每个写入的机场、城市都有审计日志（操作者是「系统」，入口是命令行）；搜索别名每次整份替换，不算修改、不写审计日志（ADR 0024）。
