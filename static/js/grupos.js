/* Quadro — Membros, novo grupo e colunas do quadro. */

// ── Modal: Equipe (membros) ───────────────────────────────
function substituirEquipe(atualizada) {
  const idx = state.equipes.findIndex(e => e.id === atualizada.id);
  if (idx === -1) state.equipes.push(atualizada);
  else state.equipes[idx] = atualizada;
  state.equipes.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function openEquipeModal() {
  if (!equipeAtual()) return;
  renderEquipeModal();
  document.getElementById("modal-equipe-overlay").classList.remove("hidden");
}

function closeEquipeModal() {
  document.getElementById("modal-equipe-overlay").classList.add("hidden");
  if (configVisivel()) renderConfig();
}

function renderEquipeModal() {
  const eq = equipeAtual();
  if (!eq) { closeEquipeModal(); return; }
  const gestor = souGestorDaEquipe(eq);

  document.getElementById("equipe-modal-titulo").textContent = eq.nome;
  document.getElementById("equipe-modal-sub").textContent =
    `${eq.membros.length} ${eq.membros.length === 1 ? "membro" : "membros"}`;
  document.querySelectorAll("#modal-equipe .equipe-gestao").forEach(el => el.classList.toggle("hidden", !gestor));
  document.getElementById("btn-equipe-excluir").classList.toggle("hidden", !gestor);
  document.getElementById("equipe-nome-input").value = eq.nome;

  const list = document.getElementById("equipe-membros-list");
  list.innerHTML = "";
  const papelDe = new Map(eq.membros.map(m => [m.usuarioId, m.papel]));
  membrosDaEquipe(eq.id).forEach(u => {
    const papel = papelDe.get(u.id);
    const row = document.createElement("div");
    row.className = "membro-row";
    row.innerHTML = `
      ${avatarHTML(u, "sm")}
      <div class="membro-nome"><strong></strong><span></span></div>
      ${gestor ? `
        <select class="membro-papel-sel">
          <option value="membro">Membro</option>
          <option value="admin">Admin da equipe</option>
        </select>
        <button class="btn-remove-etapa" title="Remover da equipe">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>`
      : `<span class="membro-papel">${papel === "admin" ? "Admin da equipe" : "Membro"}</span>`}`;
    row.querySelector(".membro-nome strong").textContent = u.nome;
    row.querySelector(".membro-nome span").textContent = u.cargo || "";

    if (gestor) {
      const selPapel = row.querySelector(".membro-papel-sel");
      selPapel.value = papel;
      selPapel.onchange = async () => {
        try {
          substituirEquipe(await api.salvarMembro(eq.id, u.id, selPapel.value));
          renderEquipeModal();
        } catch (err) {
          selPapel.value = papel;
          toast(err.message, true);
        }
      };
      row.querySelector(".btn-remove-etapa").onclick = async () => {
        const ok = await showConfirm(
          `Remover ${u.nome} da equipe ${eq.nome}? As tarefas dessa pessoa nesta equipe ficarão sem responsável.`,
          { title: "Remover membro", confirmLabel: "Remover" }
        );
        if (!ok) return;
        try {
          substituirEquipe(await api.removerMembro(eq.id, u.id));
          state.tarefas.forEach(t => {
            if (t.equipeId === eq.id && t.responsavel === u.id) t.responsavel = null;
          });
          if (u.id === state.current.id && !state.current.isAdmin) {
            // Saiu da própria equipe: deixa de ver o quadro dela.
            state.equipes = state.equipes.filter(e => e.id !== eq.id);
            state.tarefas = state.tarefas.filter(t => t.equipeId !== eq.id);
            closeEquipeModal();
            escolherEquipe(state.equipes[0]?.id ?? null);
            return;
          }
          renderEquipeModal();
          renderFiltroUsuarios();
          renderBoard();
        } catch (err) {
          toast(err.message, true);
        }
      };
    }
    list.appendChild(row);
  });

  const selAdd = document.getElementById("equipe-add-usuario");
  selAdd.innerHTML = '<option value="">Selecione uma pessoa...</option>';
  state.users.filter(u => !papelDe.has(u.id)).forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = u.nome;
    selAdd.appendChild(opt);
  });
}

