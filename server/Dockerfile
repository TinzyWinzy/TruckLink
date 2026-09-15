# Sync service image (api + worker + relay share it, different commands).
FROM node:20-slim AS build
WORKDIR /srv
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /srv
ENV NODE_ENV=production
COPY --from=build /srv/node_modules ./node_modules
COPY --from=build /srv/dist ./dist
COPY package*.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]