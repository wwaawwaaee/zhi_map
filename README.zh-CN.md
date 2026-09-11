# 知树

知树是一个自托管学习工作台。你可以从消息中的精确选区展开独立讨论，保留引用内容的快照，并将工作区保存在服务端而不是浏览器本地存储中。

[English README](README.md)

## 开始使用

需要 Node.js 22.9+ 与 npm。项目内置 SQLite，无需 Docker 或外部数据库。

先安装依赖，并创建本地环境文件：

```sh
npm install
```

Windows CMD：

```cmd
copy .env.example .env
```

macOS、Linux 或其他 POSIX shell：

```sh
cp .env.example .env
```

初始化数据库并启动开发环境：

```sh
npm run db:migrate
npm run dev
```

在浏览器打开 `http://127.0.0.1:5173`。前端开发服务器使用 `5173` 端口，API 使用 `3000` 端口。

部署单进程自托管版本：

```sh
npm run build
npm start
```

对外部署前，请设置 `NODE_ENV=production`、持久化的 `DATABASE_URL` 和高强度 `SESSION_SECRET`；前后端跨源部署时还需设置 `APP_ORIGIN`。

## 设置模型

可以在 `.env` 中设置 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL` 与可选的 `AI_TIMEOUT_MS`，作为服务端默认模型；也可以在界面的“设置与数据”中，为当前匿名会话填写 OpenAI 兼容服务。会话密钥只会提交给同源 API，不会出现在读取接口、浏览器存储、URL、日志或导出文件中。

生产环境若允许保存会话模型凭据，必须设置 `DATA_ENCRYPTION_KEY`，它是 32 字节密钥的 base64 编码，可用 `npm run keys:generate` 生成。开发环境未设置该项时，API 会生成只在当前进程有效的临时密钥，所以重启后已保存的会话凭据无法读取。可用 `AI_ALLOWED_HOSTS` 限制用户可配置的模型服务主机名。

## 验证

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
```

浏览器冒烟测试使用 `CHROME_PATH` 或 Windows 默认 Chrome 路径，截图输出到 `test-results/browser-smoke.png`。

## 延伸阅读

- [架构](docs/architecture.md)
- [API 服务](apps/api/README.md)
- [Web 客户端](apps/web/README.md)
- [领域模型](packages/domain/README.md)
- [HTTP 契约](packages/contracts/README.md)
- [测试说明](tests/README.md)
