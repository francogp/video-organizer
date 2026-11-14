FROM mwader/static-ffmpeg:9.0.2-1 AS ffmpeg-source

FROM busybox:1.38.0-musl AS ffmpeg-provider

COPY --from=ffmpeg-source /ffmpeg /opt/ffmpeg-src/ffmpeg
COPY --from=ffmpeg-source /ffprobe /opt/ffmpeg-src/ffprobe

ENTRYPOINT ["sh", "-c", "mkdir -p /opt/ffmpeg && cp -f /opt/ffmpeg-src/ffmpeg /opt/ffmpeg/.ffmpeg.tmp && cp -f /opt/ffmpeg-src/ffprobe /opt/ffmpeg/.ffprobe.tmp && chmod 0755 /opt/ffmpeg/.ffmpeg.tmp /opt/ffmpeg/.ffprobe.tmp && mv -f /opt/ffmpeg/.ffmpeg.tmp /opt/ffmpeg/ffmpeg && mv -f /opt/ffmpeg/.ffprobe.tmp /opt/ffmpeg/ffprobe && if [ -n \"${CONFIG_DIR:-}\" ] && [ \"$(id -u)\" = \"0\" ]; then mkdir -p \"${CONFIG_DIR}\" && (chown -R \"${PUID:-1000}:${PGID:-1000}\" \"${CONFIG_DIR}\" || true) && (chmod 0775 \"${CONFIG_DIR}\" || true); fi"]

FROM --platform=$BUILDPLATFORM node:26.13.1-alpine3.24 AS builder

RUN apk add --no-cache git \
  && npm install -g npm@latest \
  && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
  && git config --global url."https://github.com/".insteadOf "git@github.com:"

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY index.html tsconfig.json vite.config.ts vite.plugins.ts ./
COPY public ./public
COPY src ./src
RUN ./node_modules/.bin/vp build

FROM node:26.13.1-alpine3.24 AS runtime

RUN apk add --no-cache ca-certificates

WORKDIR /app

ENV NODE_ENV=production \
  APP_PORT=3000 \
  HOME=/tmp \
  PATH="/opt/ffmpeg:${PATH}"

COPY package.json ./package.json
COPY --from=builder /app/node_modules/valibot ./node_modules/valibot
COPY --from=builder /app/dist ./dist
COPY src/domain ./src/domain
COPY src/server ./src/server

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.APP_PORT || '3000') + '/api/state').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER 1000:1000

CMD ["node", "src/server/index.ts"]
