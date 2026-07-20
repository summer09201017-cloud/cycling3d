@echo off
REM cycling3d voice baking (YunJhe neural TTS via msedge-tts). English-only, CRLF.
REM Double-click to (re)bake announcer mp3 lines from src/voicePhrases.js.
REM Needs internet. Existing mp3 files are skipped; output goes to public\voice\.
cd /d "%~dp0"
echo Baking Cycling 3D announcer voice lines ...
if not exist "node_modules" call npm install
call node scripts\gen-voice.mjs
echo.
echo Done. Check public\voice\manifest.json
pause
