import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDtxRZL_IWajJod__LC0QSIXffxDhuR9JY",
  authDomain: "control-de-ventas-60c55.firebaseapp.com",
  projectId: "control-de-ventas-60c55",
  storageBucket: "control-de-ventas-60c55.firebasestorage.app",
  messagingSenderId: "535636855570",
  appId: "1:535636855570:web:d990feac541dbd039481cb"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const salesRef = collection(db, "ventas");
const paymentsRef = collection(db, "pagos");

let sales = [];
let payments = [];
let selectedPaymentClient = null;
let selectedDetailClient = null;
let historyType = "all";
let pendingDelete = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const connectionStatus = $("#connectionStatus");
const monthFilter = $("#monthFilter");
const historyMonthFilter = $("#historyMonthFilter");
const clientNameInput = $("#clientName");
const articleInput = $("#article");
const saleAmountInput = $("#saleAmount");
const saleDateInput = $("#saleDate");
const saveSaleButton = $("#saveSaleButton");
const saleMessage = $("#saleMessage");
const paymentPanel = $("#paymentPanel");
const paymentClientLabel = $("#paymentClientLabel");
const paymentAmountInput = $("#paymentAmount");
const paymentDateInput = $("#paymentDate");
const savePaymentButton = $("#savePaymentButton");
const paymentMessage = $("#paymentMessage");
const confirmDialog = $("#confirmDialog");
const clientDetailPanel = $("#clientDetailPanel");
const clientDetailName = $("#clientDetailName");
const clientDetailSummary = $("#clientDetailSummary");
const clientCreditTotal = $("#clientCreditTotal");
const clientPaidTotal = $("#clientPaidTotal");
const clientPendingTotal = $("#clientPendingTotal");
const clientSalesHistory = $("#clientSalesHistory");
const clientPaymentsHistory = $("#clientPaymentsHistory");

const today = new Date();
const todayISO = toISODate(today);
const currentMonth = todayISO.slice(0, 7);
monthFilter.value = currentMonth;
historyMonthFilter.value = currentMonth;
saleDateInput.value = todayISO;
paymentDateInput.value = todayISO;

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 0
  }).format(Number(value || 0)).replace("CRC", "₡");
}

function formatDate(dateString) {
  if (!dateString) return "";
  const [year, month, day] = dateString.split("-");
  return `${day}/${month}/${year}`;
}

function parseAmount(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return Number(digits || 0);
}

function formatAmountInput(input) {
  const amount = parseAmount(input.value);
  input.value = amount ? new Intl.NumberFormat("es-CR").format(amount) : "";
}

function normalizeClientName(name) {
  return name.trim().replace(/\s+/g, " ");
}

