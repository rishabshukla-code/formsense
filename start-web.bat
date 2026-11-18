@echo off
rem Double-click to start the LiveKit server, the voice agent and the web app.
cd /d "%~dp0"
python -m uv run python web\run.py
pause
