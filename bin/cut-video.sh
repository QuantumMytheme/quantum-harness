#!/usr/bin/env bash
# cut-video.sh — video cut pipeline for demo / walkthrough clips
#
# Concats arbitrary clips (mixed containers/codecs, with or without audio
# tracks — e.g. Playwright .webm + OBS .mkv + phone .mp4) into one
# H.264 + AAC .mp4: normalized to WIDTHxHEIGHT@FPS, optional single drawtext
# overlay, +faststart, and a bitrate cap chosen so a 60s cut stays well under
# the 20MB rubric (S2) limit:
#
#   budget : 20 MB = 160,000 kbit -> 160,000 / 60 s = 2,666 kbps total ceiling
#   chosen : video avg 1800 kbps (maxrate 2000, bufsize 4000) + audio 128 kbps
#   worst  : (2000 + 128) kbps * 60 s / 8 = 15.96 MB (+ ~2% mux ~= 16.3 MB)
#   typical: (1800 + 128) kbps * 60 s / 8 = 14.46 MB
#
# Inputs without an audio stream (Playwright clips) get silence injected so
# the concat filter always has n matched v/a pairs.
#
# Usage: cut-video.sh out.mp4 in1 [in2 ...] [--text OVERLAY]
#
# Tunables (env): VIDEO_BR MAXRATE BUFSIZE AUDIO_BR FPS WIDTH HEIGHT PRESET FONT
set -euo pipefail

usage() { echo "usage: $(basename "$0") out.mp4 in1 [in2 ...] [--text OVERLAY]" >&2; exit 2; }

[ $# -ge 2 ] || usage
OUT=$1; shift

TEXT=""
INPUTS=()
while [ $# -gt 0 ]; do
  case $1 in
    --text) [ $# -ge 2 ] || usage; TEXT=$2; shift 2 ;;
    *) INPUTS+=("$1"); shift ;;
  esac
done
[ ${#INPUTS[@]} -ge 1 ] || usage

VIDEO_BR=${VIDEO_BR:-1800k}
MAXRATE=${MAXRATE:-2000k}
BUFSIZE=${BUFSIZE:-4000k}
AUDIO_BR=${AUDIO_BR:-128k}
FPS=${FPS:-30}
WIDTH=${WIDTH:-1280}
HEIGHT=${HEIGHT:-720}
PRESET=${PRESET:-veryfast}

# Font for the overlay: prefer DejaVu Sans Bold, else ask fontconfig.
FONT=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}
if [ ! -f "$FONT" ]; then
  FONT=$(fc-match -f '%{file}' 'sans-serif:bold' 2>/dev/null || true)
fi
if [ -n "$TEXT" ] && [ ! -f "$FONT" ]; then
  echo "error: no usable font for --text overlay (set FONT=/path/to.ttf)" >&2
  exit 1
fi

ARGS=(-hide_banner -loglevel warning -y)
FILTER=""
N=${#INPUTS[@]}
IDX=0 # next ffmpeg input index (inputs + injected anullsrc sources)
VLBL=()
ALBL=()

for f in "${INPUTS[@]}"; do
  [ -f "$f" ] || { echo "error: input not found: $f" >&2; exit 1; }
  ARGS+=(-i "$f")
  vi=$IDX; IDX=$((IDX + 1))
  FILTER+="[$vi:v]scale=$WIDTH:$HEIGHT:force_original_aspect_ratio=decrease,"
  FILTER+="pad=$WIDTH:$HEIGHT:(ow-iw)/2:(oh-ih)/2,fps=$FPS,format=yuv420p,setsar=1[v$vi];"
  VLBL+=("[v$vi]")

  has_audio=$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$f" | head -n1)
  if [ -n "$has_audio" ]; then
    FILTER+="[$vi:a]aresample=48000,aformat=channel_layouts=stereo[a$vi];"
  else
    dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
    case $dur in
      '' | N/A) echo "error: cannot determine duration of audio-less input: $f" >&2; exit 1 ;;
    esac
    ARGS+=(-f lavfi -t "$dur" -i "anullsrc=channel_layout=stereo:sample_rate=48000")
    si=$IDX; IDX=$((IDX + 1))
    FILTER+="[$si:a]anull[a$vi];"
  fi
  ALBL+=("[a$vi]")
done

# Interleave [v0][a0][v1][a1]... into the concat filter (re-encode path).
for ((i = 0; i < N; i++)); do FILTER+="${VLBL[$i]}${ALBL[$i]}"; done
FILTER+="concat=n=$N:v=1:a=1[vcat][acat]"

VOUT="[vcat]"
if [ -n "$TEXT" ]; then
  # textfile= sidesteps drawtext/filtergraph escaping entirely.
  TMPTXT=$(mktemp /tmp/cut-video-text.XXXXXX)
  trap 'rm -f "$TMPTXT"' EXIT
  printf '%s' "$TEXT" >"$TMPTXT"
  FILTER+=";[vcat]drawtext=fontfile=$FONT:textfile=$TMPTXT:fontsize=36:fontcolor=white"
  FILTER+=":box=1:boxcolor=black@0.5:boxborderw=12:x=(w-text_w)/2:y=h-text_h-40[vout]"
  VOUT="[vout]"
fi

ffmpeg "${ARGS[@]}" \
  -filter_complex "$FILTER" \
  -map "$VOUT" -map "[acat]" \
  -c:v libx264 -preset "$PRESET" -b:v "$VIDEO_BR" -maxrate "$MAXRATE" -bufsize "$BUFSIZE" -pix_fmt yuv420p \
  -c:a aac -b:a "$AUDIO_BR" -ar 48000 \
  -movflags +faststart \
  "$OUT"

echo "wrote: $OUT"
ffprobe -v error -show_entries format=duration,size,bit_rate -of default=noprint_wrappers=1 "$OUT"