document.getElementById("btn-equipe-membros").addEventListener("click", openEquipeModal);
document.getElementById("btn-close-equipe").addEventListener("click", closeEquipeModal);
document.getElementById("btn-equipe-fechar").addEventListener("click", closeEquipeModal);
document.getElementById("modal-equipe-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-equipe-overlay")) closeEquipeModal();
});

document.getElementById("btn-equipe-add-membro").addEventListener("click", async () => {
  const eq = equipeAtual();
  const usuarioId = parseInt(document.getElementById("equipe-add-usuario").value);
  if (!eq || !usuarioId) return;
  try {
    substituirEquipe(await api.salvarMembro(eq.id, usuarioId, "membro"));
    renderEquipeModal();
    renderFiltroUsuarios();
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById("btn-equipe-renomear").addEventListener("click", async () => {
  const eq = equipeAtual();
  const nome = document.getElementById("equipe-nome-input").value.trim();
  if (!eq || !nome || nome === eq.nome) return;
  try {
    substituirEquipe(await api.renomearEquipe(eq.id, nome));
    renderEquipeModal();
    renderNavEquipes();
    toast("Equipe renomeada.");
  } catch (err) {
    toast(err.message, true);
  }
});

// Exclui a equipe/grupo; se houver tarefas, a confirmação diz quantas vão junto.
async function excluirEquipe(eq) {
  const nTarefas = state.tarefas.filter(t => t.equipeId === eq.id).length;
  const mensagem = nTarefas
    ? `Excluir ${eq.nome}? Isso também exclui ${plural(nTarefas, "tarefa", "tarefas")}, com comentários e histórico. Essa ação não pode ser desfeita.`
    : `Excluir ${eq.nome}? Essa ação não pode ser desfeita.`;
  const ok = await showConfirm(mensagem, { title: "Excluir grupo", confirmLabel: "Excluir" });
  if (!ok) return false;
  try {
    await api.deletarEquipe(eq.id, nTarefas > 0);
  } catch (err) {
    toast(err.message, true);
    return false;
  }
  state.equipes = state.equipes.filter(e => e.id !== eq.id);
  state.tarefas = state.tarefas.filter(t => t.equipeId !== eq.id);
  if (state.equipeAtual === eq.id) {
    state.equipeAtual = state.equipes[0]?.id ?? null;
    salvarPreferencia("equipeAtual", String(state.equipeAtual ?? ""));
  }
  renderNavEquipes();
  renderFiltroUsuarios();
  renderBoard();
  if (configVisivel()) renderConfig();
  toast(`${eq.nome} excluído.`);
  return true;
}

document.getElementById("btn-equipe-excluir").addEventListener("click", async () => {
  const eq = equipeAtual();
  if (!eq) return;
  document.getElementById("modal-equipe-overlay").classList.add("hidden");
  if (!(await excluirEquipe(eq))) openEquipeModal();
});

// ── Modal: Novo grupo ─────────────────────────────────────
// Qualquer pessoa monta um grupo com quem quiser, de qualquer departamento.
let grupoSelecionados = new Set();

function openGrupoModal() {
  grupoSelecionados = new Set();
  document.getElementById("grupo-nome").value  = "";
  document.getElementById("grupo-busca").value = "";
  renderGrupoPessoas();
  document.getElementById("modal-grupo-overlay").classList.remove("hidden");
  document.getElementById("grupo-nome").focus();
}

function closeGrupoModal() {
  document.getElementById("modal-grupo-overlay").classList.add("hidden");
}

function renderGrupoPessoas() {
  const busca = document.getElementById("grupo-busca").value.trim().toLowerCase();
  const list = document.getElementById("grupo-pessoas");
  list.innerHTML = "";
  state.users
    .filter(u => u.id !== state.current.id)
    .filter(u => !busca || u.nome.toLowerCase().includes(busca) || (u.cargo || "").toLowerCase().includes(busca))
    .forEach(u => {
      const marcado = grupoSelecionados.has(u.id);
      const row = document.createElement("label");
      row.className = "grupo-pessoa" + (marcado ? " selected" : "");
      row.innerHTML = `
        <input type="checkbox" ${marcado ? "checked" : ""} />
        ${avatarHTML(u, "sm")}
        <div class="membro-nome"><strong></strong><span></span></div>`;
      row.querySelector("strong").textContent = u.nome;
      row.querySelector(".membro-nome span").textContent = u.cargo || "";
      row.querySelector("input").addEventListener("change", e => {
        if (e.target.checked) grupoSelecionados.add(u.id);
        else grupoSelecionados.delete(u.id);
        row.classList.toggle("selected", e.target.checked);
        atualizarContadorGrupo();
      });
      list.appendChild(row);
    });
  atualizarContadorGrupo();
}

function atualizarContadorGrupo() {
  const n = grupoSelecionados.size + 1; // + quem está criando
  document.getElementById("grupo-contador").textContent = `· ${n} ${n === 1 ? "pessoa" : "pessoas"}, incluindo você`;
}

document.getElementById("btn-nova-equipe").addEventListener("click", openGrupoModal);
document.getElementById("grupo-busca").addEventListener("input", renderGrupoPessoas);
document.getElementById("btn-close-grupo").addEventListener("click", closeGrupoModal);
document.getElementById("btn-cancel-grupo").addEventListener("click", closeGrupoModal);
document.getElementById("modal-grupo-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-grupo-overlay")) closeGrupoModal();
});

