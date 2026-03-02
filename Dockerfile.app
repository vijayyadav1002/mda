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

RUN npm run build

ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3000 4000

CMD ["bash", "-lc", "npm -w apps/backend run db:migrate && npm -w apps/backend run start & PORT=3000 HOST=0.0.0.0 npm -w apps/web run start & wait -n"]
