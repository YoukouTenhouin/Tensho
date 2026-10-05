"""Run speech tests with a private dispatcher and temporary silent audio output.

Usage: python3 tests/native/silent_speech.py -- <speech-test-command> [arguments]
Requires PipeWire's PulseAudio interface, speech-dispatcher and espeak-ng.
The child's SPEECHD_ADDRESS isolates it from the user's speech settings.
"""
from contextlib import contextmanager
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


@contextmanager
def silent_speech():
    name = f'tensho_test_speech_{os.getpid()}'
    module = subprocess.check_output([
        'pactl', 'load-module', 'module-null-sink', f'sink_name={name}',
        'sink_properties=device.description=Tensho_Test_Speech',
    ], text=True).strip()
    try:
        with tempfile.TemporaryDirectory(prefix='tensho-speech-') as temporary:
            root = Path(temporary); (root / 'log').mkdir()
            socket = root / 'speechd.sock'
            (root / 'speechd.conf').write_text(
                f'LogLevel 1\nLogDir "{root / "log"}"\n'
                f'AudioOutputMethod "pulse"\nAudioPulseDevice "{name}"\n'
                'AddModule "espeak-ng" "sd_espeak-ng" "/etc/speech-dispatcher/modules/espeak-ng.conf"\n'
                'DefaultModule "espeak-ng"\n')
            with (root / 'server.log').open('w') as log:
                server = subprocess.Popen([
                    'speech-dispatcher', '--run-single', '--config-dir', temporary,
                    '--communication-method', 'unix_socket', '--socket-path', str(socket),
                    '--pid-file', str(root / 'speechd.pid'),
                ], stdout=log, stderr=log, env={**os.environ, 'PULSE_SINK': name})
                try:
                    deadline = time.monotonic() + 5
                    while not socket.exists() and server.poll() is None and time.monotonic() < deadline:
                        time.sleep(.05)
                    if not socket.exists() or server.poll() is not None:
                        raise RuntimeError('Private speech dispatcher did not start; refusing default audio fallback')
                    yield {'SPEECHD_ADDRESS': f'unix_socket:{socket}', 'PULSE_SINK': name}
                finally:
                    if server.poll() is None:
                        server.terminate()
                        try: server.wait(timeout=8)
                        except subprocess.TimeoutExpired: server.kill(); server.wait()
    finally:
        subprocess.run(['pactl', 'unload-module', module], check=True)


if __name__ == '__main__':
    command = sys.argv[1:]
    if command[:1] == ['--']: command = command[1:]
    if not command: raise SystemExit('Supply a speech test command after --')
    with silent_speech() as settings:
        raise SystemExit(subprocess.run(command, env={**os.environ, **settings}).returncode)
