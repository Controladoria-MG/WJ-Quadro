/* Quadro — Filtros, quadro (colunas) e cards. */

// ── Filtro de Usuário ─────────────────────────────────────
function renderFiltroUsuarios() {
  const existing = document.getElementById("filtro-usuario-bar");
  if (existing) existing.remove();

  const bar = document.createElement("div");
  bar.id = "filtro-usuario-bar";
  bar.className = "filtro-bar";

  const group = document.createElement("div");
  group.className = "filtro-group";

  // Busca por nome, descrição, cliente, competência ou etiqueta
  const busca = document.createElement("div");
  busca.className = "filtro-busca";
  busca.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input type="text" placeholder="Buscar tarefa..." />`;
  const inputBusca = busca.querySelector("input");
  inputBusca.value = state.busca || "";
  inputBusca.oninput = () => { state.busca = inputBusca.value; renderBoard(); };
  inputBusca.onkeydown = e => { if (e.key === "Escape") { inputBusca.value = ""; state.busca = ""; inputBusca.blur(); renderBoard(); } };
  group.appendChild(busca);

  // Pessoas: avatares (clicar filtra pelo responsável)
  const pessoas = document.createElement("div");
  pessoas.className = "filtro-avatares";
  const btnTodos = document.createElement("button");
  btnTodos.type = "button";
  btnTodos.className = "filtro-btn" + (state.filtroUsuario === null ? " active" : "");
  btnTodos.textContent = "Todos";
  btnTodos.onclick = () => { state.filtroUsuario = null; renderFiltroUsuarios(); renderBoard(); };
  pessoas.appendChild(btnTodos);

  const membros = membrosDaEquipe(state.equipeAtual)
    .sort((a, b) => (b.id === state.current?.id) - (a.id === state.current?.id));   // você primeiro
  membros.forEach(u => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtro-avatar" + (state.filtroUsuario === u.id ? " active" : "");
    btn.title = u.id === state.current?.id ? `${u.nome} (você)` : u.nome;
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = avatarHTML(u, "sm");
    btn.onclick = () => {
      state.filtroUsuario = state.filtroUsuario === u.id ? null : u.id;   // clicar de novo tira o filtro
      renderFiltroUsuarios();
      renderBoard();
    };
    pessoas.appendChild(btn);
  });
  group.appendChild(pessoas);

  bar.appendChild(group);
  bar.appendChild(controlesDaBarra());

  // Insere entre topbar e board
  const main   = document.getElementById("main");
  const topbar = document.getElementById("topbar");
  main.insertBefore(bar, topbar.nextSibling);

  // Só faz sentido enquanto o board está na tela — as telas de
  // concluídas/admin têm seus próprios filtros ou nenhum.
  bar.classList.toggle("hidden", !quadroVisivel());
}

// ── Board ─────────────────────────────────────────────────
// As colunas vêm de cada equipe (equipe.colunas), na ordem definida por
// quem administra o quadro. Uma coluna "finaliza" mostra as tarefas
// concluídas; nas demais só aparecem as em aberto.
function colunasDaEquipe(equipeId) {
  const equipe = state.equipes.find(e => e.id === equipeId);
  return equipe ? equipe.colunas : [];
}

function colunaDaTarefa(t) {
  const colunas = colunasDaEquipe(t.equipeId);
  return colunas.find(c => c.id === t.colunaId)
    || colunas.find(c => !c.finaliza)
    || colunas[0]
    || null;
}

function colunaFinal(equipeId) {
  return colunasDaEquipe(equipeId).find(c => c.finaliza) || null;
}

function ehColunaAndamento(coluna) {
  return !coluna.finaliza && semAcento(coluna.nome).trim() === "em andamento";
}

// Grupos com coluna "Em andamento" usam a própria coluna como status:
// o campo Status fica escondido e acompanha a coluna.
function statusPelaColuna(equipeId) {
  return colunasDaEquipe(equipeId).some(ehColunaAndamento);
}

function statusInicial(coluna) {
  return coluna && ehColunaAndamento(coluna) ? "em andamento" : "pendente";
}

// Ajusta os campos de conclusão (e o status) quando a tarefa muda para `coluna`.
function aplicarColuna(t, coluna) {
  t.colunaId = coluna.id;
  if (coluna.finaliza && !t.concluida) {
    t.concluida    = true;
    t.status       = "concluida";
    t.concluidoEm  = new Date().toISOString();
    t.concluidoPor = state.current?.id ?? null;
  } else if (!coluna.finaliza && t.concluida) {
    t.concluida = false;
    t.status    = "pendente";
  }
  if (!coluna.finaliza && statusPelaColuna(t.equipeId)) {
    t.status = ehColunaAndamento(coluna) ? "em andamento" : "pendente";
  }
}

// Campos que mudam juntos quando a tarefa troca de coluna ou é concluída.
function camposConclusao(t) {
  return {
    colunaId: t.colunaId, concluida: t.concluida, status: t.status,
    concluidoEm: t.concluidoEm, concluidoPor: t.concluidoPor,
  };
}

async function moverTarefa(t, coluna) {
  const anterior = { ...t };
  aplicarColuna(t, coluna);
  renderBoard();
  try {
    Object.assign(t, await api.patchTarefa(t.id, camposConclusao(t)));
    renderBoard();
    if (t.concluida && !anterior.concluida) avisarConclusao(t, anterior);
  } catch (err) {
    Object.assign(t, anterior);
    renderBoard();
    toast(err.message, true);
  }
}

// Quem ainda não participa de nenhuma equipe vê uma orientação, não um quadro vazio.
function boasVindas() {
  const el = document.createElement("div");
  el.className = "boas-vindas";
  el.innerHTML = `
    <h2>Bem-vindo ao Quadro</h2>
    <p>Você ainda não faz parte de nenhuma equipe. Peça a quem administra a sua equipe para te adicionar, ou crie um grupo com as pessoas com quem você trabalha.</p>
    <button type="button" class="btn btn-primary">Criar um grupo</button>`;
  el.querySelector("button").onclick = openGrupoModal;
  return el;
}

function renderBoard() {
  if (!equipeAtual()) {
    const area = areaPrincipal();
    area.innerHTML = "";
    area.appendChild(boasVindas());
    renderNavEquipes();
    return;
  }
  if (state.visao === "tabela" || state.visao === "calendario") {
    state.visao === "tabela" ? renderTabela() : renderCalendario();
    renderNavEquipes();
    return;
  }
  const board = document.getElementById("board");
  board.innerHTML = "";

  const eq = equipeAtual();
  const colunas = eq ? eq.colunas : [];
  const gestor = souGestorDaEquipe(eq);
  board.style.setProperty("--ncols", Math.max(colunas.length, 1));
  board.classList.toggle("com-coluna-nova", gestor);
  const recolhidas = colunasRecolhidas();
  board.style.gridTemplateColumns = colunas.length
    ? colunas.map(c => recolhidas.has(c.id) ? "46px" : "minmax(250px, 1fr)").join(" ") + (gestor ? " auto" : "")
    : "";

  const tarefasFiltradas = tarefasVisiveis();

  colunas.forEach(col => {
    const tasks = tarefasDaColuna(tarefasFiltradas, col);
    const count = tasks.filter(t =>
      t.prazo === "diaria" ? !isDiariaFeitaHoje(t) : !t.concluida
    ).length;

    const col_el = document.createElement("div");
    col_el.className = "column" + (recolhidas.has(col.id) ? " recolhida" : "");
    col_el.innerHTML = `
      <div class="column-header">
        <div class="column-title">
          <div class="col-dot"></div>
          <span class="column-nome"></span>
        </div>
        <div class="column-header-direita">
          <span class="col-count">${count}</span>
          <button type="button" class="coluna-recolher-btn" title="${recolhidas.has(col.id) ? "Expandir coluna" : "Recolher coluna"}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="${recolhidas.has(col.id) ? "9 18 15 12 9 6" : "15 18 9 12 15 6"}"/></svg>
          </button>
          ${gestor ? `<button type="button" class="coluna-menu-btn" title="Opções da coluna">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
          </button>` : ""}
        </div>
      </div>
      <div class="column-body"></div>`;
    col_el.querySelector(".col-dot").style.background = col.cor;
    col_el.querySelector(".column-nome").textContent = col.nome;
    board.appendChild(col_el);

    const btnRecolher = col_el.querySelector(".coluna-recolher-btn");
    btnRecolher.addEventListener("click", e => { e.stopPropagation(); alternarColunaRecolhida(col.id); });
    btnRecolher.addEventListener("mousedown", e => e.stopPropagation());
    if (recolhidas.has(col.id)) {
      col_el.addEventListener("click", () => alternarColunaRecolhida(col.id));
      // Soltar um card numa coluna recolhida também move a tarefa.
      col_el.addEventListener("dragover", e => { if (!arrastandoColuna(e)) e.preventDefault(); });
      col_el.addEventListener("drop", e => {
        if (arrastandoColuna(e)) return;
        e.preventDefault();
        const t = state.tarefas.find(x => x.id === Number(e.dataTransfer.getData("text/plain")));
        if (t && colunaDaTarefa(t)?.id !== col.id) moverTarefa(t, col);
      });
    }

    // Mover a coluna: arrastar pelo cabeçalho (só quem administra o quadro).
    if (gestor) {
      const header = col_el.querySelector(".column-header");
      const btnMenu = header.querySelector(".coluna-menu-btn");
      btnMenu.addEventListener("click", e => { e.stopPropagation(); abrirMenuColuna(btnMenu, col_el, eq, col); });
      btnMenu.addEventListener("mousedown", e => e.stopPropagation());
      header.querySelector(".column-nome").addEventListener("dblclick", () => renomearColunaNoQuadro(col_el, eq, col));
      header.draggable = true;
      header.title = "Arraste para mudar a coluna de lugar";
      header.addEventListener("dragstart", e => {
        e.dataTransfer.setData(TIPO_COLUNA, String(col.id));
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setDragImage(col_el, 20, 20);
        requestAnimationFrame(() => col_el.classList.add("coluna-arrastando"));
      });
      header.addEventListener("dragend", () => {
        col_el.classList.remove("coluna-arrastando");
        limparMarcasDeSoltar("#board .column");
      });
      col_el.addEventListener("dragover", e => {
        if (!arrastandoColuna(e)) return;
        e.preventDefault();
        limparMarcasDeSoltar("#board .column");
        col_el.classList.add(`soltar-${ladoDoMouse(e, col_el, true)}`);
      });
      col_el.addEventListener("dragleave", e => {
        if (!col_el.contains(e.relatedTarget)) col_el.classList.remove("soltar-antes", "soltar-depois");
      });
      col_el.addEventListener("drop", e => {
        if (!arrastandoColuna(e)) return;
        e.preventDefault();
        const movidaId = Number(e.dataTransfer.getData(TIPO_COLUNA));
        const lado = ladoDoMouse(e, col_el, true);
        limparMarcasDeSoltar("#board .column");
        const semMovida = colunas.filter(c => c.id !== movidaId);
        const alvo = semMovida.findIndex(c => c.id === col.id);
        if (alvo === -1) return;   // soltou em cima dela mesma
        reordenarColunas(eq, movidaId, lado === "antes" ? alvo : alvo + 1);
      });
    }

    const body = col_el.querySelector(".column-body");

    body.addEventListener("dragover", e => {
      if (arrastandoColuna(e)) return;   // quem trata é a coluna
      e.preventDefault();
      body.classList.add("drag-over");
    });
    body.addEventListener("dragleave", () => body.classList.remove("drag-over"));
    body.addEventListener("drop", e => {
      if (arrastandoColuna(e)) return;
      e.preventDefault();
      body.classList.remove("drag-over");
      const id = Number(e.dataTransfer.getData("text/plain"));
      const t  = state.tarefas.find(x => x.id === id);
      if (!t || colunaDaTarefa(t)?.id === col.id) return;
      moverTarefa(t, col);
    });

    if (tasks.length === 0) {
      body.innerHTML = `
        <div class="column-empty">${state.busca || state.filtroUsuario !== null ? "Nada com esse filtro" : "Nenhuma tarefa"}</div>`;
    } else {
      ordenarTarefas(tasks).forEach(t => body.appendChild(
        t.prazo === "diaria" ? buildDiariaCard(t) : buildCard(t)
      ));
    }

    // Criação rápida: digita o nome e Enter cria a tarefa nesta coluna.
    if (!col.finaliza) {
      const add = document.createElement("div");
      add.className = "column-add-task";
      add.innerHTML = `<input type="text" placeholder="+ Adicionar tarefa" />`;
      const input = add.querySelector("input");
      input.addEventListener("keydown", async e => {
        if (e.key === "Escape") { input.value = ""; input.blur(); return; }
        if (e.key !== "Enter") return;
        e.preventDefault();
        const nome = input.value.trim();
        if (!nome) return;
        input.disabled = true;
        try {
          const nova = await api.criarTarefa({
            equipeId: eq.id, colunaId: col.id, nome,
            prazo: "unica", urgencia: "media", status: statusInicial(col),
            etapas: [], criadoEm: new Date().toISOString(),
          });
          state.tarefas.push(nova);
          renderBoard();
          document.querySelectorAll(".column-add-task input")[colunas.filter(c => !c.finaliza).indexOf(col)]?.focus();
        } catch (err) {
          input.disabled = false;
          toast(err.message, true);
        }
      });
      col_el.appendChild(add);
    }
  });

  if (gestor) board.appendChild(novaColunaNoQuadro(eq));
  renderNavEquipes();
}

// Colunas recolhidas ficam guardadas neste navegador, por pessoa.
function colunasRecolhidas() {
  return new Set(lerPreferencia("colunasRecolhidas", "").split(",").filter(Boolean).map(Number));
}

function alternarColunaRecolhida(id) {
  const recolhidas = colunasRecolhidas();
  recolhidas.has(id) ? recolhidas.delete(id) : recolhidas.add(id);
  salvarPreferencia("colunasRecolhidas", [...recolhidas].join(","));
  renderBoard();
}

// ── Cards ─────────────────────────────────────────────────
function nomeOuVoce(u) {
  return u.id === state.current?.id ? "Você" : escapeHTML(u.nome);
}

// Ações que aparecem ao passar o mouse no card: concluir e trocar o responsável.
function acoesRapidasHTML(t) {
  const concluir = t.prazo !== "diaria" && !t.concluida
    ? `<button type="button" class="card-acao" data-acao="concluir" title="Concluir">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </button>` : "";
  return `${concluir}
    <button type="button" class="card-acao" data-acao="responsavel" title="Trocar responsável">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    </button>`;
}

function ligarAcoesRapidas(el, t) {
  el.querySelector('.card-acao[data-acao="concluir"]')?.addEventListener("click", e => {
    e.stopPropagation();
    concluirRapido(t);
  });
  const btnResp = el.querySelector('.card-acao[data-acao="responsavel"]');
  btnResp?.addEventListener("click", e => {
    e.stopPropagation();
    abrirMenuResponsavel(btnResp, t);
  });
  el.querySelectorAll(".card-acao").forEach(b => b.addEventListener("mousedown", e => e.stopPropagation()));
}

async function concluirRapido(t) {
  const final = colunaFinal(t.equipeId);
  if (final) {
    await moverTarefa(t, final);
  } else {
    const anterior = { ...t };
    Object.assign(t, { concluida: true, status: "concluida", concluidoEm: new Date().toISOString(), concluidoPor: state.current?.id ?? null });
    renderBoard();
    try {
      Object.assign(t, await api.patchTarefa(t.id, camposConclusao(t)));
    } catch (err) {
      Object.assign(t, anterior);
      renderBoard();
      toast(err.message, true);
      return;
    }
    renderBoard();
    avisarConclusao(t, anterior);
  }
}

function fecharMenuResponsavel() {
  document.getElementById("resp-menu")?.remove();
}

function abrirMenuResponsavel(botao, t) {
  const jaAberto = document.getElementById("resp-menu")?.dataset.tarefa === String(t.id);
  fecharMenuResponsavel();
  fecharMenuColuna();
  if (jaAberto) return;
  const menu = document.createElement("div");
  menu.id = "resp-menu";
  menu.className = "coluna-menu resp-menu";
  menu.dataset.tarefa = t.id;
  const opcoes = [{ id: null, nome: "Sem responsável" }, ...membrosDaEquipe(t.equipeId)];
  menu.innerHTML = `<div class="coluna-menu-secao">Responsável</div>` + opcoes.map(u => `
    <button type="button" data-id="${u.id ?? ""}" class="${(t.responsavel ?? null) === u.id ? "atual" : ""}">
      ${u.id ? avatarHTML(u, "sm") : `<span class="resp-menu-vazio"></span>`}
      <span>${u.id ? nomeOuVoce(u) : "Sem responsável"}</span>
    </button>`).join("");
  document.body.appendChild(menu);
  const r = botao.getBoundingClientRect();
  menu.style.top  = `${Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.addEventListener("mousedown", e => e.stopPropagation());
  menu.querySelectorAll("button[data-id]").forEach(b => b.onclick = () => {
    fecharMenuResponsavel();
    const novo = b.dataset.id ? Number(b.dataset.id) : null;
    if (novo !== (t.responsavel ?? null)) salvarCampo(t, { responsavel: novo });
  });
}

document.addEventListener("mousedown", e => {
  if (!e.target.closest("#resp-menu, .card-acao")) fecharMenuResponsavel();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") fecharMenuResponsavel(); });

function buildDiariaCard(t) {
  const feita = isDiariaFeitaHoje(t);
  const el = document.createElement("div");
  el.className = `task-card task-card-diaria ${feita ? "diaria-feita" : ""}${t.responsavel === state.current?.id ? " card-meu" : ""}`;
  el.draggable = true;
  el.addEventListener("dragstart", e => {
    e.dataTransfer.setData("text/plain", String(t.id));
    e.dataTransfer.effectAllowed = "move";
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));

  const resp     = t.responsavel ? state.users.find(u => u.id === t.responsavel) : null;
  const urgClass = { alta: "urg-alta", media: "urg-media", baixa: "urg-baixa" }[t.urgencia] || "urg-media";

  el.innerHTML = `
    <div class="diaria-top">
      <button class="diaria-checkbox ${feita ? "checked" : ""}" data-id="${t.id}" title="${feita ? "Desmarcar" : "Marcar como feita hoje"}">
        ${feita ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ""}
      </button>
      <div class="card-title diaria-title">${escapeHTML(t.nome)}</div>
${acoesRapidasHTML(t)}
      <button class="card-delete-btn" title="Excluir tarefa diária">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </div>
    <div class="card-meta" style="padding-left:30px">
      <div class="urgency-dot ${urgClass}"></div>
      ${feita
        ? `<span class="badge badge-concluida">Feita hoje</span>`
        : `<span class="badge badge-pendente">Pendente</span>`}
      ${resp
        ? `<div class="card-resp">${avatarHTML(resp, "sm")}<span>${nomeOuVoce(resp)}</span></div>`
        : `<span style="color:var(--muted2)">Sem resp.</span>`}
    </div>
    ${feita ? `<div class="diaria-reset-hint">↻ Será resetada amanhã</div>` : ""}`;

  el.querySelector(".diaria-checkbox").addEventListener("click", async e => {
    e.stopPropagation();
    const novaData = feita ? null : todayStr();
    try {
      const atualizada = await api.patchTarefa(t.id, { diariaFeitaEm: novaData });
      Object.assign(t, atualizada);
      renderBoard();
    } catch (err) {
      toast(err.message, true);
    }
  });

  ligarAcoesRapidas(el, t);
  el.querySelector(".card-delete-btn").addEventListener("click", e => {
    e.stopPropagation();
    excluirTarefa(t);
  });

  el.addEventListener("click", () => openDetail(t.id));
  return el;
}

function buildCard(t) {
  const el = document.createElement("div");
  el.className = "task-card" + (situacaoPrazo(t) === "atrasada" ? " card-atrasada" : "")
    + (t.responsavel === state.current?.id ? " card-meu" : "");
  el.draggable = true;
  el.addEventListener("dragstart", e => {
    e.dataTransfer.setData("text/plain", String(t.id));
    e.dataTransfer.effectAllowed = "move";
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));

  const etapasDone  = t.etapas.filter(e => e.concluida).length;
  const etapasTotal = t.etapas.length;
  const pct         = etapasTotal ? Math.round((etapasDone / etapasTotal) * 100) : 0;

  const resp        = t.responsavel ? state.users.find(u => u.id === t.responsavel) : null;
  const urgClass    = { alta: "urg-alta", media: "urg-media", baixa: "urg-baixa" }[t.urgencia] || "urg-media";
  const statusClass = { pendente: "badge-pendente", "em andamento": "badge-andamento", concluida: "badge-concluida" }[t.status] || "badge-pendente";
  const statusLabel = { pendente: "Pendente", "em andamento": "Em andamento", concluida: "Concluída" }[t.status] || t.status;

  const concluidor = t.concluida
    ? state.users.find(u => u.id === (t.concluidoPor || t.responsavel))
    : null;

  el.innerHTML = `
    <div class="card-title-row">
      <div class="card-title">${escapeHTML(t.nome)}</div>
      ${acoesRapidasHTML(t)}
      <button class="card-delete-btn" title="Excluir tarefa">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </div>
    <div class="card-meta">
      <div class="urgency-dot ${urgClass}"></div>
      ${statusPelaColuna(t.equipeId) ? "" : `<span class="badge ${statusClass}">${statusLabel}</span>`}
      ${t.dataPrazo ? `<span class="card-prazo ${situacaoPrazo(t) || ""}">${
        { atrasada: "Atrasada · ", hoje: "Vence hoje · " }[situacaoPrazo(t)] || ""}${formatDate(t.dataPrazo)}</span>` : ""}
      ${t.cliente || t.competencia ? `<span class="card-cliente">${[escapeHTML(t.cliente || ""), formatCompetencia(t.competencia)]
        .filter(Boolean).join(" · ")}</span>` : ""}
    </div>
    ${t.etiquetas?.length ? `<div class="card-etiquetas">${etiquetasHTML(t)}</div>` : ""}
    ${etapasTotal > 0 ? `
      <div class="card-progress">
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="progress-text">${etapasDone}/${etapasTotal}</span>
      </div>` : ""}
    <div class="card-footer">
      <span class="card-date">${t.comentarios ? `<span class="card-comentarios" title="Comentários">${ICONE_COMENTARIO}${t.comentarios}</span>` : ""}${resp ? "" : "Sem resp."}</span>
      ${resp ? `<div class="card-resp">${avatarHTML(resp, "sm")}<span>${nomeOuVoce(resp)}</span></div>` : ""}
    </div>
    ${t.concluida && t.concluidoEm ? `
      <div class="card-concluido-info">Concluída em ${formatDate(t.concluidoEm)}${concluidor ? ` por ${escapeHTML(concluidor.nome)}` : ""}</div>
    ` : ""}`;

  ligarAcoesRapidas(el, t);
  el.querySelector(".card-delete-btn").addEventListener("click", e => {
    e.stopPropagation();
    excluirTarefa(t);
  });
  // Clicar numa etiqueta filtra o quadro por ela.
  el.querySelectorAll(".card-etiquetas .etiqueta").forEach(et => et.addEventListener("click", e => {
    e.stopPropagation();
    filtrarPorTexto(et.dataset.etiqueta);
  }));

  el.addEventListener("click", () => openDetail(t.id));
  return el;
}

function filtrarPorTexto(texto) {
  state.busca = texto;
  const input = document.querySelector(".filtro-busca input");
  if (input) input.value = texto;
  renderBoard();
}
