# 知树架构

## 模块边界

React Web 客户端负责渲染服务端分页视图并发送命令。它不决定持久状态的变更，不存储学习数据，也不保存模型凭据。组件职责见 [web 客户端](../apps/web/README.md)。

`backend/app/domain` 负责确定性的状态变更、校验，以及与 JavaScript 兼容的 UTF-16 偏移。它不依赖 HTTP、数据库或浏览器。

FastAPI 的 Pydantic 模型负责 HTTP 边界。Python API 认证本地匿名会话、校验请求、调用域状态变更、持久化快照，并且是唯一与 SQLite 和模型提供方通信的组件。见 [backend](../backend/README.md)。

## 数据流

1. 首次请求会创建一个匿名用户，并下发 `HttpOnly`、`SameSite=Lax` 的会话 Cookie。
2. 客户端读取 revision/active 摘要、分支元数据和 cursor 页，随后带着 revision 发送命令；普通写操作只返回 compact 影响 ID。
3. Repository 对发送、回答、草稿和重试执行增量 SQL；分叉逐条迭代来源前缀，引用只读取选中消息并以 SQL 检查重复。过期 revision 返回冲突。删除撤销只给前端单次使用 token，正文保存在服务端。
4. AI 请求在最近 100 条、合计最多 64,000 字符的预算内组装输入，确保包含选区和最新问题；裁剪历史会向用户和模型说明，必需内容超预算则阻止生成。先解析会话级模型配置、再回退到环境变量，在服务端调用提供方，最后增量保存回答。流结束只返回 compact 结果，不替换其他分支视图或未保存草稿。
5. 小型备份保留 `{ schemaVersion: 2, state }`；大型备份使用有记录大小限制的 NDJSON、磁盘暂存与最终原子复制。两者均不包含模型配置。

分支会复制继承的上下文，引用以快照形式保存。因此删除原始来源不会使已有的分支或引用失效。

## 部署前提

知树是单进程、单实例服务。SQLite 使用本地持久化存储，启用 WAL、NORMAL、外键及 5 秒 busy timeout。启动自动执行 Alembic，也支持显式 `alembic upgrade head`。首次访问用户工作区时将旧 JSON 事务性迁移到规范化表，并保留原字段；原字段只是迁移时备份，不代表后续最新状态。请保留完整数据库与加密密钥，不要用旧程序打开升级后的库。

AI 网关位于服务端。配置了 `DATA_ENCRYPTION_KEY` 时，会话密钥以 AES-256-GCM 加密；生产环境在未配置该密钥时拒绝保存会话密钥。提供方 URL 会被校验、在使用前重新解析，且绝不跟随重定向。这些控制手段是对出站网络控制的补充，而非替代。

运维覆盖是刻意受限的：没有高可用、多节点协调、复制、托管备份服务，也没有可用的 OIDC 适配器。后端与浏览器侧的覆盖分别通过 `py -m pytest backend/tests -q` 和 `npm run test:browser` 运行。

## 当前边界

React 主题/消息 DOM 每页最多 40 行。流式运行状态独立于持久数据，完成后校验 owner、run 与上下文签名再保存一次。OpenAI、Anthropic、Gemini 各自映射真实文本协议，尚无真实厂商账号验证。

controller 最多缓存 8 个消息页，每分支最多 3 页；主题、来源、上下文及引用列表均为服务端每页 40 条。引用选择最多 100 个 ID；默认全选背景使用 scope 和最多 200 个排除 ID，由服务端迭代映射。正常 UI 不调用全量快照。仍保留的全量路径是 8 MiB 预算内的旧快照/JSON 导出、旧 JSON 迁移与导入，以及服务端单分支撤销正文；部分元数据动作仍加载全部主题/会话元数据。NDJSON 最终复制与分叉复制仍可能持有较长写事务。缓存条目数有界不代表任意记录大小下的字节/RSS 保证，也没有 TB 规模或真实厂商账号验证。详见 [backend](../backend/README.md) 与 [web](../apps/web/README.md)。

## 架构研究来源

参考用户指定的 Cherry Studio SHA `fc96ba8953aa89d3ca4216906ea32766d97bc911`（AGPLv3）的设计原则，Python/TypeScript 独立实现，未复制其源码或资源。[固定源码链接](architecture.md#architecture-references)涵盖运行态分离、协议注册、流事件与 SQLite 服务。
