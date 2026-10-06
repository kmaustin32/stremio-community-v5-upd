"""Verify the actual installer contains the fork executable and its branded resources.

Windows data-resource loading and 7-Zip extraction do not execute the application
or installer. This catches packaging an upstream executable despite source tests passing.
"""
import argparse
import ctypes as c
from ctypes import wintypes as w
import hashlib
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
from mpv_smoke import read_png


def digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def verify(exe):
    root = Path(__file__).resolve().parents[1]
    kernel = c.WinDLL('kernel32', use_last_error=True)
    kernel.LoadLibraryExW.argtypes = [w.LPCWSTR, w.HANDLE, w.DWORD]
    kernel.LoadLibraryExW.restype = w.HMODULE
    kernel.FindResourceW.argtypes = [w.HMODULE, c.c_void_p, c.c_void_p]
    kernel.FindResourceW.restype = w.HANDLE
    kernel.LoadResource.argtypes = [w.HMODULE, w.HANDLE]
    kernel.LoadResource.restype = w.HANDLE
    kernel.LockResource.argtypes = [w.HANDLE]
    kernel.LockResource.restype = c.c_void_p
    kernel.SizeofResource.argtypes = [w.HMODULE, w.HANDLE]
    kernel.SizeofResource.restype = w.DWORD
    kernel.FreeLibrary.argtypes = [w.HMODULE]
    module = kernel.LoadLibraryExW(str(exe.resolve()), None, 0x2 | 0x20)
    assert module, f'Cannot read executable resources: {c.get_last_error()}'

    def resource(name, kind):
        found = kernel.FindResourceW(module, name, kind)
        assert found, f'Missing fork resource {name}'
        pointer = kernel.LockResource(kernel.LoadResource(module, found))
        return c.string_at(pointer, kernel.SizeofResource(module, found))

    try:
        sources = {102: 'images/stremio.png', 103: 'images/web-symbol.png',
                   104: 'images/web-logo.png', 105: 'images/stremio2.png'}
        for name, relative in sources.items():
            source = root / relative
            assert resource(name, 10) == source.read_bytes(), f'Stale embedded image: {relative}'
        group = resource(101, 14)
        count = struct.unpack_from('<H', group, 4)[0]
        source_icon = (root / 'images/stremio2.ico').read_bytes()
        source_count = struct.unpack_from('<H', source_icon, 4)[0]
        source_images = {}
        for index in range(source_count):
            offset = 6 + index * 16
            width, height = struct.unpack_from('<BB', source_icon, offset)
            length, start = struct.unpack_from('<II', source_icon, offset + 8)
            source_images[(width or 256, height or 256)] = source_icon[start:start + length]
        sizes = set()
        for index in range(count):
            offset = 6 + index * 14
            width, height = struct.unpack_from('<BB', group, offset)
            size = (width or 256, height or 256)
            sizes.add(size)
            icon_id = struct.unpack_from('<H', group, offset + 12)[0]
            assert resource(icon_id, 3) == source_images[size], f'Stale Windows icon: {size}'
        assert sizes == {(n, n) for n in (16, 24, 32, 48, 64, 128, 256)}, sizes
        width, height, pixel = read_png(root / 'images/stremio2.png')
        assert pixel(width // 4, height // 2) == (114, 114, 194), 'Wrong branding color'
    finally:
        kernel.FreeLibrary(module)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--exe', required=True, type=Path)
    parser.add_argument('--original', required=True, type=Path)
    parser.add_argument('--installer', required=True, type=Path)
    args = parser.parse_args()
    assert digest(args.exe) != digest(args.original), 'Packaged executable is the original community build'
    verify(args.exe)
    seven_zip = shutil.which('7z.exe') or 'C:/Program Files/7-Zip/7z.exe'
    with tempfile.TemporaryDirectory(prefix='stremio-package-test-') as folder:
        subprocess.run([seven_zip, 'x', str(args.installer), 'stremio.exe', f'-o{folder}', '-y'],
                       check=True, capture_output=True)
        installed = Path(folder) / 'stremio.exe'
        assert digest(installed) == digest(args.exe), 'Installer embeds a different executable'
        verify(installed)
    print('PASS: installer contains the fork executable, exact branding resources, and all Windows icon sizes')


if __name__ == '__main__':
    main()
