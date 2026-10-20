"""
Portal de Tarefas — Backend FastAPI + PostgreSQL
Os dados ficam em tabelas reais e nunca se perdem entre deploys.
A conexão é lida da variável de ambiente DATABASE_URL.

Organização: usuários participam de uma ou mais equipes (departamentos ou
grupos com pessoas de várias áreas); cada tarefa pertence a uma equipe e só
é visível/editável por membros dela (e pelos administradores gerais). O
responsável de uma tarefa precisa ser membro da equipe da tarefa.

Cada equipe tem as próprias colunas do quadro (nome, cor e ordem editáveis).
Uma coluna marcada como "finaliza" conclui a tarefa que entra nela.
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import os
import json
import hashlib
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

try:
    from .auth import usuario_atual_id
except ImportError:
    from auth import usuario_atual_id

# Carrega backend/.env se existir (uso local — em produção a env var
# já vem definida pelo Render, o load_dotenv() vira um no-op).
# override=False: uma DATABASE_URL já exportada no ambiente tem prioridade.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

# ── Config ─────────────────────────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL")

if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Equipe que recebe os usuários e tarefas que já existiam antes das equipes.
EQUIPE_INICIAL = "Controladoria"

# Colunas que reproduzem o quadro antigo (uma por tipo de prazo).
COLUNAS_LEGADAS = [
    ("diaria", "Tarefas Diárias",   "#3b82f6"),
    ("hoje",   "Tarefas de Hoje",   "#ef4444"),
    ("semana", "Tarefas da Semana", "#f59e0b"),
    ("mes",    "Tarefas do Mês",    "#22c55e"),
]

# Layout inicial de um quadro novo.
COLUNAS_PADRAO = [
    ("A fazer",      "#64748b", False),
    ("Em andamento", "#3b82f6", False),
    ("Concluído",    "#22c55e", True),
]

# ── App ────────────────────────────────────────────────────
app = FastAPI(title="Portal de Tarefas", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── DB helpers ─────────────────────────────────────────────
def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

def init_db():
    """Cria as tabelas se não existirem e importa os JSONs na primeira vez."""
    with get_conn() as conn:
        with conn.cursor() as cur:

            # Tabela de usuários
            cur.execute("""
                CREATE TABLE IF NOT EXISTS usuarios (
                    id        SERIAL PRIMARY KEY,
                    nome      TEXT NOT NULL,
                    cargo     TEXT DEFAULT 'Colaborador',
                    avatar    TEXT,
                    is_admin  BOOLEAN DEFAULT FALSE
                )
            """)
            cur.execute("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE")
            cur.execute("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_perfil TEXT")
            conn.commit()

            # Tabela de tarefas
            cur.execute("""
                CREATE TABLE IF NOT EXISTS tarefas (
                    id              SERIAL PRIMARY KEY,
                    nome            TEXT NOT NULL,
                    descricao       TEXT DEFAULT '',
                    etapas          JSONB DEFAULT '[]',
                    prazo           TEXT NOT NULL,
                    data_prazo      TEXT,
                    urgencia        TEXT DEFAULT 'media',
                    responsavel     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                    status          TEXT DEFAULT 'pendente',
                    observacoes     TEXT DEFAULT '',
                    retorno         TEXT DEFAULT '',
                    criado_em       TEXT,
                    criado_por      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                    concluida       BOOLEAN DEFAULT FALSE,
                    diaria_feita_em TEXT
                )
            """)
            conn.commit()

            cur.execute("ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS concluido_em TEXT")
            cur.execute("ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS concluido_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL")
            cur.execute("""
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'tarefas' AND column_name = 'aviso_confirmado'
            """)
            coluna_aviso_ja_existia = cur.fetchone() is not None
            cur.execute("ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS aviso_confirmado BOOLEAN DEFAULT FALSE")
            if not coluna_aviso_ja_existia:
                # Tarefas criadas antes da existência do aviso não devem disparar
                # o aviso retroativamente — só tarefas novas a partir daqui.
                cur.execute("UPDATE tarefas SET aviso_confirmado = TRUE")
            conn.commit()

            # Equipes e participação (um usuário pode estar em várias equipes)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS equipes (
                    id         SERIAL PRIMARY KEY,
                    nome       TEXT NOT NULL UNIQUE,
                    criado_em  TEXT
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS equipe_membros (
                    equipe_id   INTEGER NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
                    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                    papel       TEXT NOT NULL DEFAULT 'membro',
                    PRIMARY KEY (equipe_id, usuario_id)
                )
            """)
            cur.execute("ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS equipe_id INTEGER REFERENCES equipes(id) ON DELETE RESTRICT")
            conn.commit()

            # Colunas do quadro de cada equipe
            cur.execute("""
                CREATE TABLE IF NOT EXISTS colunas (
                    id         SERIAL PRIMARY KEY,
                    equipe_id  INTEGER NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
                    nome       TEXT NOT NULL,
                    cor        TEXT NOT NULL DEFAULT '#3b82f6',
                    ordem      INTEGER NOT NULL DEFAULT 0,
                    finaliza   BOOLEAN NOT NULL DEFAULT FALSE
                )
            """)
            cur.execute("ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS coluna_id INTEGER REFERENCES colunas(id) ON DELETE SET NULL")
            conn.commit()

            # Importa usuários do JSON só se a tabela estiver vazia
            cur.execute("SELECT COUNT(*) as c FROM usuarios")
            if cur.fetchone()["c"] == 0:
                users_file = os.path.join(BASE_DIR, "data", "users.json")
                if os.path.exists(users_file):
                    with open(users_file, encoding="utf-8") as f:
                        users = json.load(f)
                    for u in users:
                        cur.execute(
                            "INSERT INTO usuarios (id, nome, cargo, avatar) VALUES (%s, %s, %s, %s)",
                            (u["id"], u["nome"], u.get("cargo", "Colaborador"), u.get("avatar"))
                        )
                    cur.execute("SELECT setval('usuarios_id_seq', (SELECT MAX(id) FROM usuarios))")
                    conn.commit()

            # Importa tarefas do JSON só se a tabela estiver vazia
            cur.execute("SELECT COUNT(*) as c FROM tarefas")
            if cur.fetchone()["c"] == 0:
                tarefas_file = os.path.join(BASE_DIR, "data", "tarefas.json")
                if os.path.exists(tarefas_file):
                    with open(tarefas_file, encoding="utf-8") as f:
                        tarefas = json.load(f)
                    for t in tarefas:
                        cur.execute("""
                            INSERT INTO tarefas
                                (id, nome, descricao, etapas, prazo, data_prazo, urgencia,
                                 responsavel, status, observacoes, retorno, criado_em,
                                 criado_por, concluida, diaria_feita_em)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        """, (
                            t["id"], t["nome"], t.get("descricao",""),
                            json.dumps(t.get("etapas", []), ensure_ascii=False),
                            t["prazo"], t.get("dataPrazo"),
                            t.get("urgencia","media"), t.get("responsavel"),
                            t.get("status","pendente"), t.get("observacoes",""),
                            t.get("retorno",""), t.get("criadoEm"),
                            t.get("criadoPor"), t.get("concluida", False),
                            t.get("diariaFeitaEm")
                        ))
                    cur.execute("SELECT setval('tarefas_id_seq', (SELECT MAX(id) FROM tarefas))")
                    conn.commit()

            # Migração para equipes: na primeira vez, tudo o que já existia
            # vira a equipe inicial, com todos os usuários atuais como membros.
            # Num banco novo (sem usuários nem tarefas) não há o que migrar,
            # então nenhuma equipe é criada.
            cur.execute("""
                SELECT (SELECT COUNT(*) FROM equipes) AS equipes,
                       (SELECT COUNT(*) FROM usuarios) + (SELECT COUNT(*) FROM tarefas) AS legado
            """)
            contagem = cur.fetchone()
            if contagem["equipes"] == 0 and contagem["legado"] > 0:
                cur.execute(
                    "INSERT INTO equipes (nome, criado_em) VALUES (%s, %s) RETURNING id",
                    (EQUIPE_INICIAL, agora_iso())
                )
                equipe_id = cur.fetchone()["id"]
                cur.execute("""
                    INSERT INTO equipe_membros (equipe_id, usuario_id, papel)
                    SELECT %s, id, CASE WHEN is_admin THEN 'admin' ELSE 'membro' END
                    FROM usuarios
                """, (equipe_id,))
                cur.execute("UPDATE tarefas SET equipe_id = %s WHERE equipe_id IS NULL", (equipe_id,))
                conn.commit()

            # Versões anteriores criavam a equipe inicial vazia também em banco
            # novo. Remove essa sobra: sem membros e sem tarefas. Uma equipe
            # criada por alguém sempre tem ao menos quem criou como membro.
            cur.execute("""
                DELETE FROM equipes e
                WHERE e.nome = %s
                  AND NOT EXISTS (SELECT 1 FROM equipe_membros m WHERE m.equipe_id = e.id)
                  AND NOT EXISTS (SELECT 1 FROM tarefas t WHERE t.equipe_id = e.id)
            """, (EQUIPE_INICIAL,))
            conn.commit()

            # Equipes sem colunas: as que já tinham tarefas ganham as colunas
            # antigas (uma por tipo de prazo), as demais o layout padrão.
            cur.execute("""
                SELECT e.id, EXISTS(SELECT 1 FROM tarefas t WHERE t.equipe_id = e.id) AS tem_tarefas
                FROM equipes e
                WHERE NOT EXISTS (SELECT 1 FROM colunas c WHERE c.equipe_id = e.id)
            """)
            for e in cur.fetchall():
                if e["tem_tarefas"]:
                    for ordem, (prazo, nome, cor) in enumerate(COLUNAS_LEGADAS):
                        cur.execute(
                            "INSERT INTO colunas (equipe_id, nome, cor, ordem) VALUES (%s,%s,%s,%s) RETURNING id",
                            (e["id"], nome, cor, ordem)
                        )
                        coluna_id = cur.fetchone()["id"]
                        cur.execute(
                            "UPDATE tarefas SET coluna_id = %s WHERE equipe_id = %s AND prazo = %s AND coluna_id IS NULL",
                            (coluna_id, e["id"], prazo)
                        )
                else:
                    criar_colunas_padrao(cur, e["id"])
            conn.commit()

            # Comentários e histórico de cada tarefa
            cur.execute("""
                CREATE TABLE IF NOT EXISTS comentarios (
                    id         SERIAL PRIMARY KEY,
                    tarefa_id  INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
                    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                    texto      TEXT NOT NULL,
                    criado_em  TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS historico (
                    id         SERIAL PRIMARY KEY,
                    tarefa_id  INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
                    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                    acao       TEXT NOT NULL,
                    criado_em  TEXT NOT NULL
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS comentarios_tarefa_idx ON comentarios (tarefa_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS historico_tarefa_idx ON historico (tarefa_id)")
            conn.commit()

            # Notificações (sino no topo)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS notificacoes (
                    id          SERIAL PRIMARY KEY,
                    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                    autor_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                    texto       TEXT NOT NULL,
                    tarefa_id   INTEGER REFERENCES tarefas(id) ON DELETE CASCADE,
                    equipe_id   INTEGER REFERENCES equipes(id) ON DELETE CASCADE,
                    lida        BOOLEAN NOT NULL DEFAULT FALSE,
                    criado_em   TEXT NOT NULL
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS notificacoes_usuario_idx ON notificacoes (usuario_id, lida)")
            conn.commit()

def criar_colunas_padrao(cur, equipe_id: int):
    for ordem, (nome, cor, finaliza) in enumerate(COLUNAS_PADRAO):
        cur.execute(
            "INSERT INTO colunas (equipe_id, nome, cor, ordem, finaliza) VALUES (%s,%s,%s,%s,%s)",
            (equipe_id, nome, cor, ordem, finaliza)
        )

def resposta_json(request: Request, dados) -> Response:
    """JSON com ETag. A atualização automática pede a cada 20s; quando nada
    mudou, o navegador recebe 304 (sem corpo) e reaproveita o que já tem."""
    corpo = json.dumps(dados, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    etag = '"' + hashlib.md5(corpo).hexdigest() + '"'
    cabecalhos = {"ETag": etag, "Cache-Control": "private, no-cache"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=cabecalhos)
    return Response(corpo, media_type="application/json", headers=cabecalhos)

def agora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def row_to_tarefa(row: dict) -> dict:
    """Converte uma linha do banco para o formato esperado pelo frontend."""
    etapas = row["etapas"]
    if isinstance(etapas, str):
        etapas = json.loads(etapas)
    return {
        "id":             row["id"],
        "equipeId":       row["equipe_id"],
        "colunaId":       row["coluna_id"],
        "nome":           row["nome"],
        "descricao":      row["descricao"] or "",
        "etapas":         etapas or [],
        "prazo":          row["prazo"],
        "dataPrazo":      row["data_prazo"],
        "urgencia":       row["urgencia"],
        "responsavel":    row["responsavel"],
        "status":         row["status"],
        "observacoes":    row["observacoes"] or "",
        "retorno":        row["retorno"] or "",
        "criadoEm":       row["criado_em"],
        "criadoPor":      row["criado_por"],
        "concluida":      row["concluida"],
        "diariaFeitaEm":  row["diaria_feita_em"],
        "concluidoEm":    row["concluido_em"],
        "concluidoPor":   row["concluido_por"],
        "avisoConfirmado": row["aviso_confirmado"],
        **({"comentarios": row["n_comentarios"]} if "n_comentarios" in row else {}),
    }

def row_to_usuario(row: dict) -> dict:
    return {
        "id":         row["id"],
        "nome":       row["nome"],
        "cargo":      row["cargo"],
        "avatar":     row["avatar"],
        "isAdmin":    row.get("is_admin", False),
        "fotoPerfil": row.get("foto_perfil"),
    }

# ── Permissões ─────────────────────────────────────────────
def exigir_usuario(request: Request, cur) -> dict:
    """Devolve a linha do usuário logado ou responde 401."""
    uid = usuario_atual_id(request)
    if uid is not None:
        cur.execute("SELECT * FROM usuarios WHERE id = %s", (uid,))
        row = cur.fetchone()
        if row:
            return row
    raise HTTPException(status_code=401, detail="Sessão expirada. Entre novamente.")

def exigir_admin(usuario: dict):
    if not usuario["is_admin"]:
        raise HTTPException(status_code=403, detail="Apenas administradores podem fazer isso.")

def papel_na_equipe(cur, usuario_id: int, equipe_id: int) -> Optional[str]:
    cur.execute(
        "SELECT papel FROM equipe_membros WHERE equipe_id = %s AND usuario_id = %s",
        (equipe_id, usuario_id)
    )
    row = cur.fetchone()
    return row["papel"] if row else None

def exigir_membro(cur, usuario: dict, equipe_id: Optional[int]):
    if usuario["is_admin"]:
        return
    if equipe_id is None or papel_na_equipe(cur, usuario["id"], equipe_id) is None:
        raise HTTPException(status_code=403, detail="Você não faz parte desta equipe.")

def exigir_gestor_equipe(cur, usuario: dict, equipe_id: int):
    """Administrador geral ou administrador daquela equipe."""
    if usuario["is_admin"]:
        return
    if papel_na_equipe(cur, usuario["id"], equipe_id) != "admin":
        raise HTTPException(status_code=403, detail="Apenas administradores da equipe podem fazer isso.")

def validar_responsavel(cur, equipe_id: int, responsavel: Optional[int]):
    if responsavel is None:
        return
    if papel_na_equipe(cur, responsavel, equipe_id) is None:
        raise HTTPException(status_code=400, detail="O responsável precisa ser membro da equipe da tarefa.")

def validar_coluna(cur, equipe_id: int, coluna_id: Optional[int]) -> Optional[dict]:
    if coluna_id is None:
        return None
    cur.execute("SELECT * FROM colunas WHERE id = %s", (coluna_id,))
    coluna = cur.fetchone()
    if not coluna or coluna["equipe_id"] != equipe_id:
        raise HTTPException(status_code=400, detail="A coluna não pertence a esta equipe.")
    return coluna

def primeira_coluna(cur, equipe_id: int) -> Optional[int]:
    cur.execute(
        "SELECT id FROM colunas WHERE equipe_id = %s AND NOT finaliza ORDER BY ordem, id LIMIT 1",
        (equipe_id,)
    )
    row = cur.fetchone()
    return row["id"] if row else None

def registrar(cur, tarefa_id: int, usuario_id: int, acao: str, agrupar: bool = False):
    """Grava uma linha no histórico. Com agrupar=True, não repete a mesma
    ação da mesma pessoa feita há menos de 10 minutos (os campos de texto
    salvam a cada pausa na digitação)."""
    if agrupar:
        cur.execute("""
            SELECT criado_em FROM historico
            WHERE tarefa_id = %s AND usuario_id = %s AND acao = %s
            ORDER BY id DESC LIMIT 1
        """, (tarefa_id, usuario_id, acao))
        ultimo = cur.fetchone()
        if ultimo and (datetime.now(timezone.utc) - datetime.fromisoformat(ultimo["criado_em"])).total_seconds() < 600:
            return
    cur.execute(
        "INSERT INTO historico (tarefa_id, usuario_id, acao, criado_em) VALUES (%s,%s,%s,%s)",
        (tarefa_id, usuario_id, acao, agora_iso())
    )

def notificar(cur, destinos, autor: dict, texto: str, tarefa_id: Optional[int] = None,
              equipe_id: Optional[int] = None, agrupar: bool = False):
    """Cria uma notificação para cada destino (nunca para quem fez a ação).
    Com agrupar=True, não repete o mesmo aviso ainda não lido dos últimos 10 min."""
    for destino in {d for d in destinos if d and d != autor["id"]}:
        if agrupar:
            cur.execute("""
                SELECT criado_em FROM notificacoes
                WHERE usuario_id = %s AND autor_id = %s AND texto = %s AND NOT lida
                ORDER BY id DESC LIMIT 1
            """, (destino, autor["id"], texto))
            ultima = cur.fetchone()
            if ultima and (datetime.now(timezone.utc) - datetime.fromisoformat(ultima["criado_em"])).total_seconds() < 600:
                continue
        cur.execute("""
            INSERT INTO notificacoes (usuario_id, autor_id, texto, tarefa_id, equipe_id, criado_em)
            VALUES (%s,%s,%s,%s,%s,%s)
        """, (destino, autor["id"], texto, tarefa_id, equipe_id, agora_iso()))

def nome_equipe(cur, equipe_id: int) -> str:
    cur.execute("SELECT nome FROM equipes WHERE id = %s", (equipe_id,))
    r = cur.fetchone()
    return r["nome"] if r else ""

def registrar_e_notificar(cur, autor: dict, atual: dict, nova: dict, acoes: List[tuple]):
    """Grava o histórico das mudanças e avisa o responsável e quem criou a tarefa."""
    for acao, agrupar in acoes:
        registrar(cur, nova["id"], autor["id"], acao, agrupar)

    titulo = f'“{nova["nome"]}”'
    interessados = {nova["responsavel"], nova["criado_por"]}

    # Quem acabou de receber a tarefa ganha um aviso próprio.
    if nova["responsavel"] and nova["responsavel"] != atual["responsavel"]:
        notificar(cur, [nova["responsavel"]], autor,
                  f'{autor["nome"]} te enviou a tarefa {titulo}', nova["id"], nova["equipe_id"])
        interessados.discard(nova["responsavel"])

    resto = [a for a, _ in acoes
             if not a.startswith("atribuiu a ") and a != "marcou como feita hoje"]
    if resto:
        agrupar = all(ag for a, ag in acoes if a in resto)
        notificar(cur, interessados, autor,
                  f'{autor["nome"]} atualizou {titulo}: {"; ".join(resto)}',
                  nova["id"], nova["equipe_id"], agrupar)

ROTULO_STATUS   = {"pendente": "Pendente", "em andamento": "Em andamento", "concluida": "Concluída"}
ROTULO_URGENCIA = {"alta": "Alta", "media": "Média", "baixa": "Baixa"}

def descrever_mudancas(cur, atual: dict, novos: dict) -> List[tuple]:
    """Compara a tarefa antes/depois e devolve [(ação, agrupar)] em português."""
    def nome_usuario(uid):
        if uid is None:
            return None
        cur.execute("SELECT nome FROM usuarios WHERE id = %s", (uid,))
        r = cur.fetchone()
        return r["nome"] if r else "alguém"

    def mudou(col):
        return col in novos and novos[col] != atual[col]

    acoes = []
    if mudou("nome"):
        acoes.append((f'renomeou para "{novos["nome"]}"', False))
    if mudou("concluida"):
        acoes.append(("concluiu a tarefa" if novos["concluida"] else "reabriu a tarefa", False))
    if mudou("coluna_id") and novos["coluna_id"] is not None:
        cur.execute("SELECT nome FROM colunas WHERE id = %s", (novos["coluna_id"],))
        r = cur.fetchone()
        if r:
            acoes.append((f'moveu para "{r["nome"]}"', False))
    if mudou("responsavel"):
        nome = nome_usuario(novos["responsavel"])
        acoes.append((f"atribuiu a {nome}" if nome else "removeu o responsável", False))
    if mudou("status") and novos["status"] != "concluida" and not mudou("concluida"):
        acoes.append((f'mudou o status para {ROTULO_STATUS.get(novos["status"], novos["status"])}', False))
    if mudou("urgencia"):
        acoes.append((f'mudou a urgência para {ROTULO_URGENCIA.get(novos["urgencia"], novos["urgencia"])}', False))
    if mudou("data_prazo"):
        if novos["data_prazo"]:
            a, m, d = novos["data_prazo"][:10].split("-")
            acoes.append((f"definiu o prazo para {d}/{m}/{a}", False))
        else:
            acoes.append(("removeu a data do prazo", False))
    if mudou("prazo") and "diaria" in (novos["prazo"], atual["prazo"]):
        acoes.append(("passou a repetir todo dia" if novos["prazo"] == "diaria" else "deixou de repetir todo dia", False))
    if mudou("diaria_feita_em") and novos["diaria_feita_em"]:
        acoes.append(("marcou como feita hoje", True))
    for col, rotulo in (("descricao", "a descrição"), ("observacoes", "as observações"), ("retorno", "o retorno")):
        if mudou(col):
            acoes.append((f"editou {rotulo}", True))
    if "etapas" in novos:
        antes = atual["etapas"]
        if isinstance(antes, str):
            antes = json.loads(antes)
        depois = json.loads(novos["etapas"]) if isinstance(novos["etapas"], str) else novos["etapas"]
        antes_por_id  = {e["id"]: e for e in antes or []}
        depois_por_id = {e["id"]: e for e in depois or []}
        for eid, e in depois_por_id.items():
            velho = antes_por_id.get(eid)
            if not velho:
                acoes.append((f'adicionou a etapa "{e["texto"]}"', False))
            elif e["concluida"] != velho["concluida"]:
                acoes.append((f'{"concluiu" if e["concluida"] else "desmarcou"} a etapa "{e["texto"]}"', False))
            elif e["texto"] != velho["texto"]:
                acoes.append((f'renomeou a etapa "{velho["texto"]}" para "{e["texto"]}"', False))
        for eid, e in antes_por_id.items():
            if eid not in depois_por_id:
                acoes.append((f'excluiu a etapa "{e["texto"]}"', False))
    return acoes

def carregar_tarefa(cur, tarefa_id: int) -> dict:
    cur.execute("SELECT * FROM tarefas WHERE id = %s", (tarefa_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")
    return row

# ── Models ─────────────────────────────────────────────────
class Etapa(BaseModel):
    id: int
    texto: str
    concluida: bool

class Tarefa(BaseModel):
    id: Optional[int] = None
    equipeId: Optional[int] = None
    colunaId: Optional[int] = None
    nome: str
    descricao: Optional[str] = ""
    etapas: Optional[List[Etapa]] = []
    prazo: Optional[str] = "unica"
    dataPrazo: Optional[str] = None
    urgencia: Optional[str] = "media"
    responsavel: Optional[int] = None
    status: Optional[str] = "pendente"
    observacoes: Optional[str] = ""
    retorno: Optional[str] = ""
    criadoEm: Optional[str] = None
    criadoPor: Optional[int] = None
    concluida: Optional[bool] = False
    diariaFeitaEm: Optional[str] = None
    concluidoEm: Optional[str] = None
    concluidoPor: Optional[int] = None
    avisoConfirmado: Optional[bool] = False

class Usuario(BaseModel):
    id: Optional[int] = None
    nome: str
    cargo: Optional[str] = "Colaborador"
    avatar: Optional[str] = None
    isAdmin: Optional[bool] = False
    fotoPerfil: Optional[str] = None

class Equipe(BaseModel):
    nome: str
    membros: Optional[List[int]] = None

class Coluna(BaseModel):
    nome: str
    cor: Optional[str] = "#3b82f6"
    finaliza: Optional[bool] = False

class OrdemColunas(BaseModel):
    ids: List[int]

class Membro(BaseModel):
    usuarioId: int
    papel: Optional[str] = "membro"

# ── Startup ────────────────────────────────────────────────
@app.on_event("startup")
def startup():
    if DATABASE_URL:
        init_db()

# ══════════════════════════════════════════════════════════
# ROTAS — TAREFAS
# ══════════════════════════════════════════════════════════

@app.get("/api/tarefas")
def listar_tarefas(request: Request):
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            contagem = "(SELECT COUNT(*) FROM comentarios c WHERE c.tarefa_id = t.id) AS n_comentarios"
            if usuario["is_admin"]:
                cur.execute(f"SELECT t.*, {contagem} FROM tarefas t ORDER BY t.id")
            else:
                cur.execute(f"""
                    SELECT t.*, {contagem} FROM tarefas t
                    JOIN equipe_membros m ON m.equipe_id = t.equipe_id AND m.usuario_id = %s
                    ORDER BY t.id
                """, (usuario["id"],))
            return resposta_json(request, [row_to_tarefa(r) for r in cur.fetchall()])


@app.post("/api/tarefas", status_code=201)
def criar_tarefa(tarefa: Tarefa, request: Request):
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            if tarefa.equipeId is None:
                raise HTTPException(status_code=400, detail="Informe a equipe da tarefa.")
            exigir_membro(cur, usuario, tarefa.equipeId)
            validar_responsavel(cur, tarefa.equipeId, tarefa.responsavel)
            coluna_id = tarefa.colunaId or primeira_coluna(cur, tarefa.equipeId)
            validar_coluna(cur, tarefa.equipeId, coluna_id)

            criado_em = tarefa.criadoEm or agora_iso()
            etapas_json = json.dumps(
                [e.model_dump() for e in tarefa.etapas], ensure_ascii=False
            )
            cur.execute("""
                INSERT INTO tarefas
                    (equipe_id, coluna_id, nome, descricao, etapas, prazo, data_prazo, urgencia,
                     responsavel, status, observacoes, retorno, criado_em,
                     criado_por, concluida, diaria_feita_em)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING *
            """, (
                tarefa.equipeId, coluna_id, tarefa.nome, tarefa.descricao, etapas_json,
                tarefa.prazo or "unica", tarefa.dataPrazo, tarefa.urgencia,
                tarefa.responsavel, tarefa.status, tarefa.observacoes,
                tarefa.retorno, criado_em, usuario["id"],
                tarefa.concluida, tarefa.diariaFeitaEm
            ))
            nova = cur.fetchone()
            registrar(cur, nova["id"], usuario["id"], "criou a tarefa")
            notificar(cur, [nova["responsavel"]], usuario,
                      f'{usuario["nome"]} te enviou a tarefa “{nova["nome"]}”', nova["id"], nova["equipe_id"])
            conn.commit()
            return row_to_tarefa(nova)


@app.put("/api/tarefas/{tarefa_id}")
def atualizar_tarefa(tarefa_id: int, tarefa: Tarefa, request: Request):
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            atual = carregar_tarefa(cur, tarefa_id)
            exigir_membro(cur, usuario, atual["equipe_id"])

            # Trocar a tarefa de equipe exige ser membro da equipe de destino.
            equipe_id = tarefa.equipeId or atual["equipe_id"]
            if equipe_id != atual["equipe_id"]:
                exigir_membro(cur, usuario, equipe_id)
            validar_responsavel(cur, equipe_id, tarefa.responsavel)
            if equipe_id == atual["equipe_id"]:
                coluna_id = tarefa.colunaId or atual["coluna_id"]
            elif tarefa.colunaId and tarefa.colunaId != atual["coluna_id"]:
                coluna_id = tarefa.colunaId
            else:
                # Mudou de equipe sem escolher coluna: vai para a primeira do novo quadro.
                coluna_id = primeira_coluna(cur, equipe_id)
            validar_coluna(cur, equipe_id, coluna_id)

            etapas_json = json.dumps(
                [e.model_dump() for e in tarefa.etapas], ensure_ascii=False
            )
            cur.execute("""
                UPDATE tarefas SET
                    equipe_id=%(equipe_id)s, coluna_id=%(coluna_id)s,
                    nome=%(nome)s, descricao=%(descricao)s, etapas=%(etapas)s,
                    prazo=%(prazo)s, data_prazo=%(data_prazo)s, urgencia=%(urgencia)s,
                    responsavel=%(responsavel)s, status=%(status)s,
                    observacoes=%(observacoes)s, retorno=%(retorno)s,
                    concluida=%(concluida)s, diaria_feita_em=%(diaria_feita_em)s,
                    concluido_em=%(concluido_em)s, concluido_por=%(concluido_por)s
                WHERE id=%(id)s
                RETURNING *
            """, {
                "id": tarefa_id, "equipe_id": equipe_id, "coluna_id": coluna_id, "nome": tarefa.nome,
                "descricao": tarefa.descricao, "etapas": etapas_json,
                "prazo": tarefa.prazo or atual["prazo"], "data_prazo": tarefa.dataPrazo,
                "urgencia": tarefa.urgencia, "responsavel": tarefa.responsavel,
                "status": tarefa.status, "observacoes": tarefa.observacoes,
                "retorno": tarefa.retorno, "concluida": tarefa.concluida,
                "diaria_feita_em": tarefa.diariaFeitaEm,
                "concluido_em": tarefa.concluidoEm, "concluido_por": tarefa.concluidoPor,
            })
            nova = cur.fetchone()
            registrar_e_notificar(cur, usuario, atual, nova, descrever_mudancas(cur, atual, dict(nova)))
            conn.commit()
            return row_to_tarefa(nova)


@app.patch("/api/tarefas/{tarefa_id}")
def patch_tarefa(tarefa_id: int, campos: dict, request: Request):
    col_map = {
        "nome": "nome", "descricao": "descricao", "etapas": "etapas",
        "prazo": "prazo", "dataPrazo": "data_prazo", "urgencia": "urgencia",
        "responsavel": "responsavel", "status": "status",
        "observacoes": "observacoes", "retorno": "retorno",
        "concluida": "concluida", "diariaFeitaEm": "diaria_feita_em",
        "concluidoEm": "concluido_em", "concluidoPor": "concluido_por",
        "avisoConfirmado": "aviso_confirmado", "colunaId": "coluna_id",
    }
    sets, values, novos = [], [], {}
    for key, val in campos.items():
        col = col_map.get(key)
        if not col:
            continue
        if col == "etapas" and isinstance(val, list):
            val = json.dumps(val, ensure_ascii=False)
        sets.append(f"{col} = %s")
        values.append(val)
        novos[col] = val

    if not sets:
        raise HTTPException(status_code=400, detail="Nenhum campo válido para atualizar")

    values.append(tarefa_id)
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            atual = carregar_tarefa(cur, tarefa_id)
            exigir_membro(cur, usuario, atual["equipe_id"])
            if "responsavel" in campos:
                validar_responsavel(cur, atual["equipe_id"], campos["responsavel"])
            if "colunaId" in campos:
                validar_coluna(cur, atual["equipe_id"], campos["colunaId"])

            cur.execute(
                f"UPDATE tarefas SET {', '.join(sets)} WHERE id = %s RETURNING *",
                values
            )
            nova = cur.fetchone()
            registrar_e_notificar(cur, usuario, atual, nova, descrever_mudancas(cur, atual, novos))
            conn.commit()
            return row_to_tarefa(nova)


@app.delete("/api/tarefas/{tarefa_id}", status_code=204)
def deletar_tarefa(tarefa_id: int, request: Request):
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            atual = carregar_tarefa(cur, tarefa_id)
            exigir_membro(cur, usuario, atual["equipe_id"])
            cur.execute("DELETE FROM tarefas WHERE id = %s", (tarefa_id,))
            conn.commit()
    return None

# ══════════════════════════════════════════════════════════
# ROTAS — COMENTÁRIOS E HISTÓRICO
# ══════════════════════════════════════════════════════════

class Comentario(BaseModel):
    texto: str


@app.get("/api/tarefas/{tarefa_id}/atividade")
def atividade_tarefa(tarefa_id: int, request: Request):
    """Comentários e histórico da tarefa, mais recentes primeiro."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            exigir_membro(cur, usuario, carregar_tarefa(cur, tarefa_id)["equipe_id"])
            cur.execute("""
                SELECT id, usuario_id, texto AS conteudo, criado_em, 'comentario' AS tipo
                FROM comentarios WHERE tarefa_id = %s
                UNION ALL
                SELECT id, usuario_id, acao AS conteudo, criado_em, 'historico' AS tipo
                FROM historico WHERE tarefa_id = %s
                ORDER BY criado_em DESC
                LIMIT 200
            """, (tarefa_id, tarefa_id))
            return [{
                "id": r["id"], "tipo": r["tipo"], "usuarioId": r["usuario_id"],
                "texto": r["conteudo"], "criadoEm": r["criado_em"],
            } for r in cur.fetchall()]


@app.post("/api/tarefas/{tarefa_id}/comentarios", status_code=201)
def comentar(tarefa_id: int, comentario: Comentario, request: Request):
    texto = comentario.texto.strip()
    if not texto:
        raise HTTPException(status_code=400, detail="Escreva o comentário.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            tarefa = carregar_tarefa(cur, tarefa_id)
            exigir_membro(cur, usuario, tarefa["equipe_id"])
            cur.execute(
                "INSERT INTO comentarios (tarefa_id, usuario_id, texto, criado_em) VALUES (%s,%s,%s,%s) RETURNING id",
                (tarefa_id, usuario["id"], texto, agora_iso())
            )
            novo_id = cur.fetchone()["id"]
            trecho = texto if len(texto) <= 80 else texto[:77].rstrip() + "..."
            notificar(cur, [tarefa["responsavel"], tarefa["criado_por"]], usuario,
                      f'{usuario["nome"]} comentou em “{tarefa["nome"]}”: {trecho}',
                      tarefa_id, tarefa["equipe_id"])
            conn.commit()
            return {"id": novo_id}


@app.delete("/api/comentarios/{comentario_id}", status_code=204)
def apagar_comentario(comentario_id: int, request: Request):
    """Só quem escreveu (ou um administrador geral) apaga o comentário."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            cur.execute("SELECT * FROM comentarios WHERE id = %s", (comentario_id,))
            c = cur.fetchone()
            if not c:
                raise HTTPException(status_code=404, detail="Comentário não encontrado")
            if c["usuario_id"] != usuario["id"]:
                exigir_admin(usuario)
            cur.execute("DELETE FROM comentarios WHERE id = %s", (comentario_id,))
            conn.commit()
    return None

# ══════════════════════════════════════════════════════════
# ROTAS — NOTIFICAÇÕES
# ══════════════════════════════════════════════════════════

class IdsNotificacoes(BaseModel):
    ids: Optional[List[int]] = None   # vazio = todas


@app.get("/api/notificacoes")
def listar_notificacoes(request: Request):
    """As 50 notificações mais recentes do usuário logado e o total não lido."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            cur.execute("SELECT COUNT(*) AS c FROM notificacoes WHERE usuario_id = %s AND NOT lida", (usuario["id"],))
            nao_lidas = cur.fetchone()["c"]
            cur.execute("""
                SELECT * FROM notificacoes WHERE usuario_id = %s
                ORDER BY id DESC LIMIT 50
            """, (usuario["id"],))
            return resposta_json(request, {
                "naoLidas": nao_lidas,
                "itens": [{
                    "id": n["id"], "autorId": n["autor_id"], "texto": n["texto"],
                    "tarefaId": n["tarefa_id"], "equipeId": n["equipe_id"],
                    "lida": n["lida"], "criadoEm": n["criado_em"],
                } for n in cur.fetchall()],
            })


@app.post("/api/notificacoes/lidas")
def marcar_lidas(corpo: IdsNotificacoes, request: Request):
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            if corpo.ids:
                cur.execute(
                    "UPDATE notificacoes SET lida = TRUE WHERE usuario_id = %s AND id = ANY(%s)",
                    (usuario["id"], corpo.ids)
                )
            else:
                cur.execute("UPDATE notificacoes SET lida = TRUE WHERE usuario_id = %s", (usuario["id"],))
            conn.commit()
    return {"ok": True}

# ══════════════════════════════════════════════════════════
# ROTAS — EQUIPES
# ══════════════════════════════════════════════════════════

def equipes_com_membros(cur, equipe_ids: Optional[List[int]] = None) -> List[dict]:
    if equipe_ids is None:
        cur.execute("SELECT * FROM equipes ORDER BY nome")
    else:
        cur.execute("SELECT * FROM equipes WHERE id = ANY(%s) ORDER BY nome", (equipe_ids,))
    equipes = cur.fetchall()
    if not equipes:
        return []
    cur.execute(
        "SELECT * FROM equipe_membros WHERE equipe_id = ANY(%s)",
        ([e["id"] for e in equipes],)
    )
    membros = cur.fetchall()
    cur.execute(
        "SELECT * FROM colunas WHERE equipe_id = ANY(%s) ORDER BY ordem, id",
        ([e["id"] for e in equipes],)
    )
    colunas = cur.fetchall()
    return [{
        "id": e["id"],
        "nome": e["nome"],
        "membros": [
            {"usuarioId": m["usuario_id"], "papel": m["papel"]}
            for m in membros if m["equipe_id"] == e["id"]
        ],
        "colunas": [
            {"id": c["id"], "nome": c["nome"], "cor": c["cor"], "finaliza": c["finaliza"]}
            for c in colunas if c["equipe_id"] == e["id"]
        ],
    } for e in equipes]


@app.get("/api/equipes")
def listar_equipes(request: Request):
    """Equipes do usuário logado (todas, para administradores gerais)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            if usuario["is_admin"]:
                return resposta_json(request, equipes_com_membros(cur))
            cur.execute("SELECT equipe_id FROM equipe_membros WHERE usuario_id = %s", (usuario["id"],))
            return resposta_json(request, equipes_com_membros(cur, [r["equipe_id"] for r in cur.fetchall()]))


@app.post("/api/equipes", status_code=201)
def criar_equipe(equipe: Equipe, request: Request):
    nome = equipe.nome.strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Informe o nome da equipe.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Qualquer pessoa pode montar um grupo, inclusive com gente de
            # outros departamentos; quem cria vira administrador do grupo.
            usuario = exigir_usuario(request, cur)
            cur.execute("SELECT 1 FROM equipes WHERE lower(nome) = lower(%s)", (nome,))
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="Já existe uma equipe com esse nome.")
            cur.execute(
                "INSERT INTO equipes (nome, criado_em) VALUES (%s, %s) RETURNING id",
                (nome, agora_iso())
            )
            equipe_id = cur.fetchone()["id"]
            cur.execute(
                "INSERT INTO equipe_membros (equipe_id, usuario_id, papel) VALUES (%s, %s, 'admin')",
                (equipe_id, usuario["id"])
            )
            adicionados = []
            for uid in set(equipe.membros or []) - {usuario["id"]}:
                cur.execute(
                    """INSERT INTO equipe_membros (equipe_id, usuario_id, papel)
                       SELECT %s, id, 'membro' FROM usuarios WHERE id = %s RETURNING usuario_id""",
                    (equipe_id, uid)
                )
                if cur.fetchone():
                    adicionados.append(uid)
            notificar(cur, adicionados, usuario, f'{usuario["nome"]} te adicionou a {nome}', equipe_id=equipe_id)
            criar_colunas_padrao(cur, equipe_id)
            conn.commit()
            return equipes_com_membros(cur, [equipe_id])[0]


@app.put("/api/equipes/{equipe_id}")
def renomear_equipe(equipe_id: int, equipe: Equipe, request: Request):
    nome = equipe.nome.strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Informe o nome da equipe.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            exigir_gestor_equipe(cur, usuario, equipe_id)
            cur.execute("SELECT 1 FROM equipes WHERE lower(nome) = lower(%s) AND id <> %s", (nome, equipe_id))
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="Já existe uma equipe com esse nome.")
            cur.execute("UPDATE equipes SET nome = %s WHERE id = %s RETURNING id", (nome, equipe_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Equipe não encontrada")
            conn.commit()
            return equipes_com_membros(cur, [equipe_id])[0]


@app.delete("/api/equipes/{equipe_id}", status_code=204)
def deletar_equipe(equipe_id: int, request: Request):
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            exigir_gestor_equipe(cur, usuario, equipe_id)
            cur.execute("SELECT COUNT(*) AS c FROM tarefas WHERE equipe_id = %s", (equipe_id,))
            if cur.fetchone()["c"] > 0:
                raise HTTPException(
                    status_code=400,
                    detail="A equipe ainda tem tarefas. Exclua ou mova as tarefas antes."
                )
            cur.execute("DELETE FROM equipes WHERE id = %s RETURNING id", (equipe_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Equipe não encontrada")
            conn.commit()
    return None


@app.put("/api/equipes/{equipe_id}/membros")
def salvar_membro(equipe_id: int, membro: Membro, request: Request):
    """Adiciona o usuário à equipe ou muda o papel dele."""
    if membro.papel not in ("admin", "membro"):
        raise HTTPException(status_code=400, detail="Papel inválido.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            exigir_gestor_equipe(cur, usuario, equipe_id)
            cur.execute("SELECT 1 FROM equipes WHERE id = %s", (equipe_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Equipe não encontrada")
            cur.execute("SELECT 1 FROM usuarios WHERE id = %s", (membro.usuarioId,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Usuário não encontrado")
            papel_antes = papel_na_equipe(cur, membro.usuarioId, equipe_id)
            cur.execute("""
                INSERT INTO equipe_membros (equipe_id, usuario_id, papel) VALUES (%s, %s, %s)
                ON CONFLICT (equipe_id, usuario_id) DO UPDATE SET papel = EXCLUDED.papel
            """, (equipe_id, membro.usuarioId, membro.papel))
            equipe_nome = nome_equipe(cur, equipe_id)
            if papel_antes is None:
                notificar(cur, [membro.usuarioId], usuario,
                          f'{usuario["nome"]} te adicionou a {equipe_nome}', equipe_id=equipe_id)
            elif papel_antes != membro.papel and membro.papel == "admin":
                notificar(cur, [membro.usuarioId], usuario,
                          f'{usuario["nome"]} te tornou admin de {equipe_nome}', equipe_id=equipe_id)
            conn.commit()
            return equipes_com_membros(cur, [equipe_id])[0]


@app.delete("/api/equipes/{equipe_id}/membros/{usuario_id}")
def remover_membro(equipe_id: int, usuario_id: int, request: Request):
    """Tira o usuário da equipe; as tarefas dele nessa equipe ficam sem responsável."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            exigir_gestor_equipe(cur, usuario, equipe_id)
            cur.execute(
                "DELETE FROM equipe_membros WHERE equipe_id = %s AND usuario_id = %s RETURNING usuario_id",
                (equipe_id, usuario_id)
            )
            if cur.fetchone():
                notificar(cur, [usuario_id], usuario,
                          f'{usuario["nome"]} te removeu de {nome_equipe(cur, equipe_id)}')
            cur.execute(
                "UPDATE tarefas SET responsavel = NULL WHERE equipe_id = %s AND responsavel = %s",
                (equipe_id, usuario_id)
            )
            conn.commit()
            return equipes_com_membros(cur, [equipe_id])[0]

# ══════════════════════════════════════════════════════════
# ROTAS — COLUNAS DO QUADRO
# ══════════════════════════════════════════════════════════

def carregar_coluna(cur, coluna_id: int) -> dict:
    cur.execute("SELECT * FROM colunas WHERE id = %s", (coluna_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Coluna não encontrada")
    return row


@app.post("/api/equipes/{equipe_id}/colunas", status_code=201)
def criar_coluna(equipe_id: int, coluna: Coluna, request: Request):
    nome = coluna.nome.strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Informe o nome da coluna.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            exigir_gestor_equipe(cur, exigir_usuario(request, cur), equipe_id)
            cur.execute("SELECT COALESCE(MAX(ordem), -1) + 1 AS prox FROM colunas WHERE equipe_id = %s", (equipe_id,))
            cur.execute(
                "INSERT INTO colunas (equipe_id, nome, cor, ordem, finaliza) VALUES (%s,%s,%s,%s,%s)",
                (equipe_id, nome, coluna.cor, cur.fetchone()["prox"], bool(coluna.finaliza))
            )
            conn.commit()
            return equipes_com_membros(cur, [equipe_id])[0]


@app.put("/api/colunas/{coluna_id}")
def atualizar_coluna(coluna_id: int, coluna: Coluna, request: Request):
    nome = coluna.nome.strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Informe o nome da coluna.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            atual = carregar_coluna(cur, coluna_id)
            exigir_gestor_equipe(cur, exigir_usuario(request, cur), atual["equipe_id"])
            cur.execute(
                "UPDATE colunas SET nome = %s, cor = %s, finaliza = %s WHERE id = %s",
                (nome, coluna.cor, bool(coluna.finaliza), coluna_id)
            )
            conn.commit()
            return equipes_com_membros(cur, [atual["equipe_id"]])[0]


@app.delete("/api/colunas/{coluna_id}")
def deletar_coluna(coluna_id: int, request: Request):
    with get_conn() as conn:
        with conn.cursor() as cur:
            atual = carregar_coluna(cur, coluna_id)
            exigir_gestor_equipe(cur, exigir_usuario(request, cur), atual["equipe_id"])
            cur.execute("SELECT COUNT(*) AS c FROM tarefas WHERE coluna_id = %s", (coluna_id,))
            if cur.fetchone()["c"] > 0:
                raise HTTPException(
                    status_code=400,
                    detail="A coluna ainda tem tarefas. Mova as tarefas para outra coluna antes."
                )
            cur.execute("SELECT COUNT(*) AS c FROM colunas WHERE equipe_id = %s", (atual["equipe_id"],))
            if cur.fetchone()["c"] <= 1:
                raise HTTPException(status_code=400, detail="O quadro precisa ter pelo menos uma coluna.")
            cur.execute("DELETE FROM colunas WHERE id = %s", (coluna_id,))
            conn.commit()
            return equipes_com_membros(cur, [atual["equipe_id"]])[0]


@app.put("/api/equipes/{equipe_id}/colunas/ordem")
def ordenar_colunas(equipe_id: int, ordem: OrdemColunas, request: Request):
    with get_conn() as conn:
        with conn.cursor() as cur:
            exigir_gestor_equipe(cur, exigir_usuario(request, cur), equipe_id)
            cur.execute("SELECT id FROM colunas WHERE equipe_id = %s", (equipe_id,))
            if {r["id"] for r in cur.fetchall()} != set(ordem.ids):
                raise HTTPException(status_code=400, detail="Lista de colunas desatualizada. Recarregue a página.")
            for i, cid in enumerate(ordem.ids):
                cur.execute("UPDATE colunas SET ordem = %s WHERE id = %s", (i, cid))
            conn.commit()
            return equipes_com_membros(cur, [equipe_id])[0]

# ══════════════════════════════════════════════════════════
# ROTAS — USUÁRIOS
# ══════════════════════════════════════════════════════════

@app.get("/api/usuarios")
def listar_usuarios(request: Request):
    # Aberta: a tela de login (modo simples) precisa da lista antes de haver sessão.
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM usuarios ORDER BY nome")
            return resposta_json(request, [row_to_usuario(r) for r in cur.fetchall()])


@app.post("/api/usuarios", status_code=201)
def criar_usuario(usuario: Usuario):
    avatar = usuario.avatar
    if not avatar:
        partes = usuario.nome.split()
        avatar = "".join(p[0] for p in partes[:2]).upper()

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Banco recém-criado: a primeira pessoa cadastrada vira administradora,
            # senão ninguém conseguiria criar equipes nem dar acesso aos outros.
            cur.execute("SELECT EXISTS(SELECT 1 FROM usuarios WHERE is_admin) AS tem")
            primeiro_admin = not cur.fetchone()["tem"]
            cur.execute(
                "INSERT INTO usuarios (nome, cargo, avatar, is_admin) VALUES (%s, %s, %s, %s) RETURNING *",
                (usuario.nome, usuario.cargo or "Colaborador", avatar, primeiro_admin)
            )
            conn.commit()
            return row_to_usuario(cur.fetchone())


@app.put("/api/usuarios/{usuario_id}")
def atualizar_usuario(usuario_id: int, usuario: Usuario, request: Request):
    with get_conn() as conn:
        with conn.cursor() as cur:
            atual = exigir_usuario(request, cur)
            if atual["id"] != usuario_id:
                exigir_admin(atual)
            # Só um administrador geral pode conceder ou retirar o acesso de admin.
            is_admin = usuario.isAdmin if atual["is_admin"] else atual["is_admin"]
            cur.execute("""
                UPDATE usuarios SET
                    nome=%(nome)s, cargo=%(cargo)s, avatar=%(avatar)s, is_admin=%(is_admin)s,
                    foto_perfil=%(foto_perfil)s
                WHERE id=%(id)s
                RETURNING *
            """, {
                "id": usuario_id, "nome": usuario.nome,
                "cargo": usuario.cargo, "avatar": usuario.avatar,
                "is_admin": is_admin, "foto_perfil": usuario.fotoPerfil,
            })
            conn.commit()
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Usuário não encontrado")
            return row_to_usuario(row)


@app.delete("/api/usuarios/{usuario_id}", status_code=204)
def deletar_usuario(usuario_id: int, request: Request):
    with get_conn() as conn:
        with conn.cursor() as cur:
            exigir_admin(exigir_usuario(request, cur))
            cur.execute("DELETE FROM usuarios WHERE id = %s RETURNING id", (usuario_id,))
            conn.commit()
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Usuário não encontrado")
    return None

# ══════════════════════════════════════════════════════════
# SERVE O FRONTEND
# ══════════════════════════════════════════════════════════

app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
app.mount("/data",   StaticFiles(directory=os.path.join(BASE_DIR, "data")),   name="data")

@app.get("/")
def index():
    return FileResponse(os.path.join(BASE_DIR, "index.html"))
