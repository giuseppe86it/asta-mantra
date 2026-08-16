
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const players = window.PLAYERS || [];
const DEFAULT_BUDGET = 2500;
const BUDGETS = {POR:250,DIF:500,CEN:625,ATT:1125};
const roleOrder = ["Por","Ds","Dc","Dd","M","C","W","A","Pc"];
const state = {
  purchases: JSON.parse(localStorage.getItem("am_purchases")||"{}"),
  pin: localStorage.getItem("am_pin")||"",
  view:"dashboardView",
  filter:"Tutti",
  query:""
};
function save(){localStorage.setItem("am_purchases",JSON.stringify(state.purchases))}
function roleTokens(role){return String(role||"").split("/").map(x=>x.trim())}
function fmt(n){return Number(n||0).toLocaleString("it-IT")}
function purchasedPlayers(){return players.filter(p=>state.purchases[p.id])}
function spent(){return Object.values(state.purchases).reduce((a,x)=>a+Number(x.price||0),0)}
function countClub(club){return purchasedPlayers().filter(p=>p.club===club).length}
function signal(p, price){
  price=Number(price||0); let m=Number(p.maxPrice||0);
  if(!price) return {t:"Inserisci il prezzo",c:""};
  if(price<=m*.75) return {t:"🟢 AFFARE",c:"green"};
  if(price<=m*.92) return {t:"🟢 OK",c:"green"};
  if(price<=m) return {t:"🟠 LIMITE",c:"orange"};
  return {t:"⛔ STOP",c:"red"};
}
function renderDashboard(){
  const bought=purchasedPlayers(), s=spent(), rem=DEFAULT_BUDGET-s;
  const byRep={POR:0,DIF:0,CEN:0,ATT:0};
  bought.forEach(p=>byRep[p.reparto]+=Number(state.purchases[p.id].price||0));
  const u23=bought.filter(p=>p.u23).length,u21=bought.filter(p=>p.u21).length;
  const clubAlerts=[...new Set(bought.map(p=>p.club))].filter(c=>countClub(c)>5);
  let alerts=[];
  if(u23<2) alerts.push(`Mancano ${2-u23} U23`);
  if(u21<1) alerts.push("Manca 1 U21");
  if(bought.length>25) alerts.push("Hai superato i 25 giocatori");
  if(clubAlerts.length) alerts.push("Troppi giocatori: "+clubAlerts.join(", "));
  $("#dashboardView").innerHTML=`
    <div class="grid">
      <div class="card metric"><span>Budget residuo</span><strong>${fmt(rem)}</strong><span>su 2500</span></div>
      <div class="card metric"><span>Giocatori</span><strong>${bought.length}/25</strong><span>3 POR + 22 movimento</span></div>
      <div class="card metric"><span>U23</span><strong>${u23}</strong><span>minimo 2</span></div>
      <div class="card metric"><span>U21</span><strong>${u21}</strong><span>minimo 1</span></div>
    </div>
    ${alerts.length?`<div class="alert"><b>⚠️ Controlli</b><br>${alerts.join("<br>")}</div>`:`<div class="alert ok"><b>✅ Vincoli principali sotto controllo</b></div>`}
    <div class="section-title"><h2>Budget per reparto</h2></div>
    ${Object.entries(BUDGETS).map(([rep,b])=>{let x=byRep[rep];return `<div class="card" style="margin-bottom:10px">
      <div class="line"><b>${rep}</b><span>${fmt(x)} / ${fmt(b)}</span></div>
      <div class="progress"><i style="width:${Math.min(100,x/b*100)}%"></i></div>
      <div class="muted" style="margin-top:7px">Residuo guida: ${fmt(b-x)}</div>
    </div>`}).join("")}
    <div class="section-title"><h2>Giocatori per club</h2><span class="muted">massimo 5</span></div>
    ${clubCounterHTML(bought)}

    <div class="section-title"><h2>Acquisti recenti</h2><span class="muted">${fmt(s)} spesi</span></div>
    ${bought.length?`<div class="toolbar" style="margin-bottom:10px"><button id="undoLastPurchaseBtn" class="ghost">↩️ Annulla ultimo acquisto</button></div>`:""}
    ${bought.length?bought.slice().sort((a,b)=>(state.purchases[b.id]?.at||0)-(state.purchases[a.id]?.at||0)).slice(0,8).map(playerRow).join(""):`<div class="card muted">Nessun acquisto ancora.</div>`}
  `;
  const undoBtn=$("#undoLastPurchaseBtn");
  if(undoBtn) undoBtn.onclick=undoLastPurchase;
}

