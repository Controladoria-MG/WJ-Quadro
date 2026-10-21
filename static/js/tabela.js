/* Quadro — Prazo, ordenação, quadro x tabela e visão em tabela. */

// ── Prazo e ordenação ─────────────────────────────────────
// "atrasada" (prazo já passou) ou "hoje" (vence hoje); diárias e concluídas
// não entram nessa conta.
function situacaoPrazo(t) {
  if (!t.dataPrazo || t.concluida || t.prazo === "diaria") return null;
  const prazo = t.dataPrazo.slice(0, 10), hoje = todayStr();
  if (prazo < hoje) return "atrasada";
  if (prazo === hoje) return "hoje";
  return null;
}

function ordenarTarefas(lista) {
  const peso = { alta: 0, media: 1, baixa: 2 };
  const arr = [...lista];
  if (state.ordenacao === "prazo") {
    arr.sort((a, b) => (a.dataPrazo || "9999").localeCompare(b.dataPrazo || "9999"));
  } else if (state.ordenacao === "urgencia") {
    arr.sort((a, b) => (peso[a.urgencia] ?? 1) - (peso[b.urgencia] ?? 1)
      || (a.dataPrazo || "9999").localeCompare(b.dataPrazo || "9999"));
  }
  // Diárias já feitas hoje sempre no fim (sort estável mantém o resto).
  arr.sort((a, b) => (isDiariaFeitaHoje(a) ? 1 : 0) - (isDiariaFeitaHoje(b) ? 1 : 0));
  return arr;
}