function clientKey(name) {
  return normalizeClientName(name)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function monthMatches(date, month) {
  return Boolean(date && month && date.startsWith(month));
}

function timestampMillis(record) {
  if (record.createdAt?.toMillis) return record.createdAt.toMillis();
  return new Date(`${record.date || "1970-01-01"}T12:00:00`).getTime();
}

function calculateDebtors() {
  const map = new Map();

  for (const sale of sales) {
    if (sale.status !== "credit") continue;
    const key = sale.clientKey;
    const current = map.get(key) || {
      clientKey: key,
      clientName: sale.clientName,
      creditSales: 0,
      payments: 0,
      salesCount: 0,
      saleItems: []
    };
    current.creditSales += Number(sale.amount);
    current.salesCount += 1;
    current.saleItems.push(sale);
    map.set(key, current);
  }

  for (const payment of payments) {
    const current = map.get(payment.clientKey) || {
      clientKey: payment.clientKey,
      clientName: payment.clientName,
      creditSales: 0,
      payments: 0,
      salesCount: 0,
      saleItems: []
    };
    current.payments += Number(payment.amount);
    map.set(payment.clientKey, current);
  }

  return [...map.values()]
    .map(item => ({ ...item, debt: Math.max(0, item.creditSales - item.payments) }))
    .filter(item => item.debt > 0)
    .sort((a, b) => b.debt - a.debt || a.clientName.localeCompare(b.clientName, "es"));
}

function calculateMonthSummary(month) {
  const monthSales = sales.filter(item => monthMatches(item.date, month));
  const monthPayments = payments.filter(item => monthMatches(item.date, month));
  const totalSales = monthSales.reduce((sum, item) => sum + Number(item.amount), 0);
  const paidSales = monthSales
    .filter(item => item.status === "paid")
    .reduce((sum, item) => sum + Number(item.amount), 0);
  const receivedPayments = monthPayments.reduce((sum, item) => sum + Number(item.amount), 0);
  return {
    totalSales,
    salesCount: monthSales.length,
    collected: paidSales + receivedPayments
  };
}

function allMovements() {
  const saleMovements = sales.map(item => ({
    ...item,
    kind: "sale",
    sortTime: timestampMillis(item)
  }));
  const paymentMovements = payments.map(item => ({
    ...item,
    kind: "payment",
    sortTime: timestampMillis(item)
  }));
  return [...saleMovements, ...paymentMovements].sort((a, b) => b.sortTime - a.sortTime);
}

function render() {
  const summary = calculateMonthSummary(monthFilter.value);
  const debtors = calculateDebtors();
  const totalDebt = debtors.reduce((sum, item) => sum + item.debt, 0);

  $("#monthSales").textContent = formatCurrency(summary.totalSales);
  $("#monthSalesCount").textContent = `${summary.salesCount} ${summary.salesCount === 1 ? "venta" : "ventas"}`;
  $("#monthCollected").textContent = formatCurrency(summary.collected);
  $("#currentDebt").textContent = formatCurrency(totalDebt);
  $("#debtClientCount").textContent = `${debtors.length} ${debtors.length === 1 ? "cliente" : "clientes"}`;
  $("#debtTotalTop").textContent = formatCurrency(totalDebt);
  $("#debtPeopleTop").textContent = `${debtors.length} ${debtors.length === 1 ? "cliente" : "clientes"}`;

  renderRecent();
  renderDebtors(debtors);
  renderHistory();

  if (selectedDetailClient && !clientDetailPanel.classList.contains("hidden")) {
    const updated = debtors.find(item => item.clientKey === selectedDetailClient.clientKey);
    if (updated) {
      openClientDetail(updated);
    } else {
      closeClientDetail();
    }
  }
}

function renderRecent() {
  const container = $("#recentList");
  const items = allMovements().slice(0, 5);
  if (!items.length) {
    container.innerHTML = '<p class="empty-state">Todavía no hay movimientos.</p>';
    return;
  }
  container.innerHTML = items.map(item => movementHTML(item, false)).join("");
  bindDeleteButtons(container);
}

function movementHTML(item, showDelete = true) {
  const isPayment = item.kind === "payment";
  const isPaidSale = item.kind === "sale" && item.status === "paid";
  const title = isPayment ? `Pago de ${escapeHTML(item.clientName)}` : escapeHTML(item.clientName);
  const subtitle = isPayment
    ? `Pago recibido · ${formatDate(item.date)}`
    : `${escapeHTML(item.article)} · ${item.status === "paid" ? "Pagado" : "A crédito"} · ${formatDate(item.date)}`;
  const amountClass = isPayment || isPaidSale ? "paid" : "debt";
  const amountPrefix = isPayment || isPaidSale ? "+" : "";
  const icon = isPayment ? "✓" : (isPaidSale ? "$" : "◷");
  const iconClass = isPayment || isPaidSale ? "paid" : "";
  const collectionName = isPayment ? "pagos" : "ventas";

  return `
    <article class="list-item">
      <span class="item-icon ${iconClass}">${icon}</span>
      <div class="item-main">
        <strong>${title}</strong>
        <small>${subtitle}</small>
      </div>
      <div class="item-side">
        <strong class="${amountClass}">${amountPrefix}${formatCurrency(item.amount)}</strong>
        ${showDelete ? `<button class="delete-link" data-delete-id="${item.id}" data-delete-collection="${collectionName}">Eliminar</button>` : ""}
      </div>
    </article>
  `;
}

function renderDebtors(debtors) {
  const container = $("#debtorsList");
  if (!debtors.length) {
    container.innerHTML = '<p class="empty-state">No hay cuentas pendientes.</p>';
    return;
  }

  container.innerHTML = debtors.map(item => `
    <article class="debtor-card clickable" data-client-key="${escapeAttr(item.clientKey)}">
      <div class="debtor-head">
        <strong>${escapeHTML(item.clientName)}</strong>
        <strong class="amount">${formatCurrency(item.debt)}</strong>
      </div>
      <p class="debtor-meta">${item.salesCount} ${item.salesCount === 1 ? "venta a crédito" : "ventas a crédito"}</p>
      <p class="view-detail-note">Toca para ver artículos y pagos</p>
      <div class="debtor-actions">
        <button class="small-button register-payment" data-client-key="${escapeAttr(item.clientKey)}">Registrar pago</button>
      </div>
    </article>
  `).join("");

  container.querySelectorAll(".debtor-card").forEach(card => {
    card.addEventListener("click", event => {
      if (event.target.closest(".register-payment")) return;
      const debtor = debtors.find(item => item.clientKey === card.dataset.clientKey);
      openClientDetail(debtor);
    });
  });

  $$(".register-payment").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      const debtor = debtors.find(item => item.clientKey === button.dataset.clientKey);
      openPaymentPanel(debtor);
    });
  });
}

