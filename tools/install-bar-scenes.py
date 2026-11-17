#!/usr/bin/env python3
"""Install or remove Welcome's optional Touch Bar scenes without disturbing others."""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
destination = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'barkeep' / 'scenes.json'
if not destination.parent.is_dir():
    print('barkeep is not installed; skipped Touch Bar scenes')
    sys.exit(0)
source = json.loads((root / 'dist' / 'barkeep-scenes.json').read_text())['scenes']
for scene in source:
    for key in scene['keys']:
        if 'cmd' in key:
            key['cmd'] = key['cmd'].replace('@ROOT@', str(root))
name_set = {scene['name'] for scene in source}
document = json.loads(destination.read_text()) if destination.exists() else {'scenes': []}
if destination.exists():
    backup = destination.with_name(destination.name + '.bak-before-welcome')
    if not backup.exists(): shutil.copy2(destination, backup)
document['scenes'] = [scene for scene in document.get('scenes', []) if scene.get('name') not in name_set]
if '--remove' not in sys.argv:
    document['scenes'] = source + document['scenes']
fd, temporary = tempfile.mkstemp(dir=destination.parent)
with os.fdopen(fd, 'w') as stream:
    json.dump(document, stream, indent=2, ensure_ascii=False)
os.replace(temporary, destination)
print(('Removed' if '--remove' in sys.argv else 'Installed') + ' Welcome Touch Bar scenes')
