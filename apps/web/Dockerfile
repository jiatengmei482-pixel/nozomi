# 前端镜像：反向代理 Caddy + 构建好的前端静态文件（ADR 0007「前端接入部署」）。构建上下文是仓库根目录：
#   docker build -f apps/web/Dockerfile -t nozomi-web .
# 进构建上下文的文件由同目录的 Dockerfile.dockerignore（白名单）决定；它只对这个 Dockerfile 生效，需要 BuildKit
# （Docker 23 起的默认构建方式）。
#
# - 和 API 镜像（nozomi-api）是一对：同一个提交、同一个标签，一起部署、一起回退。
# - 镜像里有两样东西：/srv/web（pnpm web:build 的产物）和 /etc/nozomi/web.caddy（从这份产物算出来的
#   API 路径前缀匹配器和内容安全策略，见 apps/web/build/edge-config.ts）。
#   Caddyfile 不在镜像里：它和 compose.yml 一样在服务器的版本目录里，由 compose.yml 挂进来，并 import 上面那个片段。
# - 镜像里没有任何密钥，也没有 Node 和源码：最终镜像只是官方 Caddy 加静态文件。

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@nozomi/web..."
# apps/web/tsconfig.json 继承根目录的 tsconfig.json；样式里的设计令牌来自 docs/design/tokens.css（ADR 0011）。
COPY tsconfig.json ./
COPY packages/domain packages/domain
COPY docs/design/tokens.css docs/design/tokens.css
COPY apps/web apps/web
# 统一权限：不依赖构建机上文件的权限位。Caddy 容器去掉了「无视文件权限」的特权，静态文件必须所有人可读。
RUN pnpm --filter @nozomi/web build \
  && mkdir /out \
  && node apps/web/build/edge-config-cli.ts apps/web/dist/index.html >/out/web.caddy \
  && chmod -R u=rwX,go=rX apps/web/dist /out

FROM caddy:2
COPY --from=build /app/apps/web/dist /srv/web
COPY --from=build /out/web.caddy /etc/nozomi/web.caddy