function clubCounterHTML(bought){
  if(!bought.length){
    return `<div class="card muted">Nessun club ancora presente in rosa.</div>`;
  }

  const counts={};
  bought.forEach(p=>{
    counts[p.club]=(counts[p.club]||0)+1;
  });

  const rows=Object.entries(counts)
    .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))
    .map(([club,count])=>{
      let cls="";
      let label="";
      if(count>5){
        cls="club-stop";
        label=" ⛔ STOP";
      }else if(count===5){
        cls="club-full";
        label=" 🔴 PIENO";
      }else if(count===4){
        cls="club-warning";
        label=" 🟠 ATTENZIONE";
      }else{
        cls="club-safe";
      }

      const pct=Math.min(100,(count/5)*100);

      return `<div class="club-counter ${cls}">
        <div class="club-counter-head">
          <b>${club}</b>
          <span><strong>${count}/5</strong>${label}</span>
        </div>
        <div class="progress"><i style="width:${pct}%"></i></div>
      </div>`;
    }).join("");

  return `<div class="card club-counter-card">${rows}</div>`;
}

function playerRow(p){
  const b=state.purchases[p.id]; const sig=b?signal(p,b.price):null;
  return `<div class="player ${b?"bought":""}" data-id="${p.id}">
    <div><h3>${p.name} ${p.notes&&p.notes.includes("TARGET")?'<span class="badge target">TARGET</span>':""}</h3>
    <div class="meta">${p.club} · ${p.role} · ${p.tier}</div>
    <span class="badge">FVM ${p.fvm}</span><span class="badge">${p.starter}</span>
    ${p.u23?'<span class="badge">U23</span>':""}${p.u21?'<span class="badge">U21</span>':""}</div>
    <div><div class="price">${b?fmt(b.price):"MAX "+fmt(p.maxPrice)}</div><div class="meta">${b?sig.t:""}</div></div>
  </div>`;
}
function renderPlayers(){
  let roles=["Tutti",...roleOrder];
  let list=players.filter(p=>{
    let q=state.query.trim().toLowerCase();
    let okq=!q || (p.name+" "+p.club+" "+p.role).toLowerCase().includes(q);
    let okr=state.filter==="Tutti" || roleTokens(p.role).includes(state.filter);
    return okq&&okr;
  }).sort((a,b)=>{
    let ta=(a.notes||"").includes("TARGET")?0:1,tb=(b.notes||"").includes("TARGET")?0:1;
    return ta-tb || b.maxPrice-a.maxPrice || b.fvm-a.fvm;
  });
  $("#playersView").innerHTML=`
    <input class="search" id="searchInput" placeholder="Cerca giocatore, club o ruolo…" value="${state.query.replaceAll('"','&quot;')}">
    <div class="chips">${roles.map(r=>`<button class="chip ${state.filter===r?"active":""}" data-role="${r}">${r}</button>`).join("")}</div>
    <div class="muted" style="margin:8px 2px">${list.length} giocatori</div>
    <div>${list.map(playerRow).join("")}</div>`;
  $("#searchInput").addEventListener("input",e=>{state.query=e.target.value;renderPlayers();bindPlayers()});
  $$(".chip").forEach(b=>b.onclick=()=>{state.filter=b.dataset.role;renderPlayers();bindPlayers()});
  bindPlayers();
}
function bindPlayers(){
  $$(".player[data-id]").forEach(el=>el.onclick=()=>openPlayer(Number(el.dataset.id)));
}
function openPlayer(id){
  const p=players.find(x=>x.id===id),b=state.purchases[id];
  $("#playerDialogContent").innerHTML=`<div class="dialog-body">
    <div class="section-title"><div><div class="eyebrow">${p.club} · ${p.role}</div><h2>${p.name}</h2></div><button class="ghost" onclick="playerDialog.close()">✕</button></div>
    <div class="grid">
      <div class="card metric"><span>FVM</span><strong>${p.fvm}</strong></div>
      <div class="card metric"><span>Prezzo MAX</span><strong>${p.maxPrice}</strong></div>
    </div>
    <div class="card" style="margin-top:10px">
      <div class="line"><span>Fascia</span><b>${p.tier}</b></div>
      <div class="line"><span>Titolarità</span><b>${p.starter}</b></div>
      <div class="line"><span>Rigori / piazzati</span><b>${p.setPieces||"—"}</b></div>
      <div class="line"><span>Giovane</span><b>${p.u21?"U21 + U23":p.u23?"U23":"—"}</b></div>
      <div class="line"><span>Modificatore</span><b>${p.modifier||"—"}</b></div>
      ${p.notes?`<div class="line"><span>Note</span><b>${p.notes}</b></div>`:""}
    </div>
    <div class="dialog-actions">
      ${b?`<button class="ghost" onclick="editPurchase(${p.id})">✏️ Modifica acquisto</button><button class="dangerbtn" onclick="removePurchase(${p.id})">Annulla acquisto</button>`:`<button class="primary" onclick="startPurchase(${p.id})">Acquista</button>`}
    </div>
  </div>`;
  $("#playerDialog").showModal();
}
let purchaseId=null;
let purchaseMode="new";