// Tarefas da equipe atual com o filtro de responsável aplicado.
function semAcento(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function tarefasVisiveis() {
  let lista = tarefasDaEquipeAtual();
  if (state.filtroUsuario !== null) lista = lista.filter(t => t.responsavel === state.filtroUsuario);
  const termo = semAcento(state.busca).trim();
  if (termo) lista = lista.filter(t =>
    [t.nome, t.descricao, t.cliente, formatCompetencia(t.competencia), ...(t.etiquetas || [])]
      .some(v => semAcento(v).includes(termo)));
  return lista;
}

function tarefasDaColuna(lista, col) {
  return lista.filter(t => colunaDaTarefa(t)?.id === col.id && (col.finaliza || !t.concluida) && !t.arquivada);
}

function salvarPreferencia(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch (e) {}
}

function lerPreferencia(chave, padrao) {
  try { return localStorage.getItem(chave) || padrao; } catch (e) { return padrao; }
}

// ── Quadro x Tabela ───────────────────────────────────────
const AREAS_DA_VISAO = { quadro: "board", tabela: "tabela-view", calendario: "calendario-view" };

function areaPrincipal() {
  return document.getElementById(AREAS_DA_VISAO[state.visao] || "board");
}

function quadroVisivel() {
  return Object.values(AREAS_DA_VISAO).some(id => !document.getElementById(id).classList.contains("hidden"));
}

function mostrarQuadro() {
  if (!AREAS_DA_VISAO[state.visao]) state.visao = "quadro";
  Object.entries(AREAS_DA_VISAO).forEach(([visao, id]) =>
    document.getElementById(id).classList.toggle("hidden", visao !== state.visao));
}

function esconderQuadro() {
  Object.values(AREAS_DA_VISAO).forEach(id => document.getElementById(id).classList.add("hidden"));
}

function trocarVisao(visao) {
  state.visao = visao;
  salvarPreferencia("visao", visao);
  mostrarQuadro();
  renderFiltroUsuarios();
  renderBoard();
}

// Controles à direita da barra de filtros (visão e ordenação).
function controlesDaBarra() {
  const wrap = document.createElement("div");
  wrap.className = "filtro-direita";
  wrap.innerHTML = `
    <select class="ordenacao-sel" title="Ordenar">
      <option value="criacao">Ordem de criação</option>
      <option value="prazo">Por prazo</option>
      <option value="urgencia">Por urgência</option>
    </select>
    <div class="visao-toggle">
      <button type="button" data-visao="quadro">Quadro</button>
      <button type="button" data-visao="tabela">Tabela</button>
      <button type="button" data-visao="calendario">Calendário</button>
    </div>`;
  const sel = wrap.querySelector("select");
  sel.classList.toggle("hidden", state.visao === "calendario");   // no calendário a ordem é pela data
  sel.value = state.ordenacao;
  sel.onchange = () => {
    state.ordenacao = sel.value;
    salvarPreferencia("ordenacao", sel.value);
    sel.blur();
    renderBoard();
  };
  wrap.querySelectorAll(".visao-toggle button").forEach(b => {
    b.classList.toggle("active", b.dataset.visao === state.visao);
    b.onclick = () => trocarVisao(b.dataset.visao);
  });
  return wrap;
}

// ── Visão em tabela ───────────────────────────────────────
// Uma tabela por coluna do quadro (como os grupos do Monday), com os campos
// editáveis direto na linha. Cada alteração grava só o campo mexido.
async function salvarCampo(t, campos) {
  const anterior = { ...t };
  Object.assign(t, campos);
  try {
    Object.assign(t, await api.patchTarefa(t.id, campos));
  } catch (err) {
    Object.assign(t, anterior);
    toast(err.message, true);
  }
  renderBoard();
}

const ICONE_ABRIR = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;
const ICONE_LIXEIRA = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const ICONE_COMENTARIO = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

function opcoesHTML(pares, atual) {
  return pares.map(([v, rotulo]) =>
    `<option value="${escapeHTML(v)}" ${String(v) === String(atual ?? "") ? "selected" : ""}>${escapeHTML(rotulo)}</option>`
  ).join("");
}

function renderTabela() {
  const wrap = document.getElementById("tabela-view");
  wrap.innerHTML = "";
  const eq = equipeAtual();
  if (!eq) return;

  const visiveis = tarefasVisiveis();
  const membros  = membrosDaEquipe(eq.id);
  const comStatus = !statusPelaColuna(eq.id);

  eq.colunas.forEach(col => {
    const tasks = ordenarTarefas(tarefasDaColuna(visiveis, col));
    const grupo = document.createElement("div");
    grupo.className = "tabela-grupo";
    grupo.style.setProperty("--cor-grupo", col.cor);
    grupo.innerHTML = `
      <div class="tabela-grupo-titulo">
        <div class="col-dot"></div><span class="tabela-grupo-nome"></span>
        <span class="col-count">${tasks.length}</span>
      </div>
      <table>
        <colgroup>
          <col style="width:${comStatus ? 30 : 42}%"><col style="width:15%">${comStatus ? `<col style="width:12%">` : ""}
          <col style="width:10%"><col style="width:12%"><col style="width:6%">
          <col style="width:10%"><col style="width:5%">
        </colgroup>
        <thead><tr>
          <th>Tarefa</th><th>Responsável</th>${comStatus ? "<th>Status</th>" : ""}<th>Urgência</th>
          <th>Prazo</th><th>Etapas</th><th>Coluna</th><th></th>
        </tr></thead>
        <tbody></tbody>
      </table>`;
    grupo.querySelector(".col-dot").style.background = col.cor;
    grupo.querySelector(".tabela-grupo-nome").textContent = col.nome;
    const tbody = grupo.querySelector("tbody");

    tasks.forEach(t => {
      const tr = document.createElement("tr");
      const feita = isDiariaFeitaHoje(t);
      const etapasFeitas = t.etapas.filter(e => e.concluida).length;
      const sit = situacaoPrazo(t);
      tr.innerHTML = `
        <td><div class="tabela-nome-cell">
          ${t.prazo === "diaria" ? `<button class="diaria-checkbox ${feita ? "checked" : ""}" title="${feita ? "Desmarcar" : "Marcar como feita hoje"}">
            ${feita ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ""}</button>` : ""}
          <input type="text" class="campo-nome" />
          ${t.comentarios ? `<span class="card-comentarios" title="Comentários">${ICONE_COMENTARIO}${t.comentarios}</span>` : ""}
        </div></td>
        <td><select class="campo-resp">${opcoesHTML([["", "Sem responsável"], ...membros.map(u => [u.id, u.nome])], t.responsavel)}</select></td>
        ${!comStatus ? "" : `<td>${t.concluida
          ? `<span class="tabela-concluida">Concluída</span>`
          : `<select class="campo-status">${opcoesHTML([["pendente", "Pendente"], ["em andamento", "Em andamento"]], t.status)}</select>`}</td>`}
        <td><select class="campo-urg">${opcoesHTML([["alta", "Alta"], ["media", "Média"], ["baixa", "Baixa"]], t.urgencia)}</select></td>
        <td><input type="date" class="campo-prazo ${sit || ""}" value="${t.dataPrazo || ""}" title="${sit === "atrasada" ? "Atrasada" : sit === "hoje" ? "Vence hoje" : ""}" /></td>
        <td class="tabela-etapas">${t.etapas.length ? `${etapasFeitas}/${t.etapas.length}` : "—"}</td>
        <td><select class="campo-coluna">${opcoesHTML(eq.colunas.map(c => [c.id, c.nome]), col.id)}</select></td>
        <td><div class="tabela-acoes">
          <button class="btn-abrir" title="Abrir detalhes">${ICONE_ABRIR}</button>
          <button class="btn-excluir danger" title="Excluir tarefa">${ICONE_LIXEIRA}</button>
        </div></td>`;

      const inputNome = tr.querySelector(".campo-nome");
      inputNome.value = t.nome;
      inputNome.addEventListener("keydown", e => {
        if (e.key === "Enter") inputNome.blur();
        if (e.key === "Escape") { inputNome.value = t.nome; inputNome.blur(); }
      });
      inputNome.addEventListener("blur", () => {
        const nome = inputNome.value.trim();
        if (!nome) { inputNome.value = t.nome; return; }
        if (nome !== t.nome) salvarCampo(t, { nome });
      });

      tr.querySelector(".diaria-checkbox")?.addEventListener("click", () =>
        salvarCampo(t, { diariaFeitaEm: feita ? null : todayStr() })
      );
      tr.querySelector(".campo-resp").onchange = e =>
        salvarCampo(t, { responsavel: e.target.value ? parseInt(e.target.value) : null });
      tr.querySelector(".campo-status")?.addEventListener("change", e => salvarCampo(t, { status: e.target.value }));
      tr.querySelector(".campo-urg").onchange = e => salvarCampo(t, { urgencia: e.target.value });
      tr.querySelector(".campo-prazo").onchange = e => salvarCampo(t, { dataPrazo: e.target.value || null });
      tr.querySelector(".campo-coluna").onchange = e => {
        const destino = eq.colunas.find(c => c.id === parseInt(e.target.value));
        if (destino) moverTarefa(t, destino);
      };
      tr.querySelector(".btn-abrir").onclick = () => openDetail(t.id);
      tr.querySelector(".btn-excluir").onclick = () => excluirTarefa(t);
      tbody.appendChild(tr);
    });

    if (!col.finaliza) {
      const tr = document.createElement("tr");
      tr.className = "tabela-add";
      tr.innerHTML = `<td colspan="8"><input type="text" placeholder="+ Adicionar tarefa" /></td>`;
      const input = tr.querySelector("input");
      input.addEventListener("keydown", async e => {
        if (e.key === "Escape") { input.value = ""; input.blur(); return; }
        if (e.key !== "Enter") return;
        const nome = input.value.trim();
        if (!nome) return;
        input.disabled = true;
        try {
          state.tarefas.push(await api.criarTarefa({
            equipeId: eq.id, colunaId: col.id, nome,
            prazo: "unica", urgencia: "media", status: statusInicial(col),
            etapas: [], criadoEm: new Date().toISOString(),
          }));
          renderBoard();
          const grupos = [...document.querySelectorAll("#tabela-view .tabela-grupo")];
          grupos[eq.colunas.indexOf(col)]?.querySelector(".tabela-add input")?.focus();
        } catch (err) {
          input.disabled = false;
          toast(err.message, true);
        }
      });
      tbody.appendChild(tr);
    }

    wrap.appendChild(grupo);
  });
}
