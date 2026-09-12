"""Build identity and complete, hash-checked onedir ZIP releases."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import struct
import sys
import tomllib
import zipfile

DESKTOP = Path(__file__).resolve().parent


def prepare():
    if struct.calcsize('P') != 8:
        raise RuntimeError('Use x64 Python to build the Windows x64 release')
    version = tomllib.loads((DESKTOP.parent / 'backend/pyproject.toml').read_text(encoding='utf-8'))['project']['version']
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    info = {'version': version, 'build_id': f'{version}-{stamp}', 'architecture': 'x64'}
    (DESKTOP / 'build-info.json').write_text(json.dumps(info, indent=2), encoding='utf-8')
    print(json.dumps(info))


def package():
    source = DESKTOP / 'dist/Zhishu'
    info = json.loads((source / '_internal/build-info.json').read_text(encoding='utf-8'))
    required = ['Zhishu.exe', f'_internal/python{sys.version_info.major}{sys.version_info.minor}.dll',
                '_internal/apps/web/dist/index.html',
                '_internal/pythonnet/runtime/Python.Runtime.dll',
                '_internal/clr_loader/ffi/dlls/amd64/ClrLoader.dll',
                '_internal/webview/lib/runtimes/win-x64/native/WebView2Loader.dll',
                '_internal/webview/lib/Microsoft.Web.WebView2.Core.dll',
                '_internal/webview/lib/Microsoft.Web.WebView2.WinForms.dll']
    for relative in required:
        if not (source / relative).is_file():
            raise RuntimeError(f'Missing packaged dependency: {relative}')
    destination = source.parent / f"Zhishu-{info['build_id']}-windows-x64.zip"
    files = sorted(path for path in source.rglob('*') if path.is_file())
    hashes = {}
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            name = path.relative_to(source.parent).as_posix()
            hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
            archive.write(path, name)
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == set(hashes)
        for name, digest in hashes.items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == digest, name
    alias = source.parent / 'Zhishu-windows-x64.zip'
    shutil.copyfile(destination, alias)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    for path in (destination, alias):
        path.with_suffix('.zip.sha256').write_text(f'{digest}  {path.name}\n', encoding='ascii')
    destination.with_suffix('.manifest.json').write_text(json.dumps({'build': info, 'sha256': digest, 'file_count': len(files), 'files': hashes}, indent=2), encoding='utf-8')
    print(json.dumps({'zip': str(destination), 'alias': str(alias), 'sha256': digest, 'file_count': len(files)}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'package'])
    args = parser.parse_args()
    prepare() if args.action == 'prepare' else package()
