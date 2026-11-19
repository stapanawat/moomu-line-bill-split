# build เว็บ แล้วรันเซิร์ฟเวอร์ตัวเดียวที่ให้บริการทั้งเว็บ, API และ webhook
FROM node:22-alpine AS web
WORKDIR /app
COPY shared ./shared
COPY web/package.json web/package-lock.json* ./web/
RUN cd web && npm install
COPY web ./web
RUN cd web && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY shared ./shared
COPY server ./server
COPY --from=web /app/web/dist ./web/dist
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "src/index.js"]
