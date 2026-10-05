import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, onSnapshot, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig={apiKey:"AIzaSyDtxRZL_IWajJod__LC0QSIXffxDhuR9JY",authDomain:"control-de-ventas-60c55.firebaseapp.com",projectId:"control-de-ventas-60c55",storageBucket:"control-de-ventas-60c55.firebasestorage.app",messagingSenderId:"535636855570",appId:"1:535636855570:web:d990feac541dbd039481cb"};
const app=initializeApp(firebaseConfig), db=getFirestore(app);
const salesRef=collection(db,"ventas"),paymentsRef=collection(db,"pagos"),inventoryRef=collection(db,"inventario");
let sales=[],payments=[],inventory=[];let ready={sales:false,payments:false,inventory:false};
const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];
const page=document.body.dataset.page||"home";const today=new Date();const todayISO=toISODate(today),currentMonth=todayISO.slice(0,7);
function toISODate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function money(v){return new Intl.NumberFormat("es-CR",{style:"currency",currency:"CRC",maximumFractionDigits:0}).format(Number(v||0)).replace("CRC","₡")}
function dateFmt(s){if(!s)return"";const[y,m,d]=s.split("-");return`${d}/${m}/${y}`}
function parseAmount(v){return Number(String(v??"").replace(/[^\d]/g,"")||0)}
function normName(n){return String(n||"").trim().replace(/\s+/g," ")}
function keyName(n){return normName(n).toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g,"")}
function stamp(r){if(r.createdAt?.toMillis)return r.createdAt.toMillis();return new Date(`${r.date||"1970-01-01"}T12:00:00`).getTime()}
function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function msg(el,text,error=false){if(!el)return;el.textContent=text;el.classList.toggle("error",error)}
function debtors(){const map=new Map();for(const s of sales){if(s.status!=="credit")continue;const k=s.clientKey||keyName(s.clientName);const x=map.get(k)||{clientKey:k,clientName:s.clientName,credit:0,paid:0,count:0};x.credit+=Number(s.amount||0);x.count++;map.set(k,x)}for(const p of payments){const k=p.clientKey||keyName(p.clientName);const x=map.get(k)||{clientKey:k,clientName:p.clientName,credit:0,paid:0,count:0};x.paid+=Number(p.amount||0);map.set(k,x)}return[...map.values()].map(x=>({...x,debt:Math.max(0,x.credit-x.paid)})).filter(x=>x.debt>0).sort((a,b)=>b.debt-a.debt||a.clientName.localeCompare(b.clientName,"es"))}
function monthLabel(k){const[y,m]=k.split("-").map(Number);const t=new Intl.DateTimeFormat("es-CR",{month:"long",year:"numeric"}).format(new Date(y,m-1,1));return t.charAt(0).toUpperCase()+t.slice(1)}
function allMovements(){return[...sales.map(x=>({...x,kind:"sale",sortTime:stamp(x)})),...payments.map(x=>({...x,kind:"payment",sortTime:stamp(x)}))].sort((a,b)=>b.sortTime-a.sortTime)}
function activeInventory(){return [...inventory].filter(x=>Number(x.quantity)>0).sort((a,b)=>a.name.localeCompare(b.name,"es"))}
function setStatus(){const el=$("#connectionStatus");if(el&&ready.sales&&ready.payments&&ready.inventory)el.textContent="● Sincronizado"}
function render(){if(page==="home")renderHome();if(page==="sale")renderSaleProducts();if(page==="inventory")renderInventory();if(page==="debts")renderDebts();if(page==="client"){renderClient();if($("#editSaleDialog")?.open)refreshSaleItems("#editSaleItems")}if(page==="history")renderHistory()}

function renderHome(){const sm=sales.filter(x=>x.date?.startsWith(currentMonth));const total=sm.reduce((a,b)=>a+Number(b.amount||0),0);const ds=debtors(),debt=ds.reduce((a,b)=>a+b.debt,0);$("#monthSales").textContent=money(total);$("#monthSalesCount").textContent=`${sm.length} ${sm.length===1?"venta":"ventas"}`;$("#currentDebt").textContent=money(debt);$("#debtClientCount").textContent=`${ds.length} ${ds.length===1?"cliente":"clientes"}`}

