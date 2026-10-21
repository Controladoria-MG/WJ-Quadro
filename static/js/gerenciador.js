/* Quadro — Navegação e Gerenciador de Base. */

// ── View: navegação entre Board / Gerenciador de Base ─────
function showBoardView() {
  fecharMinhas();
  fecharConfig();
  document.getElementById("admin-screen").classList.remove("visible");
  document.getElementById("dashboard-screen").classList.remove("visible");
  document.getElementById("nav-dashboard").classList.remove("active");
  document.getElementById("main").classList.remove("modo-dashboard");
  document.getElementById("concluded-screen").classList.remove("visible");
  mostrarQuadro();
  document.getElementById("filtro-usuario-bar")?.classList.remove("hidden");
  document.getElementById("nav-admin").classList.remove("active");
  if (state.current) renderNavEquipes();
}

document.getElementById("nav-admin").addEventListener("click", () => {
  esconderQuadro();
  fecharMinhas();
  fecharConfig();
  document.getElementById("dashboard-screen").classList.remove("visible");
  document.getElementById("nav-dashboard").classList.remove("active");
  document.getElementById("main").classList.remove("modo-dashboard");
  document.getElementById("filtro-usuario-bar")?.classList.add("hidden");
  document.getElementById("concluded-screen").classList.remove("visible");
  document.getElementById("admin-screen").classList.add("visible");
  document.getElementById("nav-admin").classList.add("active");
  renderNavEquipes();
  renderAdminTarefas();
  renderAdminUsuarios();
});

document.getElementById("btn-back-board-admin").addEventListener("click", showBoardView);

document.getElementById("admin-tab-tarefas").addEventListener("click", () => switchAdminTab("tarefas"));
document.getElementById("admin-tab-usuarios").addEventListener("click", () => switchAdminTab("usuarios"));

function switchAdminTab(tab) {
  document.getElementById("admin-tab-tarefas").classList.toggle("active", tab === "tarefas");
  document.getElementById("admin-tab-usuarios").classList.toggle("active", tab === "usuarios");
  document.getElementById("admin-tarefas-wrap").classList.toggle("hidden", tab !== "tarefas");
  document.getElementById("admin-usuarios-wrap").classList.toggle("hidden", tab !== "usuarios");
}

// ── Gerenciador de Base: tabelas ──────────────────────────
function renderAdminTarefas() {
  const tbody = document.getElementById("admin-tarefas-tbody");
  tbody.innerHTML = "";
  state.tarefas.forEach(t => {
    const resp = t.responsavel ? state.users.find(u => u.id === t.responsavel) : null;
    const eq = state.equipes.find(e => e.id === t.equipeId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.id}</td>
      <td>${eq ? eq.nome : "—"}</td>
      <td class="admin-nome-cell">${escapeHTML(t.nome)}</td>
      <td>${t.prazo}</td>
      <td>${labelStatus(t.status)}</td>
      <td>${labelUrgencia(t.urgencia)}</td>
      <td>${resp ? resp.nome : "—"}</td>
      <td>${t.concluida ? "Sim" : "Não"}</td>
      <td>
        <div class="admin-row-actions">
          <button class="btn-admin-action" data-action="edit">Editar</button>
          <button class="btn-admin-action danger" data-action="delete">Excluir</button>
        </div>
      </td>`;
    tr.querySelector('[data-action="edit"]').addEventListener("click", () => openAdminTarefaModal(t.id));
    tr.querySelector('[data-action="delete"]').addEventListener("click", () => deleteAdminTarefa(t.id));
    tbody.appendChild(tr);
  });
}

function renderAdminUsuarios() {
  const tbody = document.getElementById("admin-usuarios-tbody");
  tbody.innerHTML = "";
  state.users.forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.id}</td>
      <td class="admin-nome-cell">${escapeHTML(u.nome)}</td>
      <td>${escapeHTML(u.cargo || "—")}</td>
      <td>${escapeHTML(u.avatar || "—")}</td>
      <td>${u.isAdmin ? "Sim" : "Não"}</td>
      <td>
        <div class="admin-row-actions">
          <button class="btn-admin-action" data-action="edit">Editar</button>
          <button class="btn-admin-action danger" data-action="delete">Excluir</button>
        </div>
      </td>`;
    tr.querySelector('[data-action="edit"]').addEventListener("click", () => openAdminUsuarioModal(u.id));
    tr.querySelector('[data-action="delete"]').addEventListener("click", () => deleteAdminUsuario(u.id));
    tbody.appendChild(tr);
  });
}

