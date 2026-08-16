
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const players = window.PLAYERS || [];
const formations = window.FORMATIONS || [];
const DEFAULT_BUDGET = 2500;
const BUDGETS = {POR:250,DIF:500,CEN:625,ATT:1125};
const SERIES_A_CLUBS = [
  ["ATA","Atalanta"],["BOL","Bologna"],["CAG","Cagliari"],["COM","Como"],["FIO","Fiorentina"],
  ["FRO","Frosinone"],["GEN","Genoa"],["INT","Inter"],["JUV","Juventus"],["LAZ","Lazio"],
  ["LEC","Lecce"],["MIL","Milan"],["MON","Monza"],["NAP","Napoli"],["PAR","Parma"],
  ["ROM","Roma"],["SAS","Sassuolo"],["TOR","Torino"],["UDI","Udinese"],["VEN","Venezia"]
];
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

  const u23=bought.filter(p=>p.u23).length;
  const u21=bought.filter(p=>p.u21).length;
  const porCount=bought.filter(p=>p.reparto==="POR").length;
  const movCount=bought.length-porCount;

  const clubAlerts=SERIES_A_CLUBS
    .map(([code])=>[code,countClub(code)])
    .filter(([,count])=>count>5);

  let alerts=[];
  if(bought.length>25) alerts.push(`Rosa oltre limite: ${bought.length}/25`);
  if(porCount>3) alerts.push(`Portieri oltre limite: ${porCount}/3`);
  if(movCount>22) alerts.push(`Movimento oltre limite: ${movCount}/22`);
  if(clubAlerts.length) alerts.push("Club oltre 5: "+clubAlerts.map(([c,n])=>`${c} ${n}/5`).join(", "));

  const recent=bought.slice()
    .sort((a,b)=>(state.purchases[b.id]?.at||0)-(state.purchases[a.id]?.at||0))
    .slice(0,5);

  $("#dashboardView").innerHTML=`
    <div class="dashboard-cockpit">

      <div class="dash-metrics">
        <div class="dash-metric">
          <span>Budget</span>
          <strong>${fmt(rem)}</strong>
          <small>residuo</small>
        </div>
        <div class="dash-metric">
          <span>Rosa</span>
          <strong>${bought.length}/25</strong>
          <small>${porCount} POR · ${movCount} mov.</small>
        </div>
        <div class="dash-metric ${u23>=2?"metric-ok":"metric-warn"}">
          <span>U23</span>
          <strong>${u23}/2</strong>
          <small>minimo</small>
        </div>
        <div class="dash-metric ${u21>=1?"metric-ok":"metric-warn"}">
          <span>U21</span>
          <strong>${u21}/1</strong>
          <small>minimo</small>
        </div>
      </div>

      <div class="dash-budget-grid">
        ${Object.entries(BUDGETS).map(([rep,b])=>{
          const x=byRep[rep], left=b-x, pct=Math.min(100,Math.max(0,x/b*100));
          return `<div class="dash-budget">
            <div class="dash-budget-top"><b>${rep}</b><span>${fmt(x)}/${fmt(b)}</span></div>
            <div class="mini-progress"><i style="width:${pct}%"></i></div>
            <small>${left>=0?`${fmt(left)} rim.`:`${fmt(Math.abs(left))} oltre`}</small>
          </div>`;
        }).join("")}
      </div>

      ${alerts.length?`<div class="dash-critical">⛔ ${alerts.join(" · ")}</div>`:""}

      <div class="dash-club-title">
        <b>20 CLUB SERIE A</b>
        <span>max 5 giocatori</span>
      </div>
      ${clubCounterHTML(bought)}

      ${formationCarouselHTML()}
    </div>

    <div class="recent-section">
      <div class="recent-heading">
        <div>
          <div class="eyebrow">Cronologia</div>
          <h2>Ultimi 5 acquisti</h2>
        </div>
        <span class="muted">${fmt(s)} spesi</span>
      </div>

      ${recent.length?`<div class="toolbar recent-toolbar"><button id="undoLastPurchaseBtn" class="ghost">↩️ Annulla ultimo</button></div>`:""}
      ${recent.length?recent.map(playerRow).join(""):`<div class="card muted">Nessun acquisto ancora.</div>`}
    </div>
  `;

  const undoBtn=$("#undoLastPurchaseBtn");
  if(undoBtn) undoBtn.onclick=undoLastPurchase;
}