document.getElementById("btn-save-grupo").addEventListener("click", async () => {
  const nome = document.getElementById("grupo-nome").value.trim();
  if (!nome) { toast("Informe o nome do grupo.", true); return; }
  try {
    const novo = await api.criarEquipe(nome, [...grupoSelecionados]);
    substituirEquipe(novo);
    closeGrupoModal();
    if (configVisivel()) { renderNavEquipes(); renderConfig(); }
    else { showBoardView(); escolherEquipe(novo.id); }
    toast(`Grupo ${novo.nome} criado.`);
  } catch (err) {
    toast(err.message, true);
  }
});

// ── Ordem das colunas ─────────────────────────────────────
// Muda a ordem na tela na hora e grava em seguida; se o servidor recusar,
// volta como estava.
async function reordenarColunas(eq, colunaId, novoIndice) {
  const anterior = [...eq.colunas];
  const movida = eq.colunas.find(c => c.id === colunaId);
  if (!movida) return;
  const resto = eq.colunas.filter(c => c.id !== colunaId);
  novoIndice = Math.max(0, Math.min(novoIndice, resto.length));
  resto.splice(novoIndice, 0, movida);
  if (resto.every((c, i) => c.id === anterior[i].id)) return;   // não mudou de lugar
  eq.colunas = resto;
  renderBoard();
  if (!document.getElementById("modal-colunas-overlay").classList.contains("hidden")) renderColunasModal();
  try {
    substituirEquipe(await api.ordenarColunas(eq.id, resto.map(c => c.id)));
  } catch (err) {
    eq.colunas = anterior;
    toast(err.message, true);
  }
  renderBoard();
  if (!document.getElementById("modal-colunas-overlay").classList.contains("hidden")) renderColunasModal();
}

const TIPO_COLUNA = "application/x-coluna";
const arrastandoColuna = e => e.dataTransfer.types.includes(TIPO_COLUNA);

// Antes ou depois do elemento, conforme o lado em que o mouse está.
function ladoDoMouse(e, el, horizontal) {
  const r = el.getBoundingClientRect();
  return horizontal
    ? (e.clientX < r.left + r.width / 2 ? "antes" : "depois")
    : (e.clientY < r.top + r.height / 2 ? "antes" : "depois");
}

