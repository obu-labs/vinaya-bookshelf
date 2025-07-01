#!/usr/bin/env bash
# release.bash – Automate releasing a new version of an Obsidian plugin
# Usage: ./release.bash
set -euo pipefail

# --- Helpers ---------------------------------------------------------------
die() { echo "❌ $1" >&2; exit 1; }

# --- 1. Show current version ----------------------------------------------
current_version=$(node -p "require('./package.json').version") \
  || die "Could not read current version from package.json"
echo "Current version: $current_version"

# --- 2. Ask for the new version number ------------------------------------
read -rp "New version (MAJOR.MINOR.PATCH): " new_version
[[ -z $new_version ]] && die "No version entered"

# --- 3. Validate new version ----------------------------------------------
[[ $new_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || die "Version must follow MAJOR.MINOR.PATCH, e.g. 1.2.3"

IFS=. read -r cur_major cur_minor cur_patch <<< "$current_version"
IFS=. read -r new_major new_minor new_patch <<< "$new_version"

if (( new_major < cur_major )) ||
   { (( new_major == cur_major )) && (( new_minor < cur_minor )); } ||
   { (( new_major == cur_major )) && (( new_minor == cur_minor )) && (( new_patch <= cur_patch )); }
then
  die "Version $new_version is not greater than current version $current_version"
fi

# --- 4. Update package.json -----------------------------------------------
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '$new_version';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
" || die "Failed to update package.json"
echo "package.json updated to $new_version"

# --- 5. Propagate version & build -----------------------------------------
npm run version
rm -f main.js
npm run build
[[ -f main.js ]] || die "Build failed: main.js not found in repository root"
echo "Build succeeded"

# --- 6‑8. Commit, tag, and push -------------------------------------------
git add .
git commit -m "Release $new_version"
git tag "$new_version"
git push origin HEAD
git push origin "$new_version"

# --- 9. Collect release notes ---------------------------------------------
echo "Enter release notes (end with an empty line):"
release_notes=""
while IFS= read -r line; do
  [[ -z $line ]] && break
  release_notes+=$'\n'"$line"
done

# --- 10‑11. Create GitHub release & upload assets -------------------------
gh release create "$new_version" \
  main.js styles.css manifest.json \
  --title "$new_version" \
  --notes "$release_notes"

# --- 12. Show release URL --------------------------------------------------
remote=$(git config --get remote.origin.url)
remote=${remote%.git}
case $remote in
  git@github.com:*) remote=${remote#git@github.com:}; url="https://github.com/$remote" ;;
  https://github.com/*) url=$remote ;;
  *) die "Unrecognized remote URL: $remote" ;;
esac

echo "🎉 Release published:"
echo "   $url/releases/tag/$new_version"
