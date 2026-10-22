# Quadro

Sistema de tarefas em kanban para as equipes e grupos da MG, criado e mantido por Willian Arruda e Juan Rodrigues.

---

## Estrutura do Projeto

```
Quadro/
├── index.html              # Todas as telas e janelas
├── static/
│   ├── js/                 # Lógica da tela, um arquivo por área (consome a API)
│   └── style.css           # Estilos (modos claro e escuro)
├── data/
│   ├── tarefas.json        # Base de dados de tarefas
│   └── users.json          # Base de dados de usuários
└── backend/
    ├── main.py             # Servidor FastAPI
    ├── requirements.txt    # Dependências Python
    ├── start.sh            # Inicialização (Linux/Mac)
    └── start.bat           # Inicialização (Windows)
```

---

## Como Rodar Localmente

### Windows
```
Abra o terminal na pasta raiz do projeto e execute:
backend\start.bat
```

### Linux / Mac
```bash
bash backend/start.sh
```

O Quadro estará disponível em: **http://localhost:8000**
A documentação da API em: **http://localhost:8000/docs**

> **Importante:** sempre abra pelo endereço `http://localhost:8000`,
> não abrindo o `index.html` diretamente no navegador.

---

## Deploy no Render

1. Suba o projeto em um repositório GitHub (público ou privado)

2. Acesse [render.com](https://render.com) e crie uma conta

3. Clique em **New > Web Service** e conecte o repositório

4. Configure o serviço:
   | Campo | Valor |
   |---|---|
   | **Runtime** | Python 3 |
   | **Root Directory** | *(deixe vazio)* |
   | **Build Command** | `pip install -r backend/requirements.txt` |
   | **Start Command** | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` |

5. Clique em **Create Web Service**

> ⚠️ **Atenção ao Render gratuito:** os dados dos `.json` são perdidos
> toda vez que o serviço reinicia (o disco é efêmero).
> Para persistência real em produção, considere migrar para um banco
> de dados como PostgreSQL (o próprio Render oferece gratuitamente).

---

## API — Endpoints

### Tarefas
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/tarefas` | Lista todas as tarefas |
| POST | `/api/tarefas` | Cria uma nova tarefa |
| PUT | `/api/tarefas/{id}` | Atualiza uma tarefa completa |
| PATCH | `/api/tarefas/{id}` | Atualiza campos específicos |
| DELETE | `/api/tarefas/{id}` | Remove uma tarefa |

### Usuários
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/usuarios` | Lista todos os usuários |
| POST | `/api/usuarios` | Cria um novo usuário |
| PUT | `/api/usuarios/{id}` | Atualiza um usuário completo (inclui `fotoPerfil`) |
| DELETE | `/api/usuarios/{id}` | Remove um usuário |

---

## Foto de Perfil

Cada usuário tem um campo `fotoPerfil`, salvo como base64 (data URL) na
coluna `foto_perfil` da tabela `usuarios`. Quando não há foto, o avatar
volta a mostrar as iniciais do campo `avatar` (comportamento original).

**Quem pode trocar:**
- **Qualquer usuário** pode trocar a própria foto passando o mouse sobre
  o avatar na barra lateral — aparece um ícone de câmera; ao clicar, abre
  o seletor de arquivo. Não precisa ser admin.
- **Admins** também podem definir ou remover a foto de qualquer usuário
  em **Gerenciador de Base → Usuários → Editar**.

**Detalhes técnicos:**
- A imagem é redimensionada no navegador (máx. 160px, JPEG ~82% de
  qualidade) antes do envio, para não inflar o banco.
- A coluna é criada automaticamente na inicialização
  (`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_perfil TEXT`) —
  não exige migração manual.
- Para reverter por completo: remover o código relacionado e rodar
  `ALTER TABLE usuarios DROP COLUMN foto_perfil;` (a coluna é aditiva,
  não afeta nada que já existia).
