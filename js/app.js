import {
  configureAuthPersistence,
  friendlyAuthError,
  login,
  logout,
  observeAuth,
  resetPassword
} from "./auth.js";

import {
  createInvite,
  createProject,
  getProjectMembers,
  joinProjectByInvite,
  loadActiveProject,
  updateProject
} from "./data.js";

const $ = (selector) => document.querySelector(selector);

const authView = $("#authView");
const setupView = $("#setupView");
const appView = $("#appView");
const loginForm = $("#loginForm");
const emailInput = $("#email");
const passwordInput = $("#password");
const loginButton = $("#loginButton");
const togglePassword = $("#togglePassword");
const forgotPassword = $("#forgotPassword");
const logoutButton = $("#logoutButton");
const setupLogoutButton = $("#setupLogoutButton");
const profileButton = $("#profileButton");
const moreButton = $("#moreButton");
const openQuickAdd = $("#openQuickAdd");
const quickAddModal = $("#quickAddModal");
const moreModal = $("#moreModal");
const projectModal = $("#projectModal");
const projectSettingsButton = $("#projectSettingsButton");
const inviteSuccessModal = $("#inviteSuccessModal");
const toast = $("#toast");
const welcomeText = $("#welcomeText");
const avatarInitial = $("#avatarInitial");

const createTab = $("#createTab");
const joinTab = $("#joinTab");
const createProjectForm = $("#createProjectForm");
const joinProjectForm = $("#joinProjectForm");
const createProjectButton = $("#createProjectButton");
const joinProjectButton = $("#joinProjectButton");
const createdInviteCode = $("#createdInviteCode");
const copyInviteButton = $("#copyInviteButton");
const continueAfterInvite = $("#continueAfterInvite");

const projectSettingsForm = $("#projectSettingsForm");
const newInviteForm = $("#newInviteForm");
const membersList = $("#membersList");
const membersSummary = $("#membersSummary");

let currentUser = null;
let currentProject = null;
let currentMembers = [];
let toastTimer;

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

function currency(value) {
  return brl.format(Number(value) || 0);
}

