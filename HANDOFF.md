# Handoff — estado atual

Branch local `multi-equipes` = `main` do repositório `Controladoria-MG/WJ-Quadro` (remote `mg`). O remote `origin` (Juanzera04) é a versão antiga em produção e não recebe push.

## Pronto e funcionando

- Equipes e grupos entre departamentos, com papéis e permissões checadas no servidor. Grupos podem ser excluídos com as tarefas (com confirmação).
- Quadro com colunas personalizáveis, editadas no próprio quadro: criar, renomear, cor, "conclui", excluir, arrastar.
- Visões Quadro, Tabela (edição na linha) e Calendário (arrastar muda o prazo).
- Cards com "Atrasada/Vence hoje", destaque do que é seu, ações rápidas (concluir, trocar responsável), busca e filtro por avatar.
- Detalhe da tarefa repaginado, com comentários e histórico automático.
- Minhas tarefas, Dashboard (indicadores clicáveis, filtros por equipe, pessoa e período) e notificações (sino).
- Configurações: modo claro, escuro ou automático, cor de destaque (6 cores, padrão azul), barra lateral recolhível, perfil e membros.
- Atualização automática leve (ETag), datas no fuso de Brasília, gravação por campo e proteção contra XSS.
- No ar em homologação: https://wj-quadro.onrender.com (serviço recriado em 21/10/2026 no workspace sistema-checklist, plano gratuito, ligado ao grupo `wj-quadro-banco`).
- A rota `/` aceita HEAD (o monitor que mantém o Render acordado pinga com HEAD).

## Em andamento

- Nada pela metade no código.
- O serviço WJ-Quadro no Render está fora de projeto. Falta decidir se ele vai para "My project".

## Problemas em aberto

- **Deploy não é automático** no Render. Opções: Manual Deploy, Deploy Hook ou instalar o app do Render na organização Controladoria-MG (precisa de um admin do GitHub).
- **O repositório `Controladoria-MG/WJ-Quadro` está público.** Confirmar se é intencional.
- Duas pessoas editando as **etapas** da mesma tarefa ao mesmo tempo ainda se sobrescrevem (`etapas` é gravado como array inteiro).
- O Gerenciador de Base permite deixar `status` e `concluida` contraditórios.
- O plano grátis do Render "dorme" depois de 15 minutos sem uso (o primeiro acesso leva de 30 a 60 s).

## Próximos passos (prioridade)

1. Resolver o auto-deploy no Render e a visibilidade do repositório.
2. Recorrência mensal, semanal e anual com dias úteis e feriados, e modelos de tarefa.
3. Exportar para Excel (quadro, tabela e dashboard).
4. "Desfazer" depois de excluir ou concluir; etiquetas; campo Cliente e Competência.
5. Pendências visuais: card mais limpo, modo compacto, recolher coluna, títulos de coluna fixos, links clicáveis, atividade agrupada por dia.
6. Estrutura: backup do banco, arquivar concluídas antigas, dividir `static/script.js`.
7. Entrega ao TI (quando decidido): vínculo com o usuário do MG Controle em `auth.py`, desligar a tela de escolher o nome, "Sair" levando ao MG Controle e um documento técnico.
