FROM node:24-alpine AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM build AS server

ENV NODE_ENV=production
WORKDIR /app

USER node
EXPOSE 4318

CMD ["node", "apps/server/dist/main.js"]

FROM build AS worker

ENV NODE_ENV=production
WORKDIR /app

USER node

CMD ["node", "apps/worker/dist/main.js"]

FROM nginx:alpine AS web

COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

