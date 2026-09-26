FROM node:20-alpine

WORKDIR /app

# 仅先拷贝依赖清单，利用层缓存安装依赖
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# 拷贝应用源码
COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
