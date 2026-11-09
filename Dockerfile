FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
# Developer projects clone the repository they are analysed against.
RUN apk add --no-cache git
# standalone gives server.js plus a traced node_modules
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# full node_modules so the preflight step can run tsx
COPY --from=deps /app/node_modules ./node_modules
# preflight runs from source, outside the bundler (see bin/preflight.ts)
COPY lib ./lib
COPY bin ./bin
COPY worker ./worker
# the demo path runs INSIDE the container: seed, index, seed:demo (D34 — the app is on a
# remote server, so requiring a repo checkout beside it would be a second install to keep
# in step). Verified with: docker compose exec app npm run seed:demo
COPY scripts ./scripts
COPY eval ./eval
COPY fixtures ./fixtures
COPY package.json tsconfig.json ./
EXPOSE 3000
CMD ["sh", "-c", "npx tsx bin/preflight.ts --migrate && node server.js"]
