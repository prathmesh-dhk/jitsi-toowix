#!/usr/bin/env python3
"""Jibri finalize hook. Validate completed media, then retry idempotent ingestion."""
import json, os, pathlib, subprocess, sys, time, urllib.request
root = pathlib.Path(os.environ.get('JIBRI_RECORDING_ROOT', '/storage/recordings')).resolve()
folder = pathlib.Path(sys.argv[1]).resolve()
if not folder.is_relative_to(root) or folder == root:
    raise SystemExit('Invalid recording directory')
files = list(folder.glob('*.mp4'))
if len(files) != 1:
    raise SystemExit('Expected exactly one completed MP4')
media = files[0].resolve()
if not media.is_relative_to(root):
    raise SystemExit('Invalid recording path')
key = os.environ.get('RECORDING_INGEST_KEY') or pathlib.Path('/config/recording-ingest.key').read_text().strip()
url = os.environ.get('RECORDING_BACKEND_URL', 'http://toowix-backend:4000') + '/api/recordings/ingest'
room = media.stem.rsplit('_', 1)[0]
payload = dict(roomSlug=room, recordingSessionId=folder.name, relativeFile=str(media.relative_to(root)), fileUrl=str(media.relative_to(root)))
def post(status, **metadata):
    body = json.dumps(dict(payload, status=status, **metadata)).encode()
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, data=body, headers={'Content-Type':'application/json', 'Authorization':'Bearer '+key})
            with urllib.request.urlopen(request, timeout=660) as response:
                response.read()
            print(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), folder.name, status, flush=True)
            return
        except Exception:
            if attempt == 3: raise RuntimeError('Recording ingestion failed after retries') from None
            time.sleep(2 ** attempt)
post('Processing')
try:
    before = media.stat()
    probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(media)], timeout=30))
    duration = float(probe['format']['duration'])
    kinds = {stream['codec_type'] for stream in probe['streams']}
    if duration <= 0 or before.st_size <= 0 or not {'audio','video'} <= kinds:
        raise ValueError('Missing audio/video or duration')
    subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(media),'-map','0:v:0','-map','0:a:0','-f','null','-'], check=True, timeout=600, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    after = media.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError('File still changing')
except Exception:
    post('Failed')
    raise SystemExit('Recording media validation failed')
post('Ready', durationSeconds=duration, durationMinutes=duration/60, sizeBytes=after.st_size)
