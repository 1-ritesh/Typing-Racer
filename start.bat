@echo off
title Typing Racer Server
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
    python server.py %*
) else (
    where py >nul 2>nul
    if errorlevel 1 (
        echo Python 3.9 or newer is required. Install it from https://www.python.org/downloads/
        pause
        exit /b 1
    )
    py -3 server.py %*
)

echo.
echo The server has stopped.
pause
