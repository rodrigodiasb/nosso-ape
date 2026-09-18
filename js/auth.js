import {
  browserLocalPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import { auth } from "./firebase.js";

export async function configureAuthPersistence() {
  await setPersistence(auth, browserLocalPersistence);
}

export function observeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function login(email, password) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function logout() {
  return signOut(auth);
}

export async function resetPassword(email) {
  const cleanEmail = email.trim();
  if (!cleanEmail) {
    throw new Error("Informe seu e-mail para receber o link de redefinição.");
  }
  return sendPasswordResetEmail(auth, cleanEmail);
}

export function friendlyAuthError(error) {
  const code = error?.code || "";

  const messages = {
    "auth/invalid-email": "O e-mail informado não é válido.",
    "auth/missing-password": "Informe a senha.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/user-disabled": "Este acesso foi desativado.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente novamente.",
    "auth/network-request-failed": "Não foi possível acessar o Firebase. Verifique sua internet.",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos."
  };

  return messages[code] || error?.message || "Não foi possível concluir a autenticação.";
}
