@echo off
REM ===================================================================
REM  Double-click to pull the CollaborateMD reports.
REM  It self-updates: grabs the newest pull-reports.mjs you've
REM  downloaded, drops it into the bot folder, then runs it.
REM ===================================================================
setlocal
set "BOT=%USERPROFILE%\OneDrive\Documents\collabmdbot\collabmd-bot"
set "DL=%USERPROFILE%\OneDrive\Documents"
cd /d "%BOT%"

echo Looking for the newest report bot you downloaded...
for /f "delims=" %%f in ('dir /b /o-d "%DL%\pull*reports*.mjs" 2^>nul') do (
  copy /y "%DL%\%%f" "pull-reports.mjs" >nul
  echo Updated pull-reports.mjs from "%%f".
  goto :run
)
echo (No newer download found - using the file already here.)

:run
echo.
node pull-reports.mjs
echo.
pause
