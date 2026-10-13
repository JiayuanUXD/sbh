# 从 deploy.yml 抽出指定步骤的 run 脚本，替换 URL / 超时 / 轮数以便本地快速跑
import sys, yaml, re
wf, ref, step_name, out, url = sys.argv[1:6]
import subprocess
src = subprocess.check_output(['git', 'show', f'{ref}:{wf}'], text=True) if ref != 'WORKTREE' else open(wf, encoding='utf-8').read()
doc = yaml.safe_load(src)
steps = doc['jobs']['deploy']['steps']
run = next(s['run'] for s in steps if s.get('name', '').startswith(step_name))
run = run.replace('https://sbh-286300-10-1253925058.sh.run.tcloudbase.com', url)
run = run.replace('--max-time 15', '--max-time 2').replace('--max-time 60', '--max-time 2')
run = run.replace('$(seq 1 50)', '$(seq 1 8)').replace('$(seq 1 20)', '$(seq 1 6)').replace('sleep 5', 'sleep 0.2')
open(out, 'w', encoding='utf-8').write(run)
