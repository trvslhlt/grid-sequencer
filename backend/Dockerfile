# --- dev: what docker-compose runs locally, with source bind-mounted in ---
FROM node:20-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3002
CMD ["npm", "run", "dev"]

# --- build: compiles TypeScript to plain JS ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# --- runtime: the actual deployable image — compiled output + prod deps only ---
FROM node:20-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3002
CMD ["node", "dist/server.js"]