function limparMarcasDeSoltar(seletor) {
  document.querySelectorAll(seletor).forEach(el => el.classList.remove("soltar-antes", "soltar-depois"));
}

// ── Colunas editadas direto no quadro ─────────────────────
// Menu "⋯" no título (renomear, cor, conclui, excluir), dois cliques no
// nome para renomear e "+ Nova coluna" no fim do quadro.
const CORES_COLUNA = ["#64748b", "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b", "#22c55e", "#14b8a6"];

async function salvarColuna(eq, coluna, mudancas) {
  const dados = { nome: coluna.nome, cor: coluna.cor, finaliza: coluna.finaliza, ...mudancas };
  try {
    substituirEquipe(await api.atualizarColuna(coluna.id, dados));
  } catch (err) {
    toast(err.message, true);
  }
  renderBoard();
}

function fecharMenuColuna() {
  document.getElementById("coluna-menu")?.remove();
}

function renomearColunaNoQuadro(col_el, eq, coluna) {
  fecharMenuColuna();
  const nome = col_el.querySelector(".column-nome");
  col_el.querySelector(".column-header").draggable = false;   // senão o mouse não seleciona o texto
  const input = document.createElement("input");
  input.type = "text";
  input.className = "coluna-nome-input";
  input.value = coluna.nome;
  nome.replaceWith(input);
  input.focus();
  input.select();
  let feito = false;
  const concluir = salvar => {
    if (feito) return;
    feito = true;
    const novo = input.value.trim();
    if (salvar && novo && novo !== coluna.nome) salvarColuna(eq, coluna, { nome: novo });
    else renderBoard();
  };
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); concluir(true); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); concluir(false); }
  });
  input.addEventListener("blur", () => concluir(true));
  input.addEventListener("mousedown", e => e.stopPropagation());
}

function abrirMenuColuna(botao, col_el, eq, coluna) {
  const jaAberto = document.getElementById("coluna-menu")?.dataset.coluna === String(coluna.id);
  fecharMenuColuna();
  if (jaAberto) return;

  const menu = document.createElement("div");
  menu.id = "coluna-menu";
  menu.className = "coluna-menu";
  menu.dataset.coluna = coluna.id;
  menu.innerHTML = `
    <button type="button" data-acao="renomear">Renomear</button>
    <div class="coluna-menu-secao">Cor</div>
    <div class="coluna-menu-cores">
      ${CORES_COLUNA.map(c => `<button type="button" class="coluna-cor${c.toLowerCase() === (coluna.cor || "").toLowerCase() ? " selected" : ""}" data-cor="${c}" style="background:${c}" title="${c}"></button>`).join("")}
      <label class="coluna-cor coluna-cor-livre" title="Outra cor"><input type="color" value="${escapeHTML(coluna.cor || "#64748b")}" />+</label>
    </div>
    <label class="coluna-menu-check"><input type="checkbox" ${coluna.finaliza ? "checked" : ""} /> Conclui as tarefas</label>
    <div class="coluna-menu-dica">Arrastar um card para esta coluna marca a tarefa como concluída.</div>
    <button type="button" class="perigo" data-acao="excluir">Excluir coluna</button>`;
  document.body.appendChild(menu);

  const r = botao.getBoundingClientRect();
  const largura = menu.offsetWidth;
  menu.style.top  = `${r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - largura, window.innerWidth - largura - 8))}px`;

  menu.addEventListener("mousedown", e => e.stopPropagation());
  menu.querySelector('[data-acao="renomear"]').onclick = () => renomearColunaNoQuadro(col_el, eq, coluna);
  menu.querySelectorAll(".coluna-cor[data-cor]").forEach(b => b.onclick = () => {
    fecharMenuColuna();
    salvarColuna(eq, coluna, { cor: b.dataset.cor });
  });
  menu.querySelector(".coluna-cor-livre input").onchange = e => {
    fecharMenuColuna();
    salvarColuna(eq, coluna, { cor: e.target.value });
  };
  menu.querySelector(".coluna-menu-check input").onchange = e => {
    fecharMenuColuna();
    salvarColuna(eq, coluna, { finaliza: e.target.checked });
  };
  menu.querySelector('[data-acao="excluir"]').onclick = async () => {
    fecharMenuColuna();
    const ok = await showConfirm(`Excluir a coluna "${coluna.nome}"?`, { title: "Excluir coluna", confirmLabel: "Excluir" });
    if (!ok) return;
    try {
      substituirEquipe(await api.deletarColuna(coluna.id));
      renderBoard();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

document.addEventListener("mousedown", e => {
  if (!e.target.closest("#coluna-menu, .coluna-menu-btn")) fecharMenuColuna();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") fecharMenuColuna(); });
window.addEventListener("resize", fecharMenuColuna);

function novaColunaNoQuadro(eq) {
  const el = document.createElement("div");
  el.className = "column-nova";
  el.innerHTML = `<button type="button" title="Nova coluna" aria-label="Nova coluna">+</button>`;
  const botao = el.querySelector("button");
  botao.onclick = () => {
    el.classList.add("criando");
    el.innerHTML = `<input type="text" class="coluna-nome-input" placeholder="Nome da coluna" />`;
    const input = el.querySelector("input");
    input.focus();
    let feito = false;
    const concluir = async salvar => {
      if (feito) return;
      feito = true;
      const nome = input.value.trim();
      if (!salvar || !nome) { renderBoard(); return; }
      try {
        substituirEquipe(await api.criarColuna(eq.id, { nome, cor: CORES_COLUNA[eq.colunas.length % CORES_COLUNA.length], finaliza: false }));
      } catch (err) {
        toast(err.message, true);
      }
      renderBoard();
      // já deixa pronto para criar a próxima
      document.querySelector("#board .column-nova button")?.click();
    };
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); concluir(true); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); concluir(false); }
    });
    input.addEventListener("blur", () => concluir(true));
  };
  return el;
}

