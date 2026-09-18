import {
  configureAuthPersistence,
  friendlyAuthError,
  login,
  logout,
  observeAuth,
  resetPassword
} from "./auth.js";

const authView = document.querySelector("#authView");
const appView = document.querySelector("#appView");
const loginForm = document.querySelector("#loginForm");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const loginButton = document.querySelector("#loginButton");
const togglePassword = document.querySelector("#togglePassword");
const forgotPassword = document.querySelector("#forgotPassword");
const logoutButton = document.querySelector("#logoutButton");
const profileButton = document.querySelector("#profileButton");
const moreButton = document.querySelector("#moreButton");
const openQuickAdd = document.querySelector("#openQuickAdd");
const quickAddModal = document.querySelector("#quickAddModal");
const moreModal = document.querySelector("#moreModal");
const toast = document.querySelector("#toast");
const welcomeText = document.querySelector("#welcomeText");
const avatarInitial = document.querySelector("#avatarInitial");

let toastTimer;

function showToast(message, type = "default") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show ${type === "default" ? "" : type}`.trim();

  toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 3200);
}

function setLoading(isLoading) {
  loginButton.disabled = isLoading;
  loginButton.querySelector("span:first-child").textContent = isLoading ? "Entrando..." : "Entrar";
}

function displayNameFor(user) {
  if (user?.displayName) return user.displayName.split(" ")[0];

  const emailPrefix = user?.email?.split("@")[0] || "vocês";
  const cleaned = emailPrefix.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return "vocês";

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function showApp(user) {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");

  const firstName = displayNameFor(user);
  welcomeText.textContent = `Olá, ${firstName}!`;
  avatarInitial.textContent = firstName.charAt(0).toUpperCase();
}

function showLogin() {
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
  passwordInput.value = "";
}

function openModal(modal) {
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal(modal) {
  modal.classList.add("hidden");

  const anyOpen = [...document.querySelectorAll(".modal-layer")].some(
    element => !element.classList.contains("hidden")
  );

  if (!anyOpen) document.body.style.overflow = "";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoading(true);

  try {
    await login(emailInput.value, passwordInput.value);
    showToast("Acesso realizado com sucesso.", "success");
  } catch (error) {
    showToast(friendlyAuthError(error), "error");
  } finally {
    setLoading(false);
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

logoutButton.addEventListener("click", async () => {
  try {
    await logout();
    closeModal(moreModal);
    showToast("Sessão encerrada.");
  } catch (error) {
    showToast("Não foi possível sair agora.", "error");
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
  [quickAddModal, moreModal].forEach((modal) => {
    if (!modal.classList.contains("hidden")) closeModal(modal);
  });
});

async function boot() {
  try {
    await configureAuthPersistence();
  } catch (error) {
    console.warn("Não foi possível definir a persistência de autenticação.", error);
  }

  observeAuth((user) => {
    if (user) showApp(user);
    else showLogin();
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
