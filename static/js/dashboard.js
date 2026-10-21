/* Quadro — Dashboard. */

// ── Dashboard ─────────────────────────────────────────────
// Indicadores das equipes do usuário (ou de uma equipe/pessoa só). Diárias
// ficam fora das contagens de "em aberto"/"atrasadas" — têm KPI próprio.
// Clicar num indicador lista as tarefas dele logo abaixo.
const dash = { equipe: "todas", pessoa: "todas", periodo: 30, lista: "atrasadas" };

function dashboardVisivel() {
  return document.getElementById("dashboard-screen").classList.contains("visible");
}

function abrirDashboard() {
  esconderQuadro();
  fecharMinhas();
  fecharConfig();
  document.getElementById("filtro-usuario-bar")?.classList.add("hidden");
  document.getElementById("concluded-screen").classList.remove("visible");
  document.getElementById("admin-screen").classList.remove("visible");
  document.getElementById("nav-admin").classList.remove("active");
  document.getElementById("dashboard-screen").classList.add("visible");
  document.getElementById("nav-dashboard").classList.add("active");
  document.getElementById("main").classList.add("modo-dashboard");
  renderNavEquipes();
  renderDashboard();
}

function diasEntre(a, b) {
  return Math.round((b - a) / 86400000);
}

function plural(n, um, varios) {
  return `${n} ${n === 1 ? um : varios}`;
}

function dataLocal(iso) {
  return iso ? todayStr(new Date(iso.replace(" ", "T"))) : null;
}

// Concluída até o dia do prazo (só faz sentido para quem tinha prazo).
function noPrazo(t) {
  return dataLocal(t.concluidoEm) <= t.dataPrazo.slice(0, 10);
}

function renderFiltrosDashboard() {
  const selEquipe = document.getElementById("dash-equipe");
  if (dash.equipe !== "todas" && !state.equipes.some(e => e.id === dash.equipe)) dash.equipe = "todas";
  selEquipe.innerHTML = opcoesHTML(
    [["todas", "Todas as minhas equipes"], ...state.equipes.map(e => [e.id, e.nome])], dash.equipe
  );

  // Pessoas: membros das equipes do recorte atual.
  const ids = new Set(state.equipes
    .filter(e => dash.equipe === "todas" || e.id === dash.equipe)
    .flatMap(e => e.membros.map(m => m.usuarioId)));
  const pessoas = state.users.filter(u => ids.has(u.id));
  if (dash.pessoa !== "todas" && dash.pessoa !== "sem" && !ids.has(dash.pessoa)) dash.pessoa = "todas";
  const selPessoa = document.getElementById("dash-pessoa");
  selPessoa.innerHTML = opcoesHTML([
    ["todas", "Todas as pessoas"],
    ...(ids.has(state.current.id) ? [[state.current.id, "Só as minhas"]] : []),
    ...pessoas.filter(u => u.id !== state.current.id).map(u => [u.id, u.nome]),
    ["sem", "Sem responsável"],
  ], dash.pessoa);

  document.querySelectorAll("#dash-periodo button").forEach(b =>
    b.classList.toggle("active", Number(b.dataset.dias) === dash.periodo)
  );
}