// Older sales keep their original fields; new sales also store each product separately.
function saleItems(sale){
  if(Array.isArray(sale.items)&&sale.items.length)return sale.items;
  return sale.productId&&sale.quantity?[{productId:sale.productId,article:sale.article,quantity:Number(sale.quantity)}]:[];
}
function saleProductsHTML(sale){
  const items=saleItems(sale);
  return items.length?`<ul class="purchase-products">${items.map(item=>`<li><span>${esc(item.article)}${item.unitPrice==null?"":`<small>${money(item.unitPrice)} por unidad</small>`}</span><span class="product-units">× ${esc(item.quantity)}${item.unitPrice==null?"":`<small>${money(item.unitPrice*item.quantity)}</small>`}</span></li>`).join("")}</ul>`:`<strong>${esc(sale.article)}</strong>`;
}
function itemTotals(items){const totals=new Map();for(const item of items)totals.set(item.productId,(totals.get(item.productId)||0)+Number(item.quantity));return totals}
function saleItemFields(items){
  return {items,productId:items.length===1?items[0].productId:"",article:items.length===1?items[0].article:`${items.length} productos`,quantity:items.reduce((total,x)=>total+x.quantity,0)};
}
const MAX_SALE_PRODUCTS=5;
let itemRowNumber=0,saleSaving=false;
function unitPriceValue(raw){
  const value=String(raw??'').trim();
  if(!/^(?:\d+|\d{1,3}(?:[.,\s]\d{3})+)$/.test(value))return null;
  const price=parseAmount(value);
  return Number.isSafeInteger(price)&&price>0&&price<=100000000?price:null;
}
function addSaleItem(containerId,item={}){
  const container=$(containerId),row=document.createElement("div"),id=`sale-item-${++itemRowNumber}`;
  row.className="sale-item";
  row.innerHTML=`<div class="sale-item-heading"><strong class="item-number"></strong><button type="button" class="textbtn remove-sale-item">Quitar</button></div><div class="field item-product"><label for="${id}-product">Producto</label><select id="${id}-product" class="item-select" aria-describedby="${id}-stock"><option value="${esc(item.productId||"")}">${esc(item.article||"Seleccionar producto…")}</option></select><small id="${id}-stock" class="item-stock stock-hint"></small></div><div class="field item-quantity"><label for="${id}-quantity">Cantidad</label><input id="${id}-quantity" class="item-qty" type="number" inputmode="numeric" min="1" step="1" value="${esc(item.quantity??1)}"></div><div class="field item-price-field"><label for="${id}-price">Precio unitario</label><div class="money"><span>₡</span><input id="${id}-price" class="item-price" type="text" inputmode="numeric" placeholder="0" value="${item.unitPrice==null?"":esc(new Intl.NumberFormat("es-CR").format(item.unitPrice))}"></div></div><div class="item-line-total" aria-live="polite"></div>`;
  container.append(row);
  refreshSaleItems(containerId);
  return row;
}
function refreshSaleItems(containerId){
  const container=$(containerId);if(!container)return;
  const rows=[...container.querySelectorAll('.sale-item')],editing=containerId==="#editSaleItems";
  const original=editing&&editSaleSnapshot?saleItems(editSaleSnapshot):[],returned=itemTotals(original);
  const selected=rows.map(row=>row.querySelector('.item-select').value);
  rows.forEach((row,index)=>{
    row.querySelector('.item-number').textContent=`Producto ${index+1}`;
    const remove=row.querySelector('.remove-sale-item');remove.hidden=rows.length===1;remove.setAttribute('aria-label',`Quitar producto ${index+1}`);
    const select=row.querySelector('.item-select'),old=select.value,oldName=select.selectedOptions[0]?.textContent||"Producto no disponible";
    const options=[...inventory].filter(x=>Number(x.quantity)+(returned.get(x.id)||0)>0||x.id===old).sort((a,b)=>a.name.localeCompare(b.name,'es'));
    select.innerHTML='<option value="">Seleccionar producto…</option>'+options.map(x=>`<option value="${esc(x.id)}" ${selected.some((id,i)=>i!==index&&id===x.id)?"disabled":""}>${esc(x.name)}</option>`).join('');
    if(old&&!options.some(x=>x.id===old))select.add(new Option(oldName,old));
    select.value=old;
    const product=inventory.find(x=>x.id===old),available=product?Number(product.quantity)+(returned.get(old)||0):0;
    const hint=row.querySelector('.item-stock'),quantity=Number(row.querySelector('.item-qty').value);
    hint.textContent=old?(product?`${available} ${available===1?"unidad disponible":"unidades disponibles"}`:"Este producto ya no está disponible."):(ready.inventory?(options.length?"":"Agregá productos desde Inventario."):"Cargando inventario…");
    hint.classList.toggle('error',Boolean(old)&&(!product||quantity>available));
    const price=unitPriceValue(row.querySelector('.item-price').value);
    row.querySelector('.item-line-total').textContent=price!==null&&Number.isSafeInteger(quantity)&&quantity>0?`Subtotal: ${money(price*quantity)}`:'Subtotal: ₡0';
  });
  const chosen=rows.filter(row=>row.querySelector('.item-select').value),units=chosen.reduce((sum,row)=>sum+(Number(row.querySelector('.item-qty').value)||0),0);
  const summary=$(editing?'#editSaleItemsSummary':'#saleItemsSummary');
  summary.textContent=chosen.length?`${chosen.length} ${chosen.length===1?"producto":"productos"} · ${units} ${units===1?"unidad":"unidades"}`:"";
  const priceValues=rows.map(row=>unitPriceValue(row.querySelector('.item-price').value));
  const anyPrice=rows.some(row=>row.querySelector('.item-price').value.trim()!=='');
  const autoTotal=!editing||anyPrice;
  const amount=$(editing?'#editSaleAmount':'#saleAmount');
  amount.readOnly=autoTotal;
  if(autoTotal){
    const total=rows.reduce((sum,row,i)=>sum+(priceValues[i]||0)*(Number(row.querySelector('.item-qty').value)||0),0);
    amount.value=new Intl.NumberFormat('es-CR').format(total);
  }
  if(editing)$('#editSaleAmountHint').textContent=autoTotal?'Total calculado con los precios y cantidades.':'Esta compra anterior no tiene precios individuales. Conservá su total o ingresá el precio de todos los productos.';
  $(editing?'#addEditSaleItemButton':'#addSaleItemButton').disabled=rows.length>=MAX_SALE_PRODUCTS;
}
function readSaleItems(containerId,{allowUnpriced=false}={}){
  const rows=[...$(containerId).querySelectorAll('.sale-item')],ids=new Set();
  if(!rows.length)throw new Error("Agregá al menos un producto.");
  if(rows.length>MAX_SALE_PRODUCTS)throw new Error(`Podés agregar hasta ${MAX_SALE_PRODUCTS} productos por venta.`);
  const keepUnpriced=allowUnpriced&&rows.every(row=>!row.querySelector('.item-price').value.trim());
  const items=rows.map((row,index)=>{
    const productId=row.querySelector('.item-select').value,raw=row.querySelector('.item-qty').value.trim(),quantity=Number(raw);
    if(!productId)throw new Error(`Seleccioná el producto ${index+1}.`);
    if(!/^\d+$/.test(raw)||!Number.isSafeInteger(quantity)||quantity<=0||quantity>10000)throw new Error(`Ingresá una cantidad entera entre 1 y 10 000 para el producto ${index+1}.`);
    if(ids.has(productId))throw new Error("Este producto está repetido. Usá una sola fila y ajustá su cantidad.");
    const unitPrice=unitPriceValue(row.querySelector('.item-price').value);
    if(!keepUnpriced&&unitPrice===null)throw new Error(`Ingresá el precio unitario del producto ${index+1}, en colones enteros.`);
    ids.add(productId);return keepUnpriced?{productId,quantity}:{productId,quantity,unitPrice};
  });
  if(items.reduce((sum,item)=>sum+item.quantity,0)>10000)throw new Error('La venta no puede superar 10 000 unidades.');
  return items;
}
function bindSaleItems(containerId,buttonId){
  $(buttonId).onclick=()=>{if($(containerId).children.length<MAX_SALE_PRODUCTS)addSaleItem(containerId).querySelector('.item-select').focus()};
  $(containerId).addEventListener('click',event=>{
    const remove=event.target.closest('.remove-sale-item');
    if(remove&&$(containerId).children.length>1){remove.closest('.sale-item').remove();refreshSaleItems(containerId)}
  });
  $(containerId).addEventListener('change',event=>{
    if(event.target.matches('.item-price')){const price=unitPriceValue(event.target.value);if(price!==null)event.target.value=new Intl.NumberFormat('es-CR').format(price)}
    refreshSaleItems(containerId);
  });
  $(containerId).addEventListener('input',event=>{
    if(event.target.matches('.item-qty,.item-price'))refreshSaleItems(containerId);
  });
}
function renderSaleProducts(){refreshSaleItems('#saleItems')}
function saleError(error){
  if(error.code==='permission-denied')return "No se pudo guardar: faltan permisos de la base de datos. Tus datos del formulario se conservaron.";
  if(error.code==='unavailable')return "No se pudo conectar. Revisá tu conexión e intentá de nuevo.";
  return error.saleMessage||"No se pudo guardar la venta. Revisá tu conexión e intentá de nuevo.";
}
function productError(message){const error=new Error(message);error.saleMessage=message;return error}
// Read every product before writing so a sale is saved completely or not at all.
async function prepareSaleStock(transaction,requested,previous=[]){
  const returned=itemTotals(previous),ids=[...new Set([...returned.keys(),...requested.map(x=>x.productId)])],products=new Map();
  for(const id of ids){
    const ref=doc(db,"inventario",id),snapshot=await transaction.get(ref);
    if(!snapshot.exists())throw productError("Un producto ya no existe. Revisá los productos de la venta.");
    products.set(id,{ref,...snapshot.data()});
  }
  const wanted=itemTotals(requested),updates=[];
  for(const [id,product] of products){
    const available=(Number(product.quantity)||0)+(returned.get(id)||0),needed=wanted.get(id)||0;
    if(needed>available)throw productError(`Solo hay ${available} unidades disponibles de ${product.name}.`);
    updates.push({ref:product.ref,quantity:available-needed});
  }
  const items=requested.map(x=>({...x,article:products.get(x.productId).name}));
  return{items,updates};
}
async function saveSale(event){
  event?.preventDefault();if(saleSaving)return;
  const client=normName($('#clientName').value),amount=parseAmount($('#saleAmount').value),date=$('#saleDate').value,status=$("input[name='saleStatus']:checked")?.value,out=$('#saleMessage');
  if(!client||client.length>100||!date||!['paid','credit'].includes(status)){msg(out,"Completá cliente (máximo 100 caracteres), fecha y estado.",true);return}
  let requested;try{requested=readSaleItems('#saleItems')}catch(error){msg(out,error.message,true);return}
  if(!Number.isSafeInteger(amount)||amount<=0||amount>100000000){msg(out,'Revisá los precios: el total debe ser mayor que cero y no superar ₡100 000 000.',true);return}
  saleSaving=true;$('#saleFields').disabled=true;$('#saveSaleButton').textContent='Guardando…';msg(out,"");
  try{
    const saleDoc=doc(salesRef);
    await runTransaction(db,async transaction=>{
      const {items,updates}=await prepareSaleStock(transaction,requested);
      transaction.set(saleDoc,{clientName:client,clientKey:keyName(client),...saleItemFields(items),amount,status,date,createdAt:serverTimestamp()});
      for(const update of updates)transaction.update(update.ref,{quantity:update.quantity,updatedAt:serverTimestamp()});
    });
    $('#saleForm').reset();$('#saleItems').replaceChildren();addSaleItem('#saleItems');$('#saleDate').value=todayISO;
    msg(out,"Venta guardada con todos sus productos. Inventario actualizado.");
  }catch(error){console.error(error);msg(out,saleError(error),true)}
  finally{saleSaving=false;$('#saleFields').disabled=false;$('#saveSaleButton').textContent='Guardar venta'}
}

