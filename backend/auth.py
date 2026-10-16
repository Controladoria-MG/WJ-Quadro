"""
Identificação do usuário logado.

Todo o back-end descobre "quem está fazendo a requisição" só por
`usuario_atual_id(request)`. Para trocar o login (ex.: integrar com o
MG Controle), basta reimplementar essa função para devolver o id da
tabela `usuarios` correspondente à sessão autenticada — nenhuma rota
precisa mudar.

Modo atual ("simples"): o front grava o cookie `currentUserId` quando a
pessoa escolhe o próprio nome na tela de login. Não há senha.
"""

from fastapi import Request
from typing import Optional


def usuario_atual_id(request: Request) -> Optional[int]:
    valor = request.cookies.get("currentUserId")
    if not valor:
        return None
    try:
        return int(valor)
    except ValueError:
        return None
