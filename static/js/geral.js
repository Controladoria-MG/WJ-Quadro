/* Quadro — Utilitários, confirmação, teclado e início (boot). */

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

// `botao` ({ rotulo, acao }) acrescenta uma ação ao aviso, como "Desfazer".
function toast(msg, error = false, botao = null) {
  const c  = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className   = `toast ${error ? "error" : ""}`;
  el.textContent = msg;
  if (botao) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-acao";
    b.textContent = botao.rotulo;
    b.onclick = () => { el.remove(); botao.acao(); };
    el.appendChild(b);
  }
  c.appendChild(el);
  setTimeout(() => el.remove(), botao ? PRAZO_DESFAZER : 3000);
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
