FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY src/shared/database/migrate.ts ./src/shared/database/migrate.ts
COPY src/shared/database/seed.ts ./src/shared/database/seed.ts
COPY src/shared/database/migrations ./src/shared/database/migrations
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]