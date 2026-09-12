; 知树 Windows 安装包。需要 Inno Setup 6.3 或更新版本（x64compatible 架构标识）。
; 正常由 desktop\build.ps1 调用，也可手动编译：
;   ISCC.exe /DAPP_VERSION=2.0.0 /DBUILD_ID=2.0.0-20260912T000000000000Z installer.iss

#ifndef APP_VERSION
  #define APP_VERSION "0.0.0"
#endif
#ifndef BUILD_ID
  #define BUILD_ID "source-unversioned"
#endif
#ifndef WEBVIEW2_SETUP
  #define WEBVIEW2_SETUP "build\MicrosoftEdgeWebview2Setup.exe"
#endif
; build.ps1 取到（且签名有效）WebView2 引导程序时传 1，把运行时打进安装包；
; 取不到时传 0，安装程序改为提示用户自己去下载。默认 0 便于手工编译。
#ifndef EMBED_WEBVIEW2
  #define EMBED_WEBVIEW2 "0"
#endif
; build.ps1 按 Inno Setup 装没装 ChineseSimplified.isl 传入这两个定义。
#ifndef LANG_NAME
  #define LANG_NAME "english"
#endif
#ifndef LANG_FILE
  #define LANG_FILE "compiler:Default.isl"
#endif

; 程序装在 {localappdata}\Programs\Zhishu，用户数据在 {localappdata}\Zhishu。
; 两个路径只差一段，但绝不能混：数据目录由用户自己拥有，安装和卸载都不得写入或删除。
; 卸载程序只会清理它记录过的文件，因此这里永远不要为数据目录添加 [UninstallDelete]。
[Setup]
; AppId 是升级关系的唯一依据。一旦发布就不能再改，否则新版本会变成并存安装。
AppId={{8A7073BD-77C0-4B9F-B3A9-661427F6F416}
AppName=知树
AppVersion={#APP_VERSION}
DefaultGroupName=知树
AppPublisher=Zhishu
AppPublisherURL=https://github.com/wwaawwaaee/zhi_map
VersionInfoTextVersion={#BUILD_ID}
DefaultDirName={autopf}\Zhishu
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=dist
OutputBaseFilename=Zhishu-Setup-{#BUILD_ID}-windows-x64
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=知树
UninstallDisplayIcon={app}\Zhishu.exe
CloseApplications=yes
RestartApplications=no
; 放一个 zhishu.ico 到 desktop\ 后取消下面一行的注释，即可同时用作安装包和快捷方式图标。
; SetupIconFile=zhishu.ico

[Languages]
Name: "{#LANG_NAME}"; MessagesFile: "{#LANG_FILE}"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: unchecked

[Files]
Source: "dist\Zhishu\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; dontcopy：只在需要时由 ExtractTemporaryFile 解到 {tmp}，不留在用户机器上。
#if EMBED_WEBVIEW2 == "1"
Source: "{#WEBVIEW2_SETUP}"; DestDir: "{tmp}"; Flags: dontcopy
#endif

[Icons]
Name: "{autoprograms}\知树\知树"; Filename: "{app}\Zhishu.exe"
Name: "{autoprograms}\知树\卸载知树"; Filename: "{uninstallexe}"
Name: "{autodesktop}\知树"; Filename: "{app}\Zhishu.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Zhishu.exe"; Description: "立即启动知树"; Flags: nowait postinstall skipifsilent

[Code]
const
  WebView2ClientId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2Url = 'https://developer.microsoft.com/microsoft-edge/webview2/';

// 始终以 64 位模式运行（ArchitecturesInstallIn64BitMode），因此 HKLM 落在 64 位视图，
// 这里的 WOW6432Node 字面路径能稳定命中 EdgeUpdate 写入的位置。
function WebView2Missing: Boolean;
var
  installedVersion: String;
begin
  Result := True;
  if RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\' + WebView2ClientId, 'pv', installedVersion)
     or RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\' + WebView2ClientId, 'pv', installedVersion) then
    Result := (installedVersion = '') or (installedVersion = '0.0.0.0');
end;

// 放在复制文件之前：装不上 WebView2 就没必要先铺 100 MB 的程序文件。
function PrepareToInstall(var NeedsRestart: Boolean): String;
#if EMBED_WEBVIEW2 == "1"
var
  code: Integer;
#endif
begin
  Result := '';
  if not WebView2Missing then
    exit;
#if EMBED_WEBVIEW2 == "1"
  ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '',
              SW_SHOWNORMAL, ewWaitUntilTerminated, code) then
  begin
    Result := '无法启动 WebView2 运行时安装程序。请手动安装后重新运行知树安装包：' + #13#10 + WebView2Url;
    exit;
  end;
  if code <> 0 then
    if MsgBox('WebView2 运行时安装失败（退出码 ' + IntToStr(code) + '）。' + #13#10 +
              '知树需要它才能显示界面，缺少时程序无法启动。' + #13#10#13#10 +
              '是否仍要继续安装？稍后可手动安装：' + #13#10 + WebView2Url,
              mbConfirmation, MB_YESNO) = IDNO then
      Result := '安装已取消：缺少 WebView2 运行时。';
#else
  // 构建时没取到引导程序（例如网络到不了微软 CDN），安装包里没有运行时，
  // 只能先让用户知情，装完自行下载。注意：续行不能以 # 开头，否则会被当成预处理指令。
  if MsgBox('未检测到 Microsoft Edge WebView2 运行时，知树需要它才能显示界面。' + #13#10#13#10 +
            '本安装包未内置该运行时。安装完成后请先到下面的地址安装，再启动知树：' + #13#10 + WebView2Url + #13#10#13#10 +
            '是否继续安装？',
            mbConfirmation, MB_YESNO) = IDNO then
    Result := '安装已取消：缺少 WebView2 运行时。';
#endif
end;

procedure DeinitializeUninstall();
begin
  if UninstallSilent then
    exit;
  MsgBox('知树已卸载。' + #13#10#13#10 +
         '你的数据仍在：' + #13#10 + ExpandConstant('{localappdata}\Zhishu') + #13#10#13#10 +
         '其中包含工作区数据库和由当前 Windows 用户加密的模型密钥。' + #13#10 +
         '重新安装后会自动继续使用；如需彻底删除请手动移除该文件夹，' + #13#10 +
         '删除后已保存的模型密钥将无法恢复。',
         mbInformation, MB_OK);
end;