function renderDashboard() {
  renderFiltrosDashboard();

  const hoje    = todayStr();
  const em7dias = todayStr(new Date(Date.now() + 7 * 86400000));
  const msDia   = 86400000;
  const inicio  = Date.now() - dash.periodo * msDia;
  const inicioAnterior = inicio - dash.periodo * msDia;

  // Recorte por equipe e pessoa. Para concluídas vale quem concluiu.
  const daPessoa = (t, campo) => {
    if (dash.pessoa === "todas") return true;
    const uid = campo === "conclusao" ? (t.concluidoPor || t.responsavel) : t.responsavel;
    return dash.pessoa === "sem" ? !uid : uid === dash.pessoa;
  };
  const daEquipe = state.tarefas.filter(t => dash.equipe === "todas" || t.equipeId === dash.equipe);
  const unicas   = daEquipe.filter(t => t.prazo !== "diaria");
  const diarias  = daEquipe.filter(t => t.prazo === "diaria" && daPessoa(t));
  const abertas  = unicas.filter(t => !t.concluida && daPessoa(t));

  const situacao = t => {
    if (!t.dataPrazo) return "sem";
    const d = t.dataPrazo.slice(0, 10);
    if (d < hoje) return "atrasada";
    if (d === hoje) return "hoje";
    if (d <= em7dias) return "semana";
    return "depois";
  };
  const naJanela = (iso, de, ate) => {
    if (!iso) return false;
    const ms = new Date(iso.replace(" ", "T")).getTime();
    return ms >= de && ms < ate;
  };
  const atrasadas  = abertas.filter(t => situacao(t) === "atrasada");
  const vencendo   = abertas.filter(t => ["hoje", "semana"].includes(situacao(t)));
  const concluidas = unicas.filter(t => t.concluida && daPessoa(t, "conclusao") && naJanela(t.concluidoEm, inicio, Infinity));
  const concluidasAntes = unicas.filter(t => t.concluida && daPessoa(t, "conclusao") && naJanela(t.concluidoEm, inicioAnterior, inicio));
  const criadas    = unicas.filter(t => daPessoa(t) && naJanela(t.criadoEm, inicio, Infinity));
  const comPrazo   = concluidas.filter(t => t.dataPrazo);
  const pctNoPrazo = comPrazo.length ? Math.round(comPrazo.filter(noPrazo).length / comPrazo.length * 100) : null;
  const duracoes   = concluidas
    .map(t => (new Date(t.concluidoEm.replace(" ", "T")) - new Date((t.criadoEm || "").replace(" ", "T"))) / msDia)
    .filter(d => isFinite(d) && d >= 0);
  const tempoMedio = duracoes.length ? duracoes.reduce((a, b) => a + b, 0) / duracoes.length : null;
  const diariasFeitas = diarias.filter(isDiariaFeitaHoje).length;

  const diffConcl = concluidas.length - concluidasAntes.length;
  const comparacao = diffConcl === 0 ? `igual aos ${dash.periodo} dias anteriores`
    : `${Math.abs(diffConcl)} a ${diffConcl > 0 ? "mais" : "menos"} que nos ${dash.periodo} dias anteriores`;

  const body = document.getElementById("dash-body");
  body.innerHTML = "";

  // ── KPIs (clicáveis quando têm uma lista de tarefas por trás)
  const kpis = [
    { id: "abertas",    rotulo: "Em aberto",        valor: abertas.length, sub: abertas.length === 1 ? "tarefa não concluída" : "tarefas não concluídas", lista: abertas },
    { id: "atrasadas",  rotulo: "Atrasadas",        valor: atrasadas.length,
      sub: abertas.length ? `${Math.round(atrasadas.length / abertas.length * 100)}% das em aberto` : "nenhuma em aberto",
      lista: atrasadas, alerta: atrasadas.length > 0 },
    { id: "vencendo",   rotulo: "Vencem em 7 dias", valor: vencendo.length, sub: "incluindo hoje", lista: vencendo },
    { id: "criadas",    rotulo: "Criadas",          valor: criadas.length, sub: `nos últimos ${dash.periodo} dias`, lista: criadas },
    { id: "concluidas", rotulo: "Concluídas",       valor: concluidas.length, sub: comparacao, lista: concluidas },
    { id: "noprazo",    rotulo: "No prazo",         valor: pctNoPrazo === null ? "—" : `${pctNoPrazo}%`,
      sub: comPrazo.length ? `${comPrazo.filter(noPrazo).length} de ${comPrazo.length} concluídas com prazo` : "nenhuma concluída com prazo",
      lista: comPrazo },
    { id: "tempo",      rotulo: "Tempo médio",
      valor: tempoMedio === null ? "—" : tempoMedio < 1 ? "< 1 dia" : `${tempoMedio.toFixed(1).replace(".", ",")} dias`,
      sub: tempoMedio === null ? "sem conclusões no período" : "da criação à conclusão" },
    { id: "diarias",    rotulo: "Diárias hoje",     valor: diarias.length ? `${diariasFeitas}/${diarias.length}` : "—",
      sub: diarias.length ? "feitas" : "nenhuma diária", lista: diarias },
  ];
  if (!kpis.some(k => k.id === dash.lista && k.lista)) dash.lista = "atrasadas";

  const faixa = document.createElement("div");
  faixa.className = "dash-kpis";
  kpis.forEach(k => {
    const el = document.createElement(k.lista ? "button" : "div");
    if (k.lista) el.type = "button";
    el.className = "dash-kpi" + (k.alerta ? " alerta" : "") + (k.lista ? " clicavel" : "") + (k.id === dash.lista ? " selecionado" : "");
    el.innerHTML = `<span class="dash-kpi-rotulo"></span><strong class="dash-kpi-valor"></strong><span class="dash-kpi-sub"></span>`;
    el.querySelector(".dash-kpi-rotulo").textContent = k.rotulo;
    el.querySelector(".dash-kpi-valor").textContent = k.valor;
    el.querySelector(".dash-kpi-sub").textContent = k.sub;
    if (k.lista) {
      el.title = "Ver as tarefas";
      el.onclick = () => {
        dash.lista = k.id;
        renderDashboard();
        document.getElementById("dash-lista-tarefas")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
    }
    faixa.appendChild(el);
  });
  body.appendChild(faixa);

  const grade = document.createElement("div");
  grade.className = "dash-grade";
  body.appendChild(grade);

  // ── Lista do indicador selecionado
  const kSel = kpis.find(k => k.id === dash.lista);
  grade.appendChild(listaDeTarefas(kSel, situacao, hoje));

  // ── Concluídas ao longo do tempo (uma série: cor do tema, sem legenda)
  const porSemana = dash.periodo > 31;
  const passo = porSemana ? 7 : 1;
  const baldes = [];
  for (let i = Math.ceil(dash.periodo / passo) - 1; i >= 0; i--) {
    const fim = new Date(Date.now() - i * passo * msDia);
    const ini = new Date(fim.getTime() - (passo - 1) * msDia);
    baldes.push({ ini: todayStr(ini), fim: todayStr(fim), n: 0 });
  }
  concluidas.forEach(t => {
    const d = dataLocal(t.concluidoEm);
    const b = baldes.find(b => d >= b.ini && d <= b.fim);
    if (b) b.n++;
  });
  const maxB = Math.max(1, ...baldes.map(b => b.n));
  const fmt = s => { const [, m, d] = s.split("-"); return `${d}/${m}`; };
  grade.appendChild(cartao(
    `Concluídas por ${porSemana ? "semana" : "dia"}`, "dash-cartao-largo",
    `<div class="dash-grafico">
      <div class="dash-escala"><span>${maxB}</span><span>0</span></div>
      <div class="dash-area">
        <div class="dash-guia"></div>
        <div class="dash-colunas" role="img" aria-label="Tarefas concluídas por ${porSemana ? "semana" : "dia"}">
          ${baldes.map(b => `<div class="dash-coluna-wrap" data-tip="${porSemana ? `${fmt(b.ini)} a ${fmt(b.fim)}` : fmt(b.fim)}: ${plural(b.n, "concluída", "concluídas")}">
            <div class="dash-coluna" style="height:${b.n ? Math.max(4, b.n / maxB * 100) : 0}%"></div></div>`).join("")}
        </div>
        <div class="dash-eixo"><span>${fmt(baldes[0].ini)}</span><span>${fmt(baldes[Math.floor(baldes.length / 2)].fim)}</span><span>${fmt(baldes[baldes.length - 1].fim)}</span></div>
      </div>
    </div>`
  ));

  // ── Situação do prazo (rampa vermelha: claro = leve, profundo = crítico)
  const sit = { atrasada: 0, hoje: 0, semana: 0, depois: 0, sem: 0 };
  abertas.forEach(t => sit[situacao(t)]++);
  grade.appendChild(cartao("Prazo das tarefas em aberto", "", barrasHorizontais([
    ["Atrasadas", sit.atrasada, "var(--vermelho-profundo)"],
    ["Vencem hoje", sit.hoje, "var(--vermelho-forte)"],
    ["Próximos 7 dias", sit.semana, "var(--vermelho-medio)"],
    ["Mais adiante", sit.depois, "var(--vermelho-claro)"],
    ["Sem data de prazo", sit.sem, "var(--neutro-grafico)"],
  ], abertas.length)));

  // ── Urgência
  const urg = { alta: 0, media: 0, baixa: 0 };
  abertas.forEach(t => { urg[t.urgencia in urg ? t.urgencia : "media"]++; });
  grade.appendChild(cartao("Urgência das tarefas em aberto", "", barrasHorizontais([
    ["Alta", urg.alta, "var(--vermelho-profundo)"],
    ["Média", urg.media, "var(--vermelho-medio)"],
    ["Baixa", urg.baixa, "var(--vermelho-claro)"],
  ], abertas.length)));

  // ── Distribuição: por equipe (todas) ou por coluna (uma equipe)
  if (dash.equipe === "todas") {
    const porEquipe = state.equipes
      .map(e => [e.nome, abertas.filter(t => t.equipeId === e.id).length, "var(--green)"])
      .sort((a, b) => b[1] - a[1]);
    grade.appendChild(cartao("Em aberto por equipe", "", barrasHorizontais(porEquipe, Math.max(1, ...porEquipe.map(x => x[1])), true)));
  } else {
    const eq = state.equipes.find(e => e.id === dash.equipe);
    const porColuna = eq.colunas.map(c => [c.nome, daEquipe.filter(t =>
      daPessoa(t) && colunaDaTarefa(t)?.id === c.id && (c.finaliza || !t.concluida)).length, c.cor]);
    grade.appendChild(cartao("Tarefas por coluna", "", barrasHorizontais(porColuna, Math.max(1, ...porColuna.map(c => c[1])), true)));
  }

  // ── Por responsável (clicar filtra pela pessoa)
  if (dash.pessoa === "todas") {
    const pessoas = new Map();
    const linha = id => {
      if (!pessoas.has(id)) pessoas.set(id, { id, abertas: 0, atrasadas: 0, concluidas: 0, comPrazo: 0, noPrazo: 0 });
      return pessoas.get(id);
    };
    abertas.forEach(t => { const p = linha(t.responsavel ?? null); p.abertas++; if (situacao(t) === "atrasada") p.atrasadas++; });
    concluidas.forEach(t => {
      const p = linha(t.concluidoPor || t.responsavel || null);
      p.concluidas++;
      if (t.dataPrazo) { p.comPrazo++; if (noPrazo(t)) p.noPrazo++; }
    });
    const linhas = [...pessoas.values()].sort((a, b) => b.abertas - a.abertas || b.concluidas - a.concluidas);
    const maxAbertas = Math.max(1, ...linhas.map(p => p.abertas));
    const c = cartao("Por responsável", "dash-cartao-largo", linhas.length === 0
      ? `<div class="dash-vazio">Nenhuma tarefa neste recorte.</div>`
      : `<table class="dash-tabela">
          <thead><tr><th>Pessoa</th><th>Em aberto</th><th class="num">Atrasadas</th>
            <th class="num">Concluídas (${dash.periodo} dias)</th><th class="num">No prazo</th></tr></thead>
          <tbody>${linhas.map(p => {
            const u = state.users.find(x => x.id === p.id);
            return `<tr class="dash-linha-pessoa" data-pessoa="${p.id ?? "sem"}" title="Ver só ${u ? escapeHTML(u.nome) : "as sem responsável"}">
              <td><div class="dash-pessoa">${u ? avatarHTML(u, "sm") : ""}<span>${u ? escapeHTML(u.nome) : "Sem responsável"}</span></div></td>
              <td><div class="dash-barra-celula"><div class="dash-barra" style="width:${p.abertas / maxAbertas * 100}%"></div><span>${p.abertas}</span></div></td>
              <td class="num">${p.atrasadas ? `<span class="dash-atraso-ponto"></span>${p.atrasadas}` : "0"}</td>
              <td class="num">${p.concluidas}</td>
              <td class="num">${p.comPrazo ? `${Math.round(p.noPrazo / p.comPrazo * 100)}%` : "—"}</td>
            </tr>`;
          }).join("")}</tbody>
        </table>`);
    c.querySelectorAll(".dash-linha-pessoa").forEach(tr => tr.addEventListener("click", () => {
      dash.pessoa = tr.dataset.pessoa === "sem" ? "sem" : Number(tr.dataset.pessoa);
      renderDashboard();
      document.getElementById("dash-body").scrollTop = 0;
    }));
    grade.appendChild(c);
  }
}

// Lista das tarefas por trás do indicador selecionado.
function listaDeTarefas(k, situacao, hoje) {
  const ordenadas = [...k.lista].sort((a, b) => {
    if (k.id === "concluidas" || k.id === "noprazo") return (b.concluidoEm || "").localeCompare(a.concluidoEm || "");
    if (k.id === "criadas") return (b.criadoEm || "").localeCompare(a.criadoEm || "");
    return (a.dataPrazo || "9999").localeCompare(b.dataPrazo || "9999");
  });
  const LIMITE = 50;
  const mostradas = ordenadas.slice(0, LIMITE);

  const detalhe = t => {
    if (k.id === "concluidas" || k.id === "noprazo") {
      const quando = `concluída em ${formatDate(t.concluidoEm)}`;
      return t.dataPrazo ? `${quando} · ${noPrazo(t) ? "no prazo" : "fora do prazo"}` : quando;
    }
    if (k.id === "criadas") return `criada em ${formatDate(t.criadoEm)}`;
    if (k.id === "diarias") return isDiariaFeitaHoje(t) ? "feita hoje" : "pendente hoje";
    if (!t.dataPrazo) return "sem prazo";
    const s = situacao(t);
    if (s === "atrasada") {
      const dias = diasEntre(new Date(t.dataPrazo.slice(0, 10) + "T00:00:00"), new Date(hoje + "T00:00:00"));
      return `${plural(dias, "dia", "dias")} de atraso`;
    }
    return s === "hoje" ? "vence hoje" : `vence ${formatDate(t.dataPrazo)}`;
  };
  const destaque = t => (situacao(t) === "atrasada" && !t.concluida) || ((k.id === "concluidas" || k.id === "noprazo") && t.dataPrazo && !noPrazo(t));

  const c = cartao(`${k.rotulo} · ${plural(k.lista.length, "tarefa", "tarefas")}`, "dash-cartao-largo",
    mostradas.length === 0 ? `<div class="dash-vazio">Nenhuma tarefa aqui.</div>` :
    `<div class="dash-lista">${mostradas.map(t => {
      const u  = state.users.find(x => x.id === (t.concluida ? (t.concluidoPor || t.responsavel) : t.responsavel));
      const eq = state.equipes.find(e => e.id === t.equipeId);
      return `<button type="button" class="dash-lista-item" data-id="${t.id}">
        <span class="dash-lista-nome">${escapeHTML(t.nome)}</span>
        <span class="dash-lista-meta">${escapeHTML(eq ? eq.nome : "")} · ${u ? escapeHTML(u.nome) : "Sem responsável"}</span>
        <span class="dash-lista-situacao${destaque(t) ? " destaque" : ""}">${detalhe(t)}</span>
      </button>`;
    }).join("")}</div>
    ${ordenadas.length > LIMITE ? `<div class="dash-vazio">e mais ${ordenadas.length - LIMITE}.</div>` : ""}`);
  c.id = "dash-lista-tarefas";
  c.querySelectorAll(".dash-lista-item").forEach(b =>
    b.addEventListener("click", () => openDetail(Number(b.dataset.id)))
  );
  return c;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function cartao(titulo, cls, conteudo) {
  const el = document.createElement("section");
  el.className = "dash-cartao" + (cls ? ` ${cls}` : "");
  el.innerHTML = `<h3></h3>${conteudo}`;
  el.querySelector("h3").textContent = titulo;
  return el;
}

// Barras horizontais com rótulo e valor sempre escritos (a cor nunca é a
// única informação). `total` é a base de 100%; `relativo` mostra só o número.
function barrasHorizontais(itens, total, relativo = false) {
  if (itens.length === 0) return `<div class="dash-vazio">Nada para mostrar.</div>`;
  return `<div class="dash-barras">${itens.map(([rotulo, n, cor]) => {
    const pct = total ? n / total * 100 : 0;
    const legenda = relativo || !total ? `${n}` : `${n} · ${Math.round(pct)}%`;
    return `<div class="dash-barra-linha" data-tip="${escapeHTML(rotulo)}: ${legenda}">
      <span class="dash-barra-rotulo">${escapeHTML(rotulo)}</span>
      <div class="dash-barra-trilho"><div class="dash-barra" style="width:${pct}%;background:${cor}"></div></div>
      <span class="dash-barra-valor">${legenda}</span>
    </div>`;
  }).join("")}</div>`;
}

// Tooltip único que segue o mouse sobre qualquer elemento com data-tip.
(() => {
  const tip = document.getElementById("dash-tooltip");
  const tela = document.getElementById("dashboard-screen");
  tela.addEventListener("mousemove", e => {
    const alvo = e.target.closest("[data-tip]");
    if (!alvo) { tip.classList.add("hidden"); return; }
    tip.textContent = alvo.dataset.tip;
    tip.classList.remove("hidden");
    const x = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`;
    tip.style.top  = `${e.clientY - tip.offsetHeight - 10}px`;
  });
  tela.addEventListener("mouseleave", () => tip.classList.add("hidden"));
})();

document.getElementById("nav-dashboard").addEventListener("click", abrirDashboard);
document.getElementById("dash-equipe").addEventListener("change", e => {
  dash.equipe = e.target.value === "todas" ? "todas" : Number(e.target.value);
  e.target.blur();
  renderDashboard();
});
document.getElementById("dash-pessoa").addEventListener("change", e => {
  const v = e.target.value;
  dash.pessoa = v === "todas" || v === "sem" ? v : Number(v);
  e.target.blur();
  renderDashboard();
});
document.querySelectorAll("#dash-periodo button").forEach(b => b.addEventListener("click", () => {
  dash.periodo = Number(b.dataset.dias);
  renderDashboard();
}));
