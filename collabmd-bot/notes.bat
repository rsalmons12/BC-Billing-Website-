@echo off
REM ===================================================================
REM  Double-click to push notes into CollaborateMD (REAL - saves).
REM  Self-updates: grabs the newest push-notes.mjs AND the newest
REM  notes.csv you've downloaded, then runs the bot.
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
node push-notes.mjs
echo.
pause