function startPurchase(id){
  purchaseId=id;
  purchaseMode="new";
  const p=players.find(x=>x.id===id);
  $("#playerDialog").close();
  $("#purchaseTitle").textContent="Acquista "+p.name;
  $("#confirmPurchase").textContent="Conferma";
  $("#purchasePrice").value="";
  $("#purchaseSignal").textContent="";
  $("#purchaseDialog").showModal();
  $("#purchasePrice").focus();
}

window.editPurchase=id=>{
  purchaseId=id;
  purchaseMode="edit";
  const p=players.find(x=>x.id===id);
  const current=state.purchases[id];
  $("#playerDialog").close();
  $("#purchaseTitle").textContent="Modifica "+p.name;
  $("#confirmPurchase").textContent="Salva";
  $("#purchasePrice").value=current?.price ?? "";
  const s=signal(p,current?.price ?? "");
  $("#purchaseSignal").className="signal "+s.c;
  $("#purchaseSignal").textContent=s.t;
  $("#purchaseDialog").showModal();
  $("#purchasePrice").focus();
  $("#purchasePrice").select();
};
$("#purchasePrice").addEventListener("input",e=>{
  const p=players.find(x=>x.id===purchaseId),s=signal(p,e.target.value);
  $("#purchaseSignal").className="signal "+s.c; $("#purchaseSignal").textContent=s.t;
});
$("#purchaseForm").addEventListener("submit",e=>{
  if(e.submitter?.value==="cancel")return;
  e.preventDefault();
  const price=Number($("#purchasePrice").value);
  if(!Number.isInteger(price) || price < 1) return;
  const previous=state.purchases[purchaseId];
  state.purchases[purchaseId]={
    price,
    at: purchaseMode==="edit" && previous?.at ? previous.at : Date.now()
  };
  save();
  $("#purchaseDialog").close();
  refresh();
});
window.removePurchase=id=>{
  delete state.purchases[id];
  save();
  $("#playerDialog").close();
  refresh();
}

function undoLastPurchase(){
  const entries=Object.entries(state.purchases);
  if(!entries.length) return;
  const [lastId,lastData]=entries.sort((a,b)=>(b[1]?.at||0)-(a[1]?.at||0))[0];
  const p=players.find(x=>x.id===Number(lastId));
  if(!p) return;
  if(confirm(`Annullare l'ultimo acquisto?\n\n${p.name} — ${lastData.price} crediti`)){
    delete state.purchases[lastId];
    save();
    refresh();
  }
}