function openClientDetail(debtor) {
  selectedDetailClient = debtor;

  const creditSales = sales
    .filter(item => item.status === "credit" && item.clientKey === debtor.clientKey)
    .sort((a, b) => timestampMillis(b) - timestampMillis(a));

  const clientPayments = payments
    .filter(item => item.clientKey === debtor.clientKey)
    .sort((a, b) => timestampMillis(b) - timestampMillis(a));

  const totalCredit = creditSales.reduce((sum, item) => sum + Number(item.amount), 0);
  const totalPaid = clientPayments.reduce((sum, item) => sum + Number(item.amount), 0);
  const pending = Math.max(0, totalCredit - totalPaid);

  clientDetailName.textContent = debtor.clientName;
  clientDetailSummary.textContent = `${creditSales.length} ${creditSales.length === 1 ? "compra a crédito" : "compras a crédito"} · ${clientPayments.length} ${clientPayments.length === 1 ? "pago" : "pagos"}`;
  clientCreditTotal.textContent = formatCurrency(totalCredit);
  clientPaidTotal.textContent = formatCurrency(totalPaid);
  clientPendingTotal.textContent = formatCurrency(pending);

  clientSalesHistory.innerHTML = creditSales.length
    ? creditSales.map(item => `
        <article class="detail-row">
          <div>
            <strong>${escapeHTML(item.article)}</strong>
            <small>${formatDate(item.date)}</small>
          </div>
          <span class="detail-amount">${formatCurrency(item.amount)}</span>
        </article>
      `).join("")
    : '<p class="empty-state">No hay compras a crédito.</p>';

  clientPaymentsHistory.innerHTML = clientPayments.length
    ? clientPayments.map(item => `
        <article class="detail-row payment">
          <div>
            <strong>Pago recibido</strong>
            <small>${formatDate(item.date)}</small>
          </div>
          <span class="detail-amount">+${formatCurrency(item.amount)}</span>
        </article>
      `).join("")
    : '<p class="empty-state">Todavía no ha realizado pagos.</p>';

  paymentPanel.classList.add("hidden");
  clientDetailPanel.classList.remove("hidden");
  clientDetailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeClientDetail() {
  selectedDetailClient = null;
  clientDetailPanel.classList.add("hidden");
}

function renderHistory() {
  const container = $("#historyList");
  const month = historyMonthFilter.value;
  let items = allMovements().filter(item => monthMatches(item.date, month));
  if (historyType === "sales") items = items.filter(item => item.kind === "sale");
  if (historyType === "payments") items = items.filter(item => item.kind === "payment");

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">No hay movimientos en este período.</p>';
    return;
  }

  container.innerHTML = items.map(item => movementHTML(item, true)).join("");
  bindDeleteButtons(container);
}

function bindDeleteButtons(container) {
  container.querySelectorAll(".delete-link").forEach(button => {
    button.addEventListener("click", () => {
      pendingDelete = {
        id: button.dataset.deleteId,
        collection: button.dataset.deleteCollection
      };
      confirmDialog.showModal();
    });
  });
}