function renderInventory(){const items=activeInventory();$("#inventoryProductCount").textContent=String(items.length);$("#inventoryUnitCount").textContent=String(items.reduce((s,x)=>s+Number(x.quantity||0),0));const c=$("#inventoryList");c.innerHTML=items.length?items.map(x=>`<article class="inventory-item"><div><strong>${esc(x.name)}</strong><small>${x.quantity} ${Number(x.quantity)===1?"unidad disponible":"unidades disponibles"}</small></div><div class="stock"><button type="button" data-change="-1" data-id="${esc(x.id)}" aria-label="Restar una unidad de ${esc(x.name)}">−</button><button type="button" class="stock-edit" data-edit-stock="${esc(x.id)}" aria-label="Editar cantidad de ${esc(x.name)}: ${x.quantity} unidades"><strong>${x.quantity}</strong><span>Editar</span></button><button type="button" data-change="1" data-id="${esc(x.id)}" aria-label="Sumar una unidad de ${esc(x.name)}">+</button></div></article>`).join(""):'<p class="empty">Todavía no hay productos disponibles.</p>'}

let stockEdit=null,stockSaving=false;
function openEditStock(id){
  const product=inventory.find(x=>x.id===id);
  if(!product)return;
  stockEdit={id,quantity:Number(product.quantity)||0};
  $("#editStockProductName").textContent=product.name;
  $("#editStockCurrent").textContent=`Cantidad actual: ${stockEdit.quantity}`;
  $("#editStockQuantity").value=String(stockEdit.quantity);
  msg($("#editStockMessage"),"");
  msg($("#stockMessage"),"");
  $("#editStockDialog").showModal();
  $("#editStockQuantity").focus();
  $("#editStockQuantity").select();
}
async function saveStockQuantity(event){
  event.preventDefault();
  if(!stockEdit||stockSaving)return;
  const raw=$("#editStockQuantity").value.trim(),quantity=Number(raw),out=$("#editStockMessage");
  if(!/^\d+$/.test(raw)||!Number.isSafeInteger(quantity)){
    msg(out,"Ingresá una cantidad entera de 0 o más, sin puntos ni comas.",true);
    $("#editStockQuantity").focus();
    return;
  }
  const edit={...stockEdit},button=$("#saveStockQuantityButton");
  stockSaving=true;
  button.disabled=true;
  button.textContent="Guardando…";
  $("#cancelEditStockButton").disabled=true;
  $("#editStockQuantity").disabled=true;
  msg(out,"");
  try{
    await runTransaction(db,async transaction=>{
      const ref=doc(db,"inventario",edit.id),snapshot=await transaction.get(ref);
      if(!snapshot.exists())throw new Error("PRODUCT_NOT_FOUND");
      const current=Number(snapshot.data().quantity)||0;
      if(current!==edit.quantity){
        const error=new Error("STOCK_CHANGED");
        error.quantity=current;
        throw error;
      }
      transaction.update(ref,{quantity,updatedAt:serverTimestamp()});
    });
    $("#editStockDialog").close();
    msg($("#stockMessage"),`Cantidad guardada: ${quantity} ${quantity===1?"unidad":"unidades"}.`);
  }catch(error){
    console.error(error);
    if(error.message==="STOCK_CHANGED"){
      stockEdit.quantity=error.quantity;
      $("#editStockCurrent").textContent=`Cantidad actual: ${error.quantity}`;
      msg(out,`La cantidad cambió a ${error.quantity} mientras editabas. Revisá el total antes de guardar de nuevo.`,true);
    }else{
      msg(out,error.message==="PRODUCT_NOT_FOUND"?"Este producto ya no existe. Cerrá esta ventana y revisá el inventario.":"No se pudo guardar la cantidad. Revisá tu conexión e intentá de nuevo.",true);
    }
  }finally{
    stockSaving=false;
    button.disabled=false;
    button.textContent="Guardar cantidad";
    $("#cancelEditStockButton").disabled=false;
    $("#editStockQuantity").disabled=false;
  }
}
function bindStockEditor(){
  $("#inventoryList").onclick=event=>{
    const edit=event.target.closest('[data-edit-stock]');
    if(edit){openEditStock(edit.dataset.editStock);return}
    const step=event.target.closest('[data-change]');
    if(step)changeStock(step.dataset.id,Number(step.dataset.change));
  };
  $("#editStockForm").onsubmit=saveStockQuantity;
  $("#cancelEditStockButton").onclick=()=>$("#editStockDialog").close();
  $("#editStockDialog").addEventListener("cancel",event=>{if(stockSaving)event.preventDefault()});
  $("#editStockDialog").addEventListener("close",()=>{stockEdit=null});
}
async function addProduct(){const name=normName($("#inventoryProductName").value),q=Number.parseInt($("#inventoryProductQuantity").value,10),out=$("#inventoryMessage");if(!name||!Number.isInteger(q)||q<=0){msg(out,"Completa el producto y una cantidad válida.",true);return}const n=keyName(name),existing=inventory.find(x=>x.normalizedName===n);try{if(existing){await runTransaction(db,async t=>{const r=doc(db,"inventario",existing.id),s=await t.get(r),cur=s.exists()?Number(s.data().quantity)||0:0;t.update(r,{quantity:cur+q,updatedAt:serverTimestamp()})})}else await addDoc(inventoryRef,{name,normalizedName:n,quantity:q,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});$("#inventoryProductName").value="";$("#inventoryProductQuantity").value="";msg(out,"Inventario actualizado.")}catch(e){console.error(e);msg(out,"No se pudo guardar el producto.",true)}}
async function changeStock(id,delta){try{await runTransaction(db,async t=>{const r=doc(db,"inventario",id),s=await t.get(r);if(!s.exists())return;const cur=Number(s.data().quantity)||0;t.update(r,{quantity:Math.max(0,cur+delta),updatedAt:serverTimestamp()})})}catch(e){console.error(e)}}

