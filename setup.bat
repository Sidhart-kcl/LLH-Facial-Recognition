@echo off
REM MediPass Setup Script for Windows
setlocal enabledelayedexpansion

echo.
echo 🏥 MediPass Setup Script
echo =======================
echo.

REM Check Python
echo ✓ Checking Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Python not found. Please install Python 3.9+
    exit /b 1
)
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo   Python %PYTHON_VERSION% found

REM Check Node
echo ✓ Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js not found. Please install Node.js 18+
    exit /b 1
)
for /f %%i in ('node --version') do set NODE_VERSION=%%i
echo   Node %NODE_VERSION% found

REM Backend setup
echo.
echo 📦 Setting up backend...
cd backend

if not exist "venv" (
    echo   Creating virtual environment...
    python -m venv venv
)

echo   Activating virtual environment...
call venv\Scripts\activate.bat

echo   Installing dependencies...
pip install -q -r requirements.txt

echo   ✅ Backend ready
cd ..

REM Frontend setup
echo.
echo 📦 Setting up frontend...
cd frontend

if not exist "node_modules" (
    echo   Installing dependencies...
    call npm install --quiet
) else (
    echo   Dependencies already installed
)

echo   ✅ Frontend ready
cd ..

REM Summary
echo.
echo ✅ Setup complete!
echo.
echo 📋 Next steps:
echo.
echo   1. Start backend:
echo      cd backend
echo      venv\Scripts\activate.bat
echo      python face_service.py
echo.
echo   2. In a new terminal, start frontend:
echo      cd frontend
echo      npm run dev
echo.
echo   3. Open browser to http://localhost:5173
echo.
echo 🎯 Optional demo data:
echo    cd backend ^&^& python demo_seed\seed_from_faces.py
echo.
pause
