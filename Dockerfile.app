FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY turbo.json ./
COPY apps/backend/package*.json apps/backend/
COPY apps/web/package*.json apps/web/
COPY packages/tsconfig/package*.json packages/tsconfig/

RUN npm ci

COPY . .

ENV HOST=0.0.0.0

EXPOSE 3000 4000

CMD ["sh", "-c", "npm -w apps/backend run db:migrate && npm run dev -- --env-mode=loose"]
