FROM node:20-bookworm AS web
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM python:3.11-slim-bookworm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends iputils-ping openssh-client && rm -rf /var/lib/apt/lists/*
COPY --from=web /app /app
ENV NEXUS_BIND=0.0.0.0
EXPOSE 5000 8765 8766 8767 4173
CMD ["python3", "server/app.py"]
