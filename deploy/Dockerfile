FROM emscripten/emsdk:4.0.23 AS engine
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends cmake git make
COPY source/Quake source/Quake
COPY source/LICENSE.txt source/LICENSE.txt
COPY web/Makefile web/Makefile
COPY web/engine web/engine
COPY tools/build-web.sh tools/build-web.sh
RUN git clone https://github.com/ptitSeb/gl4es.git tools/gl4es && \
    git -C tools/gl4es checkout ec16bedd8819c475326f4f1a3063772c6d986e06 && \
    bash tools/build-web.sh

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY tools/setup-network.mjs tools/setup-network.mjs
RUN node tools/setup-network.mjs
COPY --chown=node:node web web
COPY --from=engine --chown=node:node /app/web/dist/engine web/dist/engine
COPY --chown=node:node runtime/quakespasm.pak runtime/quakespasm.pak
COPY --chown=node:node runtime/shareware-docs runtime/shareware-docs
RUN mkdir -p web/.local runtime/id1 && chown node:node web/.local runtime/id1
USER node
ENV NODE_ENV=production QUAKE_WEB_HOST=0.0.0.0 QUAKE_MULTIPLAYER_HOST=0.0.0.0
EXPOSE 3000/tcp 4433/udp
CMD ["node", "web/server.mjs"]
