# 微信云托管部署用 Dockerfile
FROM node:18-alpine
RUN apk add --no-cache ghostscript graphicsmagick
WORKDIR /app

# 先复制 package.json 利用 Docker 缓存
COPY package*.json ./
RUN npm install --omit=dev

# 复制源码
COPY . .

# 云托管默认监听 80 端口
ENV PORT=80
ENV NODE_ENV=production

EXPOSE 80

CMD ["node", "src/app.js"]