function renderDebts(){const ds=debtors(),total=ds.reduce((s,x)=>s+x.debt,0);$("#debtTotalTop").textContent=money(total);$("#debtPeopleTop").textContent=`${ds.length} ${ds.length===1?"cliente":"clientes"}`;const c=$("#debtorsList");c.innerHTML=ds.length?ds.map(x=>`<article class="debtor"><div><strong>${esc(x.clientName)}</strong><small>${x.count} ${x.count===1?"venta a crédito":"ventas a crédito"}</small></div><strong class="amount">${money(x.debt)}</strong><div class="actions"><a class="smallbtn" href="client.html?client=${encodeURIComponent(x.clientKey)}">Ver detalle</a><a class="smallbtn" href="client.html?client=${encodeURIComponent(x.clientKey)}&pay=1">Registrar pago</a></div></article>`).join(""):'<p class="empty">No hay cuentas pendientes.</p>'}

let clientKeyParam=new URLSearchParams(location.search).get("client")||"";
function clientData(){const creditSales=sales.filter(x=>x.status==="credit"&&(x.clientKey||keyName(x.clientName))===clientKeyParam).sort((a,b)=>stamp(b)-stamp(a)),pays=payments.filter(x=>(x.clientKey||keyName(x.clientName))===clientKeyParam).sort((a,b)=>stamp(b)-stamp(a));const credit=creditSales.reduce((s,x)=>s+Number(x.amount||0),0),paid=pays.reduce((s,x)=>s+Number(x.amount||0),0);return{creditSales,pays,credit,paid,pending:Math.max(0,credit-paid),name:creditSales[0]?.clientName||pays[0]?.clientName||"Cliente"}}
function renderClient(){if(!clientKeyParam)return;const d=clientData();$("#clientNameTitle").textContent=d.name;$("#clientCreditTotal").textContent=money(d.credit);$("#clientPaidTotal").textContent=money(d.paid);$("#clientPendingTotal").textContent=money(d.pending);$("#clientSalesHistory").innerHTML=d.creditSales.length?d.creditSales.map(x=>`<article class="detail-row"><div>${saleProductsHTML(x)}<small>${dateFmt(x.date)}</small></div><div><strong>${money(x.amount)}</strong><div class="detail-actions"><button class="textbtn edit-sale" data-id="${esc(x.id)}">Editar</button></div></div></article>`).join(""):'<p class="empty">No hay compras a crédito.</p>';$("#clientPaymentsHistory").innerHTML=d.pays.length?d.pays.map(x=>`<article class="detail-row"><div><strong>Pago recibido</strong><small>${dateFmt(x.date)}</small></div><div><strong style="color:var(--ok)">+${money(x.amount)}</strong><div class="detail-actions"><button class="textbtn edit-payment" data-id="${esc(x.id)}">Editar</button></div></div></article>`).join(""):'<p class="empty">Todavía no ha realizado pagos.</p>';$("#paymentClientLabel").textContent=`Saldo pendiente: ${money(d.pending)}`;$$('.edit-sale').forEach(b=>b.onclick=()=>openEditSale(b.dataset.id));$$('.edit-payment').forEach(b=>b.onclick=()=>openEditPayment(b.dataset.id));if(new URLSearchParams(location.search).get("pay")==="1"&&!window._autoPay){window._autoPay=true;$("#paymentPanel").classList.remove("hidden")}}
async function savePayment(){const d=clientData(),amount=parseAmount($("#paymentAmount").value),date=$("#paymentDate").value,out=$("#paymentMessage");if(!amount||!date){msg(out,"Completa monto y fecha.",true);return}if(amount>d.pending){msg(out,"El pago supera la deuda.",true);return}try{await addDoc(paymentsRef,{clientName:d.name,clientKey:clientKeyParam,amount,date,createdAt:serverTimestamp()});$("#paymentAmount").value="";msg(out,"Pago guardado.")}catch(e){console.error(e);msg(out,"No se pudo guardar el pago.",true)}}
let editSaleId=null,editPaymentId=null,editSaleSnapshot=null,editSaleSaving=false;
function saleSignature(sale){return JSON.stringify({clientName:sale.clientName,clientKey:sale.clientKey,amount:sale.amount,date:sale.date,status:sale.status,article:sale.article,items:saleItems(sale)})}
function openEditSale(id){
  const sale=sales.find(x=>x.id===id);if(!sale)return;
  editSaleId=id;editSaleSnapshot={...sale};
  $('#editSaleClientName').value=sale.clientName||'';
  $('#editSaleAmount').readOnly=false;$('#editSaleAmountHint').textContent='';
  $('#editSaleAmount').value=new Intl.NumberFormat('es-CR').format(Number(sale.amount)||0);
  $('#editSaleDate').value=sale.date||todayISO;
  const items=saleItems(sale).map(item=>({...item}));
  if(items.length===1&&items[0].unitPrice==null&&Number.isSafeInteger(sale.amount/items[0].quantity))items[0].unitPrice=sale.amount/items[0].quantity;
  $('#editSaleItems').replaceChildren();
  $('#editSaleProducts').classList.toggle('hidden',!items.length);
  $('#editSaleLegacy').classList.toggle('hidden',Boolean(items.length));
  $('#editSaleLegacy').textContent=`Producto: ${sale.article||'Compra anterior'}. Esta compra no tiene productos vinculados al inventario.`;
  for(const item of items)addSaleItem('#editSaleItems',item);
  msg($('#editSaleMessage'),'');$('#editSaleDialog').showModal();
}
async function saveEditedSale(event){
  event?.preventDefault();if(!editSaleSnapshot||editSaleSaving)return;
  const original=editSaleSnapshot,client=normName($('#editSaleClientName').value),amount=parseAmount($('#editSaleAmount').value),date=$('#editSaleDate').value,out=$('#editSaleMessage');
  if(!client||client.length>100||!Number.isSafeInteger(amount)||amount<=0||amount>100000000||!date){msg(out,'Revisá cliente, precios y fecha. El total debe ser mayor que cero y no superar ₡100 000 000.',true);return}
  let requested=null;
  if(saleItems(original).length){try{requested=readSaleItems('#editSaleItems',{allowUnpriced:saleItems(original).every(item=>item.unitPrice==null)})}catch(error){msg(out,error.message,true);return}}
  editSaleSaving=true;$('#editSaleFields').disabled=true;$('#saveEditSaleButton').textContent='Guardando…';msg(out,'');
  try{
    await runTransaction(db,async transaction=>{
      const ref=doc(db,'ventas',editSaleId),snapshot=await transaction.get(ref);
      if(!snapshot.exists())throw productError('Esta venta ya no existe. Cerrá y revisá el historial.');
      const current=snapshot.data();
      if(saleSignature(current)!==saleSignature(original))throw productError('Esta venta cambió mientras la editabas. Cerrá esta ventana y volvé a abrirla para revisar los datos actuales.');
      const changes={clientName:client,clientKey:keyName(client),amount,date};
      if(requested){
        const {items,updates}=await prepareSaleStock(transaction,requested,saleItems(current));
        Object.assign(changes,saleItemFields(items));
        for(const update of updates)transaction.update(update.ref,{quantity:update.quantity,updatedAt:serverTimestamp()});
      }
      transaction.update(ref,changes);
    });
    $('#editSaleDialog').close();
  }catch(error){console.error(error);msg(out,saleError(error),true)}
  finally{editSaleSaving=false;$('#editSaleFields').disabled=false;$('#saveEditSaleButton').textContent='Guardar'}
}
function openEditPayment(id){const p=payments.find(x=>x.id===id);if(!p)return;editPaymentId=id;$("#editPaymentAmount").value=new Intl.NumberFormat("es-CR").format(Number(p.amount)||0);$("#editPaymentDate").value=p.date||todayISO;$("#editPaymentDialog").showModal()}
async function saveEditedPayment(){const p=payments.find(x=>x.id===editPaymentId);if(!p)return;const amount=parseAmount($("#editPaymentAmount").value),date=$("#editPaymentDate").value;if(!amount||!date)return msg($("#editPaymentMessage"),"Completa monto y fecha.",true);const credit=sales.filter(x=>x.status==="credit"&&(x.clientKey||keyName(x.clientName))===clientKeyParam).reduce((s,x)=>s+Number(x.amount),0),others=payments.filter(x=>x.id!==p.id&&(x.clientKey||keyName(x.clientName))===clientKeyParam).reduce((s,x)=>s+Number(x.amount),0);if(amount>Math.max(0,credit-others))return msg($("#editPaymentMessage"),"El pago supera la deuda pendiente.",true);try{await runTransaction(db,async t=>t.update(doc(db,"pagos",p.id),{amount,date}));$("#editPaymentDialog").close()}catch(e){console.error(e);msg($("#editPaymentMessage"),"No se pudo actualizar.",true)}}

