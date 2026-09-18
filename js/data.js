import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import { db } from "./firebase.js";

function normalizeEmail(value = "") {
  return value.trim().toLowerCase();
}

function generateInviteCode(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, value => alphabet[value % alphabet.length]).join("");
}

export async function ensureUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    await setDoc(userRef, {
      email: normalizeEmail(user.email || ""),
      displayName: user.displayName || "",
      activeProjectId: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return;
  }

  await setDoc(userRef, {
    email: normalizeEmail(user.email || ""),
    displayName: user.displayName || snap.data().displayName || "",
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getProject(projectId) {
  const snap = await getDoc(doc(db, "projects", projectId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getProjectMembers(projectId) {
  const snap = await getDocs(collection(db, "projects", projectId, "members"));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function createInvite(projectId, email, createdBy) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  // O código tem espaço aleatório amplo (32^8 combinações).
  // Não fazemos leitura prévia do documento porque convites inexistentes
  // não são publicamente consultáveis pelas regras de segurança.
  const code = generateInviteCode();
  const inviteRef = doc(db, "invites", code);

  await setDoc(inviteRef, {
    code,
    projectId,
    email: normalized,
    status: "pending",
    createdBy,
    createdAt: serverTimestamp()
  });

  return code;
}

export async function createProject({ name, propertyValue, purchaseDate, partnerEmail }, user) {
  const projectRef = doc(collection(db, "projects"));
  const memberRef = doc(db, "projects", projectRef.id, "members", user.uid);
  const userRef = doc(db, "users", user.uid);

  const batch = writeBatch(db);

  batch.set(projectRef, {
    name: name.trim(),
    propertyValue: Number(propertyValue) || 0,
    purchaseDate: purchaseDate || null,
    ownerUid: user.uid,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  batch.set(memberRef, {
    uid: user.uid,
    email: normalizeEmail(user.email || ""),
    displayName: user.displayName || "",
    role: "owner",
    joinedAt: serverTimestamp()
  });

  batch.set(userRef, {
    email: normalizeEmail(user.email || ""),
    displayName: user.displayName || "",
    activeProjectId: projectRef.id,
    updatedAt: serverTimestamp()
  }, { merge: true });

  await batch.commit();

  let inviteCode = null;
  if (normalizeEmail(partnerEmail)) {
    inviteCode = await createInvite(projectRef.id, partnerEmail, user.uid);
  }

  return {
    project: await getProject(projectRef.id),
    inviteCode
  };
}

export async function joinProjectByInvite(code, user) {
  const normalizedCode = code.trim().toUpperCase();
  const inviteRef = doc(db, "invites", normalizedCode);
  const inviteSnap = await getDoc(inviteRef);

  if (!inviteSnap.exists()) {
    throw new Error("Convite não encontrado.");
  }

  const invite = inviteSnap.data();
  const userEmail = normalizeEmail(user.email || "");

  if (invite.status !== "pending") {
    throw new Error("Este convite não está mais disponível.");
  }

  if (normalizeEmail(invite.email) !== userEmail) {
    throw new Error("Este convite foi criado para outro e-mail.");
  }

  const memberRef = doc(db, "projects", invite.projectId, "members", user.uid);
  const userRef = doc(db, "users", user.uid);

  const batch = writeBatch(db);

  batch.set(memberRef, {
    uid: user.uid,
    email: userEmail,
    displayName: user.displayName || "",
    role: "member",
    inviteCode: normalizedCode,
    joinedAt: serverTimestamp()
  });

  batch.set(userRef, {
    email: userEmail,
    displayName: user.displayName || "",
    activeProjectId: invite.projectId,
    updatedAt: serverTimestamp()
  }, { merge: true });

  await batch.commit();

  await updateDoc(inviteRef, {
    status: "accepted",
    acceptedBy: user.uid,
    acceptedAt: serverTimestamp()
  });

  return getProject(invite.projectId);
}

export async function loadActiveProject(user) {
  await ensureUserProfile(user);
  const profile = await getUserProfile(user.uid);

  if (!profile?.activeProjectId) {
    return { profile, project: null, members: [] };
  }

  const project = await getProject(profile.activeProjectId);
  if (!project) {
    return { profile, project: null, members: [] };
  }

  const members = await getProjectMembers(project.id);
  return { profile, project, members };
}

export async function updateProject(projectId, changes) {
  await updateDoc(doc(db, "projects", projectId), {
    ...changes,
    updatedAt: serverTimestamp()
  });

  return getProject(projectId);
}
