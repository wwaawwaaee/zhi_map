# 知树架构

## 模块边界

Web 客户端负责渲染工作区快照并发送命令。它不决定持久状态的变更，不存储学习数据，也不保存模型凭据。见 [web 客户端](../apps/web/README.md)。

`backend/app/domain` 负责确定性的状态变更、校验，以及与 JavaScript 兼容的 UTF-16 偏移。它不依赖 HTTP、数据库或浏览器。

FastAPI 的 Pydantic 模型负责 HTTP 边界。Python API 认证本地匿名会话、校验请求、调用域状态变更、持久化快照，并且是唯一与 SQLite 和模型提供方通信的组件。见 [backend](../backend/README.md)。

## 数据流

1. 首次请求会创建一个匿名用户，并下发 `HttpOnly`、`SameSite=Lax` 的会话 Cookie。
2. 客户端读取工作区快照与 revision，随后带着该 revision 发送命令。
3. API 校验 HTTP 载荷、应用域状态变更，并原子性地替换该用户的 SQLite 快照。revision 过期会被判定为冲突并拒绝。
4. AI 请求读取当前分支，先解析会话级模型配置、再回退到环境变量，在服务端调用提供方，最后把生成的域动作持久化。
5. 导出/导入传输的是 `{ schemaVersion: 2, state }`，且仅限当前用户自己的工作区；模型配置不包含在内。

分支会复制继承的上下文，引用以快照形式保存。因此删除原始来源不会使已有的分支或引用失效。

## 部署前提

知树是单进程、单实例服务。SQLite 要求可持久化的本地存储，它不是共享文件系统，也不是可水平扩展的方案。启动 API 前请先执行 `alembic upgrade head`，备份 `DATABASE_URL`，并在生产环境使用 HTTPS 搭配 `APP_ENV=production` 以获得安全 Cookie。

AI 网关位于服务端。配置了 `DATA_ENCRYPTION_KEY` 时，会话密钥以 AES-256-GCM 加密；生产环境在未配置该密钥时拒绝保存会话密钥。提供方 URL 会被校验、在使用前重新解析，且绝不跟随重定向。这些控制手段是对出站网络控制的补充，而非替代。

运维覆盖是刻意受限的：没有高可用、多节点协调、复制、托管备份服务，也没有可用的 OIDC 适配器。后端与浏览器侧的覆盖分别通过 `py -m pytest backend/tests -q` 和 `npm run test:browser` 运行。
