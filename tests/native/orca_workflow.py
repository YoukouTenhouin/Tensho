"""Run Orca in isolated Xvfb and private D-Bus; audio must use silent_speech.py.

Requires an Orca runtime prefix containing bin/orca and its Python dependencies.
Example: python3 tests/native/silent_speech.py -- python3 tests/native/orca_workflow.py \
  --runtime /tmp/tensho-orca-runtime/usr --output /tmp/tensho-orca-evidence
Build the controlled provider fixture first: node scripts/build.mjs --recovery.
"""
import argparse
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--runtime',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--i18n',action='store_true')
args=parser.parse_args()
args.output.mkdir(parents=True,exist_ok=True)
import os,subprocess,select,tempfile,shutil
if not os.environ.get('SPEECHD_ADDRESS') or not os.environ.get('PULSE_SINK','').startswith('tensho_test_speech_'):
 raise SystemExit('Invoke through tests/native/silent_speech.py to protect desktop audio')
runtime=tempfile.mkdtemp(prefix='tensho-atspi-runtime-')
reader,writer=os.pipe()
xvfb=subprocess.Popen(['Xvfb','-displayfd',str(writer),'-screen','0','1400x1000x24','-nolisten','tcp'],pass_fds=(writer,),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
os.close(writer)
accessibility=None
try:
 if not select.select([reader],[],[],10)[0]:raise RuntimeError('No isolated display')
 display=':'+os.read(reader,50).decode().strip();os.close(reader)
 env={**os.environ,'LANGUAGE':'zh_CN.UTF-8' if args.i18n else 'en_US.UTF-8','TENSHO_ORCA_I18N':'1' if args.i18n else '0','DISPLAY':display,'XDG_SESSION_TYPE':'x11','XDG_RUNTIME_DIR':runtime,'XDG_SESSION_ID':'tensho-test','TENSHO_ORCA_OUTPUT':str(args.output.resolve()),'TENSHO_ORCA_RUNTIME':str(args.runtime.resolve())}
 for k in ['WAYLAND_DISPLAY','AT_SPI_BUS_ADDRESS','DBUS_STARTER_ADDRESS','DBUS_STARTER_BUS_TYPE']:env.pop(k,None)
 accessibility=subprocess.Popen(['dbus-daemon','--nofork','--print-address=1','--config-file=/usr/share/defaults/at-spi2/accessibility.conf'],stdout=subprocess.PIPE,text=True)
 env['AT_SPI_BUS_ADDRESS']=accessibility.stdout.readline().strip()
 if not env['AT_SPI_BUS_ADDRESS']:raise RuntimeError('Private accessibility bus failed')
 with (args.output/'session.log').open('w') as log:r=subprocess.run(['dbus-run-session','--','python3',str(Path(__file__).with_name('orca_session.py'))],env=env,stdout=log,stderr=log)
 raise SystemExit(r.returncode)
finally:
 if accessibility:accessibility.terminate();accessibility.wait(timeout=5)
 xvfb.terminate();xvfb.wait(timeout=5);shutil.rmtree(runtime,ignore_errors=True)
