# 知树

知树是一个自托管学习工作台。你可以从消息中的精确选区展开独立讨论，保留引用内容的快照，并将工作区保存在服务端而不是浏览器本地存储中。

[English README](README.md)

## 开始使用

需要 Node.js 22.12+（或 24 LTS）、npm 与 Python 3.12+。项目内置 SQLite，无需 Docker 或外部数据库。

先安装依赖，并创建本地环境文件：

```sh
npm install
py -m pip install -e "backend[test]"
```

Windows CMD：

```cmd
copy .env.example .env
```

macOS、Linux 或其他 POSIX shell：

```sh
cp .env.example .env
```

初始化数据库后，在两个终端分别启动 FastAPI 和 Vite：

```sh
py -m alembic -c backend/alembic.ini upgrade head
py -m uvicorn app.main:app --app-dir backend --reload --port 8000
npm run dev:web
```

在浏览器打开 `http://127.0.0.1:5173`。前端开发服务器使用 `5173` 端口，FastAPI 使用 `8000` 端口。

部署单进程自托管版本：

```sh
npm run build
py -m alembic -c backend/alembic.ini upgrade head
py -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

对外部署前，请设置 `APP_ENV=production`、持久化的 `DATABASE_URL` 和 `DATA_ENCRYPTION_KEY`。

## 设置模型

可以在 `.env` 中设置 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL` 与可选的 `AI_TIMEOUT_MS`，作为服务端默认模型；也可以在界面的“设置与数据”中，为当前匿名会话填写 OpenAI 兼容服务。会话密钥只会提交给同源 API，不会出现在读取接口、浏览器存储、URL、日志或导出文件中。

生产环境若允许保存会话模型凭据，必须设置 `DATA_ENCRYPTION_KEY`，它是 32 字节密钥的 base64 编码。开发环境未设置该项时，API 会生成只在当前进程有效的临时密钥，所以重启后已保存的会话凭据无法读取。可用 `AI_ALLOWED_HOSTS` 限制用户可配置的模型服务主机名。

## Windows 桌面版

在 Windows 上运行 `desktop\build.ps1` 会产出两种可分发形式，都在 `desktop\dist\`：

- **`Zhishu-Setup-windows-x64.exe`**（推荐）——用户双击安装，自动处理 WebView2 Runtime 和快捷方式，按用户安装、不需要管理员权限
- **`Zhishu-windows-x64.zip`**——便携版，解压后运行 `Zhishu\Zhishu.exe`，需要保留 `_internal` 整个文件夹

两种形式都自带 Python 与全部依赖，用户无需安装 Python、Node.js 或单独启动服务。数据统一存在 `%LOCALAPPDATA%\Zhishu`，卸载不会删除它。程序需要 x64 Windows 10/11；安装包会在缺少 Microsoft Edge WebView2 Runtime 时自动安装。构建细节与已知限制（尚未代码签名、向导语言）见 [桌面宿主文档](desktop/README.md)。

## 验证

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
```

浏览器冒烟测试会构建前端、以临时 SQLite 启动 FastAPI，并通过已安装的 `playwright-core` 驱动 Chrome。可设置 `CHROME_PATH`；截图输出到 `test-results/browser-smoke.png`。

## 延伸阅读

- [架构](docs/architecture.md)
- [Python 后端](backend/README.md)
- [Web 客户端](apps/web/README.md)
- [Windows 桌面宿主](desktop/README.md)
