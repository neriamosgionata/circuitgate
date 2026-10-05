# syntax=docker/dockerfile:1
FROM oven/bun:1.4.2-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build \
	&& rm -rf node_modules \
	&& bun install --frozen-lockfile --production

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build

USER node

EXPOSE 3000

CMD ["node", "build"]
