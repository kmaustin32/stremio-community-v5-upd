"""Exercise the shipped libmpv DLL in an embedded Win32 window using D3D11 WARP.

Checks real rendered pillarbox pixels with blur off/on, rather than only testing
that mpv accepts an option. Uses Python's standard library only.
"""
import argparse
import ctypes as c
from ctypes import wintypes as w
import pathlib
import struct
import time
import zlib


def read_png(path):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    compressed = bytearray()
    offset = 8
    while offset < len(data):
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + size]
        if kind == b'IHDR':
            width, height, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', payload)
            assert depth == 8 and color in (2, 6) and interlace == 0
            channels = 3 if color == 2 else 4
        elif kind == b'IDAT':
            compressed.extend(payload)
        offset += size + 12
    raw = zlib.decompress(compressed)
    stride = width * channels
    previous = bytearray(stride)
    rows = []
    for y in range(height):
        start = y * (stride + 1)
        mode = raw[start]
        row = bytearray(raw[start + 1:start + stride + 1])
        for x in range(stride):
            left = row[x - channels] if x >= channels else 0
            up = previous[x]
            upper_left = previous[x - channels] if x >= channels else 0
            if mode == 1:
                predictor = left
            elif mode == 2:
                predictor = up
            elif mode == 3:
                predictor = (left + up) // 2
            elif mode == 4:
                estimate = left + up - upper_left
                distances = [abs(estimate - v) for v in (left, up, upper_left)]
                predictor = (left, up, upper_left)[distances.index(min(distances))]
            else:
                assert mode == 0
                predictor = 0
            row[x] = (row[x] + predictor) & 255
        rows.append(row)
        previous = row
    return width, height, lambda x, y: tuple(rows[y][x * channels:x * channels + 3])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dll', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--video', help='Optional encoded sample to exercise video decoding as well')
    args = parser.parse_args()
    output = pathlib.Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    dll = c.CDLL(str(pathlib.Path(args.dll).resolve()))
    dll.mpv_create.restype = c.c_void_p
    dll.mpv_initialize.argtypes = [c.c_void_p]
    dll.mpv_set_option_string.argtypes = [c.c_void_p, c.c_char_p, c.c_char_p]
    dll.mpv_set_property_string.argtypes = [c.c_void_p, c.c_char_p, c.c_char_p]
    dll.mpv_get_property_string.argtypes = [c.c_void_p, c.c_char_p]
    dll.mpv_get_property_string.restype = c.c_void_p
    dll.mpv_free.argtypes = [c.c_void_p]
    dll.mpv_command.argtypes = [c.c_void_p, c.POINTER(c.c_char_p)]
    dll.mpv_terminate_destroy.argtypes = [c.c_void_p]
    dll.mpv_error_string.argtypes = [c.c_int]
    dll.mpv_error_string.restype = c.c_char_p
    dll.mpv_load_config_file.argtypes = [c.c_void_p, c.c_char_p]
    user32 = c.WinDLL('user32', use_last_error=True)
    user32.CreateWindowExW.argtypes = [w.DWORD, w.LPCWSTR, w.LPCWSTR, w.DWORD,
                                     c.c_int, c.c_int, c.c_int, c.c_int,
                                     w.HWND, w.HMENU, w.HINSTANCE, c.c_void_p]
    user32.CreateWindowExW.restype = w.HWND
    user32.DestroyWindow.argtypes = [w.HWND]
    user32.PeekMessageW.argtypes = [c.POINTER(w.MSG), w.HWND, w.UINT, w.UINT, w.UINT]
    user32.DispatchMessageW.argtypes = [c.POINTER(w.MSG)]
    # An off-screen host prevents interrupting the user's desktop.
    hwnd = user32.CreateWindowExW(0, 'STATIC', 'Stremio embedded render test',
                                 0x80000000 | 0x10000000, -3000, -3000, 800, 450,
                                 None, None, None, None)
    assert hwnd, f'CreateWindowExW failed: {c.get_last_error()}'
    player = dll.mpv_create()
    assert player

    def checked(code):
        if code < 0:
            raise RuntimeError(dll.mpv_error_string(code).decode())

    def prop(name):
        value = dll.mpv_get_property_string(player, name.encode())
        if not value:
            return ''
        result = c.string_at(value).decode()
        dll.mpv_free(value)
        return result

    def command(*values):
        checked(dll.mpv_command(player, (c.c_char_p * (len(values) + 1))(
            *[str(v).encode() for v in values], None)))

    def pump(seconds):
        end = time.monotonic() + seconds
        msg = w.MSG()
        while time.monotonic() < end:
            while user32.PeekMessageW(c.byref(msg), None, 0, 0, 1):
                user32.DispatchMessageW(c.byref(msg))
            time.sleep(0.01)

    try:
        sample = output / 'sample.ppm'
        sample.write_bytes(b'P6\n320 240\n255\n' + b''.join(
            bytes((80 + x // 2, 80 + y // 2, 160)) for y in range(240) for x in range(320)))
        if args.video:
            sample = pathlib.Path(args.video).resolve()
        # Also prove the exact documented options work when loaded from mpv.conf.
        config = output / 'mpv.conf'
        config.write_text('vo=gpu-next\nborder-background=color\nbackground-blur-radius=16\n')
        for name, value in {'config': 'no', 'load-scripts': 'no', 'terminal': 'yes',
                            'wid': str(hwnd), 'gpu-api': 'd3d11', 'd3d11-warp': 'yes',
                            'image-display-duration': 'inf', 'pause': 'yes',
                            'screenshot-high-bit-depth': 'no'}.items():
            checked(dll.mpv_set_option_string(player, name.encode(), value.encode()))
        checked(dll.mpv_load_config_file(player, str(config).encode()))
        checked(dll.mpv_initialize(player))
        print('Runtime:', prop('mpv-version'), 'libplacebo:', prop('libplacebo-version'))
        assert prop('mpv-version').startswith('mpv v0.41.'), prop('mpv-version')
        command('loadfile', sample)
        for _ in range(100):
            pump(0.1)
            if prop('current-vo') == 'gpu-next' and prop('video-params'):
                break
        assert prop('current-vo') == 'gpu-next', 'Embedded renderer did not start'
        pump(0.5)
        off = output / 'blur-off.png'
        command('screenshot-to-file', off, 'window')
        checked(dll.mpv_set_property_string(player, b'border-background', b'blur'))
        pump(0.5)
        on = output / 'blur-on.png'
        command('screenshot-to-file', on, 'window')
        width, height, pixel_off = read_png(off)
        on_width, on_height, pixel_on = read_png(on)
        assert (width, height) == (800, 450) == (on_width, on_height), (width, height)
        assert max(pixel_off(25, 225)) < 5, pixel_off(25, 225)
        assert max(pixel_on(25, 225)) > 30, pixel_on(25, 225)
        assert max(abs(a - b) for a, b in zip(pixel_off(400, 225), pixel_on(400, 225))) < 5
        assert prop('background-blur-radius') == '16.000000', prop('background-blur-radius')
        # Switching back while the same media is loaded restores solid borders.
        checked(dll.mpv_set_property_string(player, b'border-background', b'color'))
        pump(0.3)
        restored = output / 'blur-restored.png'
        command('screenshot-to-file', restored, 'window')
        assert max(read_png(restored)[2](25, 225)) < 5
        print('PASS: embedded gpu-next playback; native mpv.conf options; live blur on/off; unchanged video and radius')
    finally:
        dll.mpv_terminate_destroy(player)
        user32.DestroyWindow(hwnd)


if __name__ == '__main__':
    main()
