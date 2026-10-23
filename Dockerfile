# ---------- 前端构建 ----------
FROM node:22-alpine AS frontend-builder

WORKDIR /app

COPY web/package*.json ./

RUN npm install

COPY web/ ./

RUN npm run build

# ---------- 生产环境 ----------
# 后端使用 Node 内置的 node:sqlite（无需编译原生模块，也不再需要安装 sqlite 包）
FROM node:22-alpine AS production

WORKDIR /app

RUN mkdir -p uploads database web/dist

COPY package*.json ./

RUN npm install --omit=dev

COPY app.js config.js ./
COPY src/ ./src/

COPY --from=frontend-builder /app/dist ./web/dist

ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/settings').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
