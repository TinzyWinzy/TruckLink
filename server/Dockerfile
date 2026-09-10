# Sync service image (api + worker + relay share it, different commands).
FROM node:20-slim
WORKDIR /srv
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
EXPOSE 3000
CMD ["node", "dist/index.js"]