function clubCounterHTML(bought){
  const counts={};
  SERIES_A_CLUBS.forEach(([code])=>counts[code]=0);
  bought.forEach(p=>{
    if(Object.prototype.hasOwnProperty.call(counts,p.club)){
      counts[p.club]+=1;
    }
  });

  return `<div class="club-grid">
    ${SERIES_A_CLUBS.map(([club,fullName])=>{
      const count=counts[club]||0;
      let cls="club-safe";
      if(count>=5) cls="club-full";
      else if(count===4) cls="club-warning";

      return `<div class="club-tile ${cls}" title="${fullName}">
        <b>${club}</b>
        <strong>${count}/5</strong>
      </div>`;
    }).join("")}
  </div>`;
}

function formationCarouselHTML(){
  if(!formations.length){
    return `<div class="formation-box">
      <div class="formation-box-head">
        <div><b>Probabili Formazioni</b><span>Fantacalcio.it</span></div>
      </div>
      <div class="card muted">Formazioni non disponibili.</div>
    </div>`;
  }

  const pages=[];
  for(let i=0;i<formations.length;i+=5){
    pages.push(formations.slice(i,i+5));
  }

  return `<section class="formation-box" aria-label="Probabili Formazioni">
    <div class="formation-box-head">
      <div>
        <b>Probabili Formazioni</b>
        <span>Fantacalcio.it · 16/08/2026</span>
      </div>
      <small>5 per pagina · scorri ↑</small>
    </div>

    <div class="formation-vertical-carousel">
      ${pages.map((page,pageIndex)=>`
        <div class="formation-page" data-page="${pageIndex+1}">
          ${page.map(f=>{
            const index=formations.indexOf(f);
            return formationCardHTML(f,index);
          }).join("")}
        </div>
      `).join("")}
    </div>

    <div class="formation-page-hint">
      <span>1</span><i></i><span>4</span>
      <small>swipe verticale</small>
    </div>
  </section>`;
}

function formationCardHTML(f,index){
  const pitchLines=f.lines.slice().reverse().map(line=>
    `<div class="formation-line">${
      line.map(p=>`<div class="formation-player" title="${p.name} · ${p.role}">
        <b>${p.name}</b><span>${p.role}</span>
      </div>`).join("")
    }</div>`
  ).join("");

  return `<button class="formation-card formation-card-mini" onclick="openFormation(${index})" aria-label="${f.team}, ${f.module}">
    <div class="formation-card-head">
      <b>${f.club || f.team.slice(0,3).toUpperCase()}</b>
      <span>${f.module}</span>
    </div>
    <div class="mini-pitch">
      <i class="pitch-half"></i>
      <i class="pitch-circle"></i>
      <div class="formation-lines">${pitchLines}</div>
    </div>
    <div class="formation-team-name">${f.team}</div>
  </button>`;
}

window.openFormation=index=>{
  const f=formations[index]; if(!f)return;
  const pitchLines=f.lines.slice().reverse().map(line=>`<div class="formation-line large">${line.map(p=>`<div class="formation-player large"><b>${p.name}</b><span>${p.role}</span></div>`).join("")}</div>`).join("");
  $("#formationDialogContent").innerHTML=`<div class="dialog-body formation-dialog-body">
    <div class="formation-modal-head"><div><div class="eyebrow">Probabile formazione</div><h2>${f.team} · ${f.module}</h2><p>Ruoli Mantra · aggiornamento ${f.updated}</p></div><button class="ghost" onclick="formationDialog.close()">✕</button></div>
    <div class="large-pitch"><i class="pitch-half"></i><i class="pitch-circle"></i><div class="formation-lines">${pitchLines}</div></div>
    <p class="formation-source">Formazione tipo: Fantacalcio.it · Ruoli: Listone/guida Mantra 2026/27.</p>
  </div>`;
  $("#formationDialog").showModal();
};

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
