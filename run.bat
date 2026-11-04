@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
    echo Node.js and npm are required. Install Node.js 18 or newer, then try again.
    pause
    exit /b 1
)

if not exist "node_modules\electron" (
    echo Installing dependencies for the first run...
    call npm install
    if errorlevel 1 (
        echo Dependency installation failed.
        pause
        exit /b 1
    )
)

call npm start
if errorlevel 1 (
    echo The application could not be started.
    pause
    exit /b 1
)

endlocal
