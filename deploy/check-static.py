#!/usr/bin/env python3
"""Read-only check of a fixed frontend checkout before isolated test deployment."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def check(expected):
    def git(*args):
        return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()
    if not re.fullmatch(r'[0-9a-f]{40}', expected):
        raise ValueError('Expected a full lowercase 40-character commit SHA.')
    if Path(git('rev-parse', '--show-toplevel')).resolve() != ROOT:
        raise ValueError('Expected the frontend repository root.')
    if git('rev-parse', 'HEAD') != expected:
        raise ValueError('Frontend checkout differs from approved commit.')
    if git('status', '--porcelain', '--untracked-files=normal'):
        raise ValueError('Frontend has local changes or untracked files.')
    required = ['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js',
                'assets/icon.svg', 'assets/icon-192.png', 'assets/icon-512.png',
                'js/app.js', 'js/time.js', 'js/storage.js', 'js/sync.js',
                'js/log-export.js', 'js/range-ui.js']
    for name in required:
        path = ROOT / name
        if not path.is_file() or path.is_symlink():
            raise ValueError('Missing or symlinked static dependency: ' + name)
    if any((ROOT / folder).is_symlink() for folder in ('assets', 'js')):
        raise ValueError('Static directories must not be symlinks.')
    for name in re.findall(r'(?:href|src)="(\./[^"]+)"', (ROOT/'index.html').read_text()):
        path = (ROOT / name).resolve()
        if not path.is_relative_to(ROOT) or not path.exists():
            raise ValueError('HTML dependency missing or outside static root.')
    manifest = json.loads((ROOT/'manifest.webmanifest').read_text())
    if any(manifest.get(k) != './' for k in ('id', 'scope', 'start_url')):
        raise ValueError('PWA paths must remain relative to the isolated preview directory.')
    for icon in manifest['icons']:
        path = (ROOT / icon['src']).resolve()
        if not path.is_relative_to(ROOT) or not path.is_file():
            raise ValueError('Manifest icon missing or outside static root.')
    files = {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in required}
    digest = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    return {'frontend_commit': expected, 'static_files': files, 'inventory_sha256': digest,
            'preview_only': True, 'original_site': 'https://rycho813.github.io/Time_map/'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-commit', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(check(args.expected_commit), ensure_ascii=False, indent=2))
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit('STOP: ' + (str(exc) if isinstance(exc, ValueError) else type(exc).__name__))


if __name__ == '__main__':
    main()
