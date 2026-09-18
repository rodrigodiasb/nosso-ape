import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  runTransaction,
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

function toCents(value) {
  return Math.round((Number(value) || 0) * 100);
}

function fromCents(value) {
  return value / 100;
}

function addMonthsISO(isoDate, monthsToAdd) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const targetMonthIndex = (m - 1) + monthsToAdd;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const monthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, monthIndex + 1, 0)).getUTCDate();
  const safeDay = Math.min(d, lastDay);
  return `${targetYear}-${String(monthIndex + 1).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function cleanShares(shares = {}) {
  const result = {};
  for (const [uid, value] of Object.entries(shares || {})) {
    const amount = Number(value) || 0;
    if (amount > 0) result[uid] = Math.round(amount * 100) / 100;
  }
  return result;
}

function sharesTotal(shares = {}) {
  return Object.values(cleanShares(shares)).reduce((sum, value) => sum + Number(value || 0), 0);
}

function assertSharesMatch(amount, shares) {
  const expected = toCents(amount);
  const actual = toCents(sharesTotal(shares));
  if (expected !== actual) {
    throw new Error("A divisão entre os pagadores precisa somar exatamente o valor do lançamento.");
  }
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

  const code = generateInviteCode();
  await setDoc(doc(db, "invites", code), {
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

  return { project: await getProject(projectRef.id), inviteCode };
}

export async function joinProjectByInvite(code, user) {
  const normalizedCode = code.trim().toUpperCase();
  const inviteRef = doc(db, "invites", normalizedCode);
  const inviteSnap = await getDoc(inviteRef);

  if (!inviteSnap.exists()) throw new Error("Convite não encontrado.");

  const invite = inviteSnap.data();
  const userEmail = normalizeEmail(user.email || "");

  if (invite.status !== "pending") throw new Error("Este convite não está mais disponível.");
  if (normalizeEmail(invite.email) !== userEmail) throw new Error("Este convite foi criado para outro e-mail.");

  const batch = writeBatch(db);
  batch.set(doc(db, "projects", invite.projectId, "members", user.uid), {
    uid: user.uid,
    email: userEmail,
    displayName: user.displayName || "",
    role: "member",
    inviteCode: normalizedCode,
    joinedAt: serverTimestamp()
  });
  batch.set(doc(db, "users", user.uid), {
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
  if (!profile?.activeProjectId) return { profile, project: null, members: [] };

  const project = await getProject(profile.activeProjectId);
  if (!project) return { profile, project: null, members: [] };

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

export async function listContracts(projectId) {
  const snap = await getDocs(collection(db, "projects", projectId, "contracts"));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function listInstallments(projectId, contractId) {
  const snap = await getDocs(collection(db, "projects", projectId, "contracts", contractId, "installments"));
  return snap.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (a.number || 0) - (b.number || 0));
}

export async function listPayments(projectId) {
  const snap = await getDocs(collection(db, "projects", projectId, "payments"));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function listExpenses(projectId) {
  const snap = await getDocs(collection(db, "projects", projectId, "expenses"));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function listReserves(projectId) {
  const snap = await getDocs(collection(db, "projects", projectId, "reserves"));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function listReserveTransactions(projectId) {
  const snap = await getDocs(collection(db, "projects", projectId, "reserveTransactions"));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function loadFinancialData(projectId) {
  const [contracts, payments, expenses, reserves, reserveTransactions] = await Promise.all([
    listContracts(projectId),
    listPayments(projectId),
    listExpenses(projectId),
    listReserves(projectId),
    listReserveTransactions(projectId)
  ]);

  const installmentEntries = await Promise.all(
    contracts.filter(item => ["installment", "financing"].includes(item.type)).map(async contract => [
      contract.id,
      await listInstallments(projectId, contract.id)
    ])
  );

  return {
    contracts,
    payments,
    expenses,
    reserves,
    reserveTransactions,
    installmentsByContract: Object.fromEntries(installmentEntries)
  };
}

export async function createInstallmentContract(projectId, payload, user) {
  const count = Number(payload.installmentsCount) || 0;
  const totalCents = toCents(payload.totalValue);

  if (!payload.name?.trim()) throw new Error("Informe o nome do contrato.");
  if (totalCents <= 0) throw new Error("Informe um valor total maior que zero.");
  if (!Number.isInteger(count) || count < 1 || count > 480) throw new Error("A quantidade de parcelas deve ficar entre 1 e 480.");
  if (!payload.firstDueDate) throw new Error("Informe o primeiro vencimento.");

  const contractRef = doc(collection(db, "projects", projectId, "contracts"));
  const batch = writeBatch(db);
  const baseCents = Math.floor(totalCents / count);
  let remainder = totalCents - (baseCents * count);

  batch.set(contractRef, {
    name: payload.name.trim(),
    category: payload.category || "Outros",
    type: "installment",
    costTreatment: payload.costTreatment || "property",
    totalValue: fromCents(totalCents),
    installmentsCount: count,
    firstDueDate: payload.firstDueDate,
    status: "active",
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  for (let i = 0; i < count; i++) {
    const cents = baseCents + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;

    const installmentRef = doc(db, "projects", projectId, "contracts", contractRef.id, "installments", String(i + 1).padStart(3, "0"));
    batch.set(installmentRef, {
      number: i + 1,
      dueDate: addMonthsISO(payload.firstDueDate, i),
      expectedValue: fromCents(cents),
      paidValue: 0,
      status: "future",
      createdAt: serverTimestamp()
    });
  }

  await batch.commit();
  return { id: contractRef.id };
}


export async function createFinancingContract(projectId, payload, user) {
  const count = Number(payload.installmentsCount) || 0;
  const principal = Number(payload.financedPrincipal) || 0;
  const estimatedInstallmentValue = Number(payload.estimatedInstallmentValue) || 0;

  if (!payload.name?.trim()) throw new Error("Informe o nome do financiamento.");
  if (principal <= 0) throw new Error("Informe o valor financiado.");
  if (!Number.isInteger(count) || count < 1 || count > 480) throw new Error("A quantidade de parcelas deve ficar entre 1 e 480.");
  if (!payload.firstDueDate) throw new Error("Informe o primeiro vencimento.");

  const contractRef = doc(collection(db, "projects", projectId, "contracts"));
  const batch = writeBatch(db);

  batch.set(contractRef, {
    name: payload.name.trim(),
    category: "Financiamento",
    type: "financing",
    costTreatment: "financing",
    financedPrincipal: Math.round(principal * 100) / 100,
    totalValue: Math.round(principal * 100) / 100,
    principalPaid: 0,
    financingAdditionalPaid: 0,
    installmentsCount: count,
    firstDueDate: payload.firstDueDate,
    estimatedInstallmentValue: Math.round(estimatedInstallmentValue * 100) / 100,
    status: "active",
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  for (let i = 0; i < count; i++) {
    const installmentRef = doc(
      db, "projects", projectId, "contracts", contractRef.id, "installments", String(i + 1).padStart(3, "0")
    );

    batch.set(installmentRef, {
      number: i + 1,
      dueDate: addMonthsISO(payload.firstDueDate, i),
      expectedValue: Math.round(estimatedInstallmentValue * 100) / 100,
      paidValue: 0,
      principalPaid: 0,
      additionalPaid: 0,
      status: "future",
      createdAt: serverTimestamp()
    });
  }

  await batch.commit();
  return { id: contractRef.id };
}

export async function createRecurringContract(projectId, payload, user) {
  if (!payload.name?.trim()) throw new Error("Informe o nome do contrato.");

  const ref = doc(collection(db, "projects", projectId, "contracts"));
  await setDoc(ref, {
    name: payload.name.trim(),
    category: payload.category || "Outros",
    type: "recurring",
    costTreatment: payload.costTreatment || "additional",
    estimatedMonthlyValue: Number(payload.estimatedMonthlyValue) || 0,
    startDate: payload.startDate || null,
    status: "active",
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return { id: ref.id };
}

export async function createReserve(projectId, payload, user) {
  const target = Number(payload.targetValue) || 0;
  if (!payload.name?.trim()) throw new Error("Informe o nome da meta/reserva.");
  if (target <= 0) throw new Error("Informe uma meta maior que zero.");

  const ref = doc(collection(db, "projects", projectId, "reserves"));
  await setDoc(ref, {
    name: payload.name.trim(),
    category: payload.category || "Móveis",
    targetValue: target,
    currentBalance: 0,
    contributedTotal: 0,
    usedTotal: 0,
    status: "active",
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return { id: ref.id };
}

export async function addReserveContribution(projectId, payload, user) {
  const amount = Number(payload.amount) || 0;
  const shares = cleanShares(payload.shares);
  if (amount <= 0) throw new Error("Informe um valor maior que zero.");
  assertSharesMatch(amount, shares);

  const reserveRef = doc(db, "projects", projectId, "reserves", payload.reserveId);
  const txRef = doc(collection(db, "projects", projectId, "reserveTransactions"));

  await runTransaction(db, async transaction => {
    const reserveSnap = await transaction.get(reserveRef);
    if (!reserveSnap.exists()) throw new Error("Reserva não encontrada.");
    const reserve = reserveSnap.data();

    transaction.update(reserveRef, {
      currentBalance: (Number(reserve.currentBalance) || 0) + amount,
      contributedTotal: (Number(reserve.contributedTotal) || 0) + amount,
      updatedAt: serverTimestamp()
    });

    transaction.set(txRef, {
      reserveId: payload.reserveId,
      type: "contribution",
      amount,
      date: payload.date,
      shares,
      notes: payload.notes?.trim() || "",
      registeredBy: user.uid,
      status: "active",
      createdAt: serverTimestamp()
    });
  });
}

export async function recordPayment(projectId, payload, user) {
  const amount = Number(payload.amount) || 0;
  if (amount <= 0) throw new Error("Informe um valor de pagamento maior que zero.");

  const directFunding = !payload.sourceReserveId;
  const shares = cleanShares(payload.shares);
  if (directFunding) assertSharesMatch(amount, shares);

  const contractRef = doc(db, "projects", projectId, "contracts", payload.contractId);
  const installmentRef = payload.installmentId
    ? doc(db, "projects", projectId, "contracts", payload.contractId, "installments", payload.installmentId)
    : null;
  const reserveRef = payload.sourceReserveId
    ? doc(db, "projects", projectId, "reserves", payload.sourceReserveId)
    : null;
  const paymentRef = doc(collection(db, "projects", projectId, "payments"));
  const reserveTxRef = reserveRef ? doc(collection(db, "projects", projectId, "reserveTransactions")) : null;

  await runTransaction(db, async transaction => {
    const contractSnap = await transaction.get(contractRef);
    if (!contractSnap.exists()) throw new Error("Contrato não encontrado.");
    const contract = contractSnap.data();

    let installment = null;
    if (installmentRef) {
      const installmentSnap = await transaction.get(installmentRef);
      if (!installmentSnap.exists()) throw new Error("Parcela não encontrada.");
      installment = installmentSnap.data();

      if (contract.type !== "financing") {
        const remaining = Math.max(0, (Number(installment.expectedValue) || 0) - (Number(installment.paidValue) || 0));
        if (amount - remaining > 0.009) throw new Error(`O valor excede o saldo restante da parcela (${remaining.toFixed(2)}).`);
      }
    }

    let principalAmount = 0;
    let financingAdditionalAmount = 0;

    if (contract.type === "financing") {
      if (!installmentRef) throw new Error("Selecione a parcela do financiamento.");

      principalAmount = Number(payload.principalAmount) || 0;
      financingAdditionalAmount = Number(payload.financingAdditionalAmount) || 0;

      if (principalAmount < 0 || financingAdditionalAmount < 0) {
        throw new Error("Os componentes do financiamento não podem ser negativos.");
      }

      if (toCents(principalAmount + financingAdditionalAmount) !== toCents(amount)) {
        throw new Error("Amortização + juros/seguros/encargos deve ser igual ao valor total pago.");
      }

      const financedPrincipal = Number(contract.financedPrincipal || contract.totalValue || 0);
      const alreadyPrincipalPaid = Number(contract.principalPaid || 0);
      const remainingPrincipal = Math.max(0, financedPrincipal - alreadyPrincipalPaid);

      if (principalAmount - remainingPrincipal > 0.009) {
        throw new Error(`A amortização informada excede o saldo principal restante (${remainingPrincipal.toFixed(2)}).`);
      }
    }

    let reserve = null;
    if (reserveRef) {
      const reserveSnap = await transaction.get(reserveRef);
      if (!reserveSnap.exists()) throw new Error("Reserva não encontrada.");
      reserve = reserveSnap.data();
      if ((Number(reserve.currentBalance) || 0) + 0.009 < amount) {
        throw new Error("O saldo disponível na reserva é menor que o pagamento.");
      }
    }

    transaction.set(paymentRef, {
      contractId: payload.contractId,
      installmentId: payload.installmentId || null,
      amount,
      paymentDate: payload.paymentDate,
      shares: directFunding ? shares : {},
      sourceReserveId: payload.sourceReserveId || null,
      paymentMethod: payload.paymentMethod || "Outro",
      notes: payload.notes?.trim() || "",
      costTreatment: contract.costTreatment || "property",
      principalAmount,
      financingAdditionalAmount,
      markInstallmentPaid: contract.type === "financing" ? payload.markInstallmentPaid !== false : null,
      registeredBy: user.uid,
      status: "active",
      createdAt: serverTimestamp()
    });

    if (installmentRef && installment) {
      const newPaid = Math.round(((Number(installment.paidValue) || 0) + amount) * 100) / 100;

      if (contract.type === "financing") {
        const newPrincipal = Math.round(((Number(installment.principalPaid) || 0) + principalAmount) * 100) / 100;
        const newAdditional = Math.round(((Number(installment.additionalPaid) || 0) + financingAdditionalAmount) * 100) / 100;

        transaction.update(installmentRef, {
          paidValue: newPaid,
          principalPaid: newPrincipal,
          additionalPaid: newAdditional,
          status: payload.markInstallmentPaid === false ? "partial" : "paid",
          updatedAt: serverTimestamp()
        });

        transaction.update(contractRef, {
          principalPaid: Math.round(((Number(contract.principalPaid) || 0) + principalAmount) * 100) / 100,
          financingAdditionalPaid: Math.round(((Number(contract.financingAdditionalPaid) || 0) + financingAdditionalAmount) * 100) / 100,
          updatedAt: serverTimestamp()
        });
      } else {
        const expected = Number(installment.expectedValue) || 0;
        transaction.update(installmentRef, {
          paidValue: newPaid,
          status: newPaid + 0.009 >= expected ? "paid" : "partial",
          updatedAt: serverTimestamp()
        });
      }
    }

    if (reserveRef && reserve && reserveTxRef) {
      transaction.update(reserveRef, {
        currentBalance: Math.round(((Number(reserve.currentBalance) || 0) - amount) * 100) / 100,
        usedTotal: Math.round(((Number(reserve.usedTotal) || 0) + amount) * 100) / 100,
        updatedAt: serverTimestamp()
      });
      transaction.set(reserveTxRef, {
        reserveId: payload.sourceReserveId,
        type: "use",
        amount,
        date: payload.paymentDate,
        linkedPaymentId: paymentRef.id,
        registeredBy: user.uid,
        status: "active",
        createdAt: serverTimestamp()
      });
    }
  });

  return { id: paymentRef.id };
}

export async function createExpense(projectId, payload, user) {
  const amount = Number(payload.amount) || 0;
  if (amount <= 0) throw new Error("Informe um valor de despesa maior que zero.");

  const directFunding = !payload.sourceReserveId;
  const shares = cleanShares(payload.shares);
  if (directFunding) assertSharesMatch(amount, shares);

  const expenseRef = doc(collection(db, "projects", projectId, "expenses"));
  const reserveRef = payload.sourceReserveId
    ? doc(db, "projects", projectId, "reserves", payload.sourceReserveId)
    : null;
  const reserveTxRef = reserveRef ? doc(collection(db, "projects", projectId, "reserveTransactions")) : null;

  await runTransaction(db, async transaction => {
    let reserve = null;
    if (reserveRef) {
      const reserveSnap = await transaction.get(reserveRef);
      if (!reserveSnap.exists()) throw new Error("Reserva não encontrada.");
      reserve = reserveSnap.data();
      if ((Number(reserve.currentBalance) || 0) + 0.009 < amount) {
        throw new Error("O saldo disponível na reserva é menor que a despesa.");
      }
    }

    transaction.set(expenseRef, {
      description: payload.description.trim(),
      category: payload.category || "Outros",
      amount,
      date: payload.date,
      shares: directFunding ? shares : {},
      sourceReserveId: payload.sourceReserveId || null,
      countInRealCost: payload.countInRealCost !== false,
      notes: payload.notes?.trim() || "",
      registeredBy: user.uid,
      status: "active",
      createdAt: serverTimestamp()
    });

    if (reserveRef && reserve && reserveTxRef) {
      transaction.update(reserveRef, {
        currentBalance: Math.round(((Number(reserve.currentBalance) || 0) - amount) * 100) / 100,
        usedTotal: Math.round(((Number(reserve.usedTotal) || 0) + amount) * 100) / 100,
        updatedAt: serverTimestamp()
      });
      transaction.set(reserveTxRef, {
        reserveId: payload.sourceReserveId,
        type: "use",
        amount,
        date: payload.date,
        linkedExpenseId: expenseRef.id,
        registeredBy: user.uid,
        status: "active",
        createdAt: serverTimestamp()
      });
    }
  });

  return { id: expenseRef.id };
}


function isReversed(record) {
  return record?.status === "reversed";
}

function reversalFields(reason, user) {
  const cleanReason = String(reason || "").trim();
  if (cleanReason.length < 5) {
    throw new Error("Informe um motivo de estorno com pelo menos 5 caracteres.");
  }
  return {
    status: "reversed",
    reversedBy: user.uid,
    reversedAt: serverTimestamp(),
    reversalReason: cleanReason,
    updatedAt: serverTimestamp()
  };
}

export async function reversePayment(projectId, paymentId, reserveTransactionId, reason, user) {
  const paymentRef = doc(db, "projects", projectId, "payments", paymentId);

  await runTransaction(db, async transaction => {
    const paymentSnap = await transaction.get(paymentRef);
    if (!paymentSnap.exists()) throw new Error("Pagamento não encontrado.");
    const payment = paymentSnap.data();
    if (isReversed(payment)) throw new Error("Este pagamento já foi estornado.");

    const amount = Number(payment.amount) || 0;
    const contractRef = doc(db, "projects", projectId, "contracts", payment.contractId);
    const contractSnap = await transaction.get(contractRef);
    if (!contractSnap.exists()) throw new Error("Contrato relacionado não encontrado.");
    const contract = contractSnap.data();

    let installmentRef = null;
    let installment = null;
    if (payment.installmentId) {
      installmentRef = doc(db, "projects", projectId, "contracts", payment.contractId, "installments", payment.installmentId);
      const installmentSnap = await transaction.get(installmentRef);
      if (!installmentSnap.exists()) throw new Error("Parcela relacionada não encontrada.");
      installment = installmentSnap.data();
    }

    let reserveRef = null;
    let reserve = null;
    let reserveTxRef = null;
    let reserveTx = null;
    if (payment.sourceReserveId) {
      reserveRef = doc(db, "projects", projectId, "reserves", payment.sourceReserveId);
      const reserveSnap = await transaction.get(reserveRef);
      if (!reserveSnap.exists()) throw new Error("Reserva relacionada não encontrada.");
      reserve = reserveSnap.data();

      if (!reserveTransactionId) throw new Error("Não foi possível localizar a movimentação da reserva vinculada.");
      reserveTxRef = doc(db, "projects", projectId, "reserveTransactions", reserveTransactionId);
      const reserveTxSnap = await transaction.get(reserveTxRef);
      if (!reserveTxSnap.exists()) throw new Error("Movimentação da reserva não encontrada.");
      reserveTx = reserveTxSnap.data();
    }

    transaction.update(paymentRef, reversalFields(reason, user));

    if (installmentRef && installment) {
      const newPaid = Math.max(0, Math.round(((Number(installment.paidValue) || 0) - amount) * 100) / 100);

      if (contract.type === "financing") {
        const principal = Number(payment.principalAmount) || 0;
        const additional = Number(payment.financingAdditionalAmount) || 0;
        const newPrincipal = Math.max(0, Math.round(((Number(installment.principalPaid) || 0) - principal) * 100) / 100);
        const newAdditional = Math.max(0, Math.round(((Number(installment.additionalPaid) || 0) - additional) * 100) / 100);

        transaction.update(installmentRef, {
          paidValue: newPaid,
          principalPaid: newPrincipal,
          additionalPaid: newAdditional,
          status: newPaid <= 0.009 ? "future" : "partial",
          updatedAt: serverTimestamp()
        });

        transaction.update(contractRef, {
          principalPaid: Math.max(0, Math.round(((Number(contract.principalPaid) || 0) - principal) * 100) / 100),
          financingAdditionalPaid: Math.max(0, Math.round(((Number(contract.financingAdditionalPaid) || 0) - additional) * 100) / 100),
          updatedAt: serverTimestamp()
        });
      } else {
        const expected = Number(installment.expectedValue) || 0;
        transaction.update(installmentRef, {
          paidValue: newPaid,
          status: newPaid <= 0.009 ? "future" : (newPaid + 0.009 >= expected ? "paid" : "partial"),
          updatedAt: serverTimestamp()
        });
      }
    }

    if (reserveRef && reserve && reserveTxRef && reserveTx) {
      transaction.update(reserveRef, {
        currentBalance: Math.round(((Number(reserve.currentBalance) || 0) + amount) * 100) / 100,
        usedTotal: Math.max(0, Math.round(((Number(reserve.usedTotal) || 0) - amount) * 100) / 100),
        updatedAt: serverTimestamp()
      });
      transaction.update(reserveTxRef, reversalFields(`Estorno do pagamento: ${String(reason || "").trim()}`, user));
    }
  });
}

export async function reverseExpense(projectId, expenseId, reserveTransactionId, reason, user) {
  const expenseRef = doc(db, "projects", projectId, "expenses", expenseId);

  await runTransaction(db, async transaction => {
    const expenseSnap = await transaction.get(expenseRef);
    if (!expenseSnap.exists()) throw new Error("Despesa não encontrada.");
    const expense = expenseSnap.data();
    if (isReversed(expense)) throw new Error("Esta despesa já foi estornada.");

    const amount = Number(expense.amount) || 0;
    let reserveRef = null;
    let reserveTxRef = null;
    let reserve = null;

    if (expense.sourceReserveId) {
      if (!reserveTransactionId) throw new Error("Não foi possível localizar a movimentação da reserva vinculada.");
      reserveRef = doc(db, "projects", projectId, "reserves", expense.sourceReserveId);
      reserveTxRef = doc(db, "projects", projectId, "reserveTransactions", reserveTransactionId);
      const reserveSnap = await transaction.get(reserveRef);
      const txSnap = await transaction.get(reserveTxRef);
      if (!reserveSnap.exists() || !txSnap.exists()) throw new Error("Reserva relacionada não encontrada.");
      reserve = reserveSnap.data();
    }

    transaction.update(expenseRef, reversalFields(reason, user));

    if (reserveRef && reserveTxRef && reserve) {
      transaction.update(reserveRef, {
        currentBalance: Math.round(((Number(reserve.currentBalance) || 0) + amount) * 100) / 100,
        usedTotal: Math.max(0, Math.round(((Number(reserve.usedTotal) || 0) - amount) * 100) / 100),
        updatedAt: serverTimestamp()
      });
      transaction.update(reserveTxRef, reversalFields(`Estorno da despesa: ${String(reason || "").trim()}`, user));
    }
  });
}

export async function reverseReserveContribution(projectId, transactionId, reason, user) {
  const txRef = doc(db, "projects", projectId, "reserveTransactions", transactionId);

  await runTransaction(db, async transaction => {
    const txSnap = await transaction.get(txRef);
    if (!txSnap.exists()) throw new Error("Aporte não encontrado.");
    const reserveTx = txSnap.data();
    if (reserveTx.type !== "contribution") throw new Error("Somente aportes podem ser estornados diretamente.");
    if (isReversed(reserveTx)) throw new Error("Este aporte já foi estornado.");

    const amount = Number(reserveTx.amount) || 0;
    const reserveRef = doc(db, "projects", projectId, "reserves", reserveTx.reserveId);
    const reserveSnap = await transaction.get(reserveRef);
    if (!reserveSnap.exists()) throw new Error("Reserva não encontrada.");
    const reserve = reserveSnap.data();
    const available = Number(reserve.currentBalance) || 0;

    if (available + 0.009 < amount) {
      throw new Error("Este aporte não pode ser estornado porque parte do valor já foi utilizada. Estorne primeiro os pagamentos/despesas feitos com essa reserva.");
    }

    transaction.update(reserveRef, {
      currentBalance: Math.max(0, Math.round((available - amount) * 100) / 100),
      contributedTotal: Math.max(0, Math.round(((Number(reserve.contributedTotal) || 0) - amount) * 100) / 100),
      updatedAt: serverTimestamp()
    });
    transaction.update(txRef, reversalFields(reason, user));
  });
}


// ===== v0.6.1 • Reset seguro dos dados financeiros =====

async function deleteInChunks(refs, chunkSize = 400) {
  for (let i = 0; i < refs.length; i += chunkSize) {
    const batch = writeBatch(db);
    refs.slice(i, i + chunkSize).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
}

export async function resetFinancialData(projectId) {
  // Busca tudo antes de excluir para evitar deixar subcoleções órfãs.
  const contractsSnap = await getDocs(collection(db, "projects", projectId, "contracts"));
  const paymentsSnap = await getDocs(collection(db, "projects", projectId, "payments"));
  const expensesSnap = await getDocs(collection(db, "projects", projectId, "expenses"));
  const reservesSnap = await getDocs(collection(db, "projects", projectId, "reserves"));
  const reserveTxSnap = await getDocs(collection(db, "projects", projectId, "reserveTransactions"));

  const installmentRefs = [];
  for (const contractDoc of contractsSnap.docs) {
    const installmentsSnap = await getDocs(
      collection(db, "projects", projectId, "contracts", contractDoc.id, "installments")
    );
    installmentsSnap.docs.forEach(item => installmentRefs.push(item.ref));
  }

  // Ordem importante: primeiro subcoleções, depois documentos-pai.
  await deleteInChunks(installmentRefs);
  await deleteInChunks(paymentsSnap.docs.map(item => item.ref));
  await deleteInChunks(expensesSnap.docs.map(item => item.ref));
  await deleteInChunks(reserveTxSnap.docs.map(item => item.ref));
  await deleteInChunks(reservesSnap.docs.map(item => item.ref));
  await deleteInChunks(contractsSnap.docs.map(item => item.ref));

  return {
    contracts: contractsSnap.size,
    installments: installmentRefs.length,
    payments: paymentsSnap.size,
    expenses: expensesSnap.size,
    reserves: reservesSnap.size,
    reserveTransactions: reserveTxSnap.size
  };
}
