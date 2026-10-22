/* Quadro — Equipes na barra lateral, atualização automática e boot. */

// ── Equipes ───────────────────────────────────────────────
function equipeAtual() {
  return state.equipes.find(e => e.id === state.equipeAtual) || null;
}

function membrosDaEquipe(equipeId) {
  const equipe = state.equipes.find(e => e.id === equipeId);
  if (!equipe) return [];
  const ids = new Set(equipe.membros.map(m => m.usuarioId));
  return state.users.filter(u => ids.has(u.id));
}

function tarefasDaEquipeAtual() {
  return state.tarefas.filter(t => t.equipeId === state.equipeAtual);
}

function souGestorDaEquipe(equipe) {
  if (!equipe || !state.current) return false;
  if (state.current.isAdmin) return true;
  return equipe.membros.some(m => m.usuarioId === state.current.id && m.papel === "admin");
}

function escolherEquipe(id) {
  state.equipeAtual    = id;
  state.filtroUsuario  = null;
  state.filtroConcluidoUsuario = null;
  try { localStorage.setItem("equipeAtual", String(id)); } catch (e) {}
  renderFiltroUsuarios();
  renderBoard();
  if (document.getElementById("concluded-screen").classList.contains("visible")) renderConcluded();
}

function renderNavEquipes() {
  const nav = document.getElementById("nav-equipes");
  nav.innerHTML = "";
  const adminVisivel = document.getElementById("admin-screen").classList.contains("visible")
    || document.getElementById("dashboard-screen").classList.contains("visible")
    || document.getElementById("minhas-screen").classList.contains("visible")
    || document.getElementById("config-screen").classList.contains("visible");
  if (state.current) {
    const n = state.tarefas.filter(t => t.responsavel === state.current.id && !t.concluida && t.prazo !== "diaria").length;
    document.getElementById("nav-minhas-count").textContent = n || "";
  }

  if (state.equipes.length === 0) {
    nav.innerHTML = `<div class="nav-equipe-vazio">Você ainda não faz parte de nenhuma equipe.</div>`;
  }
  state.equipes.forEach(eq => {
    const abertas = state.tarefas.filter(t => t.equipeId === eq.id && !t.concluida && t.prazo !== "diaria").length;
    const el = document.createElement("div");
    el.className = "nav-item" + (eq.id === state.equipeAtual && !adminVisivel ? " active" : "");
    el.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
      </svg>
      <span class="nav-equipe-sigla"></span>
      <span class="nav-equipe-nome"></span>
      <span class="nav-equipe-count">${abertas || ""}</span>`;
    el.querySelector(".nav-equipe-nome").textContent = eq.nome;
    // Iniciais mostradas quando a barra lateral está recolhida.
    el.querySelector(".nav-equipe-sigla").textContent =
      eq.nome.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("").toUpperCase();
    el.title = eq.nome;
    el.addEventListener("click", () => { showBoardView(); escolherEquipe(eq.id); });
    nav.appendChild(el);
  });


  const eq = equipeAtual();
  const noDashboard = document.getElementById("dashboard-screen").classList.contains("visible");
  const emMinhas    = document.getElementById("minhas-screen").classList.contains("visible");
  const emConfig    = document.getElementById("config-screen").classList.contains("visible");
  document.getElementById("topbar-titulo").textContent =
    noDashboard ? "Dashboard" : emMinhas ? "Minhas tarefas" : emConfig ? "Configurações"
    : eq ? `Tarefas · ${eq.nome}` : "Tarefas";
  document.getElementById("topbar-subtitulo").textContent =
    noDashboard ? "Indicadores das suas equipes e grupos"
    : emMinhas ? "O que está com você em todas as equipes e grupos"
    : emConfig ? "Aparência, perfil e equipes"
    : "Crie e acompanhe tarefas internas da equipe";
  document.getElementById("btn-equipe-membros").classList.toggle("hidden", !eq);
  renderMembrosNoTopo(eq, noDashboard || emMinhas || emConfig);
  document.getElementById("btn-colunas").classList.toggle("hidden", !souGestorDaEquipe(eq));
  document.getElementById("btn-new-task").disabled = !eq;
}

async function carregarDados() {
  showLoading(true);
  try {
    [state.users, state.equipes, state.tarefas] = await Promise.all([
      api.getUsuarios(),
      api.getEquipes(),
      api.getTarefas(),
    ]);
    resetDiariasSeNecessario();
  } catch (e) {
    toast(e.message || "Não foi possível conectar ao servidor.", true);
    console.error(e);
  }
  showLoading(false);
  if (!state.current) return;

  let salva = null;
  try { salva = parseInt(localStorage.getItem("equipeAtual")); } catch (e) {}
  const doUsuario = state.equipes.filter(eq => eq.membros.some(m => m.usuarioId === state.current.id));
  const escolhida = state.equipes.find(eq => eq.id === salva) || doUsuario[0] || state.equipes[0];
  state.equipeAtual = escolhida ? escolhida.id : null;
}

// ── Atualização automática ────────────────────────────────
// Busca de novo equipes e tarefas a cada 20s (e ao voltar para a aba), para
// o que outras pessoas mudaram aparecer sem F5. Não redesenha enquanto a
// pessoa está mexendo em algo: janela aberta, digitando, arrastando um card
// ou com um salvamento ainda em andamento.
const INTERVALO_ATUALIZACAO = 20000;

function usuarioOcupado() {
  if (salvamentosEmAndamento > 0) return true;
  if (document.querySelector(".modal-overlay:not(.hidden):not(#loading-overlay)")) return true;
  if (document.querySelector(".task-card.dragging")) return true;
  if (document.getElementById("coluna-menu") || document.getElementById("resp-menu")) return true;
  if (document.getElementById("admin-screen").classList.contains("visible")) return true;
  const ativo = document.activeElement;
  return !!ativo && ["INPUT", "TEXTAREA", "SELECT"].includes(ativo.tagName);
}

async function atualizarEmSegundoPlano() {
  if (!state.current || document.hidden || usuarioOcupado()) return;
  let users, equipes, tarefas;
  try {
    [users, equipes, tarefas] = await Promise.all([
      api.getUsuarios(), api.getEquipes(), api.getTarefas(),
    ]);
  } catch (e) {
    return; // sem conexão agora: tenta de novo no próximo ciclo
  }
  if (!state.current || usuarioOcupado()) return;

  state.users   = users;
  state.equipes = equipes;
  state.tarefas = juntarArquivadas(tarefas.filter(t => !exclusoesPendentes.has(t.id)));
  resetDiariasSeNecessario();
  if (!equipeAtual()) state.equipeAtual = state.equipes[0]?.id ?? null;

  renderFiltroUsuarios();
  renderBoard();
  if (document.getElementById("concluded-screen").classList.contains("visible")) renderConcluded();
  if (dashboardVisivel()) renderDashboard();
  if (minhasVisivel()) renderMinhas();
}

setInterval(atualizarEmSegundoPlano, INTERVALO_ATUALIZACAO);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) atualizarEmSegundoPlano();
});

// Avatares empilhados ao lado do título; clicar abre os membros.
function renderMembrosNoTopo(eq, emOutraTela) {
  const el = document.getElementById("topbar-membros");
  const membros = eq && !emOutraTela ? membrosDaEquipe(eq.id) : [];
  el.classList.toggle("hidden", membros.length === 0);
  if (!membros.length) return;
  const MAX = 5;
  el.innerHTML = membros.slice(0, MAX).map(u => avatarHTML(u, "sm")).join("")
    + (membros.length > MAX ? `<span class="topbar-membros-mais">+${membros.length - MAX}</span>` : "");
  el.title = `${plural(membros.length, "membro", "membros")}: ${membros.map(u => u.nome).join(", ")}`;
  el.onclick = openEquipeModal;
}

// ── Barra lateral recolhível ──────────────────────────────
function aplicarSidebarRecolhida(recolhida) {
  document.getElementById("app").classList.toggle("sidebar-recolhida", recolhida);
  document.getElementById("btn-sidebar-toggle").title =
    recolhida ? "Expandir barra lateral" : "Recolher barra lateral";
}

document.getElementById("btn-sidebar-toggle").addEventListener("click", () => {
  const recolhida = !document.getElementById("app").classList.contains("sidebar-recolhida");
  aplicarSidebarRecolhida(recolhida);
  salvarPreferencia("sidebarRecolhida", recolhida ? "1" : "");
});

// ── Boot ──────────────────────────────────────────────────
function aplicarCardsCompactos(ligado) {
  document.documentElement.toggleAttribute("data-compacto", ligado);
}

async function boot() {
  aplicarSidebarRecolhida(lerPreferencia("sidebarRecolhida", "") === "1");
  aplicarCardsCompactos(lerPreferencia("cardsCompactos", "") === "1");
  state.visao     = lerPreferencia("visao", "quadro");
  state.ordenacao = lerPreferencia("ordenacao", "criacao");
  mostrarQuadro();
  showLoading(true);
  try {
    state.users = await api.getUsuarios();
  } catch (e) {
    toast("Não foi possível conectar ao servidor.", true);
    console.error(e);
  }
  showLoading(false);

  const savedId = document.cookie
    .split("; ")
    .find(r => r.startsWith("currentUserId="))
    ?.split("=")[1];

  if (savedId) {
    const user = state.users.find(u => u.id === parseInt(savedId));
    if (user) {
      state.current = user;
      enterApp();
      return;
    }
  }

  if (convitePendente()) {
    document.querySelector(".login-sub").textContent = "Você recebeu um convite para um grupo. Escolha seu perfil para entrar nele.";
  }
  renderLoginUsers();
}

async function resetDiariasSeNecessario() {
  const promises = [];
  state.tarefas.forEach(t => {
    if (t.prazo === "diaria" && t.diariaFeitaEm && t.diariaFeitaEm !== todayStr()) {
      t.diariaFeitaEm = null;
      promises.push(api.patchTarefa(t.id, { diariaFeitaEm: null }));
    }
  });
  if (promises.length) await Promise.all(promises);
}

function showLoading(on) {
  document.getElementById("loading-overlay").classList.toggle("hidden", !on);
}
