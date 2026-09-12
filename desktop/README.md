# 知树 Windows Desktop

这是 Windows 10/11 的可分发桌面版。开发者在仓库根目录准备好 Node.js、npm 和 Python 3.13+ 后，运行：

```powershell
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

构建脚本会构建 Web 客户端、安装桌面依赖并生成 PyInstaller `onedir` 发布目录；任一步返回非零退出码立即停止。发送给用户的完整包是 **`desktop\dist\Zhishu-windows-x64.zip`**，顶层为 `Zhishu` 文件夹。解压后运行 `Zhishu\Zhishu.exe`，保留 `_internal` 全部内容。另生成带版本和 UTC 构建时间的唯一文件名 `Zhishu-<build_id>-windows-x64.zip`、各 ZIP 的 `.sha256` 及逐文件哈希清单，便于确认双方使用同一个包。

用户无需 Python、Node.js 或单独启动服务。需要 x64 Windows、.NET Framework 4.6.2 或更新版本和 Microsoft Edge WebView2 Runtime；缺失时请安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。包内包含 Python、pythonnet、CLR loader 与 WebView2 桥接 DLL，系统运行时不随包分发。

首次运行会在 `%LOCALAPPDATA%\Zhishu` 创建 SQLite 数据库和由当前 Windows 用户 DPAPI 保护的主密钥。不要删除或替换 `master-key.dpapi`，否则已保存的模型 API key 无法解密。日志位于 `%LOCALAPPDATA%\Zhishu\logs\desktop.log`。

启动日志包含时间戳、PID、build ID、EXE 路径、启动 CWD、资源位置及存在性、原生运行时初始化和页面加载/关闭记录，不记录模型密钥。`_internal\build-info.json` 可核对包版本。桌面版不读取启动目录里的 `.env`。Python 层启动异常用 Windows 原生消息框提示日志位置，不依赖 tkinter；若 EXE 已被隔离或 Python 启动前失败，不会产生本次应用日志。2026-09-12 排查发现 Defender 曾隔离旧 EXE；遇到解压后 EXE 消失，应查看 Windows 安全中心的保护历史记录并报告检测名称和包哈希，不要把旧日志当作本次错误。

桌面版使用持久化 WebView2 配置目录 `browser-profile` 保存会话身份。旧版遗留的零字节主密钥，仅在确认数据库没有保存模型凭据时自动恢复；非空损坏密钥或已有凭据时会提示从备份恢复。

Windows 回归测试：`py -m pytest desktop/tests -q`（调用真实 DPAPI）。发布 ZIP 验证：`py desktop/tests/packaged_smoke.py --parent <已存在的临时目录> --zip desktop/dist/Zhishu-windows-x64.zip`，需要测试环境安装 Playwright、Pillow、pywin32；它校验 ZIP 和解压文件哈希，在中文空格路径中运行 EXE，清理开发环境变量和 PATH，在仓库外放置干扰 `.env`，使用隔离 LOCALAPPDATA。通过临时 `ZHISHU_WEBVIEW_DEBUG_PORT` 连接实际 WebView2，保存原生窗口截图，验证创建主题、模型密钥加密保存、关闭重开后的身份和数据持久化，并检查原生 DLL 加载路径。真实用户数据仅作只读完整性/哈希检查，不启动其配置。结果在临时目录 `evidence.json`，不调用真实模型服务。正常运行不启用调试端口。
