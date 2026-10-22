/* Quadro — Configurações. */

// ── Configurações ─────────────────────────────────────────
// Tudo o que é ajuste fica nesta tela, para o quadro ficar limpo:
// aparência, perfil, equipes (membros/colunas) e administração.
const CORES_DESTAQUE = [
  ["green", "#22c55e", "Verde"], ["blue", "#3b82f6", "Azul"], ["purple", "#8b5cf6", "Roxo"],
  ["orange", "#f97316", "Laranja"], ["pink", "#ec4899", "Rosa"], ["red", "#dc2626", "Vermelho"],
];

function configVisivel() {
  return document.getElementById("config-screen").classList.contains("visible");
}

function fecharConfig() {
  document.getElementById("config-screen").classList.remove("visible");
  document.getElementById("nav-config").classList.remove("active");
  document.getElementById("main").classList.remove("modo-config");
}

function abrirConfig() {
  esconderQuadro();
  fecharMinhas();
  document.getElementById("filtro-usuario-bar")?.classList.add("hidden");
  document.getElementById("concluded-screen").classList.remove("visible");
  document.getElementById("admin-screen").classList.remove("visible");
  document.getElementById("dashboard-screen").classList.remove("visible");
  document.getElementById("nav-dashboard").classList.remove("active");
  document.getElementById("main").classList.remove("modo-dashboard");
  document.getElementById("config-screen").classList.add("visible");
  document.getElementById("nav-config").classList.add("active");
  document.getElementById("main").classList.add("modo-config");
  renderNavEquipes();
  renderConfig();
}

function cartaoConfig(titulo, descricao) {
  const sec = document.createElement("section");
  sec.className = "config-cartao";
  sec.innerHTML = `<h3></h3><p class="config-desc"></p><div class="config-conteudo"></div>`;
  sec.querySelector("h3").textContent = titulo;
  sec.querySelector(".config-desc").textContent = descricao;
  return sec;
}

function linhaConfig(rotulo, controle) {
  const linha = document.createElement("div");
  linha.className = "config-linha";
  linha.innerHTML = `<span class="config-rotulo"></span><div class="config-controle"></div>`;
  linha.querySelector(".config-rotulo").textContent = rotulo;
  linha.querySelector(".config-controle").appendChild(controle);
  return linha;
}

