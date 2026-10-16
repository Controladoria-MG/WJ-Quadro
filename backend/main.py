"""
Portal de Tarefas — Backend FastAPI + PostgreSQL
Os dados ficam em tabelas reais e nunca se perdem entre deploys.
A conexão é lida da variável de ambiente DATABASE_URL.

Organização: usuários participam de uma ou mais equipes; cada tarefa
pertence a uma equipe e só é visível/editável por membros dela (e pelos
administradores gerais). O responsável de uma tarefa precisa ser membro
da equipe da tarefa.
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import os
import json
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
            cur.execute("SELECT COUNT(*) as c FROM equipes")
            if cur.fetchone()["c"] == 0:
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
    nome: str
    descricao: Optional[str] = ""
    etapas: Optional[List[Etapa]] = []
    prazo: str
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
            if usuario["is_admin"]:
                cur.execute("SELECT * FROM tarefas ORDER BY id")
            else:
                cur.execute("""
                    SELECT t.* FROM tarefas t
                    JOIN equipe_membros m ON m.equipe_id = t.equipe_id AND m.usuario_id = %s
                    ORDER BY t.id
                """, (usuario["id"],))
            return [row_to_tarefa(r) for r in cur.fetchall()]


@app.post("/api/tarefas", status_code=201)
def criar_tarefa(tarefa: Tarefa, request: Request):
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            if tarefa.equipeId is None:
                raise HTTPException(status_code=400, detail="Informe a equipe da tarefa.")
            exigir_membro(cur, usuario, tarefa.equipeId)
            validar_responsavel(cur, tarefa.equipeId, tarefa.responsavel)

            criado_em = tarefa.criadoEm or agora_iso()
            etapas_json = json.dumps(
                [e.model_dump() for e in tarefa.etapas], ensure_ascii=False
            )
            cur.execute("""
                INSERT INTO tarefas
                    (equipe_id, nome, descricao, etapas, prazo, data_prazo, urgencia,
                     responsavel, status, observacoes, retorno, criado_em,
                     criado_por, concluida, diaria_feita_em)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING *
            """, (
                tarefa.equipeId, tarefa.nome, tarefa.descricao, etapas_json,
                tarefa.prazo, tarefa.dataPrazo, tarefa.urgencia,
                tarefa.responsavel, tarefa.status, tarefa.observacoes,
                tarefa.retorno, criado_em, usuario["id"],
                tarefa.concluida, tarefa.diariaFeitaEm
            ))
            conn.commit()
            return row_to_tarefa(cur.fetchone())


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

            etapas_json = json.dumps(
                [e.model_dump() for e in tarefa.etapas], ensure_ascii=False
            )
            cur.execute("""
                UPDATE tarefas SET
                    equipe_id=%(equipe_id)s,
                    nome=%(nome)s, descricao=%(descricao)s, etapas=%(etapas)s,
                    prazo=%(prazo)s, data_prazo=%(data_prazo)s, urgencia=%(urgencia)s,
                    responsavel=%(responsavel)s, status=%(status)s,
                    observacoes=%(observacoes)s, retorno=%(retorno)s,
                    concluida=%(concluida)s, diaria_feita_em=%(diaria_feita_em)s,
                    concluido_em=%(concluido_em)s, concluido_por=%(concluido_por)s
                WHERE id=%(id)s
                RETURNING *
            """, {
                "id": tarefa_id, "equipe_id": equipe_id, "nome": tarefa.nome,
                "descricao": tarefa.descricao, "etapas": etapas_json,
                "prazo": tarefa.prazo, "data_prazo": tarefa.dataPrazo,
                "urgencia": tarefa.urgencia, "responsavel": tarefa.responsavel,
                "status": tarefa.status, "observacoes": tarefa.observacoes,
                "retorno": tarefa.retorno, "concluida": tarefa.concluida,
                "diaria_feita_em": tarefa.diariaFeitaEm,
                "concluido_em": tarefa.concluidoEm, "concluido_por": tarefa.concluidoPor,
            })
            conn.commit()
            return row_to_tarefa(cur.fetchone())


@app.patch("/api/tarefas/{tarefa_id}")
def patch_tarefa(tarefa_id: int, campos: dict, request: Request):
    col_map = {
        "nome": "nome", "descricao": "descricao", "etapas": "etapas",
        "prazo": "prazo", "dataPrazo": "data_prazo", "urgencia": "urgencia",
        "responsavel": "responsavel", "status": "status",
        "observacoes": "observacoes", "retorno": "retorno",
        "concluida": "concluida", "diariaFeitaEm": "diaria_feita_em",
        "concluidoEm": "concluido_em", "concluidoPor": "concluido_por",
        "avisoConfirmado": "aviso_confirmado",
    }
    sets, values = [], []
    for key, val in campos.items():
        col = col_map.get(key)
        if not col:
            continue
        if col == "etapas" and isinstance(val, list):
            val = json.dumps(val, ensure_ascii=False)
        sets.append(f"{col} = %s")
        values.append(val)

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

            cur.execute(
                f"UPDATE tarefas SET {', '.join(sets)} WHERE id = %s RETURNING *",
                values
            )
            conn.commit()
            return row_to_tarefa(cur.fetchone())


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
    return [{
        "id": e["id"],
        "nome": e["nome"],
        "membros": [
            {"usuarioId": m["usuario_id"], "papel": m["papel"]}
            for m in membros if m["equipe_id"] == e["id"]
        ],
    } for e in equipes]


@app.get("/api/equipes")
def listar_equipes(request: Request):
    """Equipes do usuário logado (todas, para administradores gerais)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            if usuario["is_admin"]:
                return equipes_com_membros(cur)
            cur.execute("SELECT equipe_id FROM equipe_membros WHERE usuario_id = %s", (usuario["id"],))
            return equipes_com_membros(cur, [r["equipe_id"] for r in cur.fetchall()])