function openPaymentPanel(debtor) {
  selectedPaymentClient = debtor;
  clientDetailPanel.classList.add("hidden");
  paymentClientLabel.textContent = `${debtor.clientName} · Debe ${formatCurrency(debtor.debt)}`;
  paymentAmountInput.value = "";
  paymentDateInput.value = todayISO;
  paymentMessage.textContent = "";
  paymentPanel.classList.remove("hidden");
  paymentPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function closePaymentPanel() {
  selectedPaymentClient = null;
  paymentPanel.classList.add("hidden");
}

function showMessage(element, message, type = "success") {
  element.textContent = message;
  element.classList.toggle("error", type === "error");
}

function setView(name) {
  $$(".view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
  $$(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.view === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveSale() {
  const name = normalizeClientName(clientNameInput.value);
  const article = articleInput.value.trim();
  const amount = parseAmount(saleAmountInput.value);
  const date = saleDateInput.value;
  const status = $('input[name="saleStatus"]:checked')?.value;

  if (!name || !article || !amount || !date || !status) {
    showMessage(saleMessage, "Completa todos los datos.", "error");
    return;
  }

  saveSaleButton.disabled = true;
  try {
    await addDoc(salesRef, {
      clientName: name,
      clientKey: clientKey(name),
      article,
      amount,
      status,
      date,
      createdAt: serverTimestamp()
    });
    clientNameInput.value = "";
    articleInput.value = "";
    saleAmountInput.value = "";
    saleDateInput.value = todayISO;
    $('input[name="saleStatus"][value="paid"]').checked = true;
    showMessage(saleMessage, "Venta guardada.");
  } catch (error) {
    console.error(error);
    showMessage(saleMessage, "No se pudo guardar la venta.", "error");
  } finally {
    saveSaleButton.disabled = false;
  }
}

async function savePayment() {
  if (!selectedPaymentClient) return;
  const amount = parseAmount(paymentAmountInput.value);
  const date = paymentDateInput.value;

  if (!amount || !date) {
    showMessage(paymentMessage, "Completa el monto y la fecha.", "error");
    return;
  }

  const refreshedDebtor = calculateDebtors().find(item => item.clientKey === selectedPaymentClient.clientKey);
  const currentDebt = refreshedDebtor?.debt || 0;

  if (amount > currentDebt) {
    showMessage(paymentMessage, "El pago supera la deuda.", "error");
    return;
  }

  savePaymentButton.disabled = true;
  try {
    await addDoc(paymentsRef, {
      clientName: selectedPaymentClient.clientName,
      clientKey: selectedPaymentClient.clientKey,
      amount,
      date,
      createdAt: serverTimestamp()
    });
    showMessage(paymentMessage, "Pago guardado.");
    setTimeout(closePaymentPanel, 700);
  } catch (error) {
    console.error(error);
    showMessage(paymentMessage, "No se pudo guardar el pago.", "error");
  } finally {
    savePaymentButton.disabled = false;
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHTML(value);
}

saveSaleButton.addEventListener("click", saveSale);
savePaymentButton.addEventListener("click", savePayment);
$("#closePaymentPanel").addEventListener("click", closePaymentPanel);
$("#closeClientDetail").addEventListener("click", closeClientDetail);
$("#detailRegisterPayment").addEventListener("click", () => {
  if (selectedDetailClient) openPaymentPanel(selectedDetailClient);
});

saleAmountInput.addEventListener("blur", () => formatAmountInput(saleAmountInput));
paymentAmountInput.addEventListener("blur", () => formatAmountInput(paymentAmountInput));

monthFilter.addEventListener("change", render);
historyMonthFilter.addEventListener("change", renderHistory);

$$(".nav-button").forEach(button => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

$$("[data-go]").forEach(button => {
  button.addEventListener("click", () => setView(button.dataset.go));
});

$$(".history-tab").forEach(button => {
  button.addEventListener("click", () => {
    historyType = button.dataset.history;
    $$(".history-tab").forEach(tab => tab.classList.toggle("active", tab === button));
    renderHistory();
  });
});

$("#confirmDeleteButton").addEventListener("click", async (event) => {
  if (!pendingDelete) return;
  event.preventDefault();
  try {
    await deleteDoc(doc(db, pendingDelete.collection, pendingDelete.id));
    pendingDelete = null;
    confirmDialog.close();
  } catch (error) {
    console.error(error);
  }
});

let salesReady = false;
let paymentsReady = false;

function updateConnectionState() {
  if (salesReady && paymentsReady) {
    connectionStatus.textContent = "Sincronizado";
    connectionStatus.classList.remove("error");
  }
}

onSnapshot(salesRef, snapshot => {
  sales = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
  salesReady = true;
  updateConnectionState();
  render();
}, error => {
  console.error(error);
  connectionStatus.textContent = "Error de conexión";
  connectionStatus.classList.add("error");
});

onSnapshot(paymentsRef, snapshot => {
  payments = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
  paymentsReady = true;
  updateConnectionState();
  render();
}, error => {
  console.error(error);
  connectionStatus.textContent = "Error de conexión";
  connectionStatus.classList.add("error");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(console.error);
  });
}
