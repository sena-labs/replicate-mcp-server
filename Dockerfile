# Stage 1 — build TypeScript to dist/
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2 — slim runtime image
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Copy only what we need to run.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

# Default port for HTTP transport. Stdio mode ignores this.
EXPOSE 8088

# Default to HTTP transport in container deployments — stdio is meaningless
# inside Docker since there's no TTY pipe to the parent. Override the CMD
# to run in stdio mode if needed (e.g. via `docker run -it`).
CMD ["node", "dist/index.js", "--http", "--host", "0.0.0.0", "--port", "8088"]
