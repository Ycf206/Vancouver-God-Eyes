import os
import json
import tempfile

def merge_admin_config():
    bak_p = '/tmp/godseye_admin_cfg.bak'
    cur_p = 'backend/data/admin_sources_config.json'
    if os.path.exists(bak_p) and os.path.exists(cur_p):
        try:
            with open(bak_p, 'r', encoding='utf-8') as f:
                bak = json.load(f)
            with open(cur_p, 'r', encoding='utf-8') as f:
                cur = json.load(f)
            
            bak_map = {s.get('id'): s for s in bak.get('sources', [])}
            for s in cur.get('sources', []):
                sid = s.get('id')
                if sid in bak_map:
                    bs = bak_map[sid]
                    for k in ('cron_expr', 'schedule_interval', 'enabled', 'last_updated'):
                        if k in bs:
                            s[k] = bs[k]
            
            if 'github_token' in bak:
                cur['github_token'] = bak['github_token']
            if 'github_repo' in bak:
                cur['github_repo'] = bak['github_repo']
                
            parent_dir = os.path.dirname(os.path.abspath(cur_p))
            fd, tmp_p = tempfile.mkstemp(prefix='.admin_cfg_', suffix='.tmp', dir=parent_dir)
            try:
                with os.fdopen(fd, 'w', encoding='utf-8') as f:
                    json.dump(cur, f, indent=2, ensure_ascii=False)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp_p, cur_p)
            except Exception:
                try:
                    os.unlink(tmp_p)
                except OSError:
                    pass
                raise
            print("✅ Merged admin_sources_config.json with latest workflows successfully!")
        except Exception as e:
            print(f"⚠️ Merge admin config warning: {e}")

if __name__ == '__main__':
    merge_admin_config()