function renderConfig() {
  const body = document.getElementById("config-body");
  body.innerHTML = "";
  if (!state.current) return;

  // ── Aparência
  const aparencia = cartaoConfig("Aparência", "Valem só para este navegador.");
  const ca = aparencia.querySelector(".config-conteudo");

  const modo = document.createElement("div");
  modo.className = "visao-toggle";
  [["escuro", "Escuro"], ["claro", "Claro"], ["auto", "Automático"]].forEach(([v, rotulo]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = rotulo;
    b.classList.toggle("active", lerPreferencia("tema", "escuro") === v);
    if (v === "auto") b.title = "Segue o modo claro ou escuro do Windows";
    b.onclick = () => { aplicarModoTema(v); renderConfig(); };
    modo.appendChild(b);
  });
  ca.appendChild(linhaConfig("Modo", modo));

  const cores = document.createElement("div");
  cores.className = "theme-swatches config-cores";
  const atual = document.documentElement.getAttribute("data-accent") || "blue";
  CORES_DESTAQUE.forEach(([id, hex, nome]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "theme-swatch" + (id === atual ? " selected" : "");
    b.dataset.accent = id;
    b.style.background = hex;
    b.title = nome;
    b.setAttribute("aria-label", nome);
    b.onclick = () => applyAccent(id);
    cores.appendChild(b);
  });
  ca.appendChild(linhaConfig("Cor de destaque", cores));

  const recolhida = document.createElement("label");
  recolhida.className = "checkbox-row";
  recolhida.innerHTML = `<input type="checkbox" /> Começar com a barra lateral recolhida`;
  const chk = recolhida.querySelector("input");
  chk.checked = document.getElementById("app").classList.contains("sidebar-recolhida");
  chk.onchange = () => {
    aplicarSidebarRecolhida(chk.checked);
    salvarPreferencia("sidebarRecolhida", chk.checked ? "1" : "");
  };
  ca.appendChild(linhaConfig("Barra lateral", recolhida));

  const compacto = document.createElement("label");
  compacto.className = "checkbox-row";
  compacto.innerHTML = `<input type="checkbox" /> Mostrar só o essencial em cada card`;
  const chkCompacto = compacto.querySelector("input");
  chkCompacto.checked = lerPreferencia("cardsCompactos", "") === "1";
  chkCompacto.onchange = () => {
    aplicarCardsCompactos(chkCompacto.checked);
    salvarPreferencia("cardsCompactos", chkCompacto.checked ? "1" : "");
  };
  ca.appendChild(linhaConfig("Cards compactos", compacto));

  const visao = document.createElement("select");
  visao.className = "ordenacao-sel";
  visao.innerHTML = opcoesHTML([["quadro", "Quadro"], ["tabela", "Tabela"], ["calendario", "Calendário"]], state.visao);
  visao.onchange = () => { state.visao = visao.value; salvarPreferencia("visao", visao.value); };
  ca.appendChild(linhaConfig("Visão ao abrir uma equipe", visao));
  body.appendChild(aparencia);

  // ── Meu perfil
  const perfil = cartaoConfig("Meu perfil", "Como você aparece para as outras pessoas.");
  const cp = perfil.querySelector(".config-conteudo");
  const eu = state.current;
  cp.innerHTML = `
    <div class="config-perfil">
      <div class="config-perfil-foto">${avatarHTML(eu)}</div>
      <div class="config-perfil-acoes">
        <button type="button" class="btn btn-ghost btn-sm" data-acao="foto">${eu.fotoPerfil ? "Trocar foto" : "Adicionar foto"}</button>
        ${eu.fotoPerfil ? `<button type="button" class="btn btn-ghost btn-sm" data-acao="remover">Remover foto</button>` : ""}
      </div>
    </div>
    <div class="config-campos">
      <div class="form-group"><label class="form-label">Nome</label><input type="text" data-campo="nome" /></div>
      <div class="form-group"><label class="form-label">Cargo</label><input type="text" data-campo="cargo" /></div>
      <div class="form-group config-iniciais"><label class="form-label">Iniciais</label><input type="text" data-campo="avatar" maxlength="3" /></div>
    </div>
    <div class="config-salvar"><button type="button" class="btn btn-primary btn-sm" data-acao="salvar">Salvar perfil</button></div>`;
  cp.querySelector('[data-campo="nome"]').value = eu.nome;
  cp.querySelector('[data-campo="cargo"]').value = eu.cargo || "";
  cp.querySelector('[data-campo="avatar"]').value = eu.avatar || "";
  cp.querySelector('[data-acao="foto"]').onclick = () => document.getElementById("sb-user-foto-input").click();
  const remover = cp.querySelector('[data-acao="remover"]');
  if (remover) remover.onclick = async () => { await salvarFotoPerfilAtual(null); renderConfig(); };
  cp.querySelector('[data-acao="salvar"]').onclick = async () => {
    const nome = cp.querySelector('[data-campo="nome"]').value.trim();
    if (!nome) { toast("Informe o seu nome.", true); return; }
    try {
      const atualizado = await api.atualizarUsuario(eu.id, {
        nome,
        cargo:      cp.querySelector('[data-campo="cargo"]').value.trim() || "Colaborador",
        avatar:     cp.querySelector('[data-campo="avatar"]').value.trim().toUpperCase() || null,
        isAdmin:    eu.isAdmin,
        fotoPerfil: eu.fotoPerfil,
      });
      state.current = atualizado;
      const i = state.users.findIndex(u => u.id === atualizado.id);
      if (i !== -1) state.users[i] = atualizado;
      document.getElementById("sb-user-name").textContent  = atualizado.nome;
      document.getElementById("sb-user-cargo").textContent = atualizado.cargo;
      setAvatarEl(document.getElementById("sb-user-avatar"), atualizado);
      renderConfig();
      toast("Perfil atualizado.");
    } catch (err) {
      toast(err.message, true);
    }
  };
  body.appendChild(perfil);

  // ── Equipes e grupos
  const equipes = cartaoConfig("Equipes e grupos", "Membros de cada equipe. As colunas são ajustadas direto no quadro.");
  const ce = equipes.querySelector(".config-conteudo");
  const novo = document.createElement("button");
  novo.type = "button";
  novo.className = "btn btn-ghost btn-sm config-novo-grupo";
  novo.textContent = "+ Novo grupo";
  novo.onclick = openGrupoModal;
  ce.appendChild(novo);
  if (state.equipes.length === 0) {
    ce.insertAdjacentHTML("beforeend", `<div class="dash-vazio">Você ainda não participa de nenhuma equipe.</div>`);
  }
  state.equipes.forEach(eq => {
    const gestor = souGestorDaEquipe(eq);
    const minhaParticipacao = eq.membros.find(m => m.usuarioId === eu.id);
    const papel = minhaParticipacao ? (minhaParticipacao.papel === "admin" ? "Admin da equipe" : "Membro") : "Administrador geral";
    const linha = document.createElement("div");
    linha.className = "config-equipe";
    linha.innerHTML = `
      <div class="config-equipe-info">
        <strong></strong>
        <span>${plural(eq.membros.length, "membro", "membros")} · ${plural(eq.colunas.length, "coluna", "colunas")} · ${papel}</span>
      </div>
      <div class="config-equipe-acoes">
        <button type="button" class="btn btn-ghost btn-sm" data-acao="membros">${gestor ? "Membros" : "Ver membros"}</button>
        ${gestor ? `<button type="button" class="btn btn-danger btn-sm" data-acao="excluir">Excluir</button>` : ""}
      </div>`;
    linha.querySelector("strong").textContent = eq.nome;
    const usarEquipe = () => {
      state.equipeAtual = eq.id;
      salvarPreferencia("equipeAtual", String(eq.id));
    };
    linha.querySelector('[data-acao="membros"]').onclick = () => { usarEquipe(); openEquipeModal(); };
    const btnExcluir = linha.querySelector('[data-acao="excluir"]');
    if (btnExcluir) btnExcluir.onclick = () => excluirEquipe(eq);
    ce.appendChild(linha);
  });
  body.appendChild(equipes);

  // ── Administração
  if (eu.isAdmin) {
    const admin = cartaoConfig("Administração", "Edição direta de todas as tarefas e usuários do Quadro.");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-ghost btn-sm";
    b.textContent = "Abrir Gerenciador de Base";
    b.onclick = () => { fecharConfig(); document.getElementById("nav-admin").click(); };
    admin.querySelector(".config-conteudo").appendChild(b);
    body.appendChild(admin);
  }

  // ── Sobre
  const sobre = cartaoConfig("Sobre o Quadro", "");
  sobre.querySelector(".config-desc").remove();
  sobre.querySelector(".config-conteudo").innerHTML = `
    <div class="sobre-quadro">
      <svg class="logo-jw" aria-hidden="true"><use href="#logo-jw"/></svg>
      <p>Desenvolvido por Willian Arruda e Juan Rodrigues</p>
    </div>`;
  body.appendChild(sobre);
}

document.getElementById("nav-config").addEventListener("click", abrirConfig);
