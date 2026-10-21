/* Quadro — Tela de concluídas e seus filtros. */

// ── View: Concluídas ──────────────────────────────────────
document.getElementById("btn-concluded").addEventListener("click", () => {
  esconderQuadro();
  fecharMinhas();
  fecharConfig();
  document.getElementById("dashboard-screen").classList.remove("visible");
  document.getElementById("nav-dashboard").classList.remove("active");
  document.getElementById("main").classList.remove("modo-dashboard");
  document.getElementById("filtro-usuario-bar")?.classList.add("hidden");
  document.getElementById("concluded-screen").classList.add("visible");
  renderConcluded();
});

document.getElementById("btn-back-board").addEventListener("click", () => showBoardView());

function dentroDoPeriodo(t, periodo) {
  if (!t.concluidoEm) return false;
  if (periodo === "hoje") return todayStr(new Date(t.concluidoEm)) === todayStr();
  const dias = periodo === "semana" ? 7 : 30;
  return new Date(t.concluidoEm).getTime() >= Date.now() - dias * 86400000;
}

function renderConcluded() {
  renderFiltrosConcluidas();

  const list = document.getElementById("concluded-list");
  list.innerHTML = "";

  let done = tarefasDaEquipeAtual().filter(t => t.concluida);
  const temFiltro = state.filtroConcluidoUsuario !== null || state.filtroConcluidoPeriodo !== "todos";

  if (state.filtroConcluidoUsuario !== null) {
    done = done.filter(t => (t.concluidoPor || t.responsavel) === state.filtroConcluidoUsuario);
  }
  if (state.filtroConcluidoPeriodo !== "todos") {
    done = done.filter(t => dentroDoPeriodo(t, state.filtroConcluidoPeriodo));
  }

  // Mais recentes primeiro; tarefas concluídas antes desse campo existir
  // (sem concluidoEm) ficam no final, sem quebrar a ordenação das outras.
  done = [...done].sort((a, b) => {
    if (!a.concluidoEm && !b.concluidoEm) return 0;
    if (!a.concluidoEm) return 1;
    if (!b.concluidoEm) return -1;
    return new Date(b.concluidoEm) - new Date(a.concluidoEm);
  });

  document.getElementById("concluded-count").textContent =
    `${done.length} ${done.length === 1 ? "tarefa" : "tarefas"}`;

  if (done.length === 0) {
    list.innerHTML = `<div style="color:var(--muted);font-size:13px;">Nenhuma tarefa concluída${temFiltro ? " com esse filtro" : " ainda"}.</div>`;
  } else {
    done.forEach(t => list.appendChild(buildCard(t)));
  }

  // Concluídas há mais de 6 meses não vêm com o resto; carregam sob pedido.
  if (state.arquivadas === null && state.filtroConcluidoPeriodo === "todos") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-sm concluidas-arquivadas";
    btn.textContent = "Mostrar concluídas há mais de 6 meses";
    btn.onclick = carregarArquivadas;
    list.appendChild(btn);
  }
}

async function carregarArquivadas() {
  try {
    const lista = await api.getArquivadas();
    lista.forEach(t => { t.arquivada = true; });
    state.arquivadas = lista;
    state.tarefas = juntarArquivadas(state.tarefas);
    renderConcluded();
    if (lista.length === 0) toast("Nenhuma tarefa concluída há mais de 6 meses.");
  } catch (err) {
    toast(err.message, true);
  }
}

// Mantém as arquivadas já carregadas quando a lista normal é recarregada
// (sem repetir a que tenha sido reaberta e voltado para a lista normal).
function juntarArquivadas(lista) {
  if (!state.arquivadas) return lista;
  const ids = new Set(lista.map(t => t.id));
  return lista.concat(state.arquivadas.filter(t => !ids.has(t.id)));
}

// ── Filtros da tela de Concluídas ──────────────────────────
function renderFiltrosConcluidas() {
  const existing = document.getElementById("filtro-concluidas-bar");
  if (existing) existing.remove();

  const bar = document.createElement("div");
  bar.id = "filtro-concluidas-bar";
  bar.className = "filtro-bar";

  const addGroup = (labelTxt) => {
    const group = document.createElement("div");
    group.className = "filtro-group";
    const label = document.createElement("span");
    label.className = "filtro-group-label";
    label.textContent = labelTxt;
    group.appendChild(label);
    bar.appendChild(group);
    return group;
  };
  const addBtn = (group, html, ativo, onClick) => {
    const btn = document.createElement("button");
    btn.className = "filtro-btn" + (ativo ? " active" : "");
    btn.innerHTML = html;
    btn.onclick = onClick;
    group.appendChild(btn);
  };

  const groupUser = addGroup("Concluído por");
  addBtn(groupUser, "Todos", state.filtroConcluidoUsuario === null, () => {
    state.filtroConcluidoUsuario = null;
    renderConcluded();
  });
  membrosDaEquipe(state.equipeAtual).forEach(u => {
    addBtn(groupUser, `${escapeHTML(u.avatar || "")} ${escapeHTML(u.nome)}`, state.filtroConcluidoUsuario === u.id, () => {
      state.filtroConcluidoUsuario = u.id;
      renderConcluded();
    });
  });

  const sep = document.createElement("span");
  sep.className = "filtro-sep";
  bar.appendChild(sep);

  const groupPeriodo = addGroup("Período");
  [["todos", "Todos"], ["hoje", "Hoje"], ["semana", "Últimos 7 dias"], ["mes", "Últimos 30 dias"]]
    .forEach(([key, label]) => {
      addBtn(groupPeriodo, label, state.filtroConcluidoPeriodo === key, () => {
        state.filtroConcluidoPeriodo = key;
        renderConcluded();
      });
    });

  const topbar = document.querySelector("#concluded-screen .concluded-topbar");
  topbar.insertAdjacentElement("afterend", bar);
}
