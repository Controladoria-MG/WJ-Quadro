#!/bin/bash
# Inicia o Quadro localmente
# Execute na raiz do projeto: bash backend/start.sh

echo "🚀 Iniciando o Quadro..."
echo ""

# Verifica se Python está disponível
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 não encontrado. Instale em https://python.org"
    exit 1
fi

# Cria e ativa virtualenv se não existir
if [ ! -d "backend/venv" ]; then
    echo "📦 Criando ambiente virtual..."
    python3 -m venv backend/venv
fi

# Ativa o venv
source backend/venv/bin/activate

# Instala dependências
echo "📦 Instalando dependências..."
pip install -r backend/requirements.txt -q

echo ""
echo "✅ Servidor rodando em: http://localhost:8000"
echo "📋 Documentação da API:  http://localhost:8000/docs"
echo "   (Ctrl+C para parar)"
echo ""

# Inicia o servidor a partir da raiz do projeto
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
