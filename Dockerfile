FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --frozen-lockfile --omit=dev

COPY --from=builder /app/dist ./dist

# Copy 0G storage client binary if it exists in the source
COPY src/external/0g/ ./src/external/0g/ 2>/dev/null || true

RUN useradd -r -s /bin/false appuser && chown -R appuser /app
USER appuser

EXPOSE 8080

CMD ["node", "dist/index.js"]
