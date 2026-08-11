FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

# A dependência node-ofx-parser é obtida de um repositório Git.
RUN apt-get update \
    && apt-get install --no-install-recommends --yes git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

RUN mkdir -p watch parsed \
    && chown -R node:node /app

USER node

CMD ["npm", "start"]