function renderHistory(){const c=$("#historyList");const items=allMovements();if(!items.length){c.innerHTML='<p class="empty">Todavía no hay movimientos.</p>';return}const months=[...new Set(items.map(x=>x.date?.slice(0,7)).filter(Boolean))].sort().reverse();c.innerHTML=months.map(m=>{const mi=items.filter(x=>x.date?.startsWith(m)),sv=mi.filter(x=>x.kind==="sale"),pv=mi.filter(x=>x.kind==="payment");const salesHTML=sv.length?sv.map(x=>`<article class="movement"><div><strong>${esc(x.clientName)}</strong>${saleProductsHTML(x)}<small>${x.status==="paid"?"Pagado":"A crédito"} · ${dateFmt(x.date)}</small></div><div><div class="moneyval sale">${money(x.amount)}</div><button class="textbtn delete-record" data-col="ventas" data-id="${esc(x.id)}">Eliminar</button></div></article>`).join(""):'<p class="empty">Sin ventas.</p>';const payHTML=pv.length?pv.map(x=>`<article class="movement"><div><strong>${esc(x.clientName)}</strong><small>Pago recibido · ${dateFmt(x.date)}</small></div><div><div class="moneyval payment">+${money(x.amount)}</div><button class="textbtn delete-record" data-col="pagos" data-id="${esc(x.id)}">Eliminar</button></div></article>`).join(""):'<p class="empty">Sin pagos.</p>';return`<section class="month-block"><div class="month-heading"><h2>${monthLabel(m)}</h2><span>${mi.length} movimientos</span></div><div class="history-section"><h3>Ventas</h3>${salesHTML}</div><div class="history-section"><h3>Pagos recibidos</h3>${payHTML}</div></section>`}).join("");$$('.delete-record').forEach(b=>b.onclick=async()=>{if(confirm("¿Eliminar este registro?"))await deleteDoc(doc(db,b.dataset.col,b.dataset.id))})}

