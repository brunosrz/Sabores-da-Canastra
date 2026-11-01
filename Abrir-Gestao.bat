@echo off
setlocal
cd /d "%~dp0"
start "Sabores da Canastra | Gestão" /min uv run --no-sync sabores-desktop
exit /b
