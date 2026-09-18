import {
  configureAuthPersistence,
  friendlyAuthError,
  login,
  logout,
  observeAuth,
  resetPassword
} from "./auth.js";

import {
  addReserveContribution,
  createExpense,
  createFinancingContract,
  createInstallmentContract,
  createInvite,
  createProject,
  createRecurringContract,
  createReserve,
  getProjectMembers,
  joinProjectByInvite,
  loadActiveProject,
  loadFinancialData,
  recordPayment,
  reverseExpense,
  reversePayment,
  reverseReserveContribution,
  updateProject
} from "./data.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let currentUser = null;
let currentProject = null;
let currentMembers = [];
let financial = emptyFinancial();
let toastTimer;
let preselectedContractId = null;
let preselectedInstallmentId = null;
let selectedMovement = null;
let calendarCursor = null;
let selectedCalendarDate = null;
let agendaFilter = "30";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compactBrl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function emptyFinancial() {
  return { contracts: [], payments: [], expenses: [], reserves: [], reserveTransactions: [], installmentsByContract: {} };
}

function currency(value) { return brl.format(Number(value) || 0); }
function compactCurrency(value) { return compactBrl.format(Number(value) || 0); }
function todayISO() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function dateBR(value) {
  if (!value) return "—";
  const [y,m,d] = value.split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}