@app.post("/api/equipes", status_code=201)
def criar_equipe(equipe: Equipe, request: Request):
    nome = equipe.nome.strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Informe o nome da equipe.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            usuario = exigir_usuario(request, cur)
            exigir_admin(usuario)
            cur.execute("SELECT 1 FROM equipes WHERE lower(nome) = lower(%s)", (nome,))
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="Já existe uma equipe com esse nome.")
            cur.execute(
                "INSERT INTO equipes (nome, criado_em) VALUES (%s, %s) RETURNING id",
                (nome, agora_iso())
            )
            equipe_id = cur.fetchone()["id"]
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
            exigir_admin(usuario)
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
            cur.execute("""
                INSERT INTO equipe_membros (equipe_id, usuario_id, papel) VALUES (%s, %s, %s)
                ON CONFLICT (equipe_id, usuario_id) DO UPDATE SET papel = EXCLUDED.papel
            """, (equipe_id, membro.usuarioId, membro.papel))
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
                "DELETE FROM equipe_membros WHERE equipe_id = %s AND usuario_id = %s",
                (equipe_id, usuario_id)
            )
            cur.execute(
                "UPDATE tarefas SET responsavel = NULL WHERE equipe_id = %s AND responsavel = %s",
                (equipe_id, usuario_id)
            )
            conn.commit()
            return equipes_com_membros(cur, [equipe_id])[0]

# ══════════════════════════════════════════════════════════
# ROTAS — USUÁRIOS
# ══════════════════════════════════════════════════════════

@app.get("/api/usuarios")
def listar_usuarios():
    # Aberta: a tela de login (modo simples) precisa da lista antes de haver sessão.
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM usuarios ORDER BY nome")
            return [row_to_usuario(r) for r in cur.fetchall()]


@app.post("/api/usuarios", status_code=201)
def criar_usuario(usuario: Usuario):
    avatar = usuario.avatar
    if not avatar:
        partes = usuario.nome.split()
        avatar = "".join(p[0] for p in partes[:2]).upper()

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO usuarios (nome, cargo, avatar) VALUES (%s, %s, %s) RETURNING *",
                (usuario.nome, usuario.cargo or "Colaborador", avatar)
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
