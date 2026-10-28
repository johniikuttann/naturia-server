"""Publish a new app version: put the APK in this repository and tell the server about it.

    python publish_apk.py C:\\path\\to\\Naturia.apk 2.1.0 "What is new"

This copies the APK to apk/Naturia.apk and rewrites update.json. Then commit and push:

    git add apk update.json
    git commit -m "App 2.1.0"
    git push

Render redeploys by itself, and phones with an older version show the Update button.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
UPDATE_FILE = os.path.join(HERE, 'update.json')
APK_DIR = os.path.join(HERE, 'apk')


def version_key(text):
    parts = [int(p) for p in re.findall(r'\d+', text)[:4]]
    return tuple(parts + [0] * (4 - len(parts)))


def github_repo():
    """owner/name of this repository, from its 'origin' address."""
    try:
        url = subprocess.run(['git', 'remote', 'get-url', 'origin'], cwd=HERE, capture_output=True,
                             text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        sys.exit('Could not read the GitHub address (git remote "origin"). Run this inside the cloned repository.')
    match = re.search(r'github\.com[:/]([^/]+/[^/]+?)(?:\.git)?$', url)
    if not match:
        sys.exit(f'"{url}" is not a GitHub address.')
    return match.group(1)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    source, version = sys.argv[1], sys.argv[2]
    notes = sys.argv[3] if len(sys.argv) > 3 else ''
    if not re.fullmatch(r'\d+(\.\d+){1,3}', version):
        sys.exit(f'The version must look like 2.1.0, not "{version}".')

    try:
        with open(UPDATE_FILE, encoding='utf-8-sig') as f:
            current = json.load(f)
    except (OSError, ValueError):
        current = {}
    if version_key(version) < version_key(str(current.get('latest_version', '0'))):
        sys.exit(f'Version {version} is older than the published {current["latest_version"]}.')

    # Is it really an APK, and is it the version you say it is?
    try:
        with zipfile.ZipFile(source) as apk:
            names = apk.namelist()
            manifest = apk.read('AndroidManifest.xml')
            page_script = apk.read('assets/www/assets/js/app-update.js').decode('utf-8', 'replace') \
                if 'assets/www/assets/js/app-update.js' in names else None
    except (OSError, KeyError, zipfile.BadZipFile):
        sys.exit(f'"{source}" is not an APK file.')
    if not any(n.startswith('classes') and n.endswith('.dex') for n in names):
        sys.exit('That file has no app code in it: it does not look like an APK.')
    if version.encode('utf-16-le') not in manifest:
        sys.exit(f'The APK\'s own version number is not {version}. Check versionName in build.gradle, rebuild, and try again.')
    if 'assets/products.json' in names:
        pass  # the native Android app: it checks for updates itself, using its own versionName
    elif page_script is None:
        print('WARNING: this APK does not contain the Update button (assets/js/app-update.js). '
              'Phones that install it will not be able to update themselves.')
    else:
        found = re.search(r"APP_VERSION\s*=\s*'([^']*)'", page_script)
        if not found or found.group(1) != version:
            sys.exit(f'APP_VERSION inside the APK is "{found.group(1) if found else "missing"}", not {version}. '
                     'Set it in assets/js/app-update.js, rebuild, and try again. (Otherwise the Update button '
                     'would never go away.)')

    os.makedirs(APK_DIR, exist_ok=True)
    target = os.path.join(APK_DIR, 'Naturia.apk')
    shutil.copyfile(source, target)
    with open(target, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()

    update = {
        'latest_version': version,
        'apk_url': f'https://raw.githubusercontent.com/{github_repo()}/main/apk/Naturia.apk',
        'notes': notes,
        'sha256': digest,
        'size_bytes': os.path.getsize(target),
    }
    with open(UPDATE_FILE, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(update, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(f'Published version {version}: apk/Naturia.apk ({update["size_bytes"]:,} bytes, sha256 {digest[:12]}...)')
    print('Next: git add apk update.json && git commit -m "App ' + version + '" && git push')


if __name__ == '__main__':
    main()
