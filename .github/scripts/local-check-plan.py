#!/usr/bin/env python3
"""Select local checks from changed inputs; custom Actions stay removed."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
ROOT=Path(__file__).resolve().parents[2]
SITE='Fortnite-Ai-Agent-GitHub-Cloudflare/'
RUNTIME=re.compile(r'^(?:novasparx-(?:texture-runtime|renderer|browser-transport|browser-guard|local-parser|layers|core|random-access|associations)\.js|asset-diagnosis\.js|tools\.js|preview\.js|config\.js|app\.js|fnaa-v101\.(?:js|css)|index\.html|style\.css|cloudflare-worker/)')
def checks_for(names):
    relevant=sorted(set(name for name in names if
      (name.startswith(SITE) and RUNTIME.match(name[len(SITE):])) or
      name.startswith(('.github/runtime/','.github/browser-data/')) or
      name in ('.github/novasparx-runtime.json','.github/novasparx-data.json','.github/scripts/assemble-site.py') or
      name.startswith(('.github/tests/novasparx-model-viewer','.github/tests/novasparx-mesh-handedness','.github/tests/novasparx-texture-runtime','.github/tests/novasparx-texture-placement','.github/tests/novasparx-production','.github/tests/novasparx-renderer-alpha'))))
    return {'cheapChecks':True,'nativeBrowserMatrix':bool(relevant),'productionSmoke':bool(relevant),'browserInputs':relevant}
def input_hash(root):
    digest=hashlib.sha256()
    # Exact input bytes, so identical push/PR heads share one successful proof.
    names=subprocess.check_output(['git','ls-files'],cwd=root,text=True).splitlines()
    for name in checks_for(names)['browserInputs']:
        path=root/name
        digest.update(name.encode()+b'\0')
        if path.is_file():digest.update(path.read_bytes())
    return digest.hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base',default='origin/main')
    parser.add_argument('--proof-stamp',type=Path,help='Local stamp written only after the complete browser proof passes')
    parser.add_argument('--record-success',action='store_true',help='Record completed proof for these exact input bytes')
    args=parser.parse_args()
    names=subprocess.check_output(['git','diff','--name-only',args.base],cwd=ROOT,text=True).splitlines()
    result=checks_for(names);result['inputSha256']=input_hash(ROOT)
    if args.record_success:
        if not args.proof_stamp:parser.error('--record-success requires --proof-stamp')
        args.proof_stamp.parent.mkdir(parents=True,exist_ok=True)
        args.proof_stamp.write_text(json.dumps({'inputSha256':result['inputSha256']}))
    if args.proof_stamp and args.proof_stamp.exists():
        stamp=json.loads(args.proof_stamp.read_text())
        if stamp.get('inputSha256')==result['inputSha256']:
            result.update(nativeBrowserMatrix=False,productionSmoke=False,reusedExactProof=True)
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
