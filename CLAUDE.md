# Quadro

Sistema de tarefas em kanban para várias equipes e grupos da MG (estilo Monday). Nasceu do kanban interno da Controladoria e hoje atende vários departamentos. O destino final é o TI hospedar o sistema no domínio da empresa, com login pelo MG Controle e acesso só pela rede interna.

**Stack:** Python 3 + FastAPI + PostgreSQL (psycopg2) no back-end. O front-end é HTML, CSS e JavaScript puros, sem build, servidos pelo próprio FastAPI.

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `backend/main.py` | Toda a API, a criação e migração do banco (`init_db`), as permissões, o histórico e as notificações. |
| `backend/auth.py` | `usuario_atual_id(request)`: **único** ponto que descobre quem está logado. Hoje lê o cookie `currentUserId`; o TI vai trocar pela sessão do MG Controle. |
| `index.html` | Todas as telas e janelas (modais). |
| `static/js/*.js` | A lógica da tela, um arquivo por área (base, equipes, login, quadro, concluidas, gerenciador, tarefa, grupos, tabela, atividade, dashboard, calendario, minhas, configuracoes, geral). São scripts comuns que compartilham o escopo global, carregados **nesta ordem** pelo `index.html`. Dentro de cada um, seções `// ── Nome ──`. |
| `static/style.css` | Estilos. Os temas ficam em `:root[data-accent=…]` e `:root[data-tema="claro"]`. |
| `render.yaml` | Blueprint do Render (não é usado pelo serviço atual, que foi criado à mão). |
| `data/*.json` | Carga inicial vazia; só é usada se o banco estiver vazio. |

## Como rodar

```bash
pip install -r backend/requirements.txt
DATABASE_URL=postgresql://... uvicorn backend.main:app --reload --port 8000
```

- **Não há build.** Ao mudar CSS ou JS, atualize o `?v=AAAA-MM-DD…` de todos os links (`style.css` e cada `static/js/*.js`) no `index.html`, senão o navegador usa o arquivo antigo.
- **Ordem dos scripts:** código que roda no carregamento (fora de funções) só pode usar o que já foi declarado nos arquivos anteriores. Para ligar um evento a uma função de um arquivo posterior, use `() => funcao()`, não `funcao` direto. Novos arquivos entram na lista do `index.html`.
- **Não há testes automatizados.** A validação é feita na API (com `urllib` ou `curl`) e na tela, contra um Postgres de teste.
- As tabelas são criadas e migradas sozinhas na subida (`init_db`, idempotente). Não existe script de migração separado.
- **Deploy:** Render, serviço WJ-Quadro (https://wj-quadro.onrender.com), workspace sistema-checklist, a partir do `main` do repositório `Controladoria-MG/WJ-Quadro`. O `DATABASE_URL` vem do grupo de ambiente `wj-quadro-banco`. O deploy é **automático** a cada push no `main` (app do Render instalado na organização, só para esse repositório).

## Modelo e decisões

- **Equipes e grupos** (`equipes` + `equipe_membros`, com papel `admin` ou `membro`). Uma pessoa pode estar em várias. Quem cria um grupo vira admin dele. `usuarios.is_admin` é o admin geral, que vê tudo.
- **Toda rota checa permissão no servidor** (`exigir_usuario`, `exigir_membro`, `exigir_gestor_equipe`). O responsável de uma tarefa precisa ser membro da equipe dela (não se atribui tarefa a outra área).
- **Colunas** (`colunas`) são por equipe e configuradas **no próprio quadro** (menu ⋯, "+", arrastar o título), não em Configurações. Uma coluna com `finaliza=true` conclui a tarefa que entra nela.
- **Diárias:** `prazo = "diaria"`, `diaria_feita_em` com a data local de Brasília (`todayStr` usa `America/Sao_Paulo`). Ficam fora das contagens de "em aberto" e "atrasadas".
- **Edição grava só o campo alterado** (PATCH). O PUT completo existe só no Gerenciador de Base.
- **Histórico e notificações são gerados no back-end** (`descrever_mudancas`, `registrar_e_notificar`, `notificar`). Edições de texto são agrupadas por 10 minutos. Nunca notificar quem fez a ação.
- **Arquivadas:** concluídas há mais de 180 dias (`DIAS_ATE_ARQUIVAR`) não vêm no `GET /api/tarefas`; só com `?arquivadas=true`, pelo botão no fim da tela de Concluídas. 180 porque o Dashboard compara até 90 dias com os 90 anteriores.
- **Atualização automática** a cada 20 s (`atualizarEmSegundoPlano`). Ela não redesenha a tela enquanto o usuário está ocupado (`usuarioOcupado`). Os GETs usam ETag (`resposta_json`), e o `index.html` vai com `Cache-Control: no-cache`.
- **Configurações** concentram o que é do sistema (aparência, perfil, membros, Gerenciador de Base). A tela principal fica limpa.
- **Cores:** destaque padrão azul. Status e urgência usam a **rampa vermelha da MG** (`--vermelho-claro/medio/forte/profundo`), validada para fundo escuro e claro. Nunca verde ou âmbar para status.
- **Interface 100% em português**, sem "cara de IA" (sem emojis nem notas explicativas) e com plural concordando.
- O nome do sistema é **"Quadro"**, para não confundir com o "Portal de Tarefas" da Central de Relatórios.
- **Autoria:** criado e mantido por Willian Arruda e Juan Rodrigues. A logo deles (símbolo SVG `#logo-jw` no `index.html`, sem verde: corpo em `currentColor`, faixas na cor de destaque) aparece só no rodapé da entrada e em Configurações > Sobre. A marca da barra lateral continua a do Quadro.

## Armadilhas (não fazer)

- **`backend/.env` aponta para o banco de PRODUÇÃO antigo** (`controladoria`, do repositório Juanzera04). Subir localmente com ele roda a migração nos dados reais. Para testar, exporte um `DATABASE_URL` de teste, que tem prioridade sobre o `.env`.
- **Nunca inserir texto do usuário em `innerHTML` sem `escapeHTML()`**, e foto de perfil só passando por `fotoSegura()` (já houve falha de XSS).
- Não usar `rgba(34,197,94,…)` nem outra cor fixa de destaque no CSS: use `var(--green)` ou `color-mix(…var(--green)…)`. As variáveis `--green*` são a cor do tema, qualquer que seja ela.
- Novos modais usam `z-index: 100`. A confirmação (`#modal-confirm-overlay`) fica em 120, para nunca abrir atrás de outra janela.
- Uma coluna (`.checklist`, listas) com `flex: 1; min-height: 0` encolhe primeiro e "espreme" o conteúdo. No detalhe, as seções ficam no tamanho natural e a coluna inteira rola.
- No Render, o **Root Directory deve ficar vazio** (já colocaram o comando pip ali e todos os deploys falharam).
- O Render grátis só permite **um** Postgres por conta. Excluir um web service não apaga o banco.
- Login sem senha: qualquer pessoa escolhe qualquer nome. Um token próprio **não** resolve isso; a solução é o login do MG Controle (via `auth.py`).
