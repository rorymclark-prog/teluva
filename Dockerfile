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
# server.js imports both of these at runtime — without either, the container
# crashes on boot. Keep them in step with server.js's import list.
COPY authz.mjs ./authz.mjs
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "server.js"]
