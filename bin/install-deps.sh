#!/bin/bash
# Installs the inline-video dependencies (yt-dlp, ffmpeg) for the YouTube
# Side Player into its own folder, never system-wide. Each download is checked
# against a SHA-256 before it is used. Tools already on PATH are left alone.
#
#   install-deps.sh            install what is missing
#   install-deps.sh --update   also update a yt-dlp this script installed
#
# Prints one status line per step; the last line is "ok <dir>" on success.
set -euo pipefail

DEST="${YT_MOD_DEPS_DIR:-$HOME/.claude/plugins/data/youtube-side-player/bin}"
mkdir -p "$DEST"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/yt-mod-deps.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Pinned ffmpeg 9.0.2 static builds (martin-riedl.de publishes no checksums)
case "$(uname -m)" in
  arm64)
    FFMPEG_URL="https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip"
    FFMPEG_SHA="c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924"
    ;;
  x86_64)
    FFMPEG_URL="https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip"
    FFMPEG_SHA="7fa48ef451acd225b0e82864711d417ba634588f3efba5fbdc123ab958430619"
    ;;
  *)
    echo "error unsupported architecture $(uname -m)"
    exit 1
    ;;
esac
YTDLP_BASE="https://github.com/yt-dlp/yt-dlp/releases/latest/download"

have() { command -v "$1" >/dev/null 2>&1 || [ -x "$DEST/$1" ]; }

verify() { # file expected-sha
  local got
  got="$(shasum -a 256 "$1" | awk '{print $1}')"
  if [ "$got" != "$2" ]; then
    echo "error checksum mismatch for $(basename "$1") (got $got)"
    exit 1
  fi
}

if ! have yt-dlp; then
  echo "step downloading yt-dlp"
  curl -fsSL --retry 2 -o "$TMP/yt-dlp_macos" "$YTDLP_BASE/yt-dlp_macos"
  curl -fsSL --retry 2 -o "$TMP/SHA2-256SUMS" "$YTDLP_BASE/SHA2-256SUMS"
  verify "$TMP/yt-dlp_macos" "$(awk '$2 == "yt-dlp_macos" {print $1}' "$TMP/SHA2-256SUMS")"
  install -m 755 "$TMP/yt-dlp_macos" "$DEST/yt-dlp"
elif [ "${1:-}" = "--update" ] && [ -x "$DEST/yt-dlp" ]; then
  echo "step updating yt-dlp"
  "$DEST/yt-dlp" -U >/dev/null 2>&1 || echo "step yt-dlp update failed, keeping current"
fi

if ! have ffmpeg; then
  echo "step downloading ffmpeg"
  curl -fsSL --retry 2 -o "$TMP/ffmpeg.zip" "$FFMPEG_URL"
  verify "$TMP/ffmpeg.zip" "$FFMPEG_SHA"
  unzip -oq "$TMP/ffmpeg.zip" -d "$TMP/ffmpeg"
  install -m 755 "$TMP/ffmpeg/ffmpeg" "$DEST/ffmpeg"
fi

echo "ok $DEST"
