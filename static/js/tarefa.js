/* Quadro — Nova tarefa, detalhe da tarefa, cliente, competência e etiquetas. */

// ── Modal: Nova Tarefa ────────────────────────────────────
let etapasTemp = [];

document.getElementById("btn-new-task").addEventListener("click", openCreateModal);
document.getElementById("btn-cancel-create").addEventListener("click", closeCreateModal);
document.getElementById("modal-create-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-create-overlay")) closeCreateModal();
});

function openCreateModal() {
  const eq = equipeAtual();
  if (!eq) { toast("Escolha uma equipe antes de criar a tarefa.", true); return; }
  // Mantém o que já foi digitado de uma tentativa anterior (não reseta o
  // form nem etapasTemp aqui) — só é limpo depois de criar com sucesso.
  renderEtapasTemp();
  document.querySelector("#modal-create .modal-header-info p").textContent = `Equipe ${eq.nome}`;
  const sel = document.getElementById("input-responsavel");
  const prevResponsavel = sel.value;
  sel.innerHTML = '<option value="">Sem responsável</option>';
  membrosDaEquipe(eq.id).forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = u.nome;
    sel.appendChild(opt);
  });
  sel.value = prevResponsavel;

  const selColuna = document.getElementById("input-coluna");
  const prevColuna = selColuna.value;
  selColuna.innerHTML = "";
  eq.colunas.filter(c => !c.finaliza).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.nome;
    selColuna.appendChild(opt);
  });
  if ([...selColuna.options].some(o => o.value === prevColuna)) selColuna.value = prevColuna;

  document.getElementById("modal-create-overlay").classList.remove("hidden");
  document.getElementById("input-nome").focus();
}

function closeCreateModal() {
  document.getElementById("modal-create-overlay").classList.add("hidden");
}

document.getElementById("btn-add-etapa").addEventListener("click", addEtapaFromInput);
document.getElementById("input-etapa").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); addEtapaFromInput(); }
});

function addEtapaFromInput() {
  const input = document.getElementById("input-etapa");
  const val = input.value.trim();
  if (!val) return;
  etapasTemp.push({ id: Date.now(), texto: val, concluida: false });
  input.value = "";
  renderEtapasTemp();
}

function renderEtapasTemp() {
  const list = document.getElementById("etapas-temp-list");
  list.innerHTML = "";
  etapasTemp.forEach((e, i) => {
    const el = document.createElement("div");
    el.className = "etapa-item";
    el.innerHTML = `
      <span>${escapeHTML(e.texto)}</span>
      <button class="btn-remove-etapa" data-i="${i}" title="Remover">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>`;
    el.querySelector(".btn-remove-etapa").addEventListener("click", () => {
      etapasTemp.splice(i, 1);
      renderEtapasTemp();
    });
    list.appendChild(el);
  });
}

document.getElementById("btn-save-create").addEventListener("click", async () => {
  const nome      = document.getElementById("input-nome").value.trim();
  const desc      = document.getElementById("input-desc").value.trim();
  const colunaId  = parseInt(document.getElementById("input-coluna").value) || null;
  const prazo     = document.getElementById("input-diaria").checked ? "diaria" : "unica";
  const dataPrazo = document.getElementById("input-data-prazo").value || null;
  const urgencia  = document.getElementById("input-urgencia").value;
  const respId    = document.getElementById("input-responsavel").value;

  if (!nome)  { toast("Informe o nome da tarefa.", true); return; }

  const payload = {
    equipeId: state.equipeAtual, colunaId,
    nome, descricao: desc,
    etapas: etapasTemp.map(e => ({ ...e })),
    prazo, dataPrazo, urgencia,
    responsavel: respId ? parseInt(respId) : null,
    status: statusInicial(colunasDaEquipe(state.equipeAtual).find(c => c.id === colunaId)),
    observacoes: "", retorno: "",
    criadoEm: new Date().toISOString(),
    criadoPor: state.current.id,
    concluida: false,
    diariaFeitaEm: null,
  };

  try {
    const nova = await api.criarTarefa(payload);
    state.tarefas.push(nova);
    closeCreateModal();
    document.getElementById("form-create").reset();
    etapasTemp = [];
    renderEtapasTemp();
    renderBoard();
    toast("Tarefa criada com sucesso!");
  } catch (err) {
    toast(err.message, true);
  }
});

