// Configuração web do Firebase.
// IMPORTANTE: este objeto NÃO é uma senha administrativa.
// A proteção dos dados será feita pelo Authentication + Firestore Security Rules.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBodAu_QtlIiSVBFBfCrXd26WjFPagGCZ8",
  authDomain: "nosso-ape-ed983.firebaseapp.com",
  projectId: "nosso-ape-ed983",
  storageBucket: "nosso-ape-ed983.firebasestorage.app",
  messagingSenderId: "283018257763",
  appId: "1:283018257763:web:55fa0ef066b0cac8541f56"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