async function deleteAdminTarefa(id) {
  const t = state.tarefas.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`Excluir a tarefa "${t.nome}" permanentemente? Essa ação não pode ser desfeita.`)) return;
  try {
    await api.deletarTarefa(id);
    state.tarefas = state.tarefas.filter(x => x.id !== id);
    renderAdminTarefas();
    renderBoard();
    toast("Tarefa excluída.");
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteAdminUsuario(id) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  if (!confirm(`Excluir o usuário "${u.nome}" permanentemente?`)) return;
  try {
    await api.deletarUsuario(id);
    state.users = state.users.filter(x => x.id !== id);
    renderAdminUsuarios();
    renderFiltroUsuarios();
    renderBoard();
    toast("Usuário excluído.");
  } catch (err) {
    toast(err.message, true);
  }
}

// ── Gerenciador de Base: editar tarefa ────────────────────
let adminEditingTarefaId = null;

function openAdminTarefaModal(id) {
  const t = state.tarefas.find(x => x.id === id);
  if (!t) return;
  adminEditingTarefaId = id;

  document.getElementById("admin-tarefa-id-label").textContent = `ID ${t.id}`;
  document.getElementById("admin-t-nome").value        = t.nome;
  document.getElementById("admin-t-descricao").value    = t.descricao || "";
  document.getElementById("admin-t-prazo").value        = t.prazo;
  document.getElementById("admin-t-data-prazo").value   = t.dataPrazo || "";
  document.getElementById("admin-t-urgencia").value     = t.urgencia;
  // Status "Concluída" e o campo concluida são uma coisa só no Gerenciador.
  document.getElementById("admin-t-status").value       = t.concluida ? "concluida" : (t.status === "concluida" ? "pendente" : t.status);
  document.getElementById("admin-t-observacoes").value  = t.observacoes || "";
  document.getElementById("admin-t-retorno").value      = t.retorno || "";
  document.getElementById("admin-t-etapas").value       = JSON.stringify(t.etapas || [], null, 2);

  const selEquipe = document.getElementById("admin-t-equipe");
  selEquipe.innerHTML = "";
  state.equipes.forEach(eq => {
    const opt = document.createElement("option");
    opt.value = eq.id;
    opt.textContent = eq.nome;
    selEquipe.appendChild(opt);
  });
  selEquipe.value = t.equipeId ?? "";

  const preencherResponsaveis = (responsavelAtual) => {
    const sel = document.getElementById("admin-t-responsavel");
    sel.innerHTML = '<option value="">Sem responsável</option>';
    membrosDaEquipe(parseInt(selEquipe.value)).forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = u.nome;
      if (responsavelAtual === u.id) opt.selected = true;
      sel.appendChild(opt);
    });
  };
  preencherResponsaveis(t.responsavel);
  selEquipe.onchange = () => {
    const atual = parseInt(document.getElementById("admin-t-responsavel").value) || null;
    preencherResponsaveis(atual);
  };

  document.getElementById("modal-admin-tarefa-overlay").classList.remove("hidden");
}

function closeAdminTarefaModal() {
  document.getElementById("modal-admin-tarefa-overlay").classList.add("hidden");
  adminEditingTarefaId = null;
}

document.getElementById("btn-close-admin-tarefa").addEventListener("click", closeAdminTarefaModal);
document.getElementById("btn-cancel-admin-tarefa").addEventListener("click", closeAdminTarefaModal);
document.getElementById("modal-admin-tarefa-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-admin-tarefa-overlay")) closeAdminTarefaModal();
});

document.getElementById("btn-save-admin-tarefa").addEventListener("click", async () => {
  const t = state.tarefas.find(x => x.id === adminEditingTarefaId);
  if (!t) return;

  let etapas;
  try {
    etapas = JSON.parse(document.getElementById("admin-t-etapas").value || "[]");
  } catch (e) {
    toast("Etapas: JSON inválido.", true);
    return;
  }

  const respVal = document.getElementById("admin-t-responsavel").value;
  const payload = {
    equipeId:    parseInt(document.getElementById("admin-t-equipe").value) || t.equipeId,
    nome:        document.getElementById("admin-t-nome").value.trim(),
    descricao:   document.getElementById("admin-t-descricao").value,
    etapas,
    prazo:       document.getElementById("admin-t-prazo").value,
    dataPrazo:   document.getElementById("admin-t-data-prazo").value || null,
    urgencia:    document.getElementById("admin-t-urgencia").value,
    responsavel: respVal ? parseInt(respVal) : null,
    status:      document.getElementById("admin-t-status").value,
    observacoes: document.getElementById("admin-t-observacoes").value,
    retorno:     document.getElementById("admin-t-retorno").value,
    criadoEm:    t.criadoEm,
    criadoPor:   t.criadoPor,
    concluida:   document.getElementById("admin-t-status").value === "concluida",
    diariaFeitaEm: t.diariaFeitaEm,
    colunaId:    t.colunaId,
    concluidoEm: t.concluidoEm,
    concluidoPor: t.concluidoPor,
  };

  if (!payload.nome) { toast("Informe o nome da tarefa.", true); return; }

  try {
    const atualizada = await api.atualizarTarefa(t.id, payload);
    Object.assign(t, atualizada);
    closeAdminTarefaModal();
    renderAdminTarefas();
    renderBoard();
    toast("Tarefa atualizada.");
  } catch (err) {
    toast(err.message, true);
  }
});

