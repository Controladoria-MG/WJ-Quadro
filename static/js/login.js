/* Quadro — Avatar, login, entrar e sair, foto de perfil. */

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
  document.getElementById("nav-admin").classList.add("hidden");   // acessado por Configurações
  renderFiltroUsuarios();
  renderBoard();
  carregarNotificacoes();
  aceitarConvitePendente();
}

document.getElementById("btn-logout").addEventListener("click", logout);

function logout() {
  enviarExclusoesPendentes();
  state.current      = null;
  state.filtroUsuario = null;
  state.tarefas      = [];
  state.arquivadas   = null;
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
    if (configVisivel()) renderConfig();
    toast(fotoPerfil ? "Foto de perfil atualizada." : "Foto de perfil removida.");
  } catch (err) {
    toast(err.message, true);
  }
}
