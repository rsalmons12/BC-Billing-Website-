@echo off
REM ===================================================================
REM  Double-click for a SAFE REHEARSAL of the notes push.
REM  Does everything EXCEPT click Save. Self-updates like notes.bat.
REM ===================================================================
setlocal
set "BOT=%USERPROFILE%\OneDrive\Documents\collabmdbot\collabmd-bot"
set "DL=%USERPROFILE%\OneDrive\Documents"
cd /d "%BOT%"

for /f "delims=" %%f in ('dir /b /o-d "%DL%\push*notes*.mjs" 2^>nul') do (
  copy /y "%DL%\%%f" "push-notes.mjs" >nul & echo Updated push-notes.mjs. & goto :getcsv
)
:getcsv
for /f "delims=" %%f in ('dir /b /o-d "%DL%\notes*.csv" 2^>nul') do (
  copy /y "%DL%\%%f" "notes.csv" >nul & echo Loaded newest notes.csv. & goto :run
)
:run
echo.
node push-notes.mjs --dry-run
echo.
pause
