# PyInstaller onedir specification. Run desktop\build.ps1.
from pathlib import Path

desktop = Path(SPECPATH)
root = desktop.parent
a = Analysis(
    [str(desktop / 'launcher.py')], pathex=[str(root / 'backend')],
    datas=[(str(root / 'apps/web/dist'), 'apps/web/dist'),
           (str(desktop / 'build-info.json'), '.')],
    hiddenimports=['app.main', 'app.config', 'app.db', 'app.services',
                   'app.domain', 'app.domain.workspace', 'app.domain.utf16',
                   'uvicorn.logging', 'uvicorn.loops.auto',
                   'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets.auto',
                   'webview', 'webview.platforms.winforms',
                   'webview.platforms.edgechromium', 'win32crypt'],
    binaries=[],
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='Zhishu', console=False, upx=False)
coll = COLLECT(exe, a.binaries, a.datas, name='Zhishu', upx=False)
