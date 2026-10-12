FROM node:22-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ARCH=$(dpkg --print-architecture) \
    && case "$ARCH" in \
         arm64) PIPER_ARCH=aarch64 ;; \
         amd64) PIPER_ARCH=x86_64 ;; \
         armhf) PIPER_ARCH=armv7l ;; \
         *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;; \
       esac \
    && curl -fSL "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_${PIPER_ARCH}.tar.gz" -o /tmp/piper.tar.gz \
    && tar -xzf /tmp/piper.tar.gz -C /opt \
    && rm /tmp/piper.tar.gz

ENV PATH="/opt/piper:${PATH}"
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public

EXPOSE 5005
CMD ["node", "dist/server.js"]