function escapeHtml(value = "") {
  return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function clamp(value, min=0, max=100) { return Math.min(max, Math.max(min, value)); }
function memberName(uid) {
  const member = currentMembers.find(item => item.id === uid || item.uid === uid);
  return member?.displayName || member?.email?.split("@")[0] || "Membro";
}
function displayNameFor(user) {
  if (user?.displayName) return user.displayName.split(" ")[0];
  const prefix = user?.email?.split("@")[0] || "vocês";
  const clean = prefix.replace(/[._-]+/g," ").trim();
  return clean ? clean.charAt(0).toUpperCase()+clean.slice(1) : "vocês";
}

function showToast(message, type="default") {
  clearTimeout(toastTimer);
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show ${type === "default" ? "" : type}`.trim();
  toastTimer = setTimeout(() => toast.className = "toast", 3400);
}
function setButtonLoading(button, loading, normalText, loadingText="Salvando...") {
  if (!button) return;
  button.disabled = loading;
  const span = button.querySelector("span:first-child");
  if (span) span.textContent = loading ? loadingText : normalText;
  else button.textContent = loading ? loadingText : normalText;
}
function openModal(modal) { if (modal) { modal.classList.remove("hidden"); document.body.style.overflow="hidden"; } }
function closeModal(modal) {
  if (!modal) return;
  modal.classList.add("hidden");
  if (!$$('.modal-layer').some(el => !el.classList.contains('hidden'))) document.body.style.overflow="";
}
function hideAllMainViews() { ["#authView","#setupView","#appView"].forEach(id => $(id).classList.add("hidden")); }
function showLogin() { hideAllMainViews(); $("#authView").classList.remove("hidden"); $("#password").value=""; }
function showSetup() { hideAllMainViews(); $("#setupView").classList.remove("hidden"); }
function showApp() { hideAllMainViews(); $("#appView").classList.remove("hidden"); }
function renderIdentity(user) {
  const firstName=displayNameFor(user);
  $("#welcomeText").textContent=`Olá, ${firstName}!`;
  $("#avatarInitial").textContent=firstName.charAt(0).toUpperCase();
  $("#paymentRegisteredBy").textContent=firstName;
  $("#expenseRegisteredBy").textContent=firstName;
}

function contractPayments(contractId) { return activePayments().filter(item => item.contractId === contractId); }
function contractPaid(contractId) { return contractPayments(contractId).reduce((s,p)=>s+Number(p.amount||0),0); }
function reserveById(id) { return financial.reserves.find(item=>item.id===id); }
function contractById(id) { return financial.contracts.find(item=>item.id===id); }
function isActiveRecord(item) { return item?.status !== "reversed"; }
function activePayments() { return financial.payments.filter(isActiveRecord); }
function activeExpenses() { return financial.expenses.filter(isActiveRecord); }
function activeReserveTransactions() { return financial.reserveTransactions.filter(isActiveRecord); }

function calculateSummary() {
  const paymentsTotal = activePayments().reduce((s,p)=>s+Number(p.amount||0),0);
  const expensesTotal = activeExpenses().reduce((s,e)=>s+Number(e.amount||0),0);
  const reserveBalance = financial.reserves.reduce((s,r)=>s+Number(r.currentBalance||0),0);
  const additionalFromPayments = activePayments().reduce((sum,p) => {
    if (p.costTreatment === "additional") return sum + Number(p.amount || 0);
    if (p.costTreatment === "financing") return sum + Number(p.financingAdditionalAmount || 0);
    return sum;
  }, 0);
  const additionalExpenses = activeExpenses().filter(e=>e.countInRealCost !== false).reduce((s,e)=>s+Number(e.amount||0),0);
  const additionalCosts = additionalFromPayments + additionalExpenses;
  const propertyValue = Number(currentProject?.propertyValue||0);
  const realCost = propertyValue + additionalCosts;
  const employedCapital = paymentsTotal + expensesTotal + reserveBalance;

  const contributions = Object.fromEntries(currentMembers.map(m=>[m.id,0]));
  const addShares = shares => Object.entries(shares||{}).forEach(([uid,value]) => { contributions[uid]=(contributions[uid]||0)+Number(value||0); });
  activePayments().filter(p=>!p.sourceReserveId).forEach(p=>addShares(p.shares));
  activeExpenses().filter(e=>!e.sourceReserveId).forEach(e=>addShares(e.shares));
  activeReserveTransactions().filter(t=>t.type === "contribution").forEach(t=>addShares(t.shares));

  return { propertyValue, additionalCosts, realCost, employedCapital, paymentsTotal, expensesTotal, reserveBalance, contributions };
}

function renderContributions(summary) {
  const container=$("#contributionGrid");
  const total=Object.values(summary.contributions).reduce((s,v)=>s+v,0);
  if (!currentMembers.length) { container.innerHTML='<div class="empty-mini">Nenhum membro encontrado.</div>'; return; }
  container.innerHTML=currentMembers.slice(0,2).map((member,index)=>{
    const value=summary.contributions[member.id]||0;
    const pct=total>0?value/total*100:0;
    const name=member.displayName||member.email?.split('@')[0]||`Membro ${index+1}`;
    return `<article class="person-card"><div class="person-top"><div class="mini-avatar ${index===0?'blue':'rose'}">${escapeHtml(name.charAt(0).toUpperCase())}</div><div><strong>${escapeHtml(name)}</strong><span>${currency(value)}</span></div><b>${pct.toFixed(1).replace('.',',')}%</b></div><div class="mini-progress ${index===1?'rose-bar':''}"><i style="width:${clamp(pct)}%"></i></div></article>`;
  }).join('');
}

function contractProgress(contract) {
  if (contract.type === "installment") {
    const paid=contractPaid(contract.id);
    const total=Number(contract.totalValue||0);
    return { paid, total, pct: total>0?clamp(paid/total*100):0 };
  }
  if (contract.type === "financing") {
    const principal=Number(contract.financedPrincipal||contract.totalValue||0);
    const principalPaid=Number(contract.principalPaid||0);
    return { paid:contractPaid(contract.id), total:principal, principalPaid, pct:principal>0?clamp(principalPaid/principal*100):0 };
  }
  const paid=contractPaid(contract.id);
  return { paid, total:null, pct:0 };
}

function renderDashboardContracts() {
  const target=$("#dashboardContracts");
  const items=[];
  financial.contracts.slice(0,3).forEach(contract=>items.push({kind:'contract', item:contract}));
  if (items.length<3) financial.reserves.slice(0,3-items.length).forEach(reserve=>items.push({kind:'reserve', item:reserve}));
  if (!items.length) {
    target.innerHTML='<div class="empty-contract"><div class="empty-contract-icon"><svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6Z"/><path d="M9 11h6M9 15h6M9 7h3"/></svg></div><div><strong>Nenhum contrato cadastrado ainda</strong><span>Use o botão + para criar entrada, juros de obra, financiamento ou uma meta.</span></div></div>';
    return;
  }
  target.innerHTML=items.map(({kind,item})=>{
    if (kind==='reserve') {
      const pct=item.targetValue?clamp(Number(item.contributedTotal||0)/Number(item.targetValue)*100):0;
      return `<button class="dashboard-contract-row" data-reserve-detail="${item.id}"><div class="contract-icon blue">◎</div><div class="contract-body"><div class="contract-title"><strong>${escapeHtml(item.name)}</strong><span>Meta</span></div><div class="mini-progress blue-bar"><i style="width:${pct}%"></i></div><div class="contract-meta"><span>${currency(item.contributedTotal||0)} empregados</span><span>${pct.toFixed(0)}%</span></div></div></button>`;
    }
    const p=contractProgress(item);
    const installments=financial.installmentsByContract[item.id]||[];
    const paidCount=installments.filter(x=>x.status==='paid').length;
    const suffix=item.type==='installment'||item.type==='financing'?`${paidCount} / ${item.installmentsCount}`:'Recorrente';
    const progressBlock=item.type==='installment'
      ? `<div class="mini-progress"><i style="width:${p.pct}%"></i></div><div class="contract-meta"><span>${currency(p.paid)} pagos</span><span>${p.pct.toFixed(0)}%</span></div>`
      : item.type==='financing'
        ? `<div class="mini-progress blue-bar"><i style="width:${p.pct}%"></i></div><div class="contract-meta"><span>${currency(p.principalPaid)} amortizados</span><span>${p.pct.toFixed(0)}% do principal</span></div>`
        : `<div class="contract-meta"><span>${currency(p.paid)} pagos até agora</span><span>${escapeHtml(item.category||'')}</span></div>`;
    return `<button class="dashboard-contract-row" data-contract-detail="${item.id}"><div class="contract-icon ${item.type==='financing'?'blue':'green'}">▣</div><div class="contract-body"><div class="contract-title"><strong>${escapeHtml(item.name)}</strong><span>${suffix}</span></div>${progressBlock}</div></button>`;
  }).join('');
}

function nextDueInstallment() {
  const candidates=[];
  financial.contracts.filter(c=>['installment','financing'].includes(c.type)).forEach(contract=>{
    (financial.installmentsByContract[contract.id]||[]).filter(i=>i.status!=='paid').forEach(i=>candidates.push({contract, installment:i}));
  });
  candidates.sort((a,b)=>(a.installment.dueDate||'9999').localeCompare(b.installment.dueDate||'9999'));
  return candidates[0]||null;
}

function renderNextPayment() {
  const next=nextDueInstallment();
  const card=$("#nextPaymentCard");
  if (!next) {
    card.classList.add('muted-payment');
    card.innerHTML='<div class="next-payment-icon">✓</div><div><span class="section-kicker">PRÓXIMOS COMPROMISSOS</span><strong>Nenhum vencimento pendente</strong><small>Quando houver parcelas futuras, elas aparecerão aqui.</small></div><b>—</b>';
    return;
  }
  const remaining=next.contract.type==='financing'
    ? Number(next.installment.expectedValue||0)
    : Math.max(0,Number(next.installment.expectedValue||0)-Number(next.installment.paidValue||0));
  const overdue=next.installment.dueDate < todayISO();
  card.classList.toggle('muted-payment',false);
  card.classList.toggle('overdue-card',overdue);
  const amountLabel=next.contract.type==='financing' && remaining<=0 ? 'A confirmar' : currency(remaining);
  card.innerHTML=`<div class="next-payment-icon">${next.installment.number}</div><div><span class="section-kicker">${overdue?'PAGAMENTO VENCIDO':'PRÓXIMO PAGAMENTO'}</span><strong>${escapeHtml(next.contract.name)} • ${String(next.installment.number).padStart(2,'0')}/${next.contract.installmentsCount}</strong><small>${dateBR(next.installment.dueDate)}</small></div><b>${amountLabel}</b>`;
  card.onclick=()=>openPaymentFor(next.contract.id,next.installment.id);
}

function renderProject() {
  const summary=calculateSummary();
  const progress=summary.realCost>0?clamp(summary.employedCapital/summary.realCost*100):0;
  $("#propertyName").textContent=currentProject?.name||'Nosso imóvel';
  $("#propertySubtitle").textContent=currentProject?.purchaseDate?`Aquisição iniciada em ${dateBR(currentProject.purchaseDate)}`:'Projeto financeiro da aquisição';
  $("#realProjectCost").textContent=currency(summary.realCost);
  $("#propertyValueMetric").textContent=compactCurrency(summary.propertyValue);
  $("#additionalCostsMetric").textContent=compactCurrency(summary.additionalCosts);
  $("#employedCapitalMetric").textContent=compactCurrency(summary.employedCapital);
  $("#financialProgressBadge").textContent=`${progress.toFixed(1).replace('.',',')}%`;
  $("#financialProgressFill").style.width=`${progress}%`;
  $("#financialProgressTrack").setAttribute('aria-valuenow',progress.toFixed(1));
  $("#financialProgressPaid").textContent=`${currency(summary.employedCapital)} empregados`;
  $("#financialProgressTotal").textContent=`de ${currency(summary.realCost)}`;
  renderContributions(summary); renderDashboardContracts(); renderNextPayment(); renderDashboardAgenda();
}

async function refreshFinancial() {
  if (!currentProject) return;
  financial=await loadFinancialData(currentProject.id);
  renderProject();
}

async function loadUserWorkspace(user) {
  try {
    const result=await loadActiveProject(user);
    if (!result.project) { currentProject=null; currentMembers=[]; financial=emptyFinancial(); showSetup(); return; }
    currentProject=result.project; currentMembers=result.members; await refreshFinancial(); showApp();
  } catch(error) { console.error(error); showToast('Não foi possível carregar o projeto. Confira as regras do Firestore.','error'); showSetup(); }
}

function payerAreaHtml(prefix) {
  const options=currentMembers.map((m,i)=>`<option value="${m.id}">${escapeHtml(m.displayName||m.email?.split('@')[0]||`Membro ${i+1}`)}</option>`).join('');
  return `<label class="field"><span>Quem pagou?</span><div class="field-box select-box"><select id="${prefix}PayerMode">${options}<option value="split">Dividido entre vocês</option></select></div></label><div id="${prefix}SplitArea" class="split-area hidden">${currentMembers.map(m=>`<label><span>${escapeHtml(m.displayName||m.email?.split('@')[0]||'Membro')}</span><input data-share-uid="${m.id}" type="number" min="0" step="0.01" value="0"></label>`).join('')}</div>`;
}
function setupPayerArea(prefix, amountInput) {
  const area=$(`#${prefix}PayerArea`); area.innerHTML=payerAreaHtml(prefix);
  const select=$(`#${prefix}PayerMode`); const split=$(`#${prefix}SplitArea`);
  select.addEventListener('change',()=>split.classList.toggle('hidden',select.value!=='split'));
  if (currentMembers.length===2) {
    split.querySelectorAll('input').forEach((input,index)=>input.addEventListener('focus',()=>{
      const amount=Number(amountInput.value)||0;
      if (amount>0 && [...split.querySelectorAll('input')].every(x=>Number(x.value||0)===0)) {
        split.querySelectorAll('input')[0].value=(amount/2).toFixed(2);
        split.querySelectorAll('input')[1].value=(amount-amount/2).toFixed(2);
      }
    }));
  }
}
function readShares(prefix, amount, sourceValue='direct') {
  if (sourceValue!=='direct') return {};
  const mode=$(`#${prefix}PayerMode`)?.value;
  if (!mode) throw new Error('Informe quem pagou.');
  if (mode!=='split') return { [mode]: Number(amount) };
  const result={};
  $(`#${prefix}SplitArea`).querySelectorAll('[data-share-uid]').forEach(input=>{ const v=Number(input.value)||0; if(v>0) result[input.dataset.shareUid]=v; });
  return result;
}
function populateFundingSelect(select) {
  select.innerHTML='<option value="direct">Pagamento direto</option>'+financial.reserves.filter(r=>Number(r.currentBalance||0)>0).map(r=>`<option value="reserve:${r.id}">Usar reserva: ${escapeHtml(r.name)} (${currency(r.currentBalance||0)})</option>`).join('');
}
function sourceReserveId(selectValue) { return selectValue?.startsWith('reserve:') ? selectValue.slice(8) : null; }

function populatePaymentContractSelect() {
  const select=$("#paymentContract");
  select.innerHTML='<option value="">Selecione...</option>'+financial.contracts.map(c=>`<option value="${c.id}">${escapeHtml(c.name)} — ${c.type==='installment'?'parcelado':c.type==='financing'?'financiamento':'recorrente'}</option>`).join('');
  if (preselectedContractId) select.value=preselectedContractId;
  updatePaymentInstallments();
}
function updatePaymentInstallments() {
  const contract=contractById($("#paymentContract").value);
  const field=$("#paymentInstallmentField"); const select=$("#paymentInstallment");
  const isInstallment=contract && ["installment","financing"].includes(contract.type);

  if (!isInstallment) {
    field.classList.add('hidden'); select.innerHTML='';
    if (contract) $('#paymentAmount').value='';
    toggleFinancingPaymentFields(contract);
    return;
  }

  const installments=(financial.installmentsByContract[contract.id]||[]).filter(i=>i.status!=='paid');
  select.innerHTML=installments.map(i=>{
    const label=contract.type==='financing'
      ? (Number(i.expectedValue||0)>0 ? `estimada ${currency(i.expectedValue)}` : 'valor a confirmar')
      : `resta ${currency(Math.max(0,Number(i.expectedValue||0)-Number(i.paidValue||0)))}`;
    return `<option value="${i.id}">${String(i.number).padStart(2,'0')}/${contract.installmentsCount} • ${dateBR(i.dueDate)} • ${label}</option>`;
  }).join('');
  if (preselectedInstallmentId) select.value=preselectedInstallmentId;
  field.classList.remove('hidden');
  fillPaymentAmountFromInstallment();
  toggleFinancingPaymentFields(contract);
}

function toggleFinancingPaymentFields(contract=contractById($("#paymentContract").value)) {
  const isFinancing=contract?.type==='financing';
  $("#financingPaymentFields").classList.toggle('hidden',!isFinancing);
  if (!isFinancing) {
    $("#paymentPrincipalAmount").value='0';
    $("#paymentFinancingAdditional").value='0';
    $("#financingComponentsSum").textContent=currency(0);
  } else {
    updateFinancingComponentsSum();
  }
}

function updateFinancingComponentsSum() {
  const principal=Number($("#paymentPrincipalAmount").value)||0;
  const additional=Number($("#paymentFinancingAdditional").value)||0;
  const total=principal+additional;
  $("#financingComponentsSum").textContent=currency(total);
  const paid=Number($("#paymentAmount").value)||0;
  $("#financingComponentsSum").classList.toggle('sum-mismatch',Math.round(total*100)!==Math.round(paid*100));
}

function fillPaymentAmountFromInstallment() {
  const contract=contractById($("#paymentContract").value);
  if(!contract||!["installment","financing"].includes(contract.type)) return;
  const installment=(financial.installmentsByContract[contract.id]||[]).find(i=>i.id===$("#paymentInstallment").value);
  if (!installment) return;
  if (contract.type==='financing') {
    $("#paymentAmount").value=Number(installment.expectedValue||0)>0 ? Number(installment.expectedValue).toFixed(2) : '';
    $("#paymentPrincipalAmount").value='0';
    $("#paymentFinancingAdditional").value='0';
    updateFinancingComponentsSum();
  } else {
    $("#paymentAmount").value=Math.max(0,Number(installment.expectedValue||0)-Number(installment.paidValue||0)).toFixed(2);
  }
}
function openPaymentFor(contractId=null,installmentId=null) {
  if (!financial.contracts.length) { showToast('Cadastre primeiro um contrato.'); openModal($("#contractModal")); return; }
  preselectedContractId=contractId; preselectedInstallmentId=installmentId;
  populatePaymentContractSelect(); populateFundingSelect($("#paymentSource"));
  $("#paymentDate").value=todayISO(); $("#paymentNotes").value='';
  setupPayerArea('payment',$("#paymentAmount"));
  const source=$("#paymentSource"); const payerArea=$("#paymentPayerArea");
  source.onchange=()=>payerArea.classList.toggle('hidden',source.value!=='direct');
  payerArea.classList.toggle('hidden',source.value!=='direct');
  openModal($("#paymentModal"));
}
function openExpense() {
  populateFundingSelect($("#expenseSource")); $("#expenseDate").value=todayISO();
  setupPayerArea('expense',$("#expenseAmount"));
  const source=$("#expenseSource"); const payerArea=$("#expensePayerArea");
  source.onchange=()=>payerArea.classList.toggle('hidden',source.value!=='direct');
  payerArea.classList.toggle('hidden',source.value!=='direct');
  openModal($("#expenseModal"));
}
function openReserve() {
  if (!financial.reserves.length) { prepareContractForm('reserve'); openModal($("#contractModal")); return; }
  const select=$("#reserveSelect");
  select.innerHTML=financial.reserves.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  $("#reserveContributionDate").value=todayISO(); setupPayerArea('reserve',$("#reserveContributionAmount"));
  const updateHint=()=>{ const r=reserveById(select.value); $("#reserveBalanceHint").textContent=r?`Meta ${currency(r.targetValue)} • já empregado ${currency(r.contributedTotal)} • saldo disponível ${currency(r.currentBalance)}`:''; };
  select.onchange=updateHint; updateHint(); openModal($("#reserveModal"));
}

function prepareContractForm(type='installment') {
  $("#contractForm").reset(); $("#contractType").value=type; $("#contractCategory").value=type==='reserve'?'Móveis':'Aquisição'; $("#costTreatment").value='property'; toggleContractFields();
}
function toggleContractFields() {
  const type=$("#contractType").value;
  $("#installmentFields").classList.toggle('hidden',type!=='installment');
  $("#financingFields").classList.toggle('hidden',type!=='financing');
  $("#recurringFields").classList.toggle('hidden',type!=='recurring');
  $("#reserveFields").classList.toggle('hidden',type!=='reserve');
  $("#costTreatmentGroup").classList.toggle('hidden',type==='reserve'||type==='financing');
  if (type==='recurring' && $("#contractCategory").value==='Aquisição') $("#contractCategory").value='Juros de obra';
  if (type==='recurring') $("#costTreatment").value='additional';
  if (type==='financing') $("#contractCategory").value='Financiamento';
}

function renderContractsList() {
  const box=$("#contractsFullList");
  const all=[];
  financial.contracts.forEach(c=>all.push({type:'contract',...c})); financial.reserves.forEach(r=>all.push({type:'reserve',...r}));
  if (!all.length) { box.innerHTML='<div class="big-empty"><strong>Nenhum compromisso cadastrado</strong><span>Crie o primeiro contrato ou meta financeira.</span></div>'; return; }
  box.innerHTML=all.map(item=>{
    if(item.type==='reserve') { const pct=item.targetValue?clamp(Number(item.contributedTotal||0)/Number(item.targetValue)*100):0; return `<button class="contract-list-card" data-reserve-detail="${item.id}"><span class="type-chip blue-chip">META</span><strong>${escapeHtml(item.name)}</strong><div class="list-progress"><i style="width:${pct}%"></i></div><small>${currency(item.contributedTotal)} de ${currency(item.targetValue)} • ${pct.toFixed(0)}%</small></button>`; }
    const p=contractProgress(item); const installments=financial.installmentsByContract[item.id]||[]; const paidCount=installments.filter(i=>i.status==='paid').length;
    if(item.type==='financing') return `<button class="contract-list-card" data-contract-detail="${item.id}"><span class="type-chip financing-chip">FINANCIAMENTO</span><strong>${escapeHtml(item.name)}</strong><div class="list-progress blue-progress"><i style="width:${p.pct}%"></i></div><small>${paidCount}/${item.installmentsCount} prestações • ${currency(p.principalPaid)} do principal amortizado</small></button>`;
    return `<button class="contract-list-card" data-contract-detail="${item.id}"><span class="type-chip">${item.type==='installment'?'PARCELADO':'RECORRENTE'}</span><strong>${escapeHtml(item.name)}</strong>${item.type==='installment'?`<div class="list-progress"><i style="width:${p.pct}%"></i></div><small>${paidCount}/${item.installmentsCount} parcelas • ${currency(p.paid)} pagos</small>`:`<small>${currency(p.paid)} pagos até agora • ${escapeHtml(item.category)}</small>`}</button>`;
  }).join('');
}

function openContractDetail(contractId) {
  const c=contractById(contractId); if(!c) return;
  const p=contractProgress(c); const box=$("#contractDetailContent");

  if(c.type==='installment') {
    const installments=financial.installmentsByContract[c.id]||[];
    box.innerHTML=`<div class="detail-hero"><span class="type-chip">PARCELADO</span><h3 id="contractDetailTitle">${escapeHtml(c.name)}</h3><p>${escapeHtml(c.category)} • ${c.costTreatment==='additional'?'custo adicional':'parte do imóvel'}</p><strong>${currency(c.totalValue)}</strong><div class="list-progress large"><i style="width:${p.pct}%"></i></div><small>${currency(p.paid)} pagos • ${p.pct.toFixed(1).replace('.',',')}%</small></div><div class="detail-actions"><button class="primary-button" data-pay-contract="${c.id}">Registrar pagamento</button></div><div class="installment-list">${installments.map(i=>{ const rem=Math.max(0,Number(i.expectedValue||0)-Number(i.paidValue||0)); const status=i.status==='paid'?'Pago':i.status==='partial'?'Parcial':i.dueDate<todayISO()?'Vencido':'Futuro'; return `<button class="installment-row ${status.toLowerCase()}" data-pay-installment="${c.id}|${i.id}" ${status==='Pago'?'disabled':''}><span class="installment-number">${String(i.number).padStart(2,'0')}</span><span><strong>${dateBR(i.dueDate)}</strong><small>${status}${status!=='Pago'?` • resta ${currency(rem)}`:''}</small></span><b>${currency(i.expectedValue)}</b></button>`; }).join('')}</div>`;
  } else if(c.type==='financing') {
    const installments=financial.installmentsByContract[c.id]||[];
    const remainingPrincipal=Math.max(0,Number(c.financedPrincipal||0)-Number(c.principalPaid||0));
    box.innerHTML=`<div class="detail-hero financing-detail"><span class="type-chip financing-chip">FINANCIAMENTO</span><h3 id="contractDetailTitle">${escapeHtml(c.name)}</h3><p>Principal financiado</p><strong>${currency(c.financedPrincipal||0)}</strong><div class="list-progress large blue-progress"><i style="width:${p.pct}%"></i></div><small>${currency(c.principalPaid||0)} amortizados • ${p.pct.toFixed(1).replace('.',',')}%</small></div><div class="detail-stats"><div><span>Principal restante</span><strong>${currency(remainingPrincipal)}</strong></div><div><span>Juros/seguros/encargos pagos</span><strong>${currency(c.financingAdditionalPaid||0)}</strong></div></div><div class="detail-actions"><button class="primary-button" data-pay-contract="${c.id}">Registrar prestação</button></div><div class="installment-list">${installments.map(i=>{ const status=i.status==='paid'?'Pago':i.status==='partial'?'Parcial':i.dueDate<todayISO()?'Vencido':'Futuro'; const estimate=Number(i.expectedValue||0)>0?currency(i.expectedValue):'A confirmar'; return `<button class="installment-row ${status.toLowerCase()}" data-pay-installment="${c.id}|${i.id}" ${status==='Pago'?'disabled':''}><span class="installment-number">${String(i.number).padStart(2,'0')}</span><span><strong>${dateBR(i.dueDate)}</strong><small>${status}${Number(i.principalPaid||0)>0?` • amortizado ${currency(i.principalPaid)}`:''}</small></span><b>${estimate}</b></button>`; }).join('')}</div>`;
  } else {
    box.innerHTML=`<div class="detail-hero"><span class="type-chip">RECORRENTE</span><h3 id="contractDetailTitle">${escapeHtml(c.name)}</h3><p>${escapeHtml(c.category)} • ${c.costTreatment==='additional'?'custo adicional':'parte do imóvel'}</p><strong>${currency(p.paid)}</strong><small>Total pago até agora</small></div><div class="detail-actions"><button class="primary-button" data-pay-contract="${c.id}">Registrar novo pagamento</button></div>`;
  }
  openModal($("#contractDetailModal"));
}

function openReserveDetail(id) {
  const r=reserveById(id); if(!r) return; const pct=r.targetValue?clamp(Number(r.contributedTotal||0)/Number(r.targetValue)*100):0;
  $("#contractDetailContent").innerHTML=`<div class="detail-hero reserve-detail"><span class="type-chip blue-chip">META FINANCEIRA</span><h3 id="contractDetailTitle">${escapeHtml(r.name)}</h3><p>${escapeHtml(r.category)}</p><strong>${currency(r.contributedTotal)}</strong><div class="list-progress large"><i style="width:${pct}%"></i></div><small>${pct.toFixed(1).replace('.',',')}% de ${currency(r.targetValue)}</small></div><div class="detail-stats"><div><span>Saldo disponível</span><strong>${currency(r.currentBalance)}</strong></div><div><span>Já utilizado</span><strong>${currency(r.usedTotal)}</strong></div></div><div class="detail-actions"><button class="primary-button" data-add-reserve="${r.id}">Adicionar aporte</button></div>`;
  openModal($("#contractDetailModal"));
}

function allMovementRecords() {
  const movements=[];
  financial.payments.forEach(p=>{
    const c=contractById(p.contractId);
    movements.push({
      id:p.id,
      date:p.paymentDate,
      label:c?.name||'Pagamento',
      detail:c?.type==='financing'?`Financiamento • encargos ${currency(p.financingAdditionalAmount||0)}`:(p.installmentId?'Parcela':'Pagamento recorrente'),
      amount:p.amount,
      kind:'payment',
      registeredBy:p.registeredBy,
      sourceReserveId:p.sourceReserveId,
      shares:p.shares,
      status:p.status||'active',
      reversedBy:p.reversedBy,
      reversedAt:p.reversedAt,
      reversalReason:p.reversalReason,
      raw:p
    });
  });
  financial.expenses.forEach(e=>movements.push({
    id:e.id,date:e.date,label:e.description,detail:e.category,amount:e.amount,kind:'expense',registeredBy:e.registeredBy,
    sourceReserveId:e.sourceReserveId,shares:e.shares,status:e.status||'active',reversedBy:e.reversedBy,reversedAt:e.reversedAt,reversalReason:e.reversalReason,raw:e
  }));
  financial.reserveTransactions.filter(t=>t.type==='contribution').forEach(t=>{
    const r=reserveById(t.reserveId);
    movements.push({id:t.id,date:t.date,label:r?.name||'Reserva',detail:'Aporte em reserva',amount:t.amount,kind:'reserve',registeredBy:t.registeredBy,shares:t.shares,status:t.status||'active',reversedBy:t.reversedBy,reversedAt:t.reversedAt,reversalReason:t.reversalReason,raw:t});
  });
  return movements.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
}

function renderMovements() {
  const movements=allMovementRecords();
  const box=$("#movementsList");
  if(!movements.length){box.innerHTML='<div class="big-empty"><strong>Nenhuma movimentação ainda</strong><span>Pagamentos, despesas e aportes aparecerão aqui.</span></div>';return;}
  box.innerHTML=`<div class="integrity-banner"><strong>Histórico protegido</strong><span>Lançamentos não são apagados. Correções ficam registradas por estorno.</span></div>` + movements.map(m=>{
    const paidBy=m.sourceReserveId?`Reserva: ${reserveById(m.sourceReserveId)?.name||''}`:Object.keys(m.shares||{}).map(memberName).join(' + ');
    const reversed=m.status==='reversed';
    return `<button class="movement-row movement-clickable ${reversed?'reversed':''}" data-movement-detail="${m.kind}|${m.id}"><div class="movement-icon ${m.kind}">${reversed?'↶':m.kind==='payment'?'✓':m.kind==='expense'?'$':'◎'}</div><div><div class="movement-title-line"><strong>${escapeHtml(m.label)}</strong>${reversed?'<em>ESTORNADO</em>':''}</div><span>${dateBR(m.date)} • ${escapeHtml(m.detail)} • ${escapeHtml(paidBy||'')}</span><small>${reversed?'Estornado por '+escapeHtml(memberName(m.reversedBy)):'Registrado por '+escapeHtml(memberName(m.registeredBy))}</small></div><b>${currency(m.amount)}</b></button>`;
  }).join('');
}

function timestampBR(value) {
  try {
    const d=value?.toDate ? value.toDate() : null;
    return d ? d.toLocaleString('pt-BR') : '—';
  } catch { return '—'; }
}

function openMovementDetail(kind,id) {
  const movement=allMovementRecords().find(item=>item.kind===kind&&item.id===id);
  if(!movement) return;
  selectedMovement=movement;
  const source=movement.sourceReserveId?`Reserva: ${reserveById(movement.sourceReserveId)?.name||'—'}`:(Object.entries(movement.shares||{}).map(([uid,value])=>`${memberName(uid)}: ${currency(value)}`).join(' • ')||'—');
  const reversed=movement.status==='reversed';
  const extra=kind==='payment'&&contractById(movement.raw.contractId)?.type==='financing'
    ? `<div class="detail-audit-grid"><div><span>Amortização</span><strong>${currency(movement.raw.principalAmount||0)}</strong></div><div><span>Juros/encargos</span><strong>${currency(movement.raw.financingAdditionalAmount||0)}</strong></div></div>` : '';
  $("#movementDetailContent").innerHTML=`
    <div class="movement-detail-hero ${reversed?'is-reversed':''}">
      <span class="type-chip">${kind==='payment'?'PAGAMENTO':kind==='expense'?'DESPESA':'APORTE'}</span>
      <h3 id="movementDetailTitle">${escapeHtml(movement.label)}</h3>
      <strong>${currency(movement.amount)}</strong>
      <span>${dateBR(movement.date)} • ${escapeHtml(movement.detail)}</span>
      ${reversed?'<b class="reversed-badge">ESTORNADO</b>':''}
    </div>
    ${extra}
    <div class="movement-audit-card">
      <div><span>Origem / pagador</span><strong>${escapeHtml(source)}</strong></div>
      <div><span>Registrado por</span><strong>${escapeHtml(memberName(movement.registeredBy))}</strong></div>
      ${movement.raw.notes?`<div><span>Observação</span><strong>${escapeHtml(movement.raw.notes)}</strong></div>`:''}
    </div>
    ${reversed?`
      <div class="reversal-history"><strong>Estorno registrado</strong><span>Por ${escapeHtml(memberName(movement.reversedBy))} • ${timestampBR(movement.reversedAt)}</span><p>${escapeHtml(movement.reversalReason||'Sem motivo informado')}</p></div>
    `:`
      <div class="reversal-box">
        <strong>Precisa corrigir este lançamento?</strong>
        <span>Para preservar o histórico, o lançamento original será mantido como estornado. Depois você poderá registrar o valor correto.</span>
        <label class="field"><span>Motivo do estorno</span><div class="field-box"><input id="reversalReason" type="text" maxlength="180" placeholder="Ex.: valor lançado incorretamente"></div></label>
        <button id="reverseMovementButton" class="danger-button" type="button">Estornar lançamento</button>
      </div>
    `}`;
  openModal($("#movementDetailModal"));
}

async function reverseSelectedMovement() {
  if(!selectedMovement||!currentProject||!currentUser) return;
  const reason=$("#reversalReason")?.value||'';
  const button=$("#reverseMovementButton");
  setButtonLoading(button,true,'Estornar lançamento','Estornando...');
  try {
    if(selectedMovement.kind==='payment') {
      const linked=financial.reserveTransactions.find(t=>t.linkedPaymentId===selectedMovement.id&&t.status!=='reversed');
      await reversePayment(currentProject.id,selectedMovement.id,linked?.id||null,reason,currentUser);
    } else if(selectedMovement.kind==='expense') {
      const linked=financial.reserveTransactions.find(t=>t.linkedExpenseId===selectedMovement.id&&t.status!=='reversed');
      await reverseExpense(currentProject.id,selectedMovement.id,linked?.id||null,reason,currentUser);
    } else {
      await reverseReserveContribution(currentProject.id,selectedMovement.id,reason,currentUser);
    }
    await refreshFinancial();
    closeModal($("#movementDetailModal"));
    renderMovements();
    showToast('Estorno concluído e preservado no histórico.','success');
  } catch(err) {
    console.error(err);
    showToast(err.message||'Não foi possível estornar este lançamento.','error');
  } finally {
    setButtonLoading(button,false,'Estornar lançamento');
  }
}

function csvCell(value) {
  const text=String(value??'');
  return `"${text.replaceAll('"','""')}"`;
}

function downloadBlob(filename,content,type) {
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function backupDateStamp() { return todayISO().replaceAll('-',''); }

function exportJsonBackup() {
  const payload={
    schemaVersion:'0.6',
    generatedAt:new Date().toISOString(),
    project:currentProject,
    members:currentMembers,
    data:financial,
    note:'Registros estornados são mantidos propositalmente para auditoria.'
  };
  downloadBlob(`nosso-ape-backup-${backupDateStamp()}.json`,JSON.stringify(payload,null,2),'application/json;charset=utf-8');
  showToast('Backup JSON gerado.','success');
}

function exportCsvMovements() {
  const header=['Tipo','Data','Descrição','Detalhe','Valor','Origem/Pagadores','Registrado por','Status','Estornado por','Motivo do estorno','ID'];
  const rows=allMovementRecords().map(m=>{
    const source=m.sourceReserveId?`Reserva: ${reserveById(m.sourceReserveId)?.name||''}`:Object.entries(m.shares||{}).map(([uid,value])=>`${memberName(uid)}: ${currency(value)}`).join(' + ');
    return [m.kind,m.date,m.label,m.detail,Number(m.amount||0).toFixed(2),source,memberName(m.registeredBy),m.status==='reversed'?'ESTORNADO':'ATIVO',m.reversedBy?memberName(m.reversedBy):'',m.reversalReason||'',m.id];
  });
  const csv='\ufeff'+[header,...rows].map(row=>row.map(csvCell).join(';')).join('\r\n');
  downloadBlob(`nosso-ape-movimentacoes-${backupDateStamp()}.csv`,csv,'text/csv;charset=utf-8');
  showToast('CSV de movimentações gerado.','success');
}



function parseISO(value) {
  if(!value) return null;
  const [y,m,d]=value.split('-').map(Number);
  if(!y||!m||!d) return null;
  return new Date(y,m-1,d,12,0,0,0);
}
function isoFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function monthKeyFromDate(date){ return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`; }
function monthKeyFromISO(value){ return value?.slice(0,7)||''; }
function addDaysToISO(value,days){ const d=parseISO(value); d.setDate(d.getDate()+days); return isoFromDate(d); }
function addMonthsStable(value,months){
  const d=parseISO(value); if(!d) return null;
  const day=d.getDate(); const target=new Date(d.getFullYear(),d.getMonth()+months,1,12);
  const last=new Date(target.getFullYear(),target.getMonth()+1,0,12).getDate();
  target.setDate(Math.min(day,last)); return isoFromDate(target);
}
function daysBetweenISO(from,to){
  const a=parseISO(from), b=parseISO(to); if(!a||!b) return null;
  return Math.round((b-a)/86400000);
}
function monthNameLong(date){
  return date.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase());
}
function shortMonth(date){ return date.toLocaleDateString('pt-BR',{month:'short'}).replace('.',''); }
function obligationAmount(item){ return Number(item.amount||0); }
function formatObligationTotal(items){
  const known=items.reduce((s,item)=>s+(item.unknownAmount?0:obligationAmount(item)),0);
  const unknown=items.filter(item=>item.unknownAmount).length;
  return {known,unknown,text:`${currency(known)}${unknown?` + ${unknown} a confirmar`:''}`};
}
function obligationStatus(item){
  const today=todayISO();
  if(item.dueDate<today) return 'overdue';
  if(item.dueDate===today) return 'today';
  return 'future';
}
function knownObligations(horizonMonths=24){
  const items=[];
  const today=todayISO();
  const horizon=addMonthsStable(today,horizonMonths);

  financial.contracts.filter(c=>['installment','financing'].includes(c.type)).forEach(contract=>{
    (financial.installmentsByContract[contract.id]||[]).filter(i=>i.status!=='paid').forEach(i=>{
      if(!i.dueDate) return;
      let amount=0, unknownAmount=false;
      if(contract.type==='financing'){
        const expected=Number(i.expectedValue||contract.estimatedInstallmentValue||0);
        const already=Number(i.paidValue||0);
        amount=Math.max(0,expected-already);
        unknownAmount=expected<=0;
      } else {
        amount=Math.max(0,Number(i.expectedValue||0)-Number(i.paidValue||0));
      }
      items.push({
        id:`${contract.id}|${i.id}`,
        contractId:contract.id,
        installmentId:i.id,
        contractType:contract.type,
        label:contract.name,
        category:contract.category||'Outros',
        number:i.number,
        installmentsCount:contract.installmentsCount,
        dueDate:i.dueDate,
        amount,
        unknownAmount,
        estimated:false,
        status:obligationStatus({dueDate:i.dueDate})
      });
    });
  });

  // Recorrentes não geram parcelas no banco. Para o planejamento, criamos apenas
  // uma projeção visual a partir do mês atual quando existe valor estimado.
  financial.contracts.filter(c=>c.type==='recurring'&&Number(c.estimatedMonthlyValue||0)>0).forEach(contract=>{
    const start=contract.startDate||today;
    const startMonth=monthKeyFromISO(start);
    const currentMonth=monthKeyFromISO(today);
    const base=startMonth>currentMonth?start:today.slice(0,8)+String(Math.min(parseISO(start)?.getDate()||1,new Date(parseISO(today).getFullYear(),parseISO(today).getMonth()+1,0).getDate())).padStart(2,'0');
    const alreadyPaidMonths=new Set(activePayments().filter(p=>p.contractId===contract.id&&p.paymentDate).map(p=>p.paymentDate.slice(0,7)));
    for(let n=0;n<=horizonMonths;n++){
      let due=addMonthsStable(base,n); if(!due) continue;
      if(due<start) continue;
      if(due>horizon) break;
      if(alreadyPaidMonths.has(due.slice(0,7))) continue;
      items.push({
        id:`recurring:${contract.id}:${due}`,
        contractId:contract.id,
        installmentId:null,
        contractType:'recurring',
        label:contract.name,
        category:contract.category||'Outros',
        number:null,
        installmentsCount:null,
        dueDate:due,
        amount:Number(contract.estimatedMonthlyValue||0),
        unknownAmount:false,
        estimated:true,
        status:obligationStatus({dueDate:due})
      });
    }
  });

  return items.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.label.localeCompare(b.label));
}
function obligationsForWindow(obligations,days){
  const today=todayISO(); const end=addDaysToISO(today,days);
  return obligations.filter(item=>item.dueDate>=today&&item.dueDate<=end);
}
function renderDashboardAgenda(){
  const obligations=knownObligations(24); const overdue=obligations.filter(o=>o.dueDate<todayISO()); const next30=obligationsForWindow(obligations,30);
  const ov=formatObligationTotal(overdue), n30=formatObligationTotal(next30);
  $('#dashboardOverdueValue').textContent=ov.known>0?currency(ov.known):(ov.unknown?'A confirmar':currency(0));
  $('#dashboardOverdueCount').textContent=`${overdue.length} ${overdue.length===1?'compromisso':'compromissos'}${ov.unknown?` • ${ov.unknown} sem valor`:''}`;
  $('#dashboardNext30Value').textContent=n30.known>0?currency(n30.known):(n30.unknown?'A confirmar':currency(0));
  $('#dashboardNext30Count').textContent=`${next30.length} ${next30.length===1?'compromisso':'compromissos'}${n30.unknown?` • ${n30.unknown} sem valor`:''}`;
  $('#agendaDashboardCard')?.classList.toggle('has-overdue',overdue.length>0);
}
function agendaFilterItems(obligations,filter){
  if(filter==='overdue') return obligations.filter(o=>o.dueDate<todayISO());
  return obligationsForWindow(obligations,Number(filter)||30);
}
function renderCalendarSummary(obligations){
  const groups=[
    ['Vencidos',obligations.filter(o=>o.dueDate<todayISO()),'danger'],
    ['7 dias',obligationsForWindow(obligations,7),'green'],
    ['30 dias',obligationsForWindow(obligations,30),'blue'],
    ['90 dias',obligationsForWindow(obligations,90),'purple']
  ];
  $('#calendarSummaryGrid').innerHTML=groups.map(([label,items,tone])=>{
    const t=formatObligationTotal(items);
    return `<div class="calendar-summary-card ${tone}"><span>${label}</span><strong>${t.known?compactCurrency(t.known):(t.unknown?'A confirmar':currency(0))}</strong><small>${items.length} ${items.length===1?'compromisso':'compromissos'}${t.unknown?` • ${t.unknown} sem valor`:''}</small></div>`;
  }).join('');
}
function obligationRowHtml(item,compact=false){
  const status=obligationStatus(item); const statusLabel=status==='overdue'?'Vencido':status==='today'?'Hoje':item.estimated?'Estimado':'Previsto';
  const number=item.number?` • ${String(item.number).padStart(2,'0')}/${item.installmentsCount}`:'';
  const amount=item.unknownAmount?'A confirmar':currency(item.amount);
  return `<button class="agenda-obligation-row ${status}" data-calendar-pay="${item.contractId}|${item.installmentId||''}" type="button"><span class="agenda-date-badge"><b>${parseISO(item.dueDate).getDate()}</b><small>${shortMonth(parseISO(item.dueDate))}</small></span><span class="agenda-obligation-copy"><strong>${escapeHtml(item.label)}${number}</strong><small>${escapeHtml(item.category)} • ${statusLabel}${item.estimated?' • projeção':''}</small></span><b>${amount}</b></button>`;
}
function renderAgendaPeriodList(obligations){
  const list=agendaFilterItems(obligations,agendaFilter); const target=$('#agendaPeriodList');
  $$('.agenda-filter').forEach(b=>b.classList.toggle('active',b.dataset.agendaFilter===agendaFilter));
  if(!list.length){target.innerHTML='<div class="calendar-empty">Nenhum compromisso neste período.</div>';return;}
  const shown=list.slice(0,12);
  target.innerHTML=shown.map(item=>obligationRowHtml(item,true)).join('')+(list.length>shown.length?`<div class="agenda-more">+ ${list.length-shown.length} compromissos além dos exibidos</div>`:'');
}
function renderMonthGrid(obligations){
  if(!calendarCursor){ const t=parseISO(todayISO()); calendarCursor=new Date(t.getFullYear(),t.getMonth(),1,12); }
  const year=calendarCursor.getFullYear(), month=calendarCursor.getMonth();
  $('#calendarMonthTitle').textContent=monthNameLong(calendarCursor);
  const first=new Date(year,month,1,12); const gridStart=new Date(year,month,1-first.getDay(),12);
  const byDate=Object.groupBy ? Object.groupBy(obligations,o=>o.dueDate) : obligations.reduce((acc,o)=>((acc[o.dueDate]??=[]).push(o),acc),{});
  const cells=[];
  for(let i=0;i<42;i++){
    const d=new Date(gridStart); d.setDate(gridStart.getDate()+i); const iso=isoFromDate(d); const dayItems=byDate[iso]||[]; const totals=formatObligationTotal(dayItems);
    const outside=d.getMonth()!==month; const today=iso===todayISO(); const selected=iso===selectedCalendarDate; const overdue=dayItems.some(x=>x.dueDate<todayISO());
    const amountLabel=totals.known>0?compactCurrency(totals.known):(totals.unknown?'?':'');
    cells.push(`<button class="calendar-day ${outside?'outside':''} ${today?'today':''} ${selected?'selected':''} ${dayItems.length?'has-items':''} ${overdue?'has-overdue':''}" data-calendar-date="${iso}" type="button"><span class="day-number">${d.getDate()}</span>${dayItems.length?`<span class="day-dot"></span><small>${amountLabel}</small>`:''}</button>`);
  }
  $('#calendarGrid').innerHTML=cells.join('');
}
function renderSelectedDay(obligations){
  const selected=selectedCalendarDate||todayISO(); const d=parseISO(selected); const items=obligations.filter(o=>o.dueDate===selected); const total=formatObligationTotal(items);
  $('#selectedDayTitle').textContent=d.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase());
  $('#selectedDayTotal').textContent=items.length?total.text:'Sem compromissos';
  $('#selectedDayList').innerHTML=items.length?items.map(item=>obligationRowHtml(item)).join(''):'<div class="calendar-empty">Nenhum vencimento ou estimativa para este dia.</div>';
}
function cashflowMonths(obligations,count=12){
  const today=parseISO(todayISO()); const start=new Date(today.getFullYear(),today.getMonth(),1,12); const result=[];
  for(let i=0;i<count;i++){
    const d=new Date(start.getFullYear(),start.getMonth()+i,1,12); const key=monthKeyFromDate(d); const items=obligations.filter(o=>o.dueDate>=todayISO()&&monthKeyFromISO(o.dueDate)===key); const total=formatObligationTotal(items);
    result.push({date:d,key,items,known:total.known,unknown:total.unknown});
  }
  return result;
}
function renderCashflow(obligations){
  const months=cashflowMonths(obligations,12); const total=months.reduce((s,m)=>s+m.known,0); const unknown=months.reduce((s,m)=>s+m.unknown,0); const biggest=months.reduce((best,m)=>m.known>best.known?m:best,months[0]||{known:0,date:new Date()});
  $('#cashflowHero').innerHTML=`<div><span>12 meses conhecidos</span><strong>${currency(total)}</strong><small>${unknown?`${unknown} compromisso${unknown===1?'':'s'} ainda sem valor conhecido`:'Todos os valores desta janela estão definidos'}</small></div><div><span>Mês de maior saída conhecida</span><strong>${biggest.known?monthNameLong(biggest.date):'—'}</strong><small>${biggest.known?currency(biggest.known):'Sem valores previstos'}</small></div>`;
  const max=Math.max(...months.map(m=>m.known),1);
  $('#cashflowBars').innerHTML=months.map(m=>`<button class="cashflow-month" data-calendar-month="${m.key}" type="button"><span class="cashflow-value">${m.known?compactCurrency(m.known):m.unknown?'?':'—'}</span><div class="cashflow-track"><i style="height:${m.known?Math.max(7,m.known/max*100):0}%"></i></div><strong>${shortMonth(m.date)}</strong><small>${m.items.length} item${m.items.length===1?'':'s'}${m.unknown?' • ?':''}</small></button>`).join('');
}
function renderCalendar(){
  const obligations=knownObligations(24);
  if(!selectedCalendarDate) selectedCalendarDate=todayISO();
  if(!calendarCursor){ const t=parseISO(selectedCalendarDate); calendarCursor=new Date(t.getFullYear(),t.getMonth(),1,12); }
  renderCalendarSummary(obligations); renderAgendaPeriodList(obligations); renderMonthGrid(obligations); renderSelectedDay(obligations); renderCashflow(obligations);
}
function openCalendar(){
  const t=parseISO(todayISO()); calendarCursor=new Date(t.getFullYear(),t.getMonth(),1,12); selectedCalendarDate=todayISO(); agendaFilter='30'; renderCalendar(); openModal($('#calendarModal'));
}

function addToBucket(map,key,value){ if(!key) key='Outros'; map[key]=(map[key]||0)+(Number(value)||0); }
function monthLabel(key){ const [y,m]=key.split('-'); const names=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']; return `${names[Number(m)-1]||m}/${String(y).slice(2)}`; }
function daysFromToday(days){ const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+days); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

function renderBarList(containerId,buckets,emptyText='Ainda não há dados para este gráfico.'){
  const box=$(containerId); const items=Object.entries(buckets).sort((a,b)=>b[1]-a[1]);
  if(!items.length){box.innerHTML=`<div class="report-empty">${emptyText}</div>`;return;}
  const max=Math.max(...items.map(([,v])=>v),1);
  box.innerHTML=items.map(([label,value])=>`<div class="report-bar-row"><div class="report-bar-label"><span>${escapeHtml(label)}</span><strong>${currency(value)}</strong></div><div class="report-bar-track"><i style="width:${clamp(value/max*100)}%"></i></div></div>`).join('');
}

function calculateReportData(){
  const summary=calculateSummary();
  const capitalByCategory={}; const extraByCategory={}; const monthly={};

  activePayments().forEach(p=>{
    const c=contractById(p.contractId); const category=c?.category||'Outros';
    if(!p.sourceReserveId){ addToBucket(capitalByCategory,category,p.amount); if(p.paymentDate) addToBucket(monthly,p.paymentDate.slice(0,7),p.amount); }
    if(p.costTreatment==='additional') addToBucket(extraByCategory,category,p.amount);
    if(p.costTreatment==='financing') addToBucket(extraByCategory,'Financiamento',p.financingAdditionalAmount||0);
  });
  activeExpenses().forEach(e=>{
    if(!e.sourceReserveId){ addToBucket(capitalByCategory,e.category||'Outros',e.amount); if(e.date) addToBucket(monthly,e.date.slice(0,7),e.amount); }
    if(e.countInRealCost!==false) addToBucket(extraByCategory,e.category||'Outros',e.amount);
  });
  activeReserveTransactions().filter(t=>t.type==='contribution').forEach(t=>{
    const r=reserveById(t.reserveId); addToBucket(capitalByCategory,r?.category||'Reservas',t.amount); if(t.date) addToBucket(monthly,t.date.slice(0,7),t.amount);
  });

  let regularRemaining=0, financingPrincipalRemaining=0, next30=0;
  const end30=daysFromToday(30), today=todayISO();
  financial.contracts.forEach(c=>{
    if(c.type==='installment'){
      (financial.installmentsByContract[c.id]||[]).filter(i=>i.status!=='paid').forEach(i=>{
        const rem=Math.max(0,Number(i.expectedValue||0)-Number(i.paidValue||0)); regularRemaining+=rem;
        if(i.dueDate>=today&&i.dueDate<=end30) next30+=rem;
      });
    } else if(c.type==='financing'){
      financingPrincipalRemaining+=Math.max(0,Number(c.financedPrincipal||0)-Number(c.principalPaid||0));
      (financial.installmentsByContract[c.id]||[]).filter(i=>i.status!=='paid'&&i.dueDate>=today&&i.dueDate<=end30).forEach(i=>{ next30+=Number(i.expectedValue||0); });
    }
  });
  return {summary,capitalByCategory,extraByCategory,monthly,regularRemaining,financingPrincipalRemaining,next30};
}

function renderReports(){
  const r=calculateReportData(); const s=r.summary;
  const extraPct=s.propertyValue>0?s.additionalCosts/s.propertyValue*100:0;
  const stillToEmploy=Math.max(0,s.realCost-s.employedCapital);
  $("#reportHero").innerHTML=`<div class="report-hero-main"><span>Custo real conhecido</span><strong>${currency(s.realCost)}</strong><small>${extraPct.toFixed(2).replace('.',',')}% acima do valor contratado até agora</small></div><div class="report-kpi-grid"><div><span>Capital empregado</span><strong>${currency(s.employedCapital)}</strong></div><div><span>Custos adicionais</span><strong>${currency(s.additionalCosts)}</strong></div><div><span>Saldo atual em reservas</span><strong>${currency(s.reserveBalance)}</strong></div><div><span>Diferença até o custo conhecido</span><strong>${currency(stillToEmploy)}</strong></div></div>`;
  renderBarList('#reportCategoryBars',r.capitalByCategory);
  renderBarList('#reportAdditionalBars',r.extraByCategory,'Nenhum custo adicional reconhecido até agora.');

  const months=Object.entries(r.monthly).sort((a,b)=>a[0].localeCompare(b[0])).slice(-8); const max=Math.max(...months.map(([,v])=>v),1);
  $("#reportMonthlyBars").innerHTML=months.length?months.map(([m,v])=>`<div class="month-column"><div class="month-value">${compactCurrency(v)}</div><div class="month-bar"><i style="height:${Math.max(6,v/max*100)}%"></i></div><span>${monthLabel(m)}</span></div>`).join(''):'<div class="report-empty">Os aportes mensais aparecerão aqui.</div>';

  $("#reportFuture").innerHTML=`<div class="future-kpi"><span>Parcelas comuns ainda previstas</span><strong>${currency(r.regularRemaining)}</strong></div><div class="future-kpi"><span>Principal de financiamento ainda não amortizado</span><strong>${currency(r.financingPrincipalRemaining)}</strong></div><div class="future-kpi highlight"><span>Compromissos estimados nos próximos 30 dias</span><strong>${currency(r.next30)}</strong></div>`;
}

function celebrate(name, copy='Mais uma etapa do nosso projeto concluída.') {
  $("#celebrationName").textContent=name; $("#celebrationCopy").textContent=copy;
  const box=$("#confettiBox"); box.innerHTML='';
  for(let i=0;i<24;i++){ const s=document.createElement('i'); s.style.left=`${(i*37)%100}%`; s.style.animationDelay=`${(i%8)*.08}s`; s.style.transform=`rotate(${i*29}deg)`; box.appendChild(s); }
  openModal($("#celebrationModal"));
}

function checkCelebration(before, after) {
  for(const reserve of after.reserves){ const old=before.reserves.find(r=>r.id===reserve.id); const was=old&&Number(old.contributedTotal||0)>=Number(old.targetValue||0); const is=Number(reserve.contributedTotal||0)>=Number(reserve.targetValue||0); if(is&&!was){celebrate(reserve.name,'A meta financeira foi alcançada. O valor continua rastreado mesmo quando for utilizado.'); return;} }
  for(const c of after.contracts.filter(x=>['installment','financing'].includes(x.type))){ const oldC=before.contracts.find(x=>x.id===c.id); if(!oldC) continue; if(c.type==='financing'){ const oldIns=before.installmentsByContract[c.id]||[]; const newIns=after.installmentsByContract[c.id]||[]; const wasDone=oldIns.length>0&&oldIns.every(i=>i.status==='paid'); const isDone=newIns.length>0&&newIns.every(i=>i.status==='paid'); if(isDone&&!wasDone){celebrate(c.name,'Todas as prestações do financiamento foram registradas como quitadas.'); return;} } else { const oldPaid=before.payments.filter(p=>p.status!=='reversed'&&p.contractId===c.id).reduce((s,p)=>s+Number(p.amount||0),0); const newPaid=after.payments.filter(p=>p.status!=='reversed'&&p.contractId===c.id).reduce((s,p)=>s+Number(p.amount||0),0); if(oldPaid+0.009<Number(c.totalValue||0) && newPaid+0.009>=Number(c.totalValue||0)){celebrate(c.name,'Todas as parcelas deste compromisso foram concluídas.'); return;} } }
}

// --- Auth ---
$("#loginForm").addEventListener('submit',async e=>{e.preventDefault();setButtonLoading($("#loginButton"),true,'Entrar','Entrando...');try{await login($("#email").value,$("#password").value);showToast('Acesso realizado com sucesso.','success');}catch(err){showToast(friendlyAuthError(err),'error');}finally{setButtonLoading($("#loginButton"),false,'Entrar');}});
$("#togglePassword").addEventListener('click',()=>{const input=$("#password");const show=input.type==='password';input.type=show?'text':'password';});
$("#forgotPassword").addEventListener('click',async()=>{try{await resetPassword($("#email").value);showToast('E-mail de redefinição enviado.','success');}catch(err){showToast(friendlyAuthError(err),'error');}});
async function doLogout(){try{await logout();$$('.modal-layer').forEach(closeModal);showToast('Sessão encerrada.');}catch{showToast('Não foi possível sair agora.','error');}}
$("#logoutButton").addEventListener('click',doLogout); $("#setupLogoutButton").addEventListener('click',doLogout);

// --- Setup project ---
function setSetupMode(mode){const create=mode==='create';$("#createTab").classList.toggle('active',create);$("#joinTab").classList.toggle('active',!create);$("#createProjectForm").classList.toggle('hidden',!create);$("#joinProjectForm").classList.toggle('hidden',create);}
$("#createTab").addEventListener('click',()=>setSetupMode('create'));$("#joinTab").addEventListener('click',()=>setSetupMode('join'));
$("#createProjectForm").addEventListener('submit',async e=>{e.preventDefault();const b=$("#createProjectButton");setButtonLoading(b,true,'Criar nosso projeto','Criando...');try{const result=await createProject({name:$("#projectNameInput").value,propertyValue:$("#propertyValueInput").value,purchaseDate:$("#purchaseDateInput").value,partnerEmail:$("#partnerEmailInput").value},currentUser);currentProject=result.project;currentMembers=await getProjectMembers(currentProject.id);await refreshFinancial();showApp();if(result.inviteCode){$("#createdInviteCode").textContent=result.inviteCode;openModal($("#inviteSuccessModal"));}}catch(err){console.error(err);showToast(err.message||'Não foi possível criar o projeto.','error');}finally{setButtonLoading(b,false,'Criar nosso projeto');}});
$("#joinProjectForm").addEventListener('submit',async e=>{e.preventDefault();const b=$("#joinProjectButton");setButtonLoading(b,true,'Entrar no projeto','Entrando...');try{currentProject=await joinProjectByInvite($("#inviteCodeInput").value,currentUser);currentMembers=await getProjectMembers(currentProject.id);await refreshFinancial();showApp();showToast('Vocês agora estão conectados ao mesmo projeto.','success');}catch(err){showToast(err.message||'Não foi possível aceitar o convite.','error');}finally{setButtonLoading(b,false,'Entrar no projeto');}});

// --- Project settings ---
function renderProjectMembers(){const list=$("#membersList");$("#membersSummary").textContent=`${currentMembers.length} ${currentMembers.length===1?'pessoa vinculada':'pessoas vinculadas'}`;list.innerHTML=currentMembers.map((m,i)=>{const n=m.displayName||m.email?.split('@')[0]||'Membro';return `<div class="member-row"><div class="mini-avatar ${i%2===0?'blue':'rose'}">${escapeHtml(n.charAt(0).toUpperCase())}</div><div><strong>${escapeHtml(n)}</strong><span>${escapeHtml(m.email||'')}</span></div><small>${m.role==='owner'?'Criador do projeto':'Membro'}</small></div>`;}).join('');}
$("#projectSettingsButton").addEventListener('click',()=>{$("#settingsProjectName").value=currentProject.name||'';$("#settingsPropertyValue").value=Number(currentProject.propertyValue)||'';$("#settingsPurchaseDate").value=currentProject.purchaseDate||'';renderProjectMembers();closeModal($("#moreModal"));openModal($("#projectModal"));});
$("#projectSettingsForm").addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;setButtonLoading(b,true,'Salvar alterações');try{currentProject=await updateProject(currentProject.id,{name:$("#settingsProjectName").value.trim(),propertyValue:Number($("#settingsPropertyValue").value)||0,purchaseDate:$("#settingsPurchaseDate").value||null});renderProject();showToast('Dados do projeto atualizados.','success');}catch{showToast('Não foi possível atualizar o projeto.','error');}finally{setButtonLoading(b,false,'Salvar alterações');}});
$("#newInviteForm").addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;setButtonLoading(b,true,'Gerar código de convite','Gerando...');try{const code=await createInvite(currentProject.id,$("#newInviteEmail").value,currentUser.uid);$("#createdInviteCode").textContent=code;closeModal($("#projectModal"));openModal($("#inviteSuccessModal"));}catch{showToast('Não foi possível gerar o convite.','error');}finally{setButtonLoading(b,false,'Gerar código de convite');}});
$("#copyInviteButton").addEventListener('click',async()=>{const code=$("#createdInviteCode").textContent.trim();try{await navigator.clipboard.writeText(code);showToast('Código copiado.','success');}catch{showToast(`Código: ${code}`);}});$("#continueAfterInvite").addEventListener('click',()=>closeModal($("#inviteSuccessModal")));

// --- Contract / reserve creation ---
$("#contractType").addEventListener('change',toggleContractFields);
$("#contractForm").addEventListener('submit',async e=>{e.preventDefault();const b=$("#saveContractButton");setButtonLoading(b,true,'Salvar');try{const type=$("#contractType").value;if(type==='installment')await createInstallmentContract(currentProject.id,{name:$("#contractName").value,category:$("#contractCategory").value,costTreatment:$("#costTreatment").value,totalValue:$("#contractTotal").value,installmentsCount:$("#contractInstallments").value,firstDueDate:$("#contractFirstDue").value},currentUser);else if(type==='financing')await createFinancingContract(currentProject.id,{name:$("#contractName").value,financedPrincipal:$("#financingPrincipal").value,installmentsCount:$("#financingInstallments").value,firstDueDate:$("#financingFirstDue").value,estimatedInstallmentValue:$("#financingEstimate").value},currentUser);else if(type==='recurring')await createRecurringContract(currentProject.id,{name:$("#contractName").value,category:$("#contractCategory").value,costTreatment:$("#costTreatment").value,estimatedMonthlyValue:$("#recurringEstimate").value,startDate:$("#recurringStart").value},currentUser);else await createReserve(currentProject.id,{name:$("#contractName").value,category:$("#contractCategory").value,targetValue:$("#reserveTarget").value},currentUser);await refreshFinancial();closeModal($("#contractModal"));showToast(type==='reserve'?'Meta financeira criada.':'Contrato criado com sucesso.','success');}catch(err){console.error(err);showToast(err.message||'Não foi possível salvar.','error');}finally{setButtonLoading(b,false,'Salvar');}});

// --- Payments ---
$("#paymentContract").addEventListener('change',()=>{preselectedInstallmentId=null;updatePaymentInstallments();});$("#paymentInstallment").addEventListener('change',fillPaymentAmountFromInstallment);$("#paymentPrincipalAmount").addEventListener('input',updateFinancingComponentsSum);$("#paymentFinancingAdditional").addEventListener('input',updateFinancingComponentsSum);$("#paymentAmount").addEventListener('input',updateFinancingComponentsSum);

$("#paymentForm").addEventListener('submit',async e=>{e.preventDefault();const b=$("#savePaymentButton");const amount=Number($("#paymentAmount").value)||0;const source=$("#paymentSource").value;setButtonLoading(b,true,'Confirmar pagamento','Registrando...');const before=structuredClone(financial);try{await recordPayment(currentProject.id,{contractId:$("#paymentContract").value,installmentId:$("#paymentInstallmentField").classList.contains('hidden')?null:$("#paymentInstallment").value,amount,paymentDate:$("#paymentDate").value,shares:readShares('payment',amount,source),sourceReserveId:sourceReserveId(source),paymentMethod:$("#paymentMethod").value,notes:$("#paymentNotes").value,principalAmount:$("#paymentPrincipalAmount").value,financingAdditionalAmount:$("#paymentFinancingAdditional").value,markInstallmentPaid:$("#markFinancingInstallmentPaid").checked},currentUser);await refreshFinancial();closeModal($("#paymentModal"));showToast('Pagamento registrado.','success');checkCelebration(before,financial);}catch(err){console.error(err);showToast(err.message||'Não foi possível registrar o pagamento.','error');}finally{setButtonLoading(b,false,'Confirmar pagamento');preselectedContractId=null;preselectedInstallmentId=null;}});

// --- Expenses ---
$("#expenseForm").addEventListener('submit',async e=>{e.preventDefault();const b=$("#saveExpenseButton");const amount=Number($("#expenseAmount").value)||0;const source=$("#expenseSource").value;setButtonLoading(b,true,'Salvar despesa','Registrando...');try{await createExpense(currentProject.id,{description:$("#expenseDescription").value,category:$("#expenseCategory").value,amount,date:$("#expenseDate").value,shares:readShares('expense',amount,source),sourceReserveId:sourceReserveId(source),countInRealCost:$("#expenseRealCost").checked,notes:$("#expenseNotes").value},currentUser);await refreshFinancial();e.target.reset();closeModal($("#expenseModal"));showToast('Despesa registrada.','success');}catch(err){console.error(err);showToast(err.message||'Não foi possível salvar a despesa.','error');}finally{setButtonLoading(b,false,'Salvar despesa');}});

// --- Reserve contribution ---
$("#reserveContributionForm").addEventListener('submit',async e=>{e.preventDefault();const b=$("#saveReserveContribution");const amount=Number($("#reserveContributionAmount").value)||0;const before=structuredClone(financial);setButtonLoading(b,true,'Adicionar à reserva','Registrando...');try{await addReserveContribution(currentProject.id,{reserveId:$("#reserveSelect").value,amount,date:$("#reserveContributionDate").value,shares:readShares('reserve',amount,'direct'),notes:$("#reserveContributionNotes").value},currentUser);await refreshFinancial();closeModal($("#reserveModal"));showToast('Aporte registrado.','success');checkCelebration(before,financial);}catch(err){console.error(err);showToast(err.message||'Não foi possível registrar o aporte.','error');}finally{setButtonLoading(b,false,'Adicionar à reserva');}});

// --- Navigation/actions ---
$("#openQuickAdd").addEventListener('click',()=>openModal($("#quickAddModal")));$("#moreButton").addEventListener('click',()=>openModal($("#moreModal")));$("#profileButton").addEventListener('click',()=>openModal($("#moreModal")));
$("#quickContract").addEventListener('click',()=>{closeModal($("#quickAddModal"));prepareContractForm();openModal($("#contractModal"));});
$("#quickPayment").addEventListener('click',()=>{closeModal($("#quickAddModal"));openPaymentFor();});
$("#quickExpense").addEventListener('click',()=>{closeModal($("#quickAddModal"));openExpense();});
$("#quickReserve").addEventListener('click',()=>{closeModal($("#quickAddModal"));openReserve();});
$("#contractsNav").addEventListener('click',()=>{renderContractsList();openModal($("#contractsModal"));});
$("#movementsNav").addEventListener('click',()=>{renderMovements();openModal($("#movementsModal"));});$("#reportsButton").addEventListener('click',()=>{renderReports();closeModal($("#moreModal"));openModal($("#reportsModal"));});
$("#calendarButton").addEventListener('click',()=>{closeModal($("#moreModal"));openCalendar();});
$("#openCalendarDashboard").addEventListener('click',openCalendar);
$("#agendaDashboardCard").addEventListener('click',e=>{if(!e.target.closest('button'))openCalendar();});
$("#calendarPrev").addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1,12);renderCalendar();});
$("#calendarNext").addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1,12);renderCalendar();});
$("#backupButton").addEventListener('click',()=>{closeModal($("#moreModal"));openModal($("#backupModal"));});
$("#exportJsonButton").addEventListener('click',exportJsonBackup);
$("#exportCsvButton").addEventListener('click',exportCsvMovements);$("#contributionHistoryButton").addEventListener('click',()=>{renderReports();openModal($("#reportsModal"));});$("#dashboardContractsButton").addEventListener('click',()=>{renderContractsList();openModal($("#contractsModal"));});
$("#newContractFromList").addEventListener('click',()=>{closeModal($("#contractsModal"));prepareContractForm();openModal($("#contractModal"));});
$("#createReserveFromReserveModal").addEventListener('click',()=>{closeModal($("#reserveModal"));prepareContractForm('reserve');openModal($("#contractModal"));});
$("#closeCelebration").addEventListener('click',()=>closeModal($("#celebrationModal")));

document.addEventListener('click',e=>{
  const agendaFilterButton=e.target.closest('[data-agenda-filter]'); if(agendaFilterButton){agendaFilter=agendaFilterButton.dataset.agendaFilter;renderAgendaPeriodList(knownObligations(24));return;}
  const calendarDay=e.target.closest('[data-calendar-date]'); if(calendarDay){selectedCalendarDate=calendarDay.dataset.calendarDate;const d=parseISO(selectedCalendarDate);calendarCursor=new Date(d.getFullYear(),d.getMonth(),1,12);renderCalendar();return;}
  const calendarMonth=e.target.closest('[data-calendar-month]'); if(calendarMonth){const [y,m]=calendarMonth.dataset.calendarMonth.split('-').map(Number);calendarCursor=new Date(y,m-1,1,12);selectedCalendarDate=`${y}-${String(m).padStart(2,'0')}-01`;renderCalendar();return;}
  const calendarPay=e.target.closest('[data-calendar-pay]'); if(calendarPay){const [cid,iid]=calendarPay.dataset.calendarPay.split('|');closeModal($("#calendarModal"));openPaymentFor(cid,iid||null);return;}
  const movement=e.target.closest('[data-movement-detail]'); if(movement){const [kind,id]=movement.dataset.movementDetail.split('|');openMovementDetail(kind,id);return;}
  const reverseBtn=e.target.closest('#reverseMovementButton'); if(reverseBtn){reverseSelectedMovement();return;}
  const contract=e.target.closest('[data-contract-detail]'); if(contract){closeModal($("#contractsModal"));openContractDetail(contract.dataset.contractDetail);return;}
  const reserve=e.target.closest('[data-reserve-detail]'); if(reserve){closeModal($("#contractsModal"));openReserveDetail(reserve.dataset.reserveDetail);return;}
  const pay=e.target.closest('[data-pay-contract]'); if(pay){closeModal($("#contractDetailModal"));openPaymentFor(pay.dataset.payContract);return;}
  const installment=e.target.closest('[data-pay-installment]'); if(installment){const [cid,iid]=installment.dataset.payInstallment.split('|');closeModal($("#contractDetailModal"));openPaymentFor(cid,iid);return;}
  const addReserve=e.target.closest('[data-add-reserve]'); if(addReserve){closeModal($("#contractDetailModal"));openReserve();setTimeout(()=>{$("#reserveSelect").value=addReserve.dataset.addReserve;$("#reserveSelect").dispatchEvent(new Event('change'));},0);return;}
});
$$('[data-close-modal]').forEach(btn=>btn.addEventListener('click',()=>closeModal(btn.closest('.modal-layer'))));
$$('[data-coming-soon]').forEach(btn=>btn.addEventListener('click',()=>showToast('Essa função entra em uma próxima etapa.')));
document.addEventListener('keydown',e=>{if(e.key==='Escape')$$('.modal-layer').forEach(m=>{if(!m.classList.contains('hidden'))closeModal(m);});});

async function boot(){try{await configureAuthPersistence();}catch(err){console.warn(err);}observeAuth(async user=>{currentUser=user;if(!user){currentProject=null;currentMembers=[];financial=emptyFinancial();showLogin();return;}renderIdentity(user);await loadUserWorkspace(user);});if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));}
boot();
