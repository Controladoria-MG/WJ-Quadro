/* Quadro — Estado, tema, chamadas à API e datas. */

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
applyAccent(localStorage.getItem("accent") || "blue");   // padrão: azul

// ── Modo claro / escuro ───────────────────────────────────
// "auto" segue o modo do sistema operacional e acompanha se ele mudar.
const temaDoSistema = window.matchMedia("(prefers-color-scheme: light)");
function aplicarModoTema(modo) {
  try { localStorage.setItem("tema", modo); } catch (e) {}
  const efetivo = modo === "auto" ? (temaDoSistema.matches ? "claro" : "escuro") : modo;
  document.documentElement.setAttribute("data-tema", efetivo);
}
temaDoSistema.addEventListener("change", () => {
  let modo = "escuro";
  try { modo = localStorage.getItem("tema") || "escuro"; } catch (e) {}
  if (modo === "auto") aplicarModoTema("auto");
});
(() => {
  let modo = "escuro";
  try { modo = localStorage.getItem("tema") || "escuro"; } catch (e) {}
  aplicarModoTema(modo);
})();

let state = {
  users:        [],
  tarefas:      [],
  equipes:      [],
  equipeAtual:  null,
  current:      null,
  filtroUsuario: null,
  filtroConcluidoUsuario:  null,
  filtroConcluidoPeriodo:  "todos",
  arquivadas:   null,        // concluídas há mais de 6 meses, só depois de pedir
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
  getArquivadas:   ()         => apiFetch("GET",    "/api/tarefas?arquivadas=true"),
  criarTarefa:     (t)        => apiFetch("POST",   "/api/tarefas", t),
  atualizarTarefa: (id, t)    => apiFetch("PUT",    `/api/tarefas/${id}`, t),
  patchTarefa:     async (id, body) => {
    const r = await apiFetch("PATCH", `/api/tarefas/${id}`, body);
    aoAlterarTarefa(id);
    return r;
  },
  criarEtapa:      async (id, texto) => {
    const r = await apiFetch("POST", `/api/tarefas/${id}/etapas`, { texto });
    aoAlterarTarefa(id);
    return r;
  },
  editarEtapa:     async (id, etapaId, campos) => {
    const r = await apiFetch("PATCH", `/api/tarefas/${id}/etapas/${etapaId}`, campos);
    aoAlterarTarefa(id);
    return r;
  },
  excluirEtapa:    async (id, etapaId) => {
    const r = await apiFetch("DELETE", `/api/tarefas/${id}/etapas/${etapaId}`);
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
  deletarEquipe:   (id, comTarefas = false) => apiFetch("DELETE", `/api/equipes/${id}${comTarefas ? "?com_tarefas=true" : ""}`),
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