// ── Modal: Detalhe ────────────────────────────────────────
const modalDetail = document.getElementById("modal-detail-overlay");

document.getElementById("btn-close-detail").addEventListener("click", closeDetail);
document.getElementById("btn-detail-fechar").addEventListener("click", closeDetail);
modalDetail.addEventListener("click", e => { if (e.target === modalDetail) closeDetail(); });

function openDetail(id) {
  const t = state.tarefas.find(t => t.id === id);
  if (!t) return;

  // Mostra o modal ANTES de mexer nos campos: autoGrowTextarea mede
  // scrollHeight, e um elemento dentro de display:none sempre mede 0 --
  // isso fazia os campos abrirem sempre no tamanho mínimo, ignorando o
  // texto já salvo (que só aparecia no tamanho certo depois de digitar).
  modalDetail.classList.remove("hidden");

  if (detalheTarefaId !== id) {
    document.getElementById("detail-comentario").value = "";
    document.getElementById("detail-atividade").innerHTML = "";
  }
  detalheTarefaId = id;
  carregarAtividade(id);

  document.getElementById("detail-title").textContent    = t.nome;
  const equipeT = state.equipes.find(e => e.id === t.equipeId);
  const colunaT = colunaDaTarefa(t);
  document.getElementById("detail-breadcrumb").textContent =
    [equipeT?.nome, colunaT?.nome].filter(Boolean).join("  ›  ");
  const criador    = state.users.find(u => u.id === t.criadoPor);
  const concluidor = t.concluida ? state.users.find(u => u.id === (t.concluidoPor || t.responsavel)) : null;
  document.getElementById("detail-subtitle").textContent =
    `Criada${criador ? ` por ${criador.nome}` : ""} em ${formatDate(t.criadoEm)}` +
    (t.concluida && t.concluidoEm ? ` · Concluída em ${formatDate(t.concluidoEm)}${concluidor ? ` por ${concluidor.nome}` : ""}` : "");
  document.getElementById("detail-title").onclick = () => startEditTitle(t, id);
  document.getElementById("btn-detail-excluir").onclick = () => {
    closeDetail();
    excluirTarefa(t);
  };

  document.getElementById("btn-edit-title").onclick = () => startEditTitle(t, id);

  const inputDesc = document.getElementById("detail-desc");
  inputDesc.value = t.descricao || "";
  autoGrowTextarea(inputDesc, 120);
  const salvarDescDebounced = debounce(async () => {
    t.descricao = inputDesc.value;
    try { await api.patchTarefa(t.id, { descricao: t.descricao }); }
    catch (err) { toast(err.message, true); }
  }, 600);
  const mostrarLinksDesc = () => {
    const box = document.getElementById("detail-desc-links");
    const links = linksDoTexto(inputDesc.value);
    box.classList.toggle("hidden", links.length === 0);
    box.textContent = "";
    links.forEach(l => { const a = document.createElement("span"); preencherComLinks(a, l); box.appendChild(a); });
  };
  mostrarLinksDesc();
  inputDesc.oninput = () => { autoGrowTextarea(inputDesc, 120); salvarDescDebounced(); mostrarLinksDesc(); };

  const etapasFeitas = t.etapas.filter(e => e.concluida).length;
  document.getElementById("detail-etapas-progresso").textContent =
    t.etapas.length ? `${etapasFeitas} de ${t.etapas.length}` : "";
  const barra = document.getElementById("detail-etapas-barra");
  barra.classList.toggle("hidden", t.etapas.length === 0);
  barra.querySelector(".progress-fill").style.width =
    t.etapas.length ? `${Math.round(etapasFeitas / t.etapas.length * 100)}%` : "0";

  const checklist = document.getElementById("detail-checklist");
  checklist.innerHTML = "";
  if (t.etapas.length === 0) {
    checklist.innerHTML = `<span style="color:var(--muted);font-size:12px;">Sem etapas definidas.</span>`;
  } else {
    t.etapas.forEach(etapa => {
      const item = document.createElement("div");
      item.className = `check-item ${etapa.concluida ? "done" : ""}`;
      item.innerHTML = `
        <div class="check-box">
          ${etapa.concluida ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ""}
        </div>
        <span class="check-label">${escapeHTML(etapa.texto)}</span>
        <div class="check-actions">
          <button class="btn-edit-etapa" title="Editar etapa">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="btn-remove-etapa" title="Excluir etapa">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>`;
      item.addEventListener("click", () =>
        salvarEtapas(t, id, () => api.editarEtapa(t.id, etapa.id, { concluida: !etapa.concluida }))
      );
      item.querySelector(".btn-edit-etapa").addEventListener("click", e => {
        e.stopPropagation();
        startEditEtapa(t, etapa, item, id);
      });
      item.querySelector(".btn-remove-etapa").addEventListener("click", async e => {
        e.stopPropagation();
        const ok = await showConfirm(`Excluir a etapa "${etapa.texto}"?`, {
          title: "Excluir etapa",
          confirmLabel: "Excluir",
        });
        if (!ok) return;
        if (await salvarEtapas(t, id, () => api.excluirEtapa(t.id, etapa.id))) toast("Etapa excluída.");
      });
      checklist.appendChild(item);
    });
  }

  const inputNovaEtapa = document.getElementById("detail-input-etapa");
  inputNovaEtapa.value = "";
  const addEtapaDetail = async () => {
    const val = inputNovaEtapa.value.trim();
    if (!val) return;
    await salvarEtapas(t, id, () => api.criarEtapa(t.id, val));
  };
  document.getElementById("btn-detail-add-etapa").onclick = addEtapaDetail;
  inputNovaEtapa.onkeydown = e => {
    if (e.key === "Enter") { e.preventDefault(); addEtapaDetail(); }
  };

  const selColuna = document.getElementById("detail-coluna-sel");
  selColuna.innerHTML = "";
  colunasDaEquipe(t.equipeId).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.nome;
    selColuna.appendChild(opt);
  });
  selColuna.value = colunaDaTarefa(t)?.id ?? "";
  selColuna.onchange = async () => {
    const coluna = colunasDaEquipe(t.equipeId).find(c => c.id === parseInt(selColuna.value));
    if (!coluna) return;
    await moverTarefa(t, coluna);
    openDetail(id);
  };

  const chkDiaria = document.getElementById("detail-diaria");
  chkDiaria.checked = t.prazo === "diaria";
  chkDiaria.onchange = async () => {
    const prazoAnterior = t.prazo;
    t.prazo = chkDiaria.checked ? "diaria" : "unica";
    try {
      await api.patchTarefa(t.id, { prazo: t.prazo });
      renderBoard();
    } catch (err) {
      t.prazo = prazoAnterior;
      chkDiaria.checked = prazoAnterior === "diaria";
      toast(err.message, true);
    }
  };

  const inputDataPrazo = document.getElementById("detail-data-prazo-sel");
  inputDataPrazo.value = t.dataPrazo || "";
  const marcarPrazo = () => {
    inputDataPrazo.classList.remove("atrasada", "hoje");
    const sit = situacaoPrazo(t);
    if (sit) inputDataPrazo.classList.add(sit);
    inputDataPrazo.title = { atrasada: "Atrasada", hoje: "Vence hoje" }[sit] || "";
  };
  marcarPrazo();
  inputDataPrazo.onchange = async () => {
    const dataAnterior = t.dataPrazo;
    t.dataPrazo = inputDataPrazo.value || null;
    marcarPrazo();
    try {
      await api.patchTarefa(t.id, { dataPrazo: t.dataPrazo });
      renderBoard();
    } catch (err) {
      t.dataPrazo = dataAnterior;
      inputDataPrazo.value = dataAnterior || "";
      toast(err.message, true);
    }
  };

  const selUrgencia = document.getElementById("detail-urgencia-sel");
  selUrgencia.value = t.urgencia;
  selUrgencia.onchange = async () => {
    const urgenciaAnterior = t.urgencia;
    t.urgencia = selUrgencia.value;
    try {
      await api.patchTarefa(t.id, { urgencia: t.urgencia });
      renderBoard();
    } catch (err) {
      t.urgencia = urgenciaAnterior;
      selUrgencia.value = urgenciaAnterior;
      toast(err.message, true);
    }
  };

  const sel = document.getElementById("detail-responsavel");
  sel.innerHTML = '<option value="">Sem responsável</option>';
  membrosDaEquipe(t.equipeId).forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = u.nome;
    if (t.responsavel === u.id) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.onchange = async () => {
    const responsavelAnterior = t.responsavel;
    t.responsavel = sel.value ? parseInt(sel.value) : null;
    try { await api.patchTarefa(t.id, { responsavel: t.responsavel }); renderBoard(); }
    catch (err) {
      t.responsavel = responsavelAnterior;
      sel.value = responsavelAnterior ?? "";
      toast(err.message, true);
    }
  };

  // Concluída é controlada pelo botão Concluir/Reabrir, não pelo Status.
  const selStatus = document.getElementById("detail-status-sel");
  selStatus.closest(".detail-prop").classList.toggle("hidden", statusPelaColuna(t.equipeId));
  selStatus.querySelector('option[value="concluida"]')?.remove();
  if (t.concluida) {
    selStatus.insertAdjacentHTML("beforeend", '<option value="concluida">Concluída</option>');
  }
  selStatus.value = t.concluida ? "concluida" : t.status;
  selStatus.disabled = t.concluida;
  selStatus.onchange = async () => {
    const statusAnterior = t.status;
    t.status = selStatus.value;
    try {
      await api.patchTarefa(t.id, { status: t.status });
      renderBoard();
    } catch (err) {
      t.status = statusAnterior;
      selStatus.value = statusAnterior;
      toast(err.message, true);
    }
  };

  const inputObs = document.getElementById("detail-obs");
  const inputRetorno = document.getElementById("detail-retorno");
  // Observações deu lugar aos comentários; só aparece onde já havia texto.
  document.getElementById("detail-section-obs").classList.toggle("hidden", !(t.observacoes || "").trim());
  inputObs.value     = t.observacoes || "";
  inputRetorno.value = t.retorno || "";
  autoGrowTextarea(inputObs, 160);
  autoGrowTextarea(inputRetorno, 160);

  const salvarObsDebounced = debounce(async () => {
    t.observacoes = inputObs.value;
    try { await api.patchTarefa(t.id, { observacoes: t.observacoes }); }
    catch (err) { toast(err.message, true); }
  }, 600);
  inputObs.oninput = () => { autoGrowTextarea(inputObs, 160); salvarObsDebounced(); };

  const salvarRetornoDebounced = debounce(async () => {
    t.retorno = inputRetorno.value;
    try { await api.patchTarefa(t.id, { retorno: t.retorno }); }
    catch (err) { toast(err.message, true); }
  }, 600);
  inputRetorno.oninput = () => { autoGrowTextarea(inputRetorno, 160); salvarRetornoDebounced(); };

  preencherDetalheExtras(t);

  const btnConcluir = document.getElementById("btn-concluir");
  btnConcluir.textContent = t.concluida ? "Reabrir Tarefa" : "Concluir Tarefa";
  btnConcluir.className   = t.concluida ? "btn btn-ghost"  : "btn btn-primary";

  btnConcluir.onclick = async () => {
    const anterior = { ...t };
    const colunas  = colunasDaEquipe(t.equipeId);
    if (!t.concluida) {
      const final = colunaFinal(t.equipeId);
      if (final) aplicarColuna(t, final);
      else {
        t.concluida    = true;
        t.status       = "concluida";
        t.concluidoEm  = new Date().toISOString();
        t.concluidoPor = state.current?.id ?? null;
      }
    } else {
      const destino = colunaDaTarefa(t)?.finaliza ? colunas.find(c => !c.finaliza) : null;
      if (destino) aplicarColuna(t, destino);
      else { t.concluida = false; t.status = "pendente"; }
    }
    try {
      Object.assign(t, await api.patchTarefa(t.id, camposConclusao(t)));
      closeDetail();
      redesenharTarefas();
      if (t.concluida) avisarConclusao(t, anterior);
      else toast("Tarefa reaberta.");
    } catch (err) {
      Object.assign(t, anterior);
      toast(err.message, true);
    }
  };
}

