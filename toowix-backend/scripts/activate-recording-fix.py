import subprocess, json, pathlib, time, urllib.request
run=lambda args: subprocess.check_output(args,text=True)
stats=json.loads(run(['docker','exec','jitsi-stack-jicofo-1','curl','-s','http://localhost:8888/stats']))
if stats.get('conferences',0) or stats.get('participants',0): raise SystemExit('Active meetings detected; activation postponed')
old=json.loads(run(['docker','inspect','toowix-backend']))[0]
backup='toowix-backend-before-recording-fix'
subprocess.run(['docker','stop','toowix-backend'],check=True)
subprocess.run(['docker','rename','toowix-backend',backup],check=True)
args=['docker','run','-d','--name','toowix-backend','--restart','unless-stopped','-p','4000:4000']
for bind in old['HostConfig']['Binds']: args+=['-v',bind]
args+=['toowix-backend:recording-fix']
try:
 subprocess.run(args,check=True)
 for _ in range(30):
  try:
   with urllib.request.urlopen('http://127.0.0.1:4000/health',timeout=2) as response:
    if response.status==200: break
  except Exception: time.sleep(1)
 else: raise RuntimeError('Backend health failed')
except Exception:
 subprocess.run(['docker','rm','-f','toowix-backend'])
 subprocess.run(['docker','rename',backup,'toowix-backend'])
 subprocess.run(['docker','start','toowix-backend'])
 raise
config=pathlib.Path('/opt/toowix/jitsi-stack-config/jibri')
(config/'finalize-recording.sh.pending').replace(config/'finalize-recording.sh')
print('Backend healthy; validated finalizer activated. Jitsi services were not restarted.')
