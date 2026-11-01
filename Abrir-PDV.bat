@echo off
setlocal
cd /d "%~dp0"
start "Sabores da Canastra | PDV" /min uv run --no-sync sabores-pdv
exit /b
