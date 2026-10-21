# Handoff — estado atual

Branch local `multi-equipes` = `main` do repositório `Controladoria-MG/WJ-Quadro` (remote `mg`). O remote `origin` (Juanzera04) é a versão antiga em produção e não recebe push.

## Pronto e funcionando

- Equipes e grupos entre departamentos, com papéis e permissões checadas no servidor. Grupos podem ser excluídos com as tarefas (com confirmação).
- Quadro com colunas personalizáveis, editadas no próprio quadro: criar, renomear, cor, "conclui", excluir, arrastar.
- Visões Quadro, Tabela (edição na linha) e Calendário (arrastar muda o prazo).
- Cards com "Atrasada/Vence hoje", destaque do que é seu, ações rápidas (concluir, trocar responsável), busca e filtro por avatar.
- Detalhe da tarefa repaginado, com comentários e histórico automático (agrupado por dia) e links clicáveis.
- Etiquetas, Cliente e Competência (mês/ano) por tarefa, com sugestões da equipe; aparecem no card e entram na busca. Clicar numa etiqueta filtra o quadro.
- "Desfazer" depois de excluir ou concluir (a exclusão só vai ao servidor depois de 6 s, ou ao sair da página).
- Etapas gravadas uma a uma no servidor (rotas `/api/tarefas/{id}/etapas`), sem sobrescrever quem edita ao mesmo tempo.
- Colunas recolhíveis e cards compactos (Configurações), guardados no navegador.
- Concluídas há mais de 180 dias ficam arquivadas: não carregam no quadro e aparecem sob pedido na tela de Concluídas.
- O front-end foi dividido de `static/script.js` para `static/js/*.js` (um arquivo por área, mesma ordem de antes).
- Minhas tarefas, Dashboard (indicadores clicáveis, filtros por equipe, pessoa e período) e notificações (sino).
- Configurações: modo claro, escuro ou automático, cor de destaque (6 cores, padrão azul), barra lateral recolhível, perfil e membros.
- Atualização automática leve (ETag), datas no fuso de Brasília, gravação por campo e proteção contra XSS.
- No ar em homologação: https://wj-quadro.onrender.com (serviço recriado em 21/10/2026 no workspace sistema-checklist, plano gratuito, ligado ao grupo `wj-quadro-banco`).
- A rota `/` aceita HEAD (o monitor que mantém o Render acordado pinga com HEAD).

## Em andamento

- Nada pela metade no código.
- O serviço WJ-Quadro no Render está fora de projeto. Falta decidir se ele vai para "My project".
- O deploy automático funciona desde 21/10/2026 (app do Render instalado na Controladoria-MG só para o WJ-Quadro).

## Problemas em aberto

- **O repositório `Controladoria-MG/WJ-Quadro` está público.** Confirmar se é intencional.
- O plano grátis do Render "dorme" depois de 15 minutos sem uso (o primeiro acesso leva de 30 a 60 s).

## Próximos passos (prioridade)

1. Decidir a visibilidade do repositório.
2. Exportar para Excel (adiado pelo usuário em 21/10/2026). Recorrência e modelos foram descartados.
3. Entrega ao TI (quando decidido): vínculo com o usuário do MG Controle em `auth.py`, desligar a tela de escolher o nome, "Sair" levando ao MG Controle e um documento técnico.
