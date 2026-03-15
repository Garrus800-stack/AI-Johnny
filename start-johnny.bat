@echo off
cd /d "%~dp0"

REM Create a VBScript to launch without ANY window
echo Set objShell = CreateObject("WScript.Shell") > "%TEMP%\johnny_launch.vbs"
echo objShell.Run "cmd /c cd /d ""%~dp0"" && ollama serve", 0, False >> "%TEMP%\johnny_launch.vbs"
echo WScript.Sleep 2000 >> "%TEMP%\johnny_launch.vbs"

if not exist "node_modules\" (
    echo objShell.Run "cmd /c cd /d ""%~dp0"" && npm install", 0, True >> "%TEMP%\johnny_launch.vbs"
)

echo objShell.Run "cmd /c cd /d ""%~dp0"" && npm start", 0, False >> "%TEMP%\johnny_launch.vbs"

REM Run VBScript (completely invisible) and exit immediately
start "" /B wscript "%TEMP%\johnny_launch.vbs"
exit
