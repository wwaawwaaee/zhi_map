# 知树 Windows Desktop

这是 Windows 10/11 的可分发桌面版。开发者在仓库根目录准备好 Node.js、npm、Python 3.12+ 与 [Inno Setup](https://jrsoftware.org/isdl.php) 6.3+ 后，运行：

```powershell
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

只想要便携 ZIP、不装 Inno Setup 时加 `-SkipInstaller`。

构建脚本会构建 Web 客户端、安装桌面依赖、生成 PyInstaller `onedir` 发布目录，最后编译安装包；任一步返回非零退出码立即停止。产物都在 `desktop\dist\`。

## 分发给用户的两种形式

**安装包（推荐）**：`Zhishu-Setup-windows-x64.exe`，用户双击一次即可，不需要解压或手动装运行时。

- 按用户安装到 `%LOCALAPPDATA%\Programs\Zhishu`，不要求管理员权限、不弹 UAC
- 创建开始菜单快捷方式；桌面快捷方式在向导里勾选
- 检测到缺少 WebView2 Runtime 时，先静默安装运行时**再**复制程序文件。引导程序在构建时从 `go.microsoft.com` 下载并缓存到 `desktop\build\`，构建时校验其 Authenticode 签名；安装过程本身不需要联网
- 版本号取自 `backend/pyproject.toml`，升级时原地覆盖，`AppId` 固定不变
- 卸载**不会**删除 `%LOCALAPPDATA%\Zhishu` 里的数据，并在结束时提示该目录位置。安装和卸载都不写入用户数据目录

抓取 WebView2 引导程序是**尽力而为**的，不是构建的硬依赖：微软的投递 CDN（`msedge.sf.dl.delivery.mp.microsoft.com`）在部分网络下不可达——2026-09-12 在本机实测被代理规则拦断（两个域名都解析到 `198.18.0.x` 的 fake-IP 段，第二个 TLS 连接被直接切断）。取不到时构建照常成功，只是产出一个**不含运行时**的安装包，安装时会提示用户自己去下载。想让安装包内置运行时，把 `MicrosoftEdgeWebview2Setup.exe` 手动放到 `desktop\build\` 即可，构建会校验文件名对应的签名后使用它。

`Zhishu-Setup-<build_id>-windows-x64.exe` 是带版本和 UTC 构建时间的唯一文件，另生成各安装包的 `.sha256`、同构建的 `.manifest.json`，以及逐文件哈希清单的 ZIP 版本，便于确认双方使用同一个包。

**便携 ZIP**：`Zhishu-windows-x64.zip`，顶层为 `Zhishu` 文件夹。解压后运行 `Zhishu\Zhishu.exe`，保留 `_internal` 全部内容。

## 发布后续版本

版本号只有一个来源：`backend/pyproject.toml` 的 `project.version`。`release.py prepare` 读它写出 `build-info.json`，加上 UTC 时间戳组成 `build_id`，再由 `build.ps1` 作为编译期定义传给 [installer.iss](installer.iss)——`AppVersion`、卸载项里的 `DisplayVersion`、`VersionInfoTextVersion` 和产物文件名都来自这两个值。

1. 改 `backend/pyproject.toml` 的 `version`。**不要动** [installer.iss](installer.iss) 里的 `AppId`：它是升级关系的唯一依据，改了会让新版本与旧版本并存，而不是原地覆盖。
2. 在仓库根目录执行 `powershell -ExecutionPolicy Bypass -File desktop\build.ps1`。
3. 分发 `desktop\dist\Zhishu-Setup-windows-x64.exe` 和它的 `.sha256`。它与带 `build_id` 的那份逐字节相同，只是文件名固定。

JS 依赖有变动时先跑 `npm install`——`build.ps1` 只跑 `npm run build:web`，自己不会装依赖。`py` 必须是标准布局的 CPython（python.org 或 uv）；conda 版会把 `sqlite3.dll` 放在 `Library\bin`，PyInstaller 收集不到，产出的 EXE 启动即崩。

构建时的两条警告（缺 `ChineseSimplified.isl`、取不到 WebView2 引导程序）都是设计好的降级路径，不是错误，处置办法见下方「构建注意事项」。

发布前至少确认：

- `py -m pytest desktop/tests -q` 全绿
- 静默安装（`Zhishu-Setup-*.exe /SILENT`）后，安装目录与 `desktop\dist\Zhishu` 逐文件哈希一致——PyInstaller 漏收依赖只有启动时才会暴露，这一步能提前挡住
- 启动装好的 `Zhishu.exe`，能出窗口并加载页面
- 卸载后 `%LOCALAPPDATA%\Zhishu` 一个文件都没少
- `py desktop\tests\packaged_smoke.py --parent <已存在的临时目录> --zip desktop\dist\Zhishu-windows-x64.zip`。若所在网络把域名解析进 `198.18.0.0/15`（fake-IP 代理），脚本会停在保存模型配置那一步并报 400：后端 `valid_url()` 会把这类地址判为私网。属环境问题，与发布包无关

## 构建注意事项

安装包目前**未做代码签名**，用户首次运行会遇到 SmartScreen 的“未知发布者”提示。签名是消除该提示与 Defender 误报的唯一办法。

向导默认是英文：Inno Setup 不自带简体中文，把第三方 `ChineseSimplified.isl` 放进 Inno Setup 安装目录的 `Languages\` 后，构建脚本会自动改用中文，缺失时给出警告。放一个 `desktop\zhishu.ico` 并取消 [installer.iss](installer.iss) 中 `SetupIconFile` 那行的注释即可设置图标。

## 运行时行为

用户无需 Python、Node.js 或单独启动服务。需要 x64 Windows、.NET Framework 4.6.2 或更新版本和 Microsoft Edge WebView2 Runtime；缺失时请安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。包内包含 Python、pythonnet、CLR loader 与 WebView2 桥接 DLL，系统运行时不随包分发。

首次运行会在 `%LOCALAPPDATA%\Zhishu` 创建 SQLite 数据库和由当前 Windows 用户 DPAPI 保护的主密钥。不要删除或替换 `master-key.dpapi`，否则已保存的模型 API key 无法解密。日志位于 `%LOCALAPPDATA%\Zhishu\logs\desktop.log`。

启动日志包含时间戳、PID、build ID、EXE 路径、启动 CWD、资源位置及存在性、原生运行时初始化和页面加载/关闭记录，不记录模型密钥。`_internal\build-info.json` 可核对包版本。桌面版不读取启动目录里的 `.env`。Python 层启动异常用 Windows 原生消息框提示日志位置，不依赖 tkinter；若 EXE 已被隔离或 Python 启动前失败，不会产生本次应用日志。2026-09-12 排查发现 Defender 曾隔离旧 EXE；遇到解压后 EXE 消失，应查看 Windows 安全中心的保护历史记录并报告检测名称和包哈希，不要把旧日志当作本次错误。

桌面版使用持久化 WebView2 配置目录 `browser-profile` 保存会话身份。旧版遗留的零字节主密钥，仅在确认数据库没有保存模型凭据时自动恢复；非空损坏密钥或已有凭据时会提示从备份恢复。

Windows 回归测试：`py -m pytest desktop/tests -q`（调用真实 DPAPI）。发布 ZIP 验证：`py desktop/tests/packaged_smoke.py --parent <已存在的临时目录> --zip desktop/dist/Zhishu-windows-x64.zip`，需要测试环境安装 Playwright、Pillow、pywin32；它校验 ZIP 和解压文件哈希，在中文空格路径中运行 EXE，清理开发环境变量和 PATH，在仓库外放置干扰 `.env`，使用隔离 LOCALAPPDATA。通过临时 `ZHISHU_WEBVIEW_DEBUG_PORT` 连接实际 WebView2，保存原生窗口截图，验证创建主题、模型密钥加密保存、关闭重开后的身份和数据持久化，并检查原生 DLL 加载路径。真实用户数据仅作只读完整性/哈希检查，不启动其配置。结果在临时目录 `evidence.json`，不调用真实模型服务。正常运行不启用调试端口。
