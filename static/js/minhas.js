/* Quadro — Minhas tarefas. */

// ── Minhas tarefas ────────────────────────────────────────
// Tudo o que está comigo (ou que eu pedi a outras pessoas), de todas as
// equipes, agrupado pela situação do prazo.
const minhas = { modo: "atribuidas" };

function minhasVisivel() {
  return document.getElementById("minhas-screen").classList.contains("visible");
}

function fecharMinhas() {
  document.getElementById("minhas-screen").classList.remove("visible");
  document.getElementById("nav-minhas").classList.remove("active");
  document.getElementById("main").classList.remove("modo-minhas");
}

function abrirMinhas() {
  esconderQuadro();
  fecharConfig();
  document.getElementById("filtro-usuario-bar")?.classList.add("hidden");
  document.getElementById("concluded-screen").classList.remove("visible");
  document.getElementById("admin-screen").classList.remove("visible");
  document.getElementById("nav-admin").classList.remove("active");
  document.getElementById("dashboard-screen").classList.remove("visible");
  document.getElementById("nav-dashboard").classList.remove("active");
  document.getElementById("main").classList.remove("modo-dashboard");
  document.getElementById("minhas-screen").classList.add("visible");
  document.getElementById("nav-minhas").classList.add("active");
  document.getElementById("main").classList.add("modo-minhas");
  renderNavEquipes();
  renderMinhas();
}

function minhasTarefas(modo) {
  const eu = state.current.id;
  return state.tarefas.filter(t => !t.concluida && (modo === "atribuidas"
    ? t.responsavel === eu
    : t.criadoPor === eu && t.responsavel !== eu));
}

function renderMinhas() {
  const atribuidas = minhasTarefas("atribuidas");
  const criadas    = minhasTarefas("criadas");
  document.querySelectorAll("#minhas-modo button").forEach(b => {
    b.classList.toggle("active", b.dataset.modo === minhas.modo);
    const n = b.dataset.modo === "atribuidas" ? atribuidas.length : criadas.length;
    b.textContent = `${b.dataset.modo === "atribuidas" ? "Atribuídas a mim" : "Que eu criei"} (${n})`;
  });

  const lista = minhas.modo === "atribuidas" ? atribuidas : criadas;
  const hoje = todayStr();
  const em7 = todayStr(new Date(Date.now() + 7 * 86400000));
  const peso = { alta: 0, media: 1, baixa: 2 };
  const grupos = [
    ["Atrasadas",       t => t.dataPrazo && t.dataPrazo.slice(0, 10) < hoje, "atrasada"],
    ["Hoje",            t => t.dataPrazo && t.dataPrazo.slice(0, 10) === hoje, "hoje"],
    ["Próximos 7 dias", t => t.dataPrazo && t.dataPrazo.slice(0, 10) > hoje && t.dataPrazo.slice(0, 10) <= em7, ""],
    ["Mais adiante",    t => t.dataPrazo && t.dataPrazo.slice(0, 10) > em7, ""],
    ["Sem prazo",       t => !t.dataPrazo, ""],
  ];

  const body = document.getElementById("minhas-body");
  body.innerHTML = "";

  const unicas  = lista.filter(t => t.prazo !== "diaria");
  const diarias = lista.filter(t => t.prazo === "diaria");

  if (lista.length === 0) {
    body.innerHTML = `<div class="minhas-vazio">${minhas.modo === "atribuidas"
      ? "Nenhuma tarefa em aberto com você."
      : "Nenhuma tarefa em aberto que você criou para outra pessoa."}</div>`;
    return;
  }

  if (diarias.length) {
    const feitas = diarias.filter(isDiariaFeitaHoje).length;
    body.appendChild(grupoMinhas(`Diárias de hoje`, `${feitas} de ${diarias.length} feitas`, diarias, "", hoje));
  }
  grupos.forEach(([titulo, filtro, cls]) => {
    const itens = unicas.filter(filtro).sort((a, b) =>
      (a.dataPrazo || "9999").localeCompare(b.dataPrazo || "9999") || (peso[a.urgencia] ?? 1) - (peso[b.urgencia] ?? 1));
    if (itens.length) body.appendChild(grupoMinhas(titulo, plural(itens.length, "tarefa", "tarefas"), itens, cls, hoje));
  });
}

