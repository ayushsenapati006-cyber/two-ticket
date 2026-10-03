@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  npm install
)
echo.
echo Starting Two Tickets...
echo Open http://localhost:3000 in your browser.
echo.
npm start
pause
