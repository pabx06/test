FROM node:22-alpine AS dependencies

WORKDIR /app

COPY package.json package-lock.json .npmrc.example ./
RUN cp .npmrc.example .npmrc && npm ci --omit=dev && rm -f .npmrc .npmrc.example

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc.example ./
RUN cp .npmrc.example .npmrc && npm ci && rm -f .npmrc .npmrc.example

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/server.js"]