// ── Cliente, competência e etiquetas ──────────────────────
function formatCompetencia(c) {
  if (!c) return "";
  const [a, m] = c.split("-");
  return `${m}/${a}`;
}

// Sugestões tiradas do que a equipe já usa.
function preencherSugestoes(equipeId) {
  const daEquipe = state.tarefas.filter(t => t.equipeId === equipeId);
  const unicos = lista => [...new Map(lista.map(v => [semAcento(v), v])).values()]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  const opcoes = lista => lista.map(v => `<option value="${escapeHTML(v)}"></option>`).join("");
  document.getElementById("lista-clientes").innerHTML =
    opcoes(unicos(daEquipe.map(t => t.cliente).filter(Boolean)));
  document.getElementById("lista-etiquetas").innerHTML =
    opcoes(unicos(daEquipe.flatMap(t => t.etiquetas || [])));
}

function etiquetasHTML(t, removivel = false) {
  return (t.etiquetas || []).map(e => `
    <span class="etiqueta" data-etiqueta="${escapeHTML(e)}">${escapeHTML(e)}${removivel
      ? `<button type="button" class="etiqueta-remover" title="Remover etiqueta">&times;</button>` : ""}</span>`).join("");
}

function preencherDetalheExtras(t) {
  preencherSugestoes(t.equipeId);

  const inputCliente = document.getElementById("detail-cliente");
  inputCliente.value = t.cliente || "";
  inputCliente.onchange = () => {
    const cliente = inputCliente.value.trim();
    if (cliente !== (t.cliente || "")) salvarCampo(t, { cliente });
  };
  inputCliente.onkeydown = e => { if (e.key === "Enter") inputCliente.blur(); };

  const inputComp = document.getElementById("detail-competencia");
  inputComp.value = t.competencia || "";
  inputComp.onchange = () => salvarCampo(t, { competencia: inputComp.value || null });

  const campo = document.getElementById("detail-etiquetas");
  const inputEtiqueta = document.getElementById("detail-etiqueta-input");
  campo.querySelectorAll(".etiqueta").forEach(el => el.remove());
  inputEtiqueta.insertAdjacentHTML("beforebegin", etiquetasHTML(t, true));
  inputEtiqueta.value = "";
  const salvarEtiquetas = async etiquetas => {
    await salvarCampo(t, { etiquetas });
    preencherDetalheExtras(t);
  };
  campo.querySelectorAll(".etiqueta-remover").forEach(b => {
    b.onclick = () => {
      const nome = b.parentElement.dataset.etiqueta;
      salvarEtiquetas(t.etiquetas.filter(e => e !== nome));
    };
  });
  const adicionar = () => {
    const nova = inputEtiqueta.value.trim().replace(/\s+/g, " ");
    if (!nova) return;
    if ((t.etiquetas || []).some(e => semAcento(e) === semAcento(nova))) { inputEtiqueta.value = ""; return; }
    // Reaproveita a grafia que a equipe já usa ("Fiscal" e não "fiscal").
    const existente = [...document.querySelectorAll("#lista-etiquetas option")]
      .map(o => o.value).find(v => semAcento(v) === semAcento(nova));
    salvarEtiquetas([...(t.etiquetas || []), existente || nova]);
  };
  inputEtiqueta.onkeydown = e => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); adicionar(); }
    if (e.key === "Backspace" && !inputEtiqueta.value && t.etiquetas?.length) {
      salvarEtiquetas(t.etiquetas.slice(0, -1));
    }
  };
  inputEtiqueta.onchange = adicionar;
  campo.onclick = e => { if (e.target === campo) inputEtiqueta.focus(); };
}

