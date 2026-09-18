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

function contractPayments(contractId) { return financial.payments.filter(item => item.contractId === contractId); }
function contractPaid(contractId) { return contractPayments(contractId).reduce((s,p)=>s+Number(p.amount||0),0); }
function reserveById(id) { return financial.reserves.find(item=>item.id===id); }
function contractById(id) { return financial.contracts.find(item=>item.id===id); }

function calculateSummary() {
  const paymentsTotal = financial.payments.reduce((s,p)=>s+Number(p.amount||0),0);
  const expensesTotal = financial.expenses.reduce((s,e)=>s+Number(e.amount||0),0);
  const reserveBalance = financial.reserves.reduce((s,r)=>s+Number(r.currentBalance||0),0);
  const additionalFromPayments = financial.payments.reduce((sum,p) => {
    if (p.costTreatment === "additional") return sum + Number(p.amount || 0);
    if (p.costTreatment === "financing") return sum + Number(p.financingAdditionalAmount || 0);
    return sum;
  }, 0);
  const additionalExpenses = financial.expenses.filter(e=>e.countInRealCost !== false).reduce((s,e)=>s+Number(e.amount||0),0);
  const additionalCosts = additionalFromPayments + additionalExpenses;
  const propertyValue = Number(currentProject?.propertyValue||0);
  const realCost = propertyValue + additionalCosts;
  const employedCapital = paymentsTotal + expensesTotal + reserveBalance;

  const contributions = Object.fromEntries(currentMembers.map(m=>[m.id,0]));
  const addShares = shares => Object.entries(shares||{}).forEach(([uid,value]) => { contributions[uid]=(contributions[uid]||0)+Number(value||0); });
  financial.payments.filter(p=>!p.sourceReserveId).forEach(p=>addShares(p.shares));
  financial.expenses.filter(e=>!e.sourceReserveId).forEach(e=>addShares(e.shares));
  financial.reserveTransactions.filter(t=>t.type === "contribution").forEach(t=>addShares(t.shares));

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
  renderContributions(summary); renderDashboardContracts(); renderNextPayment();
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

function renderMovements() {
  const movements=[];
  financial.payments.forEach(p=>{ const c=contractById(p.contractId); movements.push({date:p.paymentDate,label:c?.name||'Pagamento',detail:contractById(p.contractId)?.type==='financing'?`Financiamento • encargos ${currency(p.financingAdditionalAmount||0)}`:(p.installmentId?'Parcela':'Pagamento recorrente'),amount:p.amount,kind:'payment',registeredBy:p.registeredBy,sourceReserveId:p.sourceReserveId,shares:p.shares}); });
  financial.expenses.forEach(e=>movements.push({date:e.date,label:e.description,detail:e.category,amount:e.amount,kind:'expense',registeredBy:e.registeredBy,sourceReserveId:e.sourceReserveId,shares:e.shares}));
  financial.reserveTransactions.filter(t=>t.type==='contribution').forEach(t=>{ const r=reserveById(t.reserveId); movements.push({date:t.date,label:r?.name||'Reserva',detail:'Aporte em reserva',amount:t.amount,kind:'reserve',registeredBy:t.registeredBy,shares:t.shares}); });
  movements.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const box=$("#movementsList");
  if(!movements.length){box.innerHTML='<div class="big-empty"><strong>Nenhuma movimentação ainda</strong><span>Pagamentos, despesas e aportes aparecerão aqui.</span></div>';return;}
  box.innerHTML=movements.map(m=>{ const paidBy=m.sourceReserveId?`Reserva: ${escapeHtml(reserveById(m.sourceReserveId)?.name||'')}`:Object.keys(m.shares||{}).map(memberName).join(' + '); return `<article class="movement-row"><div class="movement-icon ${m.kind}">${m.kind==='payment'?'✓':m.kind==='expense'?'$':'◎'}</div><div><strong>${escapeHtml(m.label)}</strong><span>${dateBR(m.date)} • ${escapeHtml(m.detail)} • ${escapeHtml(paidBy||'')}</span><small>Registrado por ${escapeHtml(memberName(m.registeredBy))}</small></div><b>${currency(m.amount)}</b></article>`; }).join('');
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

  financial.payments.forEach(p=>{
    const c=contractById(p.contractId); const category=c?.category||'Outros';
    if(!p.sourceReserveId){ addToBucket(capitalByCategory,category,p.amount); if(p.paymentDate) addToBucket(monthly,p.paymentDate.slice(0,7),p.amount); }
    if(p.costTreatment==='additional') addToBucket(extraByCategory,category,p.amount);
    if(p.costTreatment==='financing') addToBucket(extraByCategory,'Financiamento',p.financingAdditionalAmount||0);
  });
  financial.expenses.forEach(e=>{
    if(!e.sourceReserveId){ addToBucket(capitalByCategory,e.category||'Outros',e.amount); if(e.date) addToBucket(monthly,e.date.slice(0,7),e.amount); }
    if(e.countInRealCost!==false) addToBucket(extraByCategory,e.category||'Outros',e.amount);
  });
  financial.reserveTransactions.filter(t=>t.type==='contribution').forEach(t=>{
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
  for(const c of after.contracts.filter(x=>['installment','financing'].includes(x.type))){ const oldC=before.contracts.find(x=>x.id===c.id); if(!oldC) continue; if(c.type==='financing'){ const oldIns=before.installmentsByContract[c.id]||[]; const newIns=after.installmentsByContract[c.id]||[]; const wasDone=oldIns.length>0&&oldIns.every(i=>i.status==='paid'); const isDone=newIns.length>0&&newIns.every(i=>i.status==='paid'); if(isDone&&!wasDone){celebrate(c.name,'Todas as prestações do financiamento foram registradas como quitadas.'); return;} } else { const oldPaid=before.payments.filter(p=>p.contractId===c.id).reduce((s,p)=>s+Number(p.amount||0),0); const newPaid=after.payments.filter(p=>p.contractId===c.id).reduce((s,p)=>s+Number(p.amount||0),0); if(oldPaid+0.009<Number(c.totalValue||0) && newPaid+0.009>=Number(c.totalValue||0)){celebrate(c.name,'Todas as parcelas deste compromisso foram concluídas.'); return;} } }
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
$("#movementsNav").addEventListener('click',()=>{renderMovements();openModal($("#movementsModal"));});$("#reportsButton").addEventListener('click',()=>{renderReports();closeModal($("#moreModal"));openModal($("#reportsModal"));});$("#contributionHistoryButton").addEventListener('click',()=>{renderReports();openModal($("#reportsModal"));});$("#dashboardContractsButton").addEventListener('click',()=>{renderContractsList();openModal($("#contractsModal"));});
$("#newContractFromList").addEventListener('click',()=>{closeModal($("#contractsModal"));prepareContractForm();openModal($("#contractModal"));});
$("#createReserveFromReserveModal").addEventListener('click',()=>{closeModal($("#reserveModal"));prepareContractForm('reserve');openModal($("#contractModal"));});
$("#closeCelebration").addEventListener('click',()=>closeModal($("#celebrationModal")));

document.addEventListener('click',e=>{
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
