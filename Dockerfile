# Парсер реплеев: собирается отдельно, в образ уезжает только бинарник
FROM golang:1.23-alpine AS parser
WORKDIR /parser
COPY tools/replay-parser/go.mod tools/replay-parser/go.sum ./
RUN go mod download
COPY tools/replay-parser/*.go ./
RUN CGO_ENABLED=0 go build -o replay-parser .

# Сборка TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache python3 make g++
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# zstd и bzip2 нужны для распаковки реплеев: Valve отдаёт оба формата под расширением .bz2
RUN apk add --no-cache zstd bzip2

COPY package*.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev \
    && apk del .build-deps

COPY --from=builder /app/dist ./dist
COPY --from=parser /parser/replay-parser ./tools/replay-parser/replay-parser

# Разобранные реплеи и готовые разборы должны переживать перезапуск контейнера
RUN mkdir -p data/replays data/analysis

ENV NODE_ENV=production
ENV WEB_PORT=3000
EXPOSE 3000

# Run the bot
CMD ["node", "dist/index.js"]
