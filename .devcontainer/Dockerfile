FROM mcr.microsoft.com/devcontainers/typescript-node:22-bookworm
RUN apt-get update && apt-get install -y sqlite3
# corepack is bundled with Node 18+; enable it so pnpm is available.
# The exact pnpm version is pinned via "packageManager" in package.json.
RUN corepack enable
