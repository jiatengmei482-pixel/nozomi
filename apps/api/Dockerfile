# API 的运行镜像。构建上下文是仓库根目录：
#   docker build -f apps/api/Dockerfile -t nozomi-api .
#
# - Node 24 直接运行 .ts，没有编译步骤。
# - 镜像里没有任何密钥：进镜像的文件由根目录 .dockerignore 的白名单决定，配置全部在运行时由环境变量传入。
# - 以非 root 用户（node）运行；/app 属于 root，运行用户只能读不能改。

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod
COPY packages packages
COPY apps/api apps/api
# 统一权限：不依赖构建机上源码文件的权限位（所有人可读、目录可进入，只有属主可写）。
RUN chmod -R u=rwX,go=rX /app

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./
USER node
EXPOSE 8080
CMD ["node", "apps/api/src/server.ts"]
