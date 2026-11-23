@echo off
REM Windows launcher: creates a virtualenv on first run, installs dependencies and starts the studio.
REM   run.bat            -> only this computer   (http://127.0.0.1:8000)
REM   run.bat --lan      -> also phones on the same Wi-Fi (prints URL + token)
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv (
  echo [setup] creating .venv ...
  py -3 -m venv .venv || python -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install -q --disable-pip-version-check -r requirements.txt
python run.py %*
