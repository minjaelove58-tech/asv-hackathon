@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  start "Hackathon TV Server" /b py -3 "%~dp0display_server.py"
  goto open_browser
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "Hackathon TV Server" /b python "%~dp0display_server.py"
  goto open_browser
)

echo Python 3을 찾지 못했습니다.
echo Python을 설치한 뒤 start_display.bat을 다시 실행해 주세요.
pause
exit /b 1

:open_browser
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8765/"
endlocal
