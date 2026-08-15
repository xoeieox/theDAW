#!/usr/bin/env bash
# thedaw - open the operating table from the MacBook.
#
# Wakes GravityWell, holds it awake for the session, opens the UI, and
# releases the hold when you're done. During the TOU peak window
# (16:00-21:00 PT, the highest electricity rate tier of the day) it asks
# before taking the peak-wake override.
#
# Install (run on the Mac):
#   mkdir -p ~/bin && scp jellyfish@100.100.52.102:/data/git/theDAW/scripts/thedaw-launcher.sh ~/bin/thedaw && chmod +x ~/bin/thedaw
#
# Usage: thedaw [session-minutes]     (default 240)
set -euo pipefail

BRIX="${THEDAW_BRIX:-jellyfish@100.100.52.102}"   # or your 'brix' ssh alias
URL="http://gravitywell:8600"                      # Tailscale MagicDNS; IP fallback 100.122.101.124
MINUTES="${1:-240}"
HOLD_NAME="thedaw-session"

# --- TOU peak check, evaluated in PT no matter where the Mac thinks it is ---
hour_pt=$(TZ=America/Los_Angeles date +%H)
if (( 10#$hour_pt >= 16 && 10#$hour_pt < 21 )); then
  echo "It is $(TZ=America/Los_Angeles date '+%H:%M') PT - inside the TOU PEAK window (16:00-21:00 PT),"
  echo "the highest electricity rate tier of the day. Keeping GravityWell awake now runs"
  echo "the whole session at peak rates; off-peak starts at 21:00 PT."
  read -r -p "Wake and hold GravityWell anyway? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
  # The wol-sentinel refuses in-peak wakes unless this hold exists.
  ssh "$BRIX" "gw-hold theDAW-session $MINUTES"
fi

echo "-> waking GravityWell (no-op if already up)..."
ssh "$BRIX" "wake-gravitywell thedaw-session"

echo "-> taking keepawake hold (${MINUTES}m)..."
ssh "$BRIX" "ssh gravitywell 'sudo gw-keepawake hold $HOLD_NAME $((MINUTES * 60)) theDAW-session-mac-launcher'"

release() {
  echo
  echo "-> releasing keepawake hold..."
  ssh "$BRIX" "ssh gravitywell 'sudo gw-keepawake release $HOLD_NAME'" || true
}
trap release EXIT

echo "-> waiting for theDAW on :8600..."
up=0
for _ in $(seq 1 40); do
  if curl -sf -m 3 "$URL/api/health" >/dev/null 2>&1; then up=1; break; fi
  sleep 3
done
if [ "$up" != 1 ]; then
  echo "theDAW did not answer at $URL/api/health."
  echo "Check on GravityWell: systemctl status thedaw   (service auto-starts on boot)"
  exit 1
fi

open "$URL"
echo
echo "theDAW is live at $URL - the keepawake hold expires on its own in ${MINUTES}m."
read -r -p "Press Enter (or Ctrl-C) when done to release the hold early... " _ || true
