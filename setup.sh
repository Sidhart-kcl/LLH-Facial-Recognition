#!/bin/bash
set -e

echo "🏥 MediPass Setup Script"
echo "======================="
echo ""

# Check Python
echo "✓ Checking Python..."
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Please install Python 3.9+"
    exit 1
fi
PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
echo "  Python $PYTHON_VERSION found"

# Check Node
echo "✓ Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+"
    exit 1
fi
NODE_VERSION=$(node --version)
echo "  Node $NODE_VERSION found"

# Backend setup
echo ""
echo "📦 Setting up backend..."
cd backend

if [ ! -d "venv" ]; then
    echo "  Creating virtual environment..."
    python3 -m venv venv
fi

echo "  Activating virtual environment..."
source venv/bin/activate 2>/dev/null || . venv/Scripts/activate

echo "  Installing dependencies..."
pip install --quiet -r requirements.txt

echo "  ✅ Backend ready"
cd ..

# Frontend setup
echo ""
echo "📦 Setting up frontend..."
cd frontend

if [ ! -d "node_modules" ]; then
    echo "  Installing dependencies..."
    npm install --quiet
else
    echo "  Dependencies already installed"
fi

echo "  ✅ Frontend ready"
cd ..

# Summary
echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo ""
echo "  1. Start backend:"
echo "     cd backend"
echo "     source venv/bin/activate"
echo "     python face_service.py"
echo ""
echo "  2. In a new terminal, start frontend:"
echo "     cd frontend"
echo "     npm run dev"
echo ""
echo "  3. Open browser to http://localhost:5173"
echo ""
echo "🎯 Default test credentials in db/patients.json"
echo "   (no registration needed for demo patients)"
echo ""
