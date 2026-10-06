"""Check the packaged FFmpeg/FFprobe pair and the original streaming runtime."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tools', required=True)
    parser.add_argument('--runtime', required=True)
    parser.add_argument('--server', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    tools = Path(args.tools).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    ffmpeg, ffprobe = tools / 'ffmpeg.exe', tools / 'ffprobe.exe'
    sample = output / 'sample.avi'
    subprocess.run([str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-y',
                    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1',
                    '-c:v', 'mpeg4', '-c:a', 'pcm_s16le', str(sample)], check=True, creationflags=flags)
    info = json.loads(subprocess.check_output([str(ffprobe), '-v', 'error',
        '-show_streams', '-show_format', '-of', 'json', str(sample)], creationflags=flags))
    assert info['streams'][0]['width'] == 320 and info['streams'][0]['height'] == 240
    assert 0.9 <= float(info['format']['duration']) <= 1.1
    server_source = Path(args.server).read_text(encoding='utf-8')
    assert '"-fps_mode:v", "cfr"' in server_source and 'apad,aresample=async=1' in server_source
    assert '"-vsync", "cfr"' not in server_source and '"-async", 1' not in server_source
    # Exercise the server's updated software HLS transcode options and fragment flags.
    subprocess.run([str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-y',
        '-fflags', '+genpts', '-noaccurate_seek', '-seek_timestamp', '1', '-copyts',
        '-i', str(sample), '-threads', '2', '-max_muxing_queue_size', '2048',
        '-ignore_unknown', '-map_metadata', '-1', '-map_chapters', '-1',
        '-map', 'v:0', '-c:v', 'libx264', '-preset:v', 'veryfast', '-profile:v', 'high',
        '-tune:v', 'fastdecode', '-fps_mode:v', 'cfr', '-r:v', '10', '-map', 'a:0',
        '-c:a', 'aac', '-filter:a', 'apad,aresample=async=1', '-t', '1',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof+delay_moov+dash',
        '-use_editlist', '1', '-f', 'mp4', str(output / 'transcoded.mp4')],
        check=True, creationflags=flags)
    environment = dict(os.environ, APP_PATH=str(output / 'server-profile'), NO_CORS='1',
                       FFMPEG_BIN=str(ffmpeg), FFPROBE_BIN=str(ffprobe))
    log_path = output / 'server.log'
    with log_path.open('w', encoding='utf-8') as log:
        process = subprocess.Popen([str(Path(args.runtime).resolve()),
                                    str(Path(args.server).resolve())], env=environment,
                                   cwd=output, stdout=log, stderr=subprocess.STDOUT,
                                   creationflags=flags)
        try:
            deadline = time.monotonic() + 30
            endpoint = None
            while time.monotonic() < deadline:
                assert process.poll() is None, log_path.read_text(errors='replace')
                match = re.search(r'EngineFS server started at (http://127\.0\.0\.1:\d+)',
                                  log_path.read_text(errors='replace'))
                if match:
                    endpoint = match[1]
                    break
                time.sleep(0.1)
            assert endpoint, 'Streaming server did not start; see server.log'
            with urllib.request.urlopen(endpoint + '/settings', timeout=5) as response:
                settings = json.load(response)
                assert isinstance(settings, dict), settings
            log_text = log_path.read_text(errors='replace')
            normalized_log = log_text.replace('\\\\', '\\')
            assert str(ffmpeg) in normalized_log and str(ffprobe) in normalized_log, (
                'Streaming server must select the updated media tools')
            print('PASS: encoding, ffprobe metadata, HLS transcode options, streaming server startup, and settings endpoint')
        finally:
            # End just the process tree started by this test, including its probe workers.
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=flags)
            else:
                process.terminate()
            process.wait(timeout=10)


if __name__ == '__main__':
    main()
