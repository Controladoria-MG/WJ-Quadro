/* Quadro — Visão em calendário. */

// ── Visão em calendário ───────────────────────────────────
// Mês inteiro com as tarefas no dia do prazo (diárias ficam de fora).
// Arrastar uma tarefa para outro dia muda o prazo; o "+" cria no dia.
const cal = { ano: new Date().getFullYear(), mes: new Date().getMonth(), expandidos: new Set() };
const TIPO_TAREFA_CAL = "application/x-tarefa-cal";
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
               "agosto", "setembro", "outubro", "novembro", "dezembro"];

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mudarMesCalendario(delta) {
  if (delta === 0) {
    const h = new Date(todayStr() + "T12:00:00");
    cal.ano = h.getFullYear(); cal.mes = h.getMonth();
  } else {
    const d = new Date(cal.ano, cal.mes + delta, 1);
    cal.ano = d.getFullYear(); cal.mes = d.getMonth();
  }
  cal.expandidos.clear();
  renderCalendario();
}

function renderCalendario() {
  const wrap = document.getElementById("calendario-view");
  wrap.innerHTML = "";
  const eq = equipeAtual();
  if (!eq) return;

  const hoje = todayStr();
  const peso = { alta: 0, media: 1, baixa: 2 };
  const doQuadro = tarefasVisiveis().filter(t => t.prazo !== "diaria");
  const porDia = new Map();
  doQuadro.filter(t => t.dataPrazo).forEach(t => {
    const d = t.dataPrazo.slice(0, 10);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(t);
  });
  porDia.forEach(lista => lista.sort((a, b) =>
    (a.concluida ? 1 : 0) - (b.concluida ? 1 : 0) || (peso[a.urgencia] ?? 1) - (peso[b.urgencia] ?? 1)));
  const semData = doQuadro.filter(t => !t.dataPrazo && !t.concluida).length;

  const topo = document.createElement("div");
  topo.className = "cal-topo";
  topo.innerHTML = `
    <div class="cal-nav">
      <button type="button" class="btn btn-ghost btn-sm" data-delta="-1" title="Mês anterior">‹</button>
      <button type="button" class="btn btn-ghost btn-sm" data-delta="0">Hoje</button>
      <button type="button" class="btn btn-ghost btn-sm" data-delta="1" title="Próximo mês">›</button>
    </div>
    <h3 class="cal-titulo">${MESES[cal.mes][0].toUpperCase() + MESES[cal.mes].slice(1)} de ${cal.ano}</h3>
    <span class="cal-semdata">${semData ? `${plural(semData, "tarefa em aberto", "tarefas em aberto")} sem data` : ""}</span>`;
  topo.querySelectorAll("[data-delta]").forEach(b => b.onclick = () => mudarMesCalendario(Number(b.dataset.delta)));
  wrap.appendChild(topo);

  const grade = document.createElement("div");
  grade.className = "cal-grade";
  ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].forEach(d => {
    const el = document.createElement("div");
    el.className = "cal-dia-semana";
    el.textContent = d;
    grade.appendChild(el);
  });

  const primeiro = new Date(cal.ano, cal.mes, 1);
  const inicio = new Date(cal.ano, cal.mes, 1 - primeiro.getDay());
  const diasNoMes = new Date(cal.ano, cal.mes + 1, 0).getDate();
  const semanas = Math.ceil((primeiro.getDay() + diasNoMes) / 7);
  const LIMITE = 3;

  for (let i = 0; i < semanas * 7; i++) {
    const data = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    const chave = ymd(data);
    const tarefas = porDia.get(chave) || [];
    const expandido = cal.expandidos.has(chave);
    const cel = document.createElement("div");
    cel.className = "cal-dia"
      + (data.getMonth() !== cal.mes ? " fora-do-mes" : "")
      + (chave === hoje ? " hoje" : "")
      + (data.getDay() === 0 || data.getDay() === 6 ? " fim-de-semana" : "");
    cel.innerHTML = `
      <div class="cal-dia-topo">
        <span class="cal-num">${data.getDate()}</span>
        <button type="button" class="cal-add" title="Nova tarefa neste dia">+</button>
      </div>
      <div class="cal-itens"></div>`;
    const itens = cel.querySelector(".cal-itens");
    (expandido ? tarefas : tarefas.slice(0, LIMITE)).forEach(t => itens.appendChild(chipCalendario(t, hoje)));
    if (tarefas.length > LIMITE) {
      const mais = document.createElement("button");
      mais.type = "button";
      mais.className = "cal-mais";
      mais.textContent = expandido ? "mostrar menos" : `+${tarefas.length - LIMITE} mais`;
      mais.onclick = () => { expandido ? cal.expandidos.delete(chave) : cal.expandidos.add(chave); renderCalendario(); };
      itens.appendChild(mais);
    }

    cel.querySelector(".cal-add").onclick = () => {
      openCreateModal();
      document.getElementById("input-data-prazo").value = chave;
    };
    cel.addEventListener("dragover", e => {
      if (!e.dataTransfer.types.includes(TIPO_TAREFA_CAL)) return;
      e.preventDefault();
      cel.classList.add("soltar-aqui");
    });
    cel.addEventListener("dragleave", e => {
      if (!cel.contains(e.relatedTarget)) cel.classList.remove("soltar-aqui");
    });
    cel.addEventListener("drop", e => {
      if (!e.dataTransfer.types.includes(TIPO_TAREFA_CAL)) return;
      e.preventDefault();
      cel.classList.remove("soltar-aqui");
      const t = state.tarefas.find(x => x.id === Number(e.dataTransfer.getData(TIPO_TAREFA_CAL)));
      if (t && t.dataPrazo?.slice(0, 10) !== chave) salvarCampo(t, { dataPrazo: chave });
    });
    grade.appendChild(cel);
  }
  wrap.appendChild(grade);
}

function chipCalendario(t, hoje) {
  const chip = document.createElement("button");
  chip.type = "button";
  const atrasada = !t.concluida && t.dataPrazo.slice(0, 10) < hoje;
  chip.className = "cal-chip" + (t.concluida ? " concluida" : "") + (atrasada ? " atrasada" : "");
  chip.style.setProperty("--cor-chip", colunaDaTarefa(t)?.cor || "var(--border2)");
  const resp = state.users.find(u => u.id === t.responsavel);
  chip.title = `${t.nome}${resp ? ` · ${resp.nome}` : ""}${t.concluida ? " · concluída" : atrasada ? " · atrasada" : ""}`;
  chip.innerHTML = `<span class="cal-chip-nome"></span>${resp ? `<span class="cal-chip-resp">${escapeHTML(resp.avatar || "")}</span>` : ""}`;
  chip.querySelector(".cal-chip-nome").textContent = t.nome;
  chip.draggable = !t.concluida;
  chip.addEventListener("dragstart", e => {
    e.dataTransfer.setData(TIPO_TAREFA_CAL, String(t.id));
    e.dataTransfer.effectAllowed = "move";
  });
  chip.onclick = () => openDetail(t.id);
  return chip;
}
