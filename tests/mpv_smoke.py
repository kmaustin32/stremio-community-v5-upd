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
    dll_path = pathlib.Path(args.dll).resolve()
    dll = c.CDLL(str(dll_path))
    kernel32 = c.WinDLL('kernel32')
    kernel32.GetModuleHandleW.argtypes = [w.LPCWSTR]
    kernel32.GetModuleHandleW.restype = w.HMODULE
    kernel32.GetModuleFileNameW.argtypes = [w.HMODULE, w.LPWSTR, w.DWORD]
    loader_path = c.create_unicode_buffer(32768)
    kernel32.GetModuleFileNameW(kernel32.GetModuleHandleW('vulkan-1.dll'), loader_path, len(loader_path))
    assert pathlib.Path(loader_path.value).parent == dll_path.parent, 'Must use the bundled Vulkan loader'
    print('Bundled Vulkan loader:', loader_path.value)
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
        # Load the actual defaults shipped by the packager, including input.conf.
        config_dir = pathlib.Path(__file__).resolve().parents[1] / 'utils/mpv/anime4k/portable_config'
        config = config_dir / 'mpv.conf'
        for name, value in {'config': 'yes', 'load-scripts': 'no', 'terminal': 'yes',
                            'config-dir': str(config_dir), 'input-conf': str(config_dir / 'input.conf'),
                            'gpu-shader-cache-dir': str(output / 'shader-cache'),
                            'wid': str(hwnd), 'gpu-api': 'd3d11', 'd3d11-warp': 'yes',
                            'image-display-duration': 'inf', 'pause': 'yes', 'ao': 'null',
                            'screenshot-high-bit-depth': 'no'}.items():
            checked(dll.mpv_set_option_string(player, name.encode(), value.encode()))
        checked(dll.mpv_load_config_file(player, str(config).encode()))
        checked(dll.mpv_initialize(player))
        print('Runtime:', prop('mpv-version'), 'libplacebo:', prop('libplacebo-version'))
        assert prop('mpv-version').startswith('mpv v0.41.'), prop('mpv-version')
        assert prop('border-background') == 'blur'
        assert prop('background-blur-radius') == '25.000000'
        assert prop('sub-ass-override') == 'force'
        command('loadfile', sample)
        for _ in range(100):
            pump(0.1)
            if prop('current-vo') == 'gpu-next' and prop('video-params'):
                break
        assert prop('current-vo') == 'gpu-next', 'Embedded renderer did not start'
        pump(0.5)
        default = output / 'blur-default.png'
        command('screenshot-to-file', default, 'window')
        assert max(read_png(default)[2](25, 225)) > 30, 'Default blur did not render'
        checked(dll.mpv_set_property_string(player, b'border-background', b'color'))
        pump(0.3)
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
        assert prop('background-blur-radius') == '25.000000', prop('background-blur-radius')
        # Switching back while the same media is loaded restores solid borders.
        checked(dll.mpv_set_property_string(player, b'border-background', b'color'))
        pump(0.3)
        restored = output / 'blur-restored.png'
        command('screenshot-to-file', restored, 'window')
        assert max(read_png(restored)[2](25, 225)) < 5
        # Exercise the real key bindings, rather than duplicating their commands.
        for key in range(1, 8):
            command('keypress', f'Ctrl+{key}')
            pump(0.1)
            shaders = [shader for shader in prop('glsl-shaders').split(';') if shader]
            assert shaders, f'Ctrl+{key} did not select shaders'
            for shader in shaders:
                shader_path = config_dir / shader[3:] if shader.startswith('~~/') else pathlib.Path(shader)
                assert shader_path.is_file(), f'Missing shader: {shader}'
            if key == 7:
                pump(0.3)
                command('screenshot-to-file', output / 'fsr.png', 'window')
            command('keypress', 'Ctrl+8')
            pump(0.1)
            assert not prop('glsl-shaders'), 'Ctrl+8 did not clear shaders'
        command('keypress', 'F1')
        pump(0.1)
        assert 'loudnorm' in prop('af'), 'F1 did not enable normalization'
        command('keypress', 'F1')
        pump(0.1)
        assert 'loudnorm' not in prop('af'), 'F1 did not disable normalization'
        for override in ('strip', 'no', 'force'):
            command('keypress', 'F2')
            pump(0.1)
            assert prop('sub-ass-override') == override
        command('keypress', ']')
        pump(0.1)
        assert float(prop('speed')) == 1.25
        command('keypress', '[')
        pump(0.1)
        assert float(prop('speed')) == 1.0
        command('keypress', 'k')
        pump(0.05)
        assert prop('pause') == 'no'
        command('keypress', 'MBTN_LEFT')
        pump(0.05)
        assert prop('pause') == 'yes'
        print('PASS: shipped mpv.conf/input.conf; default blur and live toggling; shader modes and files; FSR rendering; audio/subtitle/pause/speed bindings')
    finally:
        dll.mpv_terminate_destroy(player)
        user32.DestroyWindow(hwnd)


if __name__ == '__main__':
    main()
