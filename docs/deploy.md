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

### 7. 创建第一个平台管理员

系统里没有任何预置账号。第一次部署成功后，用部署用户登录服务器，运行（把邮箱和姓名换成你自己的）：

```bash
/opt/nozomi/staging/current/bin/compose.sh exec api node apps/api/src/cli/admin-create.ts --email 你的邮箱 --name 你的姓名
```

按提示输入两遍密码（输入时不显示）。密码至少 12 个字符，大写、小写、数字、符号里至少有三种。之后就可以用这个邮箱登录平台后台。

忘了密码时，在服务器上运行同样写法的 `admin-reset-password.ts --email 你的邮箱` 重设。

### 8. 以后再做：填 Stripe 和谷歌地图的密钥

这两项不填，测试环境也能运行（收款、里程报价这两类功能不可用）。**正式环境必须填**，否则程序拒绝启动。

拿到密钥后，用 `nozomi` 账号登录服务器，编辑环境目录下的 `.env` 文件，把对应的空行填上（每一项去哪里找见 `docs/secrets.md`），然后让它生效：

```bash
/opt/nozomi/staging/current/bin/compose.sh up -d --wait
```

## 二、平时怎么部署

- **测试环境**：什么都不用做。代码合并到 main、自动检查（CI）通过后，自动部署。
- **正式环境**：Actions → Deploy → Run workflow → 环境选 `production` → Run，然后在弹出的审批里点 Approve。只能部署 main 上已经通过检查的最新版本。

每次部署自动做这些事：构建程序镜像 → 上传到服务器 → 备份数据库 → 核对数据库的应用账号 → 更新数据库结构 → 启动新版本 → 检查健康 → 从外网访问一次确认。切换新旧版本时服务会中断几秒钟。

**数据库的两个账号**（不用你操作，知道有这回事即可）：程序平时运行用的是一个权限最小的「应用账号」，它改不了数据库结构，也改不了、删不了操作日志；更新数据库结构、备份和恢复用另一个「迁移账号」。两个账号的密码都是自动生成的，程序运行的容器里拿不到迁移账号的密码。程序启动时会自己检查：如果发现自己用的是权限过大的账号，会拒绝启动（这次部署按失败处理，线上仍是旧版本）。

**从更早的版本升级**（服务器是在有「应用账号」之前初始化的）：照常部署即可，不需要重新运行 Server init，也不需要登录服务器。那一次部署会自动在 `.env` 里补上 `POSTGRES_APP_PASSWORD`、在数据库里建好应用账号，然后切换到新版本。

## 三、怎么看状态

**在 GitHub 上**（不用登录服务器）：Actions → Deploy，最上面一条就是最近一次部署。

| 你看到的 | 意思 |
| --- | --- |
| 绿色，摘要写「已部署到 …」 | 部署成功 |
| 绿色但有黄色警告「测试环境没有部署」，后两步是灰色（已跳过） | 这个环境的服务器信息还没填全，**这次没有部署**。按「第一次上线」补齐 |
| 红色 | 部署失败，见下一节 |

**打开网址**：`https://你的域名/health`。`status` 是 `ok` 表示程序、数据库都正常；`integrations` 里能看到每个第三方账号是「已配置」还是「未配置」。`database` 里的 `errorCode` 如果是 `DB_ROLE_UNSAFE`，意思是程序连数据库用的账号权限过大、程序拒绝用它干活——正常部署不会出现，出现了请告诉 Claude。

**在服务器上**（用 `nozomi` 账号登录）：

```bash
/opt/nozomi/staging/current/bin/compose.sh ps                      # 三个容器是否都在运行、是否健康
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

**重要**：备份目前只存在这台服务器上，服务器整机损坏时备份会一起丢。异地备份等你提供存放位置后补上；正式上线前还要补「恢复到任意时间点」的能力（见 ADR 0007）。

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

做完后用浏览器打开 `https://你的域名/health`，看到 `"status":"ok"` 就是通了。

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

部署的是当前检出的那个提交（有没提交的改动时会拒绝执行）。它会在本机构建程序镜像、直接传到服务器（不经过任何镜像仓库）、然后走和自动部署一样的流程：备份 → 更新数据库结构 → 启动 → 检查健康，不健康自动换回上一个版本。最后一行会告诉你结果；如果提示「从外网还访问不到」，说明第 2 步的 nginx 配置还没做或证书还没好，NOZOMI 本身已经在运行。

之后的步骤（创建第一个平台管理员、填 Stripe 和谷歌地图的密钥）和第一节第 7、8 步一样。

### 4. CentOS / RHEL 系统的说明

- 初始化脚本支持 CentOS Stream、RHEL、Rocky Linux、AlmaLinux 的 9 和 10，做的事情和 Ubuntu 上一样；软件用 dnf 安装，定时任务用系统的 crond（没装会自动装上并启用）。
- 需要脚本管理防火墙时（独占一台服务器的模式），这类系统用的是 firewalld；`behind-proxy` 模式下不安装、不启用、不改任何防火墙规则。
- SELinux：脚本只查看并报告它的状态，不会去改。目前的测试服务器 SELinux 是关闭的；如果换到一台 SELinux 开着的机器，请先告诉 Claude 做一次验证（这种情况还没有实测过）。

### 5. 需要知道的限制

- 部署账号 `nozomi` 能管理这台服务器上的**所有**容器，包括原有服务的。自动流程只操作 NOZOMI 自己的，但这把部署钥匙要像服务器的 root 密码一样保管。
- 原有的 nginx 停了、配置被改掉、或证书过期，NOZOMI 的网址就打不开，而 GitHub 上的部署记录仍然是绿的（最多一条黄色警告）。网址打不开时先查那个 nginx。
- 两套服务共用这台机器的内存和硬盘，一边占满会影响另一边。
