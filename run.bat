@echo off
REM cycling3d playtest. English-only, CRLF.
cd /d "%~dp0"
echo Starting Cycling 3D ...
if not exist "node_modules" call npm install
call npm run dev -- --open --port 5220
pause