function startEditTitle(t, id) {
  // Não usa h2.replaceWith(input): o <h2 id="detail-title"> é um elemento
  // fixo do index.html (não é recriado a cada openDetail, diferente do
  // .check-label das etapas) -- substituí-lo apagaria o id permanentemente
  // e quebraria todo openDetail() seguinte ("Cannot set properties of null").
  // Em vez disso só escondemos o h2 e inserimos o input do lado.
  const h2 = document.getElementById("detail-title");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "detail-title-input";
  input.value = t.nome;
  h2.style.display = "none";
  h2.insertAdjacentElement("afterend", input);
  input.focus();
  input.select();

  let resolved = false;
  const cleanup = () => {
    input.remove();
    h2.style.display = "";
  };
  const save = async () => {
    if (resolved) return;
    resolved = true;
    const val = input.value.trim();
    if (!val || val === t.nome) { cleanup(); openDetail(id); return; }
    const nomeAnterior = t.nome;
    t.nome = val;
    try {
      await api.patchTarefa(t.id, { nome: t.nome });
      cleanup();
      openDetail(id);
      renderBoard();
    } catch (err) {
      t.nome = nomeAnterior;
      toast(err.message, true);
      cleanup();
      openDetail(id);
    }
  };
  input.addEventListener("keydown", e => {
    if (e.key === "Enter")  { e.preventDefault(); save(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); resolved = true; cleanup(); openDetail(id); }
  });
  input.addEventListener("blur", save);
}

