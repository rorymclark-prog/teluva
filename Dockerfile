FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# Only the runtime deps needed by server.js
RUN npm ci --omit=dev
COPY server.js ./server.js
# server.js imports this at runtime — without it the container crashes on boot.
COPY authz.mjs ./authz.mjs
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "server.js"]
