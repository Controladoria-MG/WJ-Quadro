@echo off
:: Inicia o Quadro localmente no Windows
:: Execute na raiz do projeto: backend\start.bat

echo Iniciando o Quadro...
echo.

:: Verifica Python
python --version >nul 2>&1
if errorlevel 1 (
    echo Python nao encontrado. Instale em https://python.org
    pause
    exit /b 1
)

:: Cria venv se nao existir
if not exist "backend\venv" (
    echo Criando ambiente virtual...
    python -m venv backend\venv
)

:: Ativa o venv
call backend\venv\Scripts\activate.bat

:: Instala dependencias
echo Instalando dependencias...
pip install -r backend\requirements.txt -q

echo.
echo Servidor rodando em: http://localhost:8000
echo Documentacao da API:  http://localhost:8000/docs
echo (Ctrl+C para parar)
echo.

uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
pause
