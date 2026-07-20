FROM node:24-alpine AS builder

ARG APP_NAME
WORKDIR /workspace

COPY package.json package-lock.json nx.json tsconfig.base.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN npm ci
RUN npm exec nx -- run @org/${APP_NAME}:prune --configuration=production --skipNxCache

FROM node:24-alpine AS runtime

ARG APP_NAME
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /workspace/apps/${APP_NAME}/dist/ ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

USER node
CMD ["node", "main.js"]
