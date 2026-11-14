FROM node:26-alpine AS builder

RUN apk add --no-cache git \
  && npm install -g npm@latest \
  && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
  && git config --global url."https://github.com/".insteadOf "git@github.com:"

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY index.html tsconfig.json vite.config.ts vite.plugins.ts ./
COPY src ./src
RUN ./node_modules/.bin/vp build

FROM node:26-alpine AS runtime

RUN apk add --no-cache ffmpeg ca-certificates su-exec

WORKDIR /app

ENV NODE_ENV=production
ENV APP_PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY src ./src
COPY tsconfig.json ./tsconfig.json

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.APP_PORT || '3000') + '/api/state').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "cfg=\"${CONFIG_DIR:-/config}\"; uid=\"${PUID:-1000}\"; gid=\"${PGID:-1000}\"; if [ \"$(id -u)\" = \"0\" ]; then mkdir -p \"$cfg\" && chown \"$uid:$gid\" \"$cfg\"; exec su-exec \"$uid:$gid\" node src/server/index.ts; fi; exec node src/server/index.ts"]
