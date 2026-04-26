#!/usr/bin/env bash
# Run from the billbook-app git repository root (or: ./scripts/release.sh from repo root).
# Tags this repo only — CI then clones billbook-fe + whatsapp_automation to build.

set -euo pipefail

BUMP="${1:-patch}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "📦 Bumping version ($BUMP) in billbook-app…"
NEW_TAG=$(npm version "$BUMP" --no-git-tag-version)
NEW_VERSION="${NEW_TAG#v}"
echo "🔖 $NEW_VERSION"

git add package.json
git commit -m "chore: release v$NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

echo ""
echo "Push to trigger GitHub Actions (Release workflow):"
echo "  git push && git push --tags"
read -rp "Push now? [y/N] " c
if [[ "$c" =~ ^[Yy]$ ]]; then
  git push && git push --tags
fi
