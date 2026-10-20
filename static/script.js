/* ============================================================
   Portal da Controladoria — script.js
   ============================================================ */

const API = "";

// ── Tema (paleta de cor) ──────────────────────────────────
function applyAccent(name) {
  document.documentElement.setAttribute("data-accent", name);
  localStorage.setItem("accent", name);
  document.querySelectorAll(".theme-swatch").forEach(b =>
    b.classList.toggle("selected", b.dataset.accent === name)
  );
}
document.querySelectorAll(".theme-swatch").forEach(b =>
  b.addEventListener("click", () => applyAccent(b.dataset.accent))
);
applyAccent(localStorage.getItem("accent") || "green");

let state = {
  users:        [],
  tarefas:      [],
  equipes:      [],
  equipeAtual:  null,
  current:      null,
  filtroUsuario: null,
  filtroConcluidoUsuario:  null,
  filtroConcluidoPeriodo:  "todos",
  visao:        "quadro",    // "quadro" (kanban) ou "tabela"
  ordenacao:    "criacao",   // "criacao", "prazo" ou "urgencia"
};

// ── API helpers ───────────────────────────────────────────
let salvamentosEmAndamento = 0;

async function apiFetch(method, path, body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== null) opts.body = JSON.stringify(body);
  if (method !== "GET") salvamentosEmAndamento++;
  let res;
  try {
    res = await fetch(`${API}${path}`, opts);
  } finally {
    if (method !== "GET") salvamentosEmAndamento--;
  }
  if (res.status === 401 && state.current) {
    logout();
    throw new Error("Sessão expirada. Entre novamente.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Erro ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const api = {
  getTarefas:      ()         => apiFetch("GET",    "/api/tarefas"),
  criarTarefa:     (t)        => apiFetch("POST",   "/api/tarefas", t),
  atualizarTarefa: (id, t)    => apiFetch("PUT",    `/api/tarefas/${id}`, t),
  patchTarefa:     async (id, body) => {
    const r = await apiFetch("PATCH", `/api/tarefas/${id}`, body);
    aoAlterarTarefa(id);
    return r;
  },
  getAtividade:    (id)       => apiFetch("GET",    `/api/tarefas/${id}/atividade`),
  comentar:        (id, texto) => apiFetch("POST",  `/api/tarefas/${id}/comentarios`, { texto }),
  apagarComentario:(id)       => apiFetch("DELETE", `/api/comentarios/${id}`),
  getNotificacoes: ()         => apiFetch("GET",    "/api/notificacoes"),
  marcarNotificacoesLidas: (ids) => apiFetch("POST", "/api/notificacoes/lidas", { ids }),
  deletarTarefa:   (id)       => apiFetch("DELETE", `/api/tarefas/${id}`),
  getUsuarios:     ()         => apiFetch("GET",    "/api/usuarios"),
  criarUsuario:    (u)        => apiFetch("POST",   "/api/usuarios", u),
  atualizarUsuario:(id, u)    => apiFetch("PUT",    `/api/usuarios/${id}`, u),
  deletarUsuario:  (id)       => apiFetch("DELETE", `/api/usuarios/${id}`),
  getEquipes:      ()         => apiFetch("GET",    "/api/equipes"),
  criarEquipe:     (nome, membros = []) => apiFetch("POST", "/api/equipes", { nome, membros }),
  criarColuna:     (equipeId, c) => apiFetch("POST", `/api/equipes/${equipeId}/colunas`, c),
  atualizarColuna: (id, c)    => apiFetch("PUT",    `/api/colunas/${id}`, c),
  deletarColuna:   (id)       => apiFetch("DELETE", `/api/colunas/${id}`),
  ordenarColunas:  (equipeId, ids) => apiFetch("PUT", `/api/equipes/${equipeId}/colunas/ordem`, { ids }),
  renomearEquipe:  (id, nome) => apiFetch("PUT",    `/api/equipes/${id}`, { nome }),
  deletarEquipe:   (id)       => apiFetch("DELETE", `/api/equipes/${id}`),
  salvarMembro:    (id, usuarioId, papel) => apiFetch("PUT", `/api/equipes/${id}/membros`, { usuarioId, papel }),
  removerMembro:   (id, usuarioId)        => apiFetch("DELETE", `/api/equipes/${id}/membros/${usuarioId}`),
};

// ── Data helpers ──────────────────────────────────────────
// Data (aaaa-mm-dd) no horário de Brasília. Com toISOString() o dia virava
// às 21h, porque o UTC já está no dia seguinte.
function todayStr(d = new Date()) {
  return d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

function isDiariaFeitaHoje(t) {
  return t.prazo === "diaria" && t.diariaFeitaEm === todayStr();
}

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
    || document.getElementById("minhas-screen").classList.contains("visible");
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
  document.getElementById("topbar-titulo").textContent =
    noDashboard ? "Dashboard" : emMinhas ? "Minhas tarefas" : eq ? `Tarefas · ${eq.nome}` : "Tarefas";
  document.getElementById("topbar-subtitulo").textContent =
    noDashboard ? "Indicadores das suas equipes e grupos"
    : emMinhas ? "O que está com você em todas as equipes e grupos"
    : "Crie e acompanhe tarefas internas da equipe";
  document.getElementById("btn-equipe-membros").classList.toggle("hidden", !eq);
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
  state.tarefas = tarefas;
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
async function boot() {
  aplicarSidebarRecolhida(lerPreferencia("sidebarRecolhida", "") === "1");
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

// ── Avatar (foto de perfil) ───────────────────────────────
// u.fotoPerfil é uma data URL (base64) opcional; sem ela, cai nas iniciais em u.avatar.
function fotoSegura(foto) {
  return typeof foto === "string" && /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(foto) ? foto : null;
}

function avatarHTML(u, extraClass = "") {
  const cls = "avatar" + (extraClass ? " " + extraClass : "");
  const foto = u && fotoSegura(u.fotoPerfil);
  if (foto) {
    return `<div class="${cls}"><img src="${foto}" alt=""></div>`;
  }
  return `<div class="${cls}">${u ? escapeHTML(u.avatar || "") : ""}</div>`;
}

function setAvatarEl(el, u) {
  const foto = u && fotoSegura(u.fotoPerfil);
  el.innerHTML = foto ? `<img src="${foto}" alt="">` : (u ? escapeHTML(u.avatar || "") : "");
}

// Redimensiona a imagem escolhida no cliente antes de mandar como base64,
// pra não inflar o banco com fotos em resolução original.
function resizeImageToBase64(file, maxSize = 160, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Arquivo não é uma imagem válida."));
      img.onload = () => {
        let { width, height } = img;
        if (width > height) {
          if (width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
        } else {
          if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Login ─────────────────────────────────────────────────
function renderLoginUsers() {
  const list = document.getElementById("login-user-list");
  list.innerHTML = "";
  const busca = document.getElementById("login-busca");
  busca.classList.toggle("hidden", state.users.length < 8);   // só vale a pena com muita gente
  const termo = busca.value.trim().toLowerCase();
  const visiveis = state.users.filter(u => !termo
    || u.nome.toLowerCase().includes(termo) || (u.cargo || "").toLowerCase().includes(termo));
  if (visiveis.length === 0) {
    list.innerHTML = `<div class="login-nenhum">Ninguém encontrado com esse nome.</div>`;
  }
  visiveis.forEach(u => {
    const el = document.createElement("div");
    el.className = "user-option";
    el.dataset.id = u.id;
    el.innerHTML = `
      ${avatarHTML(u)}
      <div class="user-option-info">
        <strong>${escapeHTML(u.nome)}</strong>
        <span>${escapeHTML(u.cargo || "")}</span>
      </div>`;
    el.addEventListener("click", () => selectUser(el, u.id));
    list.appendChild(el);
  });
}

function selectUser(el, id) {
  document.querySelectorAll(".user-option").forEach(o => o.classList.remove("selected"));
  el.classList.add("selected");
  document.getElementById("btn-enter").disabled = false;
  document.getElementById("btn-enter").dataset.userId = id;
}

document.getElementById("login-busca").addEventListener("input", () => {
  renderLoginUsers();
  document.getElementById("btn-enter").disabled = true;
});
document.getElementById("login-busca").addEventListener("keydown", e => {
  // Enter com um único resultado já seleciona a pessoa.
  if (e.key !== "Enter") return;
  const opcoes = document.querySelectorAll("#login-user-list .user-option");
  if (opcoes.length === 1) opcoes[0].click();
});

document.getElementById("btn-enter").addEventListener("click", () => {
  const id = parseInt(document.getElementById("btn-enter").dataset.userId);
  if (!id) return;
  const user = state.users.find(u => u.id === id);
  if (!user) return;
  state.current = user;
  enterApp();
});

document.getElementById("btn-show-new-user").addEventListener("click", () => {
  document.getElementById("new-user-form").classList.toggle("visible");
});

document.getElementById("btn-create-user").addEventListener("click", async () => {
  const nome  = document.getElementById("new-user-name").value.trim();
  const cargo = document.getElementById("new-user-cargo").value.trim();
  if (!nome) { toast("Informe o nome do usuário.", true); return; }
  try {
    const novo = await api.criarUsuario({ nome, cargo: cargo || "Colaborador" });
    state.users.push(novo);
    document.getElementById("new-user-form").classList.remove("visible");
    document.getElementById("new-user-name").value  = "";
    document.getElementById("new-user-cargo").value = "";
    renderLoginUsers();
    toast(`Usuário ${novo.nome} criado!`);
  } catch (e) {
    toast(e.message, true);
  }
});

// ── Enter / Logout ────────────────────────────────────────
async function enterApp() {
  document.cookie = `currentUserId=${state.current.id};path=/;max-age=86400`;
  await carregarDados();
  if (!state.current) return;
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").classList.add("visible");
  document.getElementById("sb-user-name").textContent   = state.current.nome;
  document.getElementById("sb-user-cargo").textContent  = state.current.cargo;
  setAvatarEl(document.getElementById("sb-user-avatar"), state.current);
  document.getElementById("nav-admin").classList.toggle("hidden", !state.current.isAdmin);
  renderFiltroUsuarios();
  renderBoard();
  checkAvisoNovasTarefas();
  carregarNotificacoes();
}

// ── Aviso de novas tarefas atribuídas ──────────────────────
// Mostra uma única vez por tarefa: quando alguém cria/atribui uma tarefa
// para outra pessoa, o responsável vê um aviso na próxima vez que entrar
// no portal. Depois de confirmar ("Ciente"), aviso_confirmado vira true
// e a tarefa não aparece mais nesse aviso.
function checkAvisoNovasTarefas() {
  const pendentes = state.tarefas.filter(t =>
    t.responsavel === state.current.id &&
    t.criadoPor && t.criadoPor !== state.current.id &&
    !t.avisoConfirmado
  );
  if (pendentes.length === 0) return;

  const list = document.getElementById("aviso-tarefas-list");
  list.innerHTML = "";
  pendentes.forEach(t => {
    const autor = state.users.find(u => u.id === t.criadoPor);
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHTML(t.nome)}</strong><span>Criada por ${autor ? E(autor.nome) : "alguém"}</span>`;
    list.appendChild(li);
  });

  document.getElementById("modal-aviso-overlay").classList.remove("hidden");

  document.getElementById("btn-aviso-ciente").onclick = async () => {
    document.getElementById("modal-aviso-overlay").classList.add("hidden");
    try {
      await Promise.all(pendentes.map(t => {
        t.avisoConfirmado = true;
        return api.patchTarefa(t.id, { avisoConfirmado: true });
      }));
    } catch (err) {
      toast(err.message, true);
    }
  };
}

document.getElementById("btn-logout").addEventListener("click", logout);

function logout() {
  state.current      = null;
  state.filtroUsuario = null;
  state.tarefas      = [];
  state.equipes      = [];
  state.equipeAtual  = null;
  notificacoes = { naoLidas: 0, itens: [] };
  renderNotificacoes();
  fecharPainelNotificacoes();
  document.cookie = "currentUserId=;path=/;max-age=0";
  document.getElementById("app").classList.remove("visible");
  document.getElementById("login-screen").style.display = "";
  document.querySelectorAll(".user-option").forEach(o => o.classList.remove("selected"));
  document.getElementById("btn-enter").disabled = true;
  delete document.getElementById("btn-enter").dataset.userId;
  const bar = document.getElementById("filtro-usuario-bar");
  if (bar) bar.remove();
  document.getElementById("nav-admin").classList.add("hidden");
  document.querySelectorAll(".modal-overlay:not(#loading-overlay)").forEach(o => o.classList.add("hidden"));
  renderLoginUsers();
  showBoardView();
}

// ── Foto de perfil (qualquer usuário, não só admin) ───────
// Clicar no próprio avatar da sidebar revela o botão de trocar a foto —
// self-service, sem precisar passar pelo Gerenciador de Base.
// Se já existe foto, abre um menu com "trocar" ou "remover"; sem foto,
// vai direto pro seletor de arquivo.
function closeAvatarEditMenu() {
  document.getElementById("sb-avatar-edit-menu").classList.add("hidden");
}

document.getElementById("sb-avatar-edit-wrap").addEventListener("click", () => {
  if (!state.current) return;
  if (state.current.fotoPerfil) {
    document.getElementById("sb-avatar-edit-menu").classList.toggle("hidden");
  } else {
    document.getElementById("sb-user-foto-input").click();
  }
});

document.getElementById("sb-avatar-edit-menu").addEventListener("click", e => e.stopPropagation());

document.addEventListener("click", e => {
  if (!document.getElementById("sb-avatar-edit-wrap").contains(e.target)) closeAvatarEditMenu();
});

document.getElementById("sb-avatar-menu-upload").addEventListener("click", () => {
  closeAvatarEditMenu();
  document.getElementById("sb-user-foto-input").click();
});

document.getElementById("sb-avatar-menu-remove").addEventListener("click", () => {
  closeAvatarEditMenu();
  if (state.current) salvarFotoPerfilAtual(null);
});

document.getElementById("sb-user-foto-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !state.current) return;

  try {
    const fotoPerfil = await resizeImageToBase64(file);
    await salvarFotoPerfilAtual(fotoPerfil);
  } catch (err) {
    toast(err.message, true);
  }
});

async function salvarFotoPerfilAtual(fotoPerfil) {
  try {
    const payload = {
      nome:       state.current.nome,
      cargo:      state.current.cargo,
      avatar:     state.current.avatar,
      isAdmin:    state.current.isAdmin,
      fotoPerfil,
    };
    const atualizado = await api.atualizarUsuario(state.current.id, payload);
    state.current = atualizado;
    const idx = state.users.findIndex(u => u.id === atualizado.id);
    if (idx !== -1) state.users[idx] = atualizado;

    setAvatarEl(document.getElementById("sb-user-avatar"), state.current);
    renderBoard();
    renderFiltroUsuarios();
    toast(fotoPerfil ? "Foto de perfil atualizada." : "Foto de perfil removida.");
  } catch (err) {
    toast(err.message, true);
  }
}

// ── Filtro de Usuário ─────────────────────────────────────
function renderFiltroUsuarios() {
  const existing = document.getElementById("filtro-usuario-bar");
  if (existing) existing.remove();

  const bar = document.createElement("div");
  bar.id = "filtro-usuario-bar";
  bar.className = "filtro-bar";

  const group = document.createElement("div");
  group.className = "filtro-group";

  const label = document.createElement("span");
  label.className = "filtro-group-label";
  label.textContent = "Filtrar:";
  group.appendChild(label);

  // Botão Todos
  const btnTodos = document.createElement("button");
  btnTodos.className = "filtro-btn" + (state.filtroUsuario === null ? " active" : "");
  btnTodos.textContent = "Todos";
  btnTodos.onclick = () => {
    state.filtroUsuario = null;
    renderFiltroUsuarios();
    renderBoard();
  };
  group.appendChild(btnTodos);

  // Botão por membro da equipe
  membrosDaEquipe(state.equipeAtual).forEach(u => {
    const btn = document.createElement("button");
    btn.className = "filtro-btn" + (state.filtroUsuario === u.id ? " active" : "");
    btn.innerHTML = `${escapeHTML(u.avatar || "")} ${escapeHTML(u.nome)}`;
    btn.onclick = () => {
      state.filtroUsuario = u.id;
      renderFiltroUsuarios();
      renderBoard();
    };
    group.appendChild(btn);
  });

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

// Ajusta os campos de conclusão quando a tarefa muda para `coluna`.
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
    <h2>Bem-vindo ao Portal de Tarefas</h2>
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

  const tarefasFiltradas = tarefasVisiveis();

  colunas.forEach(col => {
    const tasks = tarefasDaColuna(tarefasFiltradas, col);
    const count = tasks.filter(t =>
      t.prazo === "diaria" ? !isDiariaFeitaHoje(t) : !t.concluida
    ).length;

    const col_el = document.createElement("div");
    col_el.className = "column";
    col_el.innerHTML = `
      <div class="column-header">
        <div class="column-title">
          <div class="col-dot"></div>
          <span class="column-nome"></span>
        </div>
        <span class="col-count">${count}</span>
      </div>
      <div class="column-body"></div>`;
    col_el.querySelector(".col-dot").style.background = col.cor;
    col_el.querySelector(".column-nome").textContent = col.nome;
    board.appendChild(col_el);

    // Mover a coluna: arrastar pelo cabeçalho (só quem administra o quadro).
    if (gestor) {
      const header = col_el.querySelector(".column-header");
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
        <div class="column-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>
          </svg>
          <span>Nenhuma tarefa</span>
        </div>`;
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
            prazo: "unica", urgencia: "media", status: "pendente",
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

  if (gestor) {
    const nova = document.createElement("div");
    nova.className = "column-nova";
    nova.innerHTML = `<button type="button">+ Nova coluna</button>`;
    nova.querySelector("button").addEventListener("click", openColunasModal);
    board.appendChild(nova);
  }

  renderNavEquipes();
}

// ── Cards ─────────────────────────────────────────────────
function buildDiariaCard(t) {
  const feita = isDiariaFeitaHoje(t);
  const el = document.createElement("div");
  el.className = `task-card task-card-diaria ${feita ? "diaria-feita" : ""}`;
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
        ? `<div class="card-resp">${avatarHTML(resp, "sm")}<span>${escapeHTML(resp.nome)}</span></div>`
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

  el.querySelector(".card-delete-btn").addEventListener("click", async e => {
    e.stopPropagation();
    const ok = await showConfirm(`Excluir a tarefa diária "${t.nome}" permanentemente? Essa ação não pode ser desfeita.`);
    if (!ok) return;
    try {
      await api.deletarTarefa(t.id);
      state.tarefas = state.tarefas.filter(x => x.id !== t.id);
      renderBoard();
      toast("Tarefa diária excluída.");
    } catch (err) {
      toast(err.message, true);
    }
  });

  el.addEventListener("click", () => openDetail(t.id));
  return el;
}

function buildCard(t) {
  const el = document.createElement("div");
  el.className = "task-card" + (situacaoPrazo(t) === "atrasada" ? " card-atrasada" : "");
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
      <span class="badge ${statusClass}">${statusLabel}</span>
      ${t.dataPrazo ? `<span class="card-prazo ${situacaoPrazo(t) || ""}">${
        { atrasada: "Atrasada · ", hoje: "Vence hoje · " }[situacaoPrazo(t)] || ""}${formatDate(t.dataPrazo)}</span>` : ""}
    </div>
    ${etapasTotal > 0 ? `
      <div class="card-progress">
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="progress-text">${etapasDone}/${etapasTotal}</span>
      </div>` : ""}
    <div class="card-footer">
      <span class="card-date">${t.comentarios ? `<span class="card-comentarios" title="Comentários">${ICONE_COMENTARIO}${t.comentarios}</span>` : ""}${resp ? "" : "Sem resp."}</span>
      ${resp ? `<div class="card-resp">${avatarHTML(resp, "sm")}<span>${escapeHTML(resp.nome)}</span></div>` : ""}
    </div>
    ${t.concluida && t.concluidoEm ? `
      <div class="card-concluido-info">Concluída em ${formatDate(t.concluidoEm)}${concluidor ? ` por ${escapeHTML(concluidor.nome)}` : ""}</div>
    ` : ""}`;

  el.querySelector(".card-delete-btn").addEventListener("click", async e => {
    e.stopPropagation();
    const ok = await showConfirm(`Excluir a tarefa "${t.nome}" permanentemente? Essa ação não pode ser desfeita.`);
    if (!ok) return;
    try {
      await api.deletarTarefa(t.id);
      state.tarefas = state.tarefas.filter(x => x.id !== t.id);
      renderBoard();
      if (document.getElementById("concluded-screen").classList.contains("visible")) renderConcluded();
      toast("Tarefa excluída.");
    } catch (err) {
      toast(err.message, true);
    }
  });

  el.addEventListener("click", () => openDetail(t.id));
  return el;
}

// ── View: Concluídas ──────────────────────────────────────
document.getElementById("btn-concluded").addEventListener("click", () => {
  esconderQuadro();
  fecharMinhas();
  document.getElementById("dashboard-screen").classList.remove("visible");
  document.getElementById("nav-dashboard").classList.remove("active");
  document.getElementById("main").classList.remove("modo-dashboard");
  document.getElementById("filtro-usuario-bar")?.classList.add("hidden");
  document.getElementById("concluded-screen").classList.add("visible");
  renderConcluded();
});

document.getElementById("btn-back-board").addEventListener("click", showBoardView);

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
    return;
  }
  done.forEach(t => list.appendChild(buildCard(t)));
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

// ── View: navegação entre Board / Gerenciador de Base ─────
function showBoardView() {
  fecharMinhas();
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
  document.getElementById("admin-t-status").value       = t.status;
  document.getElementById("admin-t-concluida").value    = t.concluida ? "true" : "false";
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
    concluida:   document.getElementById("admin-t-concluida").value === "true",
    diariaFeitaEm: t.diariaFeitaEm,
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
      document.getElementById("nav-admin").classList.toggle("hidden", !u.isAdmin);
    }
    toast("Usuário atualizado.");
  } catch (err) {
    toast(err.message, true);
  }
});

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
    status: "pendente",
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
  document.getElementById("btn-detail-excluir").onclick = async () => {
    const antes = state.tarefas.length;
    await excluirTarefa(t);
    if (state.tarefas.length < antes) closeDetail();
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
  inputDesc.oninput = () => { autoGrowTextarea(inputDesc, 120); salvarDescDebounced(); };

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
      item.addEventListener("click", async () => {
        etapa.concluida = !etapa.concluida;
        try {
          await api.patchTarefa(t.id, { etapas: t.etapas });
          openDetail(id);
          renderBoard();
        } catch (err) {
          etapa.concluida = !etapa.concluida;
          toast(err.message, true);
        }
      });
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
        t.etapas = t.etapas.filter(e2 => e2 !== etapa);
        try {
          await api.patchTarefa(t.id, { etapas: t.etapas });
          openDetail(id);
          renderBoard();
          toast("Etapa excluída.");
        } catch (err) {
          toast(err.message, true);
        }
      });
      checklist.appendChild(item);
    });
  }

  const inputNovaEtapa = document.getElementById("detail-input-etapa");
  inputNovaEtapa.value = "";
  const addEtapaDetail = async () => {
    const val = inputNovaEtapa.value.trim();
    if (!val) return;
    t.etapas.push({ id: Date.now(), texto: val, concluida: false });
    try {
      await api.patchTarefa(t.id, { etapas: t.etapas });
      openDetail(id);
      renderBoard();
    } catch (err) {
      t.etapas.pop();
      toast(err.message, true);
    }
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
      renderBoard();
      if (document.getElementById("concluded-screen").classList.contains("visible")) renderConcluded();
      toast(t.concluida ? "Tarefa concluída!" : "Tarefa reaberta.");
    } catch (err) {
      Object.assign(t, anterior);
      toast(err.message, true);
    }
  };
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
    const textoAnterior = etapa.texto;
    etapa.texto = val;
    try {
      await api.patchTarefa(t.id, { etapas: t.etapas });
      openDetail(id);
      renderBoard();
    } catch (err) {
      etapa.texto = textoAnterior;
      toast(err.message, true);
      openDetail(id);
    }
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

document.getElementById("btn-equipe-excluir").addEventListener("click", async () => {
  const eq = equipeAtual();
  if (!eq) return;
  const ok = await showConfirm(`Excluir a equipe ${eq.nome}? Só é possível excluir equipes sem tarefas.`);
  if (!ok) return;
  try {
    await api.deletarEquipe(eq.id);
    state.equipes = state.equipes.filter(e => e.id !== eq.id);
    closeEquipeModal();
    escolherEquipe(state.equipes[0]?.id ?? null);
    toast("Equipe excluída.");
  } catch (err) {
    toast(err.message, true);
  }
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
    showBoardView();
    escolherEquipe(novo.id);
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

// ── Modal: Colunas do quadro ──────────────────────────────
function openColunasModal() {
  if (!equipeAtual()) return;
  renderColunasModal();
  document.getElementById("modal-colunas-overlay").classList.remove("hidden");
}

function closeColunasModal() {
  document.getElementById("modal-colunas-overlay").classList.add("hidden");
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
function tarefasVisiveis() {
  const daEquipe = tarefasDaEquipeAtual();
  return state.filtroUsuario !== null
    ? daEquipe.filter(t => t.responsavel === state.filtroUsuario)
    : daEquipe;
}

function tarefasDaColuna(lista, col) {
  return lista.filter(t => colunaDaTarefa(t)?.id === col.id && (col.finaliza || !t.concluida));
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
          <col style="width:30%"><col style="width:15%"><col style="width:12%">
          <col style="width:10%"><col style="width:12%"><col style="width:6%">
          <col style="width:10%"><col style="width:5%">
        </colgroup>
        <thead><tr>
          <th>Tarefa</th><th>Responsável</th><th>Status</th><th>Urgência</th>
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
        <td>${t.concluida
          ? `<span class="tabela-concluida">Concluída</span>`
          : `<select class="campo-status">${opcoesHTML([["pendente", "Pendente"], ["em andamento", "Em andamento"]], t.status)}</select>`}</td>
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
            prazo: "unica", urgencia: "media", status: "pendente",
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

async function excluirTarefa(t) {
  const ok = await showConfirm(`Excluir a tarefa "${t.nome}" permanentemente? Essa ação não pode ser desfeita.`);
  if (!ok) return;
  try {
    await api.deletarTarefa(t.id);
    state.tarefas = state.tarefas.filter(x => x.id !== t.id);
    renderBoard();
    if (document.getElementById("concluded-screen").classList.contains("visible")) renderConcluded();
    toast("Tarefa excluída.");
  } catch (err) {
    toast(err.message, true);
  }
}

// ── Atividade: comentários e histórico ────────────────────
let detalheTarefaId = null;
let atividadeTimer  = null;

function tempoRelativo(iso) {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1)  return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24 && todayStr(d) === todayStr()) return `há ${h} h`;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function carregarAtividade(tarefaId) {
  const list = document.getElementById("detail-atividade");
  let itens;
  try {
    itens = await api.getAtividade(tarefaId);
  } catch (err) {
    if (detalheTarefaId === tarefaId) list.innerHTML = `<div class="atividade-vazia">Não foi possível carregar a atividade.</div>`;
    return;
  }
  if (detalheTarefaId !== tarefaId) return;

  const t = state.tarefas.find(x => x.id === tarefaId);
  if (t) t.comentarios = itens.filter(i => i.tipo === "comentario").length;

  list.innerHTML = "";
  if (itens.length === 0) {
    list.innerHTML = `<div class="atividade-vazia">Nenhuma atividade ainda.</div>`;
    return;
  }
  itens.forEach(item => {
    const autor = state.users.find(u => u.id === item.usuarioId);
    const el = document.createElement("div");
    el.className = "atividade-item";
    el.innerHTML = `
      ${avatarHTML(autor, "sm")}
      <div class="atividade-corpo">
        <strong></strong>
        <span class="${item.tipo === "historico" ? "atividade-historico" : ""}"></span>
        <span class="atividade-quando"></span>
      </div>`;
    el.querySelector("strong").textContent = autor ? autor.nome : "Usuário removido";
    el.querySelector(".atividade-quando").textContent = tempoRelativo(item.criadoEm);
    const corpo = el.querySelector(".atividade-corpo");

    if (item.tipo === "historico") {
      el.querySelector(".atividade-historico").textContent = item.texto;
    } else {
      el.querySelector(".atividade-corpo > span:not(.atividade-quando)").textContent = "comentou";
      if (item.usuarioId === state.current.id || state.current.isAdmin) {
        const apagar = document.createElement("button");
        apagar.className = "atividade-apagar";
        apagar.textContent = "Apagar";
        apagar.onclick = async () => {
          const ok = await showConfirm("Apagar este comentário?", { title: "Apagar comentário", confirmLabel: "Apagar" });
          if (!ok) return;
          try {
            await api.apagarComentario(item.id);
            carregarAtividade(tarefaId);
            renderBoard();
          } catch (err) {
            toast(err.message, true);
          }
        };
        corpo.appendChild(apagar);
      }
      const texto = document.createElement("div");
      texto.className = "atividade-comentario-texto";
      texto.textContent = item.texto;
      corpo.appendChild(texto);
    }
    list.appendChild(el);
  });
}

// Depois de qualquer alteração na tarefa aberta, recarrega a atividade
// (com um pequeno atraso para juntar várias alterações seguidas).
function aoAlterarTarefa(tarefaId) {
  if (detalheTarefaId !== tarefaId || modalDetail.classList.contains("hidden")) return;
  clearTimeout(atividadeTimer);
  atividadeTimer = setTimeout(() => carregarAtividade(tarefaId), 400);
}

async function enviarComentario() {
  const input = document.getElementById("detail-comentario");
  const texto = input.value.trim();
  const tarefaId = detalheTarefaId;
  if (!texto || !tarefaId) return;
  const btn = document.getElementById("btn-comentar");
  btn.disabled = true;
  try {
    await api.comentar(tarefaId, texto);
    input.value = "";
    await carregarAtividade(tarefaId);
    renderBoard();
  } catch (err) {
    toast(err.message, true);
  }
  btn.disabled = false;
}

document.getElementById("btn-comentar").addEventListener("click", enviarComentario);
document.getElementById("detail-comentario").addEventListener("keydown", e => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviarComentario(); }
});

// ── Notificações (sino no topo) ───────────────────────────
// Buscadas a cada 20s, independente do resto da tela: atualizar o número
// do sino não atrapalha quem está digitando ou com uma janela aberta.
let notificacoes = { naoLidas: 0, itens: [] };

async function carregarNotificacoes() {
  if (!state.current) return;
  try {
    notificacoes = await api.getNotificacoes();
  } catch (e) {
    return;
  }
  renderNotificacoes();
}

function renderNotificacoes() {
  const n = notificacoes.naoLidas;
  const badge = document.getElementById("notif-badge");
  badge.textContent = n > 99 ? "99+" : String(n);
  badge.classList.toggle("hidden", n === 0);
  document.title = n > 0 ? `(${n}) Portal de Tarefas` : "Portal de Tarefas";
  document.getElementById("btn-notif-todas").disabled = n === 0;

  const lista = document.getElementById("notif-lista");
  lista.innerHTML = "";
  if (notificacoes.itens.length === 0) {
    lista.innerHTML = `<div class="notif-vazia">Nenhuma notificação por enquanto.</div>`;
    return;
  }
  notificacoes.itens.forEach(item => {
    const autor = state.users.find(u => u.id === item.autorId);
    const el = document.createElement("div");
    el.className = "notif-item" + (item.lida ? "" : " nao-lida");
    el.innerHTML = `
      ${avatarHTML(autor, "sm")}
      <div class="notif-texto"><span></span><span class="notif-quando"></span></div>
      ${item.lida ? "" : `<div class="notif-ponto"></div>`}`;
    el.querySelector(".notif-texto span").textContent = item.texto;
    el.querySelector(".notif-quando").textContent = tempoRelativo(item.criadoEm);
    el.addEventListener("click", () => abrirNotificacao(item));
    lista.appendChild(el);
  });
}

async function marcarNotificacoesLidas(ids = null) {
  const alvo = ids ? notificacoes.itens.filter(i => ids.includes(i.id)) : notificacoes.itens;
  const novas = alvo.filter(i => !i.lida).length;
  alvo.forEach(i => { i.lida = true; });
  notificacoes.naoLidas = ids ? Math.max(0, notificacoes.naoLidas - novas) : 0;
  renderNotificacoes();
  try {
    await api.marcarNotificacoesLidas(ids);
  } catch (err) {
    toast(err.message, true);
  }
}

function fecharPainelNotificacoes() {
  document.getElementById("notif-painel").classList.add("hidden");
}

// Vai para a equipe/tarefa da notificação. Se a pessoa acabou de entrar
// num grupo, a equipe ainda não está carregada: busca de novo antes.
async function abrirNotificacao(item) {
  fecharPainelNotificacoes();
  if (!item.lida) marcarNotificacoesLidas([item.id]);
  if (!item.equipeId) return;

  if (!state.equipes.some(e => e.id === item.equipeId) ||
      (item.tarefaId && !state.tarefas.some(t => t.id === item.tarefaId))) {
    try {
      [state.equipes, state.tarefas] = await Promise.all([api.getEquipes(), api.getTarefas()]);
    } catch (err) {
      toast(err.message, true);
      return;
    }
  }
  if (!state.equipes.some(e => e.id === item.equipeId)) {
    toast("Você não tem mais acesso a esta equipe.", true);
    return;
  }
  showBoardView();
  escolherEquipe(item.equipeId);
  if (item.tarefaId) {
    if (state.tarefas.some(t => t.id === item.tarefaId)) openDetail(item.tarefaId);
    else toast("Essa tarefa foi excluída.", true);
  }
}

document.getElementById("btn-notif").addEventListener("click", e => {
  e.stopPropagation();
  const painel = document.getElementById("notif-painel");
  painel.classList.toggle("hidden");
  if (painel.classList.contains("hidden")) return;
  const r = document.getElementById("btn-notif").getBoundingClientRect();
  painel.style.top   = `${r.bottom + 8}px`;
  painel.style.right = `${Math.max(16, window.innerWidth - r.right)}px`;
  carregarNotificacoes();
});
document.getElementById("notif-painel").addEventListener("click", e => e.stopPropagation());
document.getElementById("btn-notif-todas").addEventListener("click", () => marcarNotificacoesLidas());
document.addEventListener("click", fecharPainelNotificacoes);
document.addEventListener("keydown", e => { if (e.key === "Escape") fecharPainelNotificacoes(); });

setInterval(() => { if (!document.hidden) carregarNotificacoes(); }, INTERVALO_ATUALIZACAO);
document.addEventListener("visibilitychange", () => { if (!document.hidden) carregarNotificacoes(); });

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

// ── Helpers ───────────────────────────────────────────────
function formatDate(str) {
  if (!str) return "";
  // Aceita "aaaa-mm-dd", ISO com "T" e o formato do Postgres ("aaaa-mm-dd hh:mm:ss-03").
  const d = str.length <= 10 ? new Date(str + "T00:00:00") : new Date(str.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (isNaN(d)) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function labelStatus(s) {
  return { pendente: "Pendente", "em andamento": "Em andamento", concluida: "Concluída" }[s] || s;
}

function labelUrgencia(u) {
  return { alta: "🔴 Alta", media: "🟡 Média", baixa: "🔵 Baixa" }[u] || u;
}

// ── Modal de confirmação (substitui o confirm() nativo) ───
const confirmOverlay = document.getElementById("modal-confirm-overlay");
let confirmResolver = null;

function showConfirm(message, { title = "Confirmar exclusão", confirmLabel = "Excluir" } = {}) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-message").textContent = message;
  document.getElementById("btn-confirm-ok").textContent = confirmLabel;
  confirmOverlay.classList.remove("hidden");
  return new Promise(resolve => { confirmResolver = resolve; });
}

function resolveConfirm(result) {
  confirmOverlay.classList.add("hidden");
  if (confirmResolver) { confirmResolver(result); confirmResolver = null; }
}

document.getElementById("btn-confirm-ok").addEventListener("click", () => resolveConfirm(true));
document.getElementById("btn-confirm-cancel").addEventListener("click", () => resolveConfirm(false));
confirmOverlay.addEventListener("click", e => { if (e.target === confirmOverlay) resolveConfirm(false); });

// ── Fechar modais com Esc ──────────────────────────────────
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!confirmOverlay.classList.contains("hidden")) {
    resolveConfirm(false);
  } else if (!document.getElementById("modal-create-overlay").classList.contains("hidden")) {
    closeCreateModal();
  } else if (!modalDetail.classList.contains("hidden")) {
    closeDetail();
  } else if (!document.getElementById("modal-admin-tarefa-overlay").classList.contains("hidden")) {
    closeAdminTarefaModal();
  } else if (!document.getElementById("modal-admin-usuario-overlay").classList.contains("hidden")) {
    closeAdminUsuarioModal();
  } else if (!document.getElementById("modal-equipe-overlay").classList.contains("hidden")) {
    closeEquipeModal();
  } else if (!document.getElementById("modal-grupo-overlay").classList.contains("hidden")) {
    closeGrupoModal();
  } else if (!document.getElementById("modal-colunas-overlay").classList.contains("hidden")) {
    closeColunasModal();
  }
});

// ── Tab: prender o foco dentro do modal aberto ─────────────
document.addEventListener("keydown", e => {
  if (e.key !== "Tab") return;
  const overlays = document.querySelectorAll(".modal-overlay:not(.hidden)");
  if (overlays.length === 0) return;
  // A confirmação fica por cima de todas; nas demais, a última no DOM é a de cima.
  const overlay = !confirmOverlay.classList.contains("hidden") ? confirmOverlay : overlays[overlays.length - 1];

  const focusables = Array.from(
    overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter(el => !el.disabled && el.offsetParent !== null);
  if (focusables.length === 0) return;

  const first = focusables[0];
  const last  = focusables[focusables.length - 1];
  const dentro = overlay.contains(document.activeElement);

  if (e.shiftKey) {
    if (!dentro || document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (!dentro || document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

// ── Atalho "N": abrir Nova Tarefa ──────────────────────────
document.addEventListener("keydown", e => {
  if (e.key !== "n" && e.key !== "N") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!document.getElementById("app").classList.contains("visible")) return;

  const active = document.activeElement;
  const tag = active?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active?.isContentEditable) return;

  const anyModalOpen = document.querySelectorAll(".modal-overlay:not(.hidden)").length > 0;
  if (anyModalOpen) return;

  e.preventDefault();
  openCreateModal();
});

function toast(msg, error = false) {
  const c  = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className   = `toast ${error ? "error" : ""}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

// Ajusta a altura da textarea pro tamanho do conteúdo (mínimo do CSS até
// maxHeight); zera pra "auto" antes de medir scrollHeight, senão o navegador
// mede contra a altura antiga em vez do conteúdo atual. Só liga overflow-y
// quando realmente precisa cortar (scrollHeight > maxHeight) -- deixar
// "auto" sempre ligado faz o navegador reservar a barra mesmo sem conteúdo
// suficiente pra rolar.
function autoGrowTextarea(el, maxHeight) {
  el.style.height = "auto";
  const precisa = el.scrollHeight > maxHeight;
  el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  el.style.overflowY = precisa ? "auto" : "hidden";
}

// ── Init ──────────────────────────────────────────────────
boot();