// ── Gerenciador de Base: editar usuário ───────────────────
let adminEditingUsuarioId = null;
let adminEditingUsuarioFoto = null; // data URL atual (ou null) enquanto o modal está aberto

function openAdminUsuarioModal(id) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  adminEditingUsuarioId = id;
  adminEditingUsuarioFoto = u.fotoPerfil || null;

  document.getElementById("admin-usuario-id-label").textContent = `ID ${u.id}`;
  document.getElementById("admin-u-nome").value     = u.nome;
  document.getElementById("admin-u-cargo").value    = u.cargo || "";
  document.getElementById("admin-u-avatar").value   = u.avatar || "";
  document.getElementById("admin-u-isadmin").checked = !!u.isAdmin;
  setAvatarEl(document.getElementById("admin-u-foto-preview"), u);
  document.getElementById("admin-u-foto-input").value = "";

  document.getElementById("modal-admin-usuario-overlay").classList.remove("hidden");
}

function closeAdminUsuarioModal() {
  document.getElementById("modal-admin-usuario-overlay").classList.add("hidden");
  adminEditingUsuarioId = null;
  adminEditingUsuarioFoto = null;
}

document.getElementById("btn-close-admin-usuario").addEventListener("click", closeAdminUsuarioModal);
document.getElementById("btn-cancel-admin-usuario").addEventListener("click", closeAdminUsuarioModal);
document.getElementById("modal-admin-usuario-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-admin-usuario-overlay")) closeAdminUsuarioModal();
});

document.getElementById("btn-admin-u-foto-escolher").addEventListener("click", () => {
  document.getElementById("admin-u-foto-input").click();
});

document.getElementById("admin-u-foto-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    adminEditingUsuarioFoto = await resizeImageToBase64(file);
    setAvatarEl(document.getElementById("admin-u-foto-preview"), {
      fotoPerfil: adminEditingUsuarioFoto,
      avatar: document.getElementById("admin-u-avatar").value.trim(),
    });
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById("btn-admin-u-foto-remover").addEventListener("click", () => {
  adminEditingUsuarioFoto = null;
  document.getElementById("admin-u-foto-input").value = "";
  setAvatarEl(document.getElementById("admin-u-foto-preview"), {
    fotoPerfil: null,
    avatar: document.getElementById("admin-u-avatar").value.trim(),
  });
});

document.getElementById("btn-save-admin-usuario").addEventListener("click", async () => {
  const u = state.users.find(x => x.id === adminEditingUsuarioId);
  if (!u) return;

  const nome = document.getElementById("admin-u-nome").value.trim();
  if (!nome) { toast("Informe o nome do usuário.", true); return; }

  const payload = {
    nome,
    cargo:      document.getElementById("admin-u-cargo").value.trim() || "Colaborador",
    avatar:     document.getElementById("admin-u-avatar").value.trim() || null,
    isAdmin:    document.getElementById("admin-u-isadmin").checked,
    fotoPerfil: adminEditingUsuarioFoto,
  };

  try {
    const atualizado = await api.atualizarUsuario(u.id, payload);
    Object.assign(u, atualizado);
    closeAdminUsuarioModal();
    renderAdminUsuarios();
    renderFiltroUsuarios();
    renderBoard();
    if (state.current && state.current.id === u.id) {
      state.current = u;
      document.getElementById("sb-user-name").textContent   = u.nome;
      document.getElementById("sb-user-cargo").textContent  = u.cargo;
      setAvatarEl(document.getElementById("sb-user-avatar"), u);
      if (configVisivel()) renderConfig();
    }
    toast("Usuário atualizado.");
  } catch (err) {
    toast(err.message, true);
  }
});
