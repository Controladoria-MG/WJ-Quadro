/* Quadro — Desfazer, comentários, histórico e notificações. */

// ── Excluir e concluir com "Desfazer" ─────────────────────
// A exclusão só vai ao servidor depois do prazo do aviso; até lá a tarefa
// some da tela e "Desfazer" a devolve. Ao sair da página, o que estiver
// pendente é enviado na hora.
const PRAZO_DESFAZER = 6000;
const exclusoesPendentes = new Map();

function redesenharTarefas() {
  renderBoard();
  if (document.getElementById("concluded-screen").classList.contains("visible")) renderConcluded();
}

function excluirTarefa(t) {
  state.tarefas = state.tarefas.filter(x => x.id !== t.id);
  redesenharTarefas();
  const timer = setTimeout(() => efetivarExclusao(t.id), PRAZO_DESFAZER);
  exclusoesPendentes.set(t.id, { t, timer });
  toast("Tarefa excluída.", false, {
    rotulo: "Desfazer",
    acao: () => {
      const pendente = exclusoesPendentes.get(t.id);
      if (!pendente) return;
      clearTimeout(pendente.timer);
      exclusoesPendentes.delete(t.id);
      state.tarefas.push(t);
      redesenharTarefas();
    },
  });
}

async function efetivarExclusao(id) {
  const pendente = exclusoesPendentes.get(id);
  if (!pendente) return;
  exclusoesPendentes.delete(id);
  try {
    await api.deletarTarefa(id);
  } catch (err) {
    state.tarefas.push(pendente.t);
    redesenharTarefas();
    toast(err.message, true);
  }
}

function enviarExclusoesPendentes() {
  exclusoesPendentes.forEach(({ timer }, id) => {
    clearTimeout(timer);
    fetch(`${API}/api/tarefas/${id}`, { method: "DELETE", keepalive: true });
  });
  exclusoesPendentes.clear();
}
window.addEventListener("pagehide", enviarExclusoesPendentes);

// Aviso de conclusão com "Desfazer", que devolve os campos de antes.
function avisarConclusao(t, anterior) {
  toast("Tarefa concluída.", false, {
    rotulo: "Desfazer",
    acao: async () => {
      const campos = camposConclusao(anterior);
      Object.assign(t, campos);
      redesenharTarefas();
      try {
        Object.assign(t, await api.patchTarefa(t.id, campos));
        redesenharTarefas();
      } catch (err) {
        toast(err.message, true);
      }
    },
  });
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
  let diaAnterior = null;
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
      preencherComLinks(texto, item.texto);
      corpo.appendChild(texto);
    }
    const dia = rotuloDoDia(item.criadoEm);
    if (dia !== diaAnterior) {
      const cab = document.createElement("div");
      cab.className = "atividade-dia";
      cab.textContent = dia;
      list.appendChild(cab);
      diaAnterior = dia;
    }
    list.appendChild(el);
  });
}

function rotuloDoDia(iso) {
  const dia = todayStr(new Date(iso));
  if (dia === todayStr()) return "Hoje";
  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  if (dia === todayStr(ontem)) return "Ontem";
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

// Escreve o texto em `el` com os endereços (http/https) virando links.
// Monta os nós um a um, sem innerHTML, para não abrir brecha de XSS.
const REGEX_LINK = /\bhttps?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]]/g;
function preencherComLinks(el, texto) {
  el.textContent = "";
  let ultimo = 0;
  for (const m of texto.matchAll(REGEX_LINK)) {
    el.append(texto.slice(ultimo, m.index));
    const a = document.createElement("a");
    a.href = m[0];
    a.textContent = m[0];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.addEventListener("click", e => e.stopPropagation());
    el.append(a);
    ultimo = m.index + m[0].length;
  }
  el.append(texto.slice(ultimo));
}

function linksDoTexto(texto) {
  return [...new Set((texto || "").match(REGEX_LINK) || [])];
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
  document.title = n > 0 ? `(${n}) Quadro` : "Quadro";
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