// ── Modal: Colunas do quadro ──────────────────────────────
function openColunasModal() {
  if (!equipeAtual()) return;
  renderColunasModal();
  document.getElementById("modal-colunas-overlay").classList.remove("hidden");
}

function closeColunasModal() {
  document.getElementById("modal-colunas-overlay").classList.add("hidden");
  if (configVisivel()) renderConfig();
}

async function salvarLayout(promessa) {
  try {
    substituirEquipe(await promessa);
    renderColunasModal();
    renderBoard();
    return true;
  } catch (err) {
    toast(err.message, true);
    renderColunasModal();
    return false;
  }
}

function renderColunasModal() {
  const eq = equipeAtual();
  if (!eq) { closeColunasModal(); return; }
  document.getElementById("colunas-modal-sub").textContent = eq.nome;

  const list = document.getElementById("colunas-edit-list");
  list.innerHTML = "";
  eq.colunas.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "coluna-edit-row";
    row.innerHTML = `
      <span class="coluna-alca" title="Arraste para mudar a ordem">
        <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor"><circle cx="3" cy="2" r="1.4"/><circle cx="9" cy="2" r="1.4"/><circle cx="3" cy="7" r="1.4"/><circle cx="9" cy="7" r="1.4"/><circle cx="3" cy="12" r="1.4"/><circle cx="9" cy="12" r="1.4"/></svg>
      </span>
      <button type="button" class="btn-ordem" data-dir="-1" title="Mover para cima" ${i === 0 ? "disabled" : ""}>↑</button>
      <button type="button" class="btn-ordem" data-dir="1" title="Mover para baixo" ${i === eq.colunas.length - 1 ? "disabled" : ""}>↓</button>
      <input type="color" />
      <input type="text" />
      <label class="coluna-conclui"><input type="checkbox" /> Conclui</label>
      <button type="button" class="btn-remove-etapa" title="Excluir coluna">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;
    const inputCor   = row.querySelector('input[type="color"]');
    const inputNome  = row.querySelector('input[type="text"]');
    const inputFinal = row.querySelector('.coluna-conclui input');
    inputCor.value     = c.cor;
    inputNome.value    = c.nome;
    inputFinal.checked = c.finaliza;

    const salvar = () => {
      const nome = inputNome.value.trim();
      if (!nome) { inputNome.value = c.nome; return; }
      if (nome === c.nome && inputCor.value === c.cor && inputFinal.checked === c.finaliza) return;
      salvarLayout(api.atualizarColuna(c.id, { nome, cor: inputCor.value, finaliza: inputFinal.checked }));
    };
    inputNome.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); inputNome.blur(); } });
    inputNome.addEventListener("blur", salvar);
    inputCor.addEventListener("change", salvar);
    inputFinal.addEventListener("change", salvar);

    row.querySelectorAll(".btn-ordem").forEach(btn => btn.addEventListener("click", () =>
      reordenarColunas(eq, c.id, i + Number(btn.dataset.dir))
    ));

    // Arrastar pela alça (só a alça liga o arrastar, para não atrapalhar
    // a seleção de texto no campo do nome).
    const alca = row.querySelector(".coluna-alca");
    alca.addEventListener("mousedown", () => { row.draggable = true; });
    row.addEventListener("dragstart", e => {
      e.dataTransfer.setData(TIPO_COLUNA, String(c.id));
      e.dataTransfer.effectAllowed = "move";
      requestAnimationFrame(() => row.classList.add("coluna-arrastando"));
    });
    row.addEventListener("dragend", () => {
      row.draggable = false;
      row.classList.remove("coluna-arrastando");
      limparMarcasDeSoltar(".coluna-edit-row");
    });
    row.addEventListener("dragover", e => {
      if (!arrastandoColuna(e)) return;
      e.preventDefault();
      limparMarcasDeSoltar(".coluna-edit-row");
      row.classList.add(`soltar-${ladoDoMouse(e, row, false)}`);
    });
    row.addEventListener("drop", e => {
      if (!arrastandoColuna(e)) return;
      e.preventDefault();
      const movidaId = Number(e.dataTransfer.getData(TIPO_COLUNA));
      const lado = ladoDoMouse(e, row, false);
      limparMarcasDeSoltar(".coluna-edit-row");
      const semMovida = eq.colunas.filter(x => x.id !== movidaId);
      const alvo = semMovida.findIndex(x => x.id === c.id);
      if (alvo === -1) return;
      reordenarColunas(eq, movidaId, lado === "antes" ? alvo : alvo + 1);
    });

    row.querySelector(".btn-remove-etapa").addEventListener("click", async () => {
      const ok = await showConfirm(`Excluir a coluna "${c.nome}"?`, { title: "Excluir coluna", confirmLabel: "Excluir" });
      if (ok) salvarLayout(api.deletarColuna(c.id));
    });

    list.appendChild(row);
  });
}

async function adicionarColuna() {
  const eq = equipeAtual();
  const input = document.getElementById("nova-coluna-nome");
  const nome = input.value.trim();
  if (!eq || !nome) return;
  const cores = ["#64748b", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#22c55e", "#ec4899"];
  if (await salvarLayout(api.criarColuna(eq.id, { nome, cor: cores[eq.colunas.length % cores.length], finaliza: false }))) {
    input.value = "";
    input.focus();
  }
}

document.getElementById("btn-colunas").addEventListener("click", openColunasModal);
document.getElementById("btn-add-coluna").addEventListener("click", adicionarColuna);
document.getElementById("nova-coluna-nome").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); adicionarColuna(); }
});
document.getElementById("btn-close-colunas").addEventListener("click", closeColunasModal);
document.getElementById("btn-fechar-colunas").addEventListener("click", closeColunasModal);
document.getElementById("modal-colunas-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-colunas-overlay")) closeColunasModal();
});
