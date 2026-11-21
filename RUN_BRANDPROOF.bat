@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer from https://nodejs.org
  pause
  exit /b 1
)
echo Starting BrandProof...
echo Keep this window open while using the app.
echo Open http://localhost:3000 in your browser.
echo Demo login: creator@demo.com
echo Password: demo1234
echo.
node server.js
echo.
echo BrandProof has stopped.
pause