function bind(){if(page==="sale"){$("#saleDate").value=todayISO;$("#saleForm").onsubmit=saveSale;bindSaleItems("#saleItems","#addSaleItemButton");addSaleItem("#saleItems");$("#saleAmount").onblur=e=>e.target.value=parseAmount(e.target.value)?new Intl.NumberFormat("es-CR").format(parseAmount(e.target.value)):""}if(page==="inventory"){$("#saveInventoryProductButton").onclick=addProduct;bindStockEditor()}if(page==="client"){$("#paymentDate").value=todayISO;$("#savePaymentButton").onclick=savePayment;$("#showPaymentButton").onclick=()=>$("#paymentPanel").classList.toggle("hidden");$("#editSaleForm").onsubmit=saveEditedSale;bindSaleItems("#editSaleItems","#addEditSaleItemButton");$("#editSaleDialog").addEventListener("cancel",event=>{if(editSaleSaving)event.preventDefault()});$("#saveEditPaymentButton").onclick=saveEditedPayment;$("#cancelEditSaleButton").onclick=()=>$("#editSaleDialog").close();$("#cancelEditPaymentButton").onclick=()=>$("#editPaymentDialog").close()}}
bind();
onSnapshot(salesRef,s=>{sales=s.docs.map(d=>({id:d.id,...d.data()}));ready.sales=true;setStatus();render()},e=>console.error(e));
onSnapshot(paymentsRef,s=>{payments=s.docs.map(d=>({id:d.id,...d.data()}));ready.payments=true;setStatus();render()},e=>console.error(e));
onSnapshot(inventoryRef,s=>{inventory=s.docs.map(d=>({id:d.id,...d.data()}));ready.inventory=true;setStatus();render()},e=>console.error(e));
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'}).catch(console.error));