function grupoMinhas(titulo, contagem, itens, cls, hoje) {
  const sec = document.createElement("section");
  sec.className = "minhas-grupo" + (cls ? ` ${cls}` : "");
  sec.innerHTML = `<h3><span></span><span class="minhas-contagem"></span></h3><div class="minhas-lista"></div>`;
  sec.querySelector("h3 span").textContent = titulo;
  sec.querySelector(".minhas-contagem").textContent = contagem;
  const lista = sec.querySelector(".minhas-lista");

  itens.forEach(t => {
    const eq = state.equipes.find(e => e.id === t.equipeId);
    const col = colunaDaTarefa(t);
    const resp = state.users.find(u => u.id === t.responsavel);
    const diaria = t.prazo === "diaria";
    const feita = isDiariaFeitaHoje(t);
    const linha = document.createElement("div");
    linha.className = "minhas-item" + (feita ? " feita" : "");
    linha.innerHTML = `
      ${diaria ? `<button class="diaria-checkbox ${feita ? "checked" : ""}" title="${feita ? "Desmarcar" : "Marcar como feita hoje"}">
        ${feita ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ""}</button>`
        : `<div class="urgency-dot urg-${t.urgencia || "media"}" title="Urgência ${({ alta: "alta", media: "média", baixa: "baixa" })[t.urgencia] || "média"}"></div>`}
      <span class="minhas-nome"></span>
      <span class="minhas-equipe"></span>
      <span class="minhas-coluna"><span class="col-dot"></span><span></span></span>
      ${minhas.modo === "criadas" ? `<span class="minhas-resp">${resp ? avatarHTML(resp, "sm") : ""}<span></span></span>` : ""}
      <span class="minhas-prazo"></span>
      ${t.comentarios ? `<span class="card-comentarios" title="Comentários">${ICONE_COMENTARIO}${t.comentarios}</span>` : ""}`;
    linha.querySelector(".minhas-nome").textContent = t.nome;
    linha.querySelector(".minhas-equipe").textContent = eq ? eq.nome : "";
    linha.querySelector(".minhas-coluna .col-dot").style.background = col?.cor || "var(--border2)";
    linha.querySelector(".minhas-coluna span:last-child").textContent = col?.nome || "";
    if (minhas.modo === "criadas") linha.querySelector(".minhas-resp > span:last-child").textContent = resp ? resp.nome : "Sem responsável";
    const prazo = linha.querySelector(".minhas-prazo");
    if (diaria) prazo.textContent = feita ? "feita hoje" : "pendente";
    else if (!t.dataPrazo) prazo.textContent = "—";
    else {
      const d = t.dataPrazo.slice(0, 10);
      const dias = Math.round((new Date(hoje + "T00:00:00") - new Date(d + "T00:00:00")) / 86400000);
      prazo.textContent = d < hoje ? `${plural(dias, "dia", "dias")} de atraso` : d === hoje ? "vence hoje" : formatDate(d);
      if (d < hoje) prazo.classList.add("atrasada");
    }

    linha.querySelector(".diaria-checkbox")?.addEventListener("click", async e => {
      e.stopPropagation();
      await salvarCampo(t, { diariaFeitaEm: feita ? null : todayStr() });
      renderMinhas();
    });
    linha.addEventListener("click", () => openDetail(t.id));
    lista.appendChild(linha);
  });
  return sec;
}

document.getElementById("nav-minhas").addEventListener("click", abrirMinhas);
document.querySelectorAll("#minhas-modo button").forEach(b => b.addEventListener("click", () => {
  minhas.modo = b.dataset.modo;
  renderMinhas();
}));
