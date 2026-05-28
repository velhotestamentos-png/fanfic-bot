FROM node:24-slim

RUN npm install -g pnpm@10

WORKDIR /app

# Root workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json tsconfig.base.json ./

# All workspace packages pnpm needs to resolve
COPY lib/ ./lib/
COPY scripts/ ./scripts/
COPY artifacts/api-server/ ./artifacts/api-server/

# Install all dependencies
RUN pnpm install --no-frozen-lockfile

# Build the API server (bundles everything via esbuild)
RUN pnpm --filter @workspace/api-server run build

# Railway provides PORT at runtime
EXPOSE 3000

CMD ["node", "artifacts/api-server/dist/index.mjs"]
