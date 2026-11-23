#!/usr/bin/env bash
# Linux / macOS launcher: creates a virtualenv on first run, installs the (small) dependencies and starts the studio.
#   ./run.sh              -> only this computer   (http://127.0.0.1:8000)
#   ./run.sh --lan        -> also phones on the same Wi-Fi (prints URL + token)
set -e
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
if [ ! -d .venv ]; then
  echo "[setup] creating .venv ..."
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
. .venv/bin/activate
python -m pip install -q --disable-pip-version-check -r requirements.txt
exec python run.py "$@"
