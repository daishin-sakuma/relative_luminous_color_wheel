#!/bin/bash
# Workaround for macOS 26 Tahoe: hdiutil create -srcfolder is broken.
# Uses a blank-image approach: create → mount → copy → convert.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -p "require('${ROOT}/package.json').version")
APP_NAME="Relative Luminous Color Wheel"
RELEASE_DIR="${ROOT}/release"
APP_PATH="${RELEASE_DIR}/mac-arm64/${APP_NAME}.app"
WORK_DMG="${RELEASE_DIR}/_work.dmg"
FINAL_DMG="${RELEASE_DIR}/${APP_NAME}-${VERSION}-arm64.dmg"

if [ ! -d "${APP_PATH}" ]; then
  echo "Error: app not found at ${APP_PATH}" >&2
  echo "Run 'npm run dist:mac' first." >&2
  exit 1
fi

APP_SIZE_KB=$(du -sk "${APP_PATH}" | awk '{print $1}')
DMG_SIZE_MB=$(( (APP_SIZE_KB / 1024) + 60 ))

echo "→ Creating writable blank image (${DMG_SIZE_MB}MB)…"
rm -f "${WORK_DMG}"
hdiutil create -size "${DMG_SIZE_MB}m" -volname "${APP_NAME}" -fs APFS "${WORK_DMG}"

echo "→ Mounting…"
MOUNT_OUTPUT=$(hdiutil attach "${WORK_DMG}" -readwrite -noverify -noautoopen)
# sed strips everything up to and including the last tab on the mount-point line
MOUNT_POINT=$(echo "${MOUNT_OUTPUT}" | grep '/Volumes' | sed 's/.*	//' | tail -1)

if [ -z "${MOUNT_POINT}" ]; then
  echo "Error: could not determine mount point" >&2
  rm -f "${WORK_DMG}"
  exit 1
fi

cleanup() {
  hdiutil detach "${MOUNT_POINT}" -quiet 2>/dev/null || true
  rm -f "${WORK_DMG}"
}
trap cleanup EXIT

echo "→ Copying app to ${MOUNT_POINT}…"
cp -R "${APP_PATH}" "${MOUNT_POINT}/"
ln -s /Applications "${MOUNT_POINT}/Applications"

echo "→ Unmounting…"
hdiutil detach "${MOUNT_POINT}" -quiet
trap - EXIT

echo "→ Converting to compressed DMG…"
rm -f "${FINAL_DMG}"
hdiutil convert "${WORK_DMG}" -format UDZO -imagekey zlib-level=9 -o "${FINAL_DMG}"
rm -f "${WORK_DMG}"

echo "✓ Created: ${FINAL_DMG}"