function renderSquad(){
  const b=purchasedPlayers();
  $("#squadView").innerHTML=`<div class="section-title"><h2>La mia rosa</h2><span class="muted">${b.length}/25</span></div>
  ${["POR","DIF","CEN","ATT"].map(rep=>`<div class="role-group"><h3>${rep}</h3>${b.filter(p=>p.reparto===rep).length?b.filter(p=>p.reparto===rep).map(playerRow).join(""):'<div class="card muted">Nessun giocatore.</div>'}</div>`).join("")}`;
  bindPlayers();
}
function pickFor(slot,used,b){
  return b.filter(p=>!used.has(p.id)&&roleTokens(p.role).includes(slot))
          .sort((a,c)=>c.maxPrice-a.maxPrice)[0];
}
function renderPlan(){
  const b=purchasedPlayers(),used=new Set(),slots=["Por","Ds","Dc","Dc","Dd","M","M","C","W","Pc","W"];
  let xi=slots.map(s=>{let p=pickFor(s,used,b);if(p)used.add(p.id);return {s,p}});

  const poolByRep={POR:0,DIF:0,CEN:0,ATT:0};
  players.forEach(p=>poolByRep[p.reparto]=(poolByRep[p.reparto]||0)+1);
  const movement=players.length-poolByRep.POR;
  const roleCounts={};
  ["Por","Ds","Dc","Dd","M","C","W","A","Pc"].forEach(r=>{
    roleCounts[r]=players.filter(p=>roleTokens(p.role).includes(r)).length;
  });

  $("#planView").innerHTML=`
    <div class="section-title"><h2>Strategia mercato — 8 squadre</h2></div>
    <div class="grid">
      <div class="card metric"><span>Bacino analizzato</span><strong>${players.length}/200</strong><span>mercato strategico</span></div>
      <div class="card metric"><span>Portieri</span><strong>${poolByRep.POR}/24</strong><span>3 × 8 squadre</span></div>
      <div class="card metric"><span>Movimento</span><strong>${movement}/176</strong><span>22 × 8 squadre</span></div>
      <div class="card metric"><span>Struttura target</span><strong>3+22</strong><span>3 POR · 8 DIF · 7 CEN · 7 ATT</span></div>
    </div>

    <div class="section-title"><h2>Profondità strategica</h2></div>
    <div class="card">
      <div class="line"><span>Difensori nel bacino</span><b>${poolByRep.DIF}/64</b></div>
      <div class="line"><span>Centrocampisti nel bacino</span><b>${poolByRep.CEN}/56</b></div>
      <div class="line"><span>Attaccanti/W nel bacino</span><b>${poolByRep.ATT}/56</b></div>
      <div class="line"><span>Budget guida</span><b>250 · 500 · 625 · 1125</b></div>
    </div>

    <div class="section-title"><h2>Copertura ruoli Mantra nel database</h2></div>
    <div class="card">
      ${["Por","Ds","Dc","Dd","M","C","W","A","Pc"].map(r=>`<div class="line"><span>${r}</span><b>${roleCounts[r]} opzioni</b></div>`).join("")}
    </div>

    <div class="section-title"><h2>Priorità del tuo 4-3-3</h2></div>
    <div class="card">
      <div class="line"><span>POR</span><b>Top/value + complementare + copertura</b></div>
      <div class="line"><span>Ds</span><b>2 elementi realmente schierabili</b></div>
      <div class="line"><span>Dc</span><b>4 — qualità media per modificatore</b></div>
      <div class="line"><span>Dd</span><b>2 elementi realmente schierabili</b></div>
      <div class="line"><span>M/C + M + C</span><b>7 totali, priorità multiruolo</b></div>
      <div class="line"><span>W/A + A/Pc + W/A</span><b>7 totali, almeno 4 esterni + 3 punte</b></div>
    </div>

    <p class="install-note" style="margin-top:12px">
      Il bacino 64 DIF / 56 CEN / 56 ATT è una griglia strategica costruita sul tuo obiettivo 8-7-7 per 8 squadre:
      non è un vincolo regolamentare della lega. I giocatori con soli ruoli E/T/B che non coprono uno slot del tuo 4-3-3
      vengono volutamente penalizzati o esclusi.
    </p>

    <div class="section-title"><h2>4-3-3 Mantra suggerito dalla tua rosa</h2></div>
    <div class="card">${xi.map(x=>`<div class="line"><span>${x.s}</span><b>${x.p?x.p.name:"— manca copertura —"}</b></div>`).join("")}</div>
    <p class="install-note" style="margin-top:12px">È una verifica automatica di copertura ruoli, non una formazione basata sull'avversario della giornata.</p>`;
}
function renderSettings(){
  $("#settingsView").innerHTML=`<div class="section-title"><h2>Impostazioni</h2></div>
    <div class="card">
      <h3>Privacy</h3><p class="muted">Tutti i dati dell'asta restano nel browser del dispositivo. Nessun account e nessun tracciamento.</p>
      <div class="toolbar"><button id="setPin" class="ghost">${state.pin?"Cambia PIN":"Imposta PIN"}</button>${state.pin?'<button id="removePin" class="ghost">Rimuovi PIN</button>':""}</div>
    </div>
    <div class="card" style="margin-top:10px"><h3>Backup</h3>
      <div class="toolbar"><button id="exportBtn" class="primary">Esporta backup</button><label class="ghost" style="margin:0">Importa backup<input id="importFile" type="file" accept=".json" hidden></label></div>
    </div>
    <div class="card" style="margin-top:10px"><h3>Reset</h3><button id="resetBtn" class="dangerbtn">Azzera tutta l'asta</button></div>
    <div class="card install-note" style="margin-top:10px"><b>Installazione su iPhone</b><br>Apri il sito in Safari → Condividi → Aggiungi alla schermata Home → attiva “Apri come app” se disponibile.</div>`;
  $("#setPin").onclick=()=>{let p=prompt("Scegli un PIN numerico (4-8 cifre):");if(/^\d{4,8}$/.test(p||"")){localStorage.setItem("am_pin",p);state.pin=p;alert("PIN salvato.")}};
  if($("#removePin"))$("#removePin").onclick=()=>{localStorage.removeItem("am_pin");state.pin="";renderSettings()};
  $("#resetBtn").onclick=()=>{if(confirm("Vuoi davvero cancellare tutti gli acquisti?")){state.purchases={};save();refresh()}};
  $("#exportBtn").onclick=()=>{let blob=new Blob([JSON.stringify({version:1,purchases:state.purchases},null,2)],{type:"application/json"});let a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="AstaMantra-backup.json";a.click();URL.revokeObjectURL(a.href)};
  $("#importFile").onchange=e=>{let f=e.target.files[0];if(!f)return;let rd=new FileReader();rd.onload=()=>{try{let o=JSON.parse(rd.result);state.purchases=o.purchases||{};save();refresh();alert("Backup importato.")}catch{alert("File non valido.")}};rd.readAsText(f)};
}
function switchView(id){
  state.view=id;$$(".view").forEach(v=>v.classList.toggle("active",v.id===id));$$(".tab").forEach(t=>t.classList.toggle("active",t.dataset.view===id));
  if(id==="dashboardView")renderDashboard();if(id==="playersView")renderPlayers();if(id==="squadView")renderSquad();if(id==="planView")renderPlan();if(id==="settingsView")renderSettings();
}
$$(".tab").forEach(t=>t.onclick=()=>switchView(t.dataset.view));
$("#settingsBtn").onclick=()=>switchView("settingsView");
function refresh(){renderDashboard();renderPlayers();renderSquad();renderPlan();if(state.view==="settingsView")renderSettings()}
function lockInit(){
  if(!state.pin)return;
  $("#lock").classList.remove("hidden");$("#disablePinBtn").style.display="none";
  $("#unlockBtn").onclick=()=>{if($("#pinInput").value===state.pin)$("#lock").classList.add("hidden");else $("#lockText").textContent="PIN errato. Riprova."};
}
refresh();lockInit();
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