// Grava uma alteração de etapa e adota a lista devolvida pelo servidor,
// que já inclui o que outras pessoas tenham mudado nesse meio tempo.
async function salvarEtapas(t, id, chamada) {
  try {
    const atualizada = await chamada();
    t.etapas = atualizada.etapas;
    return true;
  } catch (err) {
    toast(err.message, true);
    // A etapa pode ter sido mudada por outra pessoa: recarrega a tarefa.
    const doServidor = (await api.getTarefas().catch(() => [])).find(x => x.id === t.id);
    if (doServidor) Object.assign(t, doServidor);
    return false;
  } finally {
    openDetail(id);
    renderBoard();
  }
}

function startEditEtapa(t, etapa, item, id) {
  const label = item.querySelector(".check-label");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "etapa-edit-input";
  input.value = etapa.texto;
  label.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener("click", e => e.stopPropagation());

  let resolved = false;
  const save = async () => {
    if (resolved) return;
    resolved = true;
    const val = input.value.trim();
    if (!val || val === etapa.texto) { openDetail(id); return; }
    await salvarEtapas(t, id, () => api.editarEtapa(t.id, etapa.id, { texto: val }));
  };
  input.addEventListener("keydown", e => {
    if (e.key === "Enter")  { e.preventDefault(); save(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); resolved = true; openDetail(id); }
  });
  input.addEventListener("blur", save);
}

function closeDetail() {
  modalDetail.classList.add("hidden");
  if (dashboardVisivel()) renderDashboard();
  if (minhasVisivel()) renderMinhas();
}