function dateBR(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function showToast(message, type = "default") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show ${type === "default" ? "" : type}`.trim();

  toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 3400);
}

function setLoginLoading(isLoading) {
  loginButton.disabled = isLoading;
  loginButton.querySelector("span:first-child").textContent = isLoading ? "Entrando..." : "Entrar";
}

function setButtonLoading(button, isLoading, normalText, loadingText = "Salvando...") {
  if (!button) return;
  button.disabled = isLoading;
  const firstSpan = button.querySelector("span:first-child");
  if (firstSpan) firstSpan.textContent = isLoading ? loadingText : normalText;
  else button.textContent = isLoading ? loadingText : normalText;
}

function displayNameFor(user) {
  if (user?.displayName) return user.displayName.split(" ")[0];

  const emailPrefix = user?.email?.split("@")[0] || "vocês";
  const cleaned = emailPrefix.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return "vocês";

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function hideAllMainViews() {
  authView.classList.add("hidden");
  setupView.classList.add("hidden");
  appView.classList.add("hidden");
}

function showLogin() {
  hideAllMainViews();
  authView.classList.remove("hidden");
  passwordInput.value = "";
}

function showSetup() {
  hideAllMainViews();
  setupView.classList.remove("hidden");
}

function showApp() {
  hideAllMainViews();
  appView.classList.remove("hidden");
}

function openModal(modal) {
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.add("hidden");

  const anyOpen = [...document.querySelectorAll(".modal-layer")].some(
    element => !element.classList.contains("hidden")
  );

  if (!anyOpen) document.body.style.overflow = "";
}

function renderIdentity(user) {
  const firstName = displayNameFor(user);
  welcomeText.textContent = `Olá, ${firstName}!`;
  avatarInitial.textContent = firstName.charAt(0).toUpperCase();
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderContributions(members) {
  const container = $("#contributionGrid");

  if (!members.length) {
    container.innerHTML = `<div class="empty-mini">Os aportes aparecerão aqui quando cadastrarmos pagamentos e reservas.</div>`;
    return;
  }

  container.innerHTML = members.slice(0, 2).map((member, index) => {
    const name = member.displayName || member.email?.split("@")[0] || (index === 0 ? "Você" : "Membro");
    const initials = name.charAt(0).toUpperCase();
    const tone = index === 0 ? "blue" : "rose";

    return `
      <article class="person-card">
        <div class="person-top">
          <div class="mini-avatar ${tone}">${escapeHtml(initials)}</div>
          <div>
            <strong>${escapeHtml(name)}</strong>
            <span>R$ 0,00</span>
          </div>
          <b>0%</b>
        </div>
        <div class="mini-progress ${index === 1 ? "rose-bar" : ""}"><i style="width:0%"></i></div>
      </article>
    `;
  }).join("");
}

function renderProject(project, members = []) {
  currentProject = project;
  currentMembers = members;

  const propertyValue = Number(project.propertyValue) || 0;
  const additionalCosts = 0;
  const employedCapital = 0;
  const realCost = propertyValue + additionalCosts;
  const progress = realCost > 0 ? Math.min(100, employedCapital / realCost * 100) : 0;

  $("#propertyName").textContent = project.name || "Nosso imóvel";
  $("#propertySubtitle").textContent = project.purchaseDate
    ? `Aquisição iniciada em ${dateBR(project.purchaseDate)}`
    : "Projeto financeiro da aquisição";

  $("#realProjectCost").textContent = currency(realCost);
  $("#propertyValueMetric").textContent = currency(propertyValue);
  $("#additionalCostsMetric").textContent = currency(additionalCosts);
  $("#employedCapitalMetric").textContent = currency(employedCapital);

  $("#financialProgressBadge").textContent = `${progress.toFixed(1).replace(".", ",")}%`;
  $("#financialProgressFill").style.width = `${progress}%`;
  $("#financialProgressTrack").setAttribute("aria-valuenow", progress.toFixed(1));
  $("#financialProgressPaid").textContent = `${currency(employedCapital)} empregados`;
  $("#financialProgressTotal").textContent = `de ${currency(realCost)}`;

  renderContributions(members);
}

async function loadUserWorkspace(user) {
  try {
    const result = await loadActiveProject(user);

    if (!result.project) {
      currentProject = null;
      currentMembers = [];
      showSetup();
      return;
    }

    renderProject(result.project, result.members);
    showApp();
  } catch (error) {
    console.error(error);
    showToast("Não foi possível carregar o projeto. Confira as regras do Firestore.", "error");
    showSetup();
  }
}

function setSetupMode(mode) {
  const createMode = mode === "create";

  createTab.classList.toggle("active", createMode);
  joinTab.classList.toggle("active", !createMode);
  createProjectForm.classList.toggle("hidden", !createMode);
  joinProjectForm.classList.toggle("hidden", createMode);
}

function renderProjectMembers(members) {
  membersSummary.textContent = `${members.length} ${members.length === 1 ? "pessoa vinculada" : "pessoas vinculadas"}`;

  membersList.innerHTML = members.map((member, index) => {
    const name = member.displayName || member.email?.split("@")[0] || "Membro";
    const role = member.role === "owner" ? "Criador do projeto" : "Membro";
    return `
      <div class="member-row">
        <div class="mini-avatar ${index % 2 === 0 ? "blue" : "rose"}">${escapeHtml(name.charAt(0).toUpperCase())}</div>
        <div>
          <strong>${escapeHtml(name)}</strong>
          <span>${escapeHtml(member.email || "")}</span>
        </div>
        <small>${role}</small>
      </div>
    `;
  }).join("");
}

function fillProjectSettings() {
  if (!currentProject) return;

  $("#settingsProjectName").value = currentProject.name || "";
  $("#settingsPropertyValue").value = Number(currentProject.propertyValue) || "";
  $("#settingsPurchaseDate").value = currentProject.purchaseDate || "";
  renderProjectMembers(currentMembers);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoginLoading(true);

  try {
    await login(emailInput.value, passwordInput.value);
    showToast("Acesso realizado com sucesso.", "success");
  } catch (error) {
    showToast(friendlyAuthError(error), "error");
  } finally {
    setLoginLoading(false);
  }
});

togglePassword.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  togglePassword.setAttribute("aria-label", isPassword ? "Ocultar senha" : "Mostrar senha");
});

forgotPassword.addEventListener("click", async () => {
  try {
    await resetPassword(emailInput.value);
    showToast("E-mail de redefinição enviado.", "success");
  } catch (error) {
    showToast(friendlyAuthError(error), "error");
  }
});

async function doLogout() {
  try {
    await logout();
    [moreModal, projectModal, quickAddModal].forEach(modal => closeModal(modal));
    showToast("Sessão encerrada.");
  } catch (error) {
    showToast("Não foi possível sair agora.", "error");
  }
}

logoutButton.addEventListener("click", doLogout);
setupLogoutButton.addEventListener("click", doLogout);

createTab.addEventListener("click", () => setSetupMode("create"));
joinTab.addEventListener("click", () => setSetupMode("join"));

createProjectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;

  setButtonLoading(createProjectButton, true, "Criar nosso projeto", "Criando...");

  try {
    const result = await createProject({
      name: $("#projectNameInput").value,
      propertyValue: $("#propertyValueInput").value,
      purchaseDate: $("#purchaseDateInput").value,
      partnerEmail: $("#partnerEmailInput").value
    }, currentUser);

    currentProject = result.project;
    currentMembers = await getProjectMembers(currentProject.id);
    renderProject(currentProject, currentMembers);
    showApp();

    if (result.inviteCode) {
      createdInviteCode.textContent = result.inviteCode;
      openModal(inviteSuccessModal);
    } else {
      showToast("Projeto criado. Agora podemos começar a estruturar os contratos.", "success");
    }
  } catch (error) {
    console.error(error);
    showToast(error?.message || "Não foi possível criar o projeto.", "error");
  } finally {
    setButtonLoading(createProjectButton, false, "Criar nosso projeto");
  }
});

joinProjectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;

  setButtonLoading(joinProjectButton, true, "Entrar no projeto", "Entrando...");

  try {
    const project = await joinProjectByInvite($("#inviteCodeInput").value, currentUser);
    const members = await getProjectMembers(project.id);
    renderProject(project, members);
    showApp();
    showToast("Vocês agora estão conectados ao mesmo projeto.", "success");
  } catch (error) {
    console.error(error);
    showToast(error?.message || "Não foi possível aceitar o convite.", "error");
  } finally {
    setButtonLoading(joinProjectButton, false, "Entrar no projeto");
  }
});

copyInviteButton.addEventListener("click", async () => {
  const code = createdInviteCode.textContent.trim();
  if (!code || code === "—") return;

  try {
    await navigator.clipboard.writeText(code);
    showToast("Código copiado.", "success");
  } catch {
    showToast(`Código: ${code}`);
  }
});

continueAfterInvite.addEventListener("click", () => closeModal(inviteSuccessModal));

projectSettingsButton.addEventListener("click", () => {
  fillProjectSettings();
  closeModal(moreModal);
  openModal(projectModal);
});

projectSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentProject) return;

  const submit = event.submitter;
  setButtonLoading(submit, true, "Salvar alterações");

  try {
    currentProject = await updateProject(currentProject.id, {
      name: $("#settingsProjectName").value.trim(),
      propertyValue: Number($("#settingsPropertyValue").value) || 0,
      purchaseDate: $("#settingsPurchaseDate").value || null
    });

    renderProject(currentProject, currentMembers);
    showToast("Dados do projeto atualizados.", "success");
  } catch (error) {
    console.error(error);
    showToast("Não foi possível atualizar o projeto.", "error");
  } finally {
    setButtonLoading(submit, false, "Salvar alterações");
  }
});

newInviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentProject || !currentUser) return;

  const submit = event.submitter;
  setButtonLoading(submit, true, "Gerar código de convite", "Gerando...");

  try {
    const code = await createInvite(
      currentProject.id,
      $("#newInviteEmail").value,
      currentUser.uid
    );

    createdInviteCode.textContent = code;
    closeModal(projectModal);
    openModal(inviteSuccessModal);
    $("#newInviteEmail").value = "";
  } catch (error) {
    console.error(error);
    showToast("Não foi possível gerar o convite.", "error");
  } finally {
    setButtonLoading(submit, false, "Gerar código de convite");
  }
});

openQuickAdd.addEventListener("click", () => openModal(quickAddModal));
moreButton.addEventListener("click", () => openModal(moreModal));
profileButton.addEventListener("click", () => openModal(moreModal));

document.querySelectorAll("[data-close-modal]").forEach((button) => {
  button.addEventListener("click", () => {
    const modal = button.closest(".modal-layer");
    if (modal) closeModal(modal);
  });
});

document.querySelectorAll("[data-coming-soon]").forEach((button) => {
  button.addEventListener("click", () => {
    showToast("Essa função entra na próxima etapa.");
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  [quickAddModal, moreModal, projectModal, inviteSuccessModal].forEach((modal) => {
    if (modal && !modal.classList.contains("hidden")) closeModal(modal);
  });
});

async function boot() {
  try {
    await configureAuthPersistence();
  } catch (error) {
    console.warn("Não foi possível definir a persistência de autenticação.", error);
  }

  observeAuth(async (user) => {
    currentUser = user;

    if (!user) {
      currentProject = null;
      currentMembers = [];
      showLogin();
      return;
    }

    renderIdentity(user);
    await loadUserWorkspace(user);
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        await navigator.serviceWorker.register("./sw.js");
      } catch (error) {
        console.warn("Service Worker não registrado.", error);
      }
    });
  }
}

boot();
