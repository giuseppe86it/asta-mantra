
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const strategicPlayers = window.PLAYERS || [];
const marketSeed = window.MARKET_PLAYERS || [];
const marketMeta = window.MARKET_META || {};
const players = strategicPlayers; // compatibilità con il codice storico
const formations = window.FORMATIONS || [];

function normalizePlayerName(name){
  return String(name||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}
function marketTier(fvm){
  const v=Number(fvm||0);
  if(v>=180)return "TOP";
  if(v>=90)return "SEMITOP";
  if(v>=45)return "TITOLARE";
  if(v>=20)return "VALUE";
  if(v>=8)return "ROTAZIONE";
  return "LOW COST";
}
function enrichMarketPlayer(p){
  return {
    ...p,
    maxPrice:Number(p.marketMax||Math.max(1,Math.round(Number(p.fvm||0)*2.5))),
    tier:p.tier||marketTier(p.fvm),
    starter:p.starter||"Listone",
    setPieces:p.setPieces||"—",
    u23:!!p.u23,
    u21:!!p.u21,
    modifier:p.modifier||"—",
    notes:p.notes||"LISTONE COMPLETO · MAX neutro da FVM ×2,5",
    strategic:!!p.strategic
  };
}
function buildAllPlayers(){
  const byName=new Map();
  marketSeed.forEach(p=>byName.set(normalizePlayerName(p.name),enrichMarketPlayer(p)));
  strategicPlayers.forEach(p=>{
    byName.set(normalizePlayerName(p.name),enrichMarketPlayer({...p,strategic:true}));
  });
  return [...byName.values()];
}
const allPlayers = buildAllPlayers();
function getPlayer(id){
  return allPlayers.find(p=>String(p.id)===String(id));
}
function idArg(id){return JSON.stringify(String(id));}
const DEFAULT_BUDGET = 2500;
const STRATEGIES = {
  A:{
    id:"A",
    module:"4-3-1-2",
    name:"Strategia A",
    budgets:{POR:250,DIF:550,CEN:725,ATT:975},
    slots:[
      {label:"Por",roles:["Por"]},
      {label:"Dd",roles:["Dd"]},{label:"Dc",roles:["Dc"]},{label:"Dc",roles:["Dc"]},{label:"Ds",roles:["Ds"]},
      {label:"M/C",roles:["M","C"]},{label:"M",roles:["M"]},{label:"C",roles:["C"]},
      {label:"T",roles:["T"]},{label:"T/A/Pc",roles:["T","A","Pc"]},{label:"A/Pc",roles:["A","Pc"]}
    ],
    keySlots:[
      {label:"T",roles:["T"]},{label:"T/A/Pc",roles:["T","A","Pc"]},{label:"A/Pc",roles:["A","Pc"]}
    ],
    priority:"T + T/A/Pc + A/Pc",
    depth:"2 profili T · 4 profili A/Pc"
  },
  B:{
    id:"B",
    module:"4-3-3",
    name:"Strategia B",
    budgets:{POR:250,DIF:500,CEN:625,ATT:1125},
    slots:[
      {label:"Por",roles:["Por"]},
      {label:"Dd",roles:["Dd"]},{label:"Dc",roles:["Dc"]},{label:"Dc",roles:["Dc"]},{label:"Ds",roles:["Ds"]},
      {label:"M/C",roles:["M","C"]},{label:"M",roles:["M"]},{label:"C",roles:["C"]},
      {label:"W/A",roles:["W","A"]},{label:"A/Pc",roles:["A","Pc"]},{label:"W/A",roles:["W","A"]}
    ],
    keySlots:[
      {label:"W/A",roles:["W","A"]},{label:"A/Pc",roles:["A","Pc"]},{label:"W/A",roles:["W","A"]}
    ],
    priority:"W/A + A/Pc + W/A",
    depth:"4 profili W/A · 3 profili A/Pc"
  }
};
const SERIES_A_CLUBS = [
  ["ATA","Atalanta"],["BOL","Bologna"],["CAG","Cagliari"],["COM","Como"],["FIO","Fiorentina"],
  ["FRO","Frosinone"],["GEN","Genoa"],["INT","Inter"],["JUV","Juventus"],["LAZ","Lazio"],
  ["LEC","Lecce"],["MIL","Milan"],["MON","Monza"],["NAP","Napoli"],["PAR","Parma"],
  ["ROM","Roma"],["SAS","Sassuolo"],["TOR","Torino"],["UDI","Udinese"],["VEN","Venezia"]
];
const roleOrder = ["Por","Ds","Dc","Dd","B","E","M","C","W","T","A","Pc"];
const state = {
  purchases: JSON.parse(localStorage.getItem("am_purchases")||"{}"),
  sold: JSON.parse(localStorage.getItem("am_sold")||"{}"),
  pin: localStorage.getItem("am_pin")||"",
  view:"dashboardView",
  filter:"Tutti",
  query:"",
  strategy: localStorage.getItem("am_strategy") || "A",
  poolMode: localStorage.getItem("am_pool_mode") || "strategic"
};
function save(){localStorage.setItem("am_purchases",JSON.stringify(state.purchases))}
function saveSold(){localStorage.setItem("am_sold",JSON.stringify(state.sold))}
function soldPlayers(){return allPlayers.filter(p=>state.sold[p.id])}
function isSold(id){return !!state.sold[id]}
function roleTokens(role){return String(role||"").split("/").map(x=>x.trim()).filter(Boolean)}
function activeStrategy(){return STRATEGIES[state.strategy] || STRATEGIES.A}
function slotCompatible(p,slot){
  const tokens=roleTokens(p.role);
  return slot.roles.some(r=>tokens.includes(r));
}
function strategyPlayerFit(p,strategyId=state.strategy){
  const st=STRATEGIES[strategyId]||STRATEGIES.A;
  const labels=st.keySlots.filter(slot=>slotCompatible(p,slot)).map(x=>x.label);
  return [...new Set(labels)];
}
function playerQuality(p){
  return Math.min(999,Math.max(0,Number(p.maxPrice||p.marketMax||Math.round(Number(p.fvm||0)*2.5)||0)));
}
function bestLineupMatch(strategy,bought,slotsOverride=null){
  const slots=slotsOverride||strategy.slots;
  let dp=new Map([[0,{value:0,assign:Array(slots.length).fill(null)}]]);
  for(const p of bought){
    const next=new Map(dp);
    for(const [mask,data] of dp){
      for(let i=0;i<slots.length;i++){
        if(mask&(1<<i)) continue;
        if(!slotCompatible(p,slots[i])) continue;
        const nmask=mask|(1<<i);
        const nvalue=data.value+10000+playerQuality(p);
        const prev=next.get(nmask);
        if(!prev || nvalue>prev.value){
          const assign=data.assign.slice();
          assign[i]=p;
          next.set(nmask,{value:nvalue,assign});
        }
      }
    }
    dp=next;
  }
  let best={mask:0,value:0,assign:Array(slots.length).fill(null)};
  for(const [mask,data] of dp){
    const filled=mask.toString(2).split("1").length-1;
    const bestFilled=best.mask.toString(2).split("1").length-1;
    if(filled>bestFilled || (filled===bestFilled && data.value>best.value)){
      best={mask,value:data.value,assign:data.assign};
    }
  }
  best.filled=best.mask.toString(2).split("1").length-1;
  best.total=slots.length;
  return best;
}
function strategyDepth(strategyId,bought){
  const countHas=roles=>bought.filter(p=>roles.some(r=>roleTokens(p.role).includes(r))).length;
  if(strategyId==="A"){
    const t=countHas(["T"]);
    const apc=countHas(["A","Pc"]);
    return {
      value:(Math.min(1,t/2)+Math.min(1,apc/4))/2,
      text:`T ${t}/2 · A/Pc ${apc}/4`
    };
  }
  const wa=countHas(["W","A"]);
  const apc=countHas(["A","Pc"]);
  return {
    value:(Math.min(1,wa/4)+Math.min(1,apc/3))/2,
    text:`W/A ${wa}/4 · A/Pc ${apc}/3`
  };
}
function marketEligiblePlayers(roles){
  return allPlayers.filter(p=>roles.some(r=>roleTokens(p.role).includes(r)));
}
function marketRemainingPlayers(roles){
  return marketEligiblePlayers(roles).filter(p=>!state.purchases[p.id]&&!state.sold[p.id]);
}
function marketRoleHealth(roles,needed){
  if(needed<=0) return {value:1,remaining:marketRemainingPlayers(roles).length,total:marketEligiblePlayers(roles).length};
  const all=marketEligiblePlayers(roles);
  const remaining=all.filter(p=>!state.purchases[p.id]&&!state.sold[p.id]);
  if(!all.length) return {value:0,remaining:0,total:0};

  const weight=p=>1+Math.min(5,playerQuality(p)/120);
  const totalWeight=all.reduce((a,p)=>a+weight(p),0);
  const remainingWeight=remaining.reduce((a,p)=>a+weight(p),0);

  const countShare=remaining.length/all.length;
  const qualityShare=totalWeight?remainingWeight/totalWeight:0;
  const cushion=Math.min(1,remaining.length/Math.max(1,needed*4));
  const value=.35*countShare+.35*qualityShare+.30*cushion;

  return {value,remaining:remaining.length,total:all.length};
}
function strategyMarket(strategyId,bought=purchasedPlayers()){
  const countOwned=roles=>bought.filter(p=>roles.some(r=>roleTokens(p.role).includes(r))).length;

  if(strategyId==="A"){
    const ownedT=countOwned(["T"]);
    const ownedAPc=countOwned(["A","Pc"]);
    const t=marketRoleHealth(["T"],Math.max(0,2-ownedT));
    const apc=marketRoleHealth(["A","Pc"],Math.max(0,4-ownedAPc));
    return {
      value:.58*t.value+.42*apc.value,
      primary:t,
      secondary:apc,
      text:`T mercato ${t.remaining}/${t.total} · A/Pc ${apc.remaining}/${apc.total}`
    };
  }

  const ownedWA=countOwned(["W","A"]);
  const ownedAPc=countOwned(["A","Pc"]);
  const wa=marketRoleHealth(["W","A"],Math.max(0,4-ownedWA));
  const apc=marketRoleHealth(["A","Pc"],Math.max(0,3-ownedAPc));
  return {
    value:.62*wa.value+.38*apc.value,
    primary:wa,
    secondary:apc,
    text:`W/A mercato ${wa.remaining}/${wa.total} · A/Pc ${apc.remaining}/${apc.total}`
  };
}
function strategyScore(strategyId,bought=purchasedPlayers()){
  const st=STRATEGIES[strategyId];
  const full=bestLineupMatch(st,bought);
  const key=bestLineupMatch(st,bought,st.keySlots);
  const depth=strategyDepth(strategyId,bought);
  const market=strategyMarket(strategyId,bought);
  const keyPlayers=key.assign.filter(Boolean);
  const qsum=keyPlayers.reduce((a,p)=>a+playerQuality(p),0);
  const quality=Math.min(1,qsum/900);
  const prior=strategyId==="A"?3:0;

  const score=Math.round(
    35
    +20*(full.filled/full.total)
    +18*(key.filled/3)
    +9*depth.value
    +6*quality
    +12*market.value
    +prior
  );

  return {score:Math.min(100,score),full,key,depth,quality,market};
}
function strategyRecommendation(bought=purchasedPlayers()){
  const A=strategyScore("A",bought),B=strategyScore("B",bought);
  const delta=A.score-B.score;
  let recommended="A",status="BASE";
  if(bought.length<3){
    recommended="A"; status="BASE";
  }else if(delta>=4){
    recommended="A"; status="A";
  }else if(delta<=-4){
    recommended="B"; status="B";
  }else{
    recommended=state.strategy; status="EQUILIBRIO";
  }
  const active=state.strategy;
  let headline="";
  if(status==="EQUILIBRIO") headline=`Rosa ibrida: mantieni ${active}`;
  else if(recommended===active) headline=`Continua con ${recommended} · ${STRATEGIES[recommended].module}`;
  else headline=`Switch consigliato → ${recommended} · ${STRATEGIES[recommended].module}`;

  let reason="";
  if(bought.length<3){
    reason=`Partenza base su A · ${A.market.text} · ${B.market.text}.`;
  }else if(recommended==="A"){
    reason=`A è più coperta: ${A.depth.text} · ${A.market.text}.`;
  }else{
    reason=`B è più coperta: ${B.depth.text} · ${B.market.text}.`;
  }
  return {A,B,recommended,status,headline,reason};
}
function setStrategy(id){
  if(!STRATEGIES[id]) return;
  state.strategy=id;
  localStorage.setItem("am_strategy",id);
  refresh();
}
window.setStrategy=setStrategy;
function primaryOffensiveRole(p){
  if(!p) return null;
  if(["W","T","A","Pc"].includes(p.primaryRole)) return p.primaryRole;
  if(p.reparto!=="ATT") return null;
  return roleTokens(p.role).find(r=>["W","T","A","Pc"].includes(r)) || null;
}
function roleFilterCount(role){
  if(role==="T"){
    return players.filter(p=>roleTokens(p.role).includes("T")).length;
  }
  if(["W","A","Pc"].includes(role)){
    return players.filter(p=>primaryOffensiveRole(p)===role).length;
  }
  return players.filter(p=>roleTokens(p.role).includes(role)).length;
}
function playerMatchesRoleFilter(p,role,mode=state.poolMode){
  if(role==="Tutti") return true;
  if(mode==="all"){
    return roleTokens(p.role).includes(role);
  }
  if(role==="T") return roleTokens(p.role).includes("T");
  if(["W","A","Pc"].includes(role)) return primaryOffensiveRole(p)===role;
  return roleTokens(p.role).includes(role);
}
function fmt(n){return Number(n||0).toLocaleString("it-IT")}
function purchasedPlayers(){return allPlayers.filter(p=>state.purchases[p.id])}
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
  const st=activeStrategy(), budgets=st.budgets, rec=strategyRecommendation(bought);
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

      <div class="strategy-engine ${rec.recommended===state.strategy?"strategy-hold":"strategy-switch"}">
        <div class="strategy-engine-top">
          <div>
            <span class="strategy-kicker">MOTORE STRATEGIA</span>
            <strong>${rec.headline}</strong>
          </div>
          <div class="strategy-scores">
            <span class="${rec.recommended==="A"?"recommended":""}">A ${rec.A.score}</span>
            <span class="${rec.recommended==="B"?"recommended":""}">B ${rec.B.score}</span>
          </div>
        </div>
        <div class="strategy-buttons">
          <button class="strategy-btn ${state.strategy==="A"?"active":""}" onclick="setStrategy('A')">
            <b>A</b><span>4-3-1-2</span>
          </button>
          <button class="strategy-btn ${state.strategy==="B"?"active":""}" onclick="setStrategy('B')">
            <b>B</b><span>4-3-3</span>
          </button>
        </div>
        <div class="strategy-reason">${rec.reason}</div>
        <div class="strategy-market-status">
          <span>Venduti ad altri <b>${soldPlayers().length}</b></span>
          <span>A mercato <b>${Math.round(rec.A.market.value*100)}%</b></span>
          <span>B mercato <b>${Math.round(rec.B.market.value*100)}%</b></span>
        </div>
        <div class="full-market-mini">
          <span>Listone algoritmo</span>
          <b>${allPlayers.length} giocatori</b>
          <small>${allPlayers.filter(p=>!state.sold[p.id]&&!state.purchases[p.id]).length} ancora disponibili</small>
        </div>
      </div>

      <div class="dash-budget-label">
        <b>Budget guida ${state.strategy} · ${st.module}</b>
        <span>${fmt(budgets.POR+budgets.DIF+budgets.CEN+budgets.ATT)} crediti</span>
      </div>
      <div class="dash-budget-grid">
        ${Object.entries(budgets).map(([rep,b])=>{
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

function formationBroadGroup(role){
  const tokens=String(role||"").split("/").map(x=>x.trim()).filter(Boolean);
  if(tokens.includes("Por")) return "POR";
  if(tokens.some(r=>["W","A","Pc"].includes(r))) return "ATT";
  if(tokens.some(r=>["B","Ds","Dc","Dd"].includes(r))) return "DIF";
  return "CEN";
}

function formationListCardHTML(f,index){
  const groups={POR:[],DIF:[],CEN:[],ATT:[]};

  (f.lines||[]).flat().forEach(p=>{
    const g=formationBroadGroup(p.role);
    groups[g].push(p);
  });

  const labels={POR:"POR",DIF:"DIF",CEN:"CEN",ATT:"ATT"};

  return `<article class="formation-list-card"
      role="button"
      tabindex="0"
      onclick="openFormation(${index})"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openFormation(${index})}"
      aria-label="${f.team}, ${f.module}">
    <div class="formation-list-head">
      <div>
        <b>${f.team}</b>
        <span>${f.club}</span>
      </div>
      <strong>${f.module}</strong>
    </div>

    <div class="formation-role-list">
      ${["POR","DIF","CEN","ATT"].map(group=>`
        <div class="formation-role-row formation-role-${group.toLowerCase()}">
          <div class="formation-role-label">${labels[group]}</div>
          <div class="formation-role-players">
            ${groups[group].map(p=>`
              <span class="formation-name-chip">
                <b>${p.name}</b>
                <em>${p.role}</em>
              </span>
            `).join("") || `<span class="formation-empty">—</span>`}
          </div>
        </div>
      `).join("")}
    </div>

    <div class="formation-list-foot">
      <span>Agg. ${f.updated}</span>
      <span>tocca per dettaglio ›</span>
    </div>
  </article>`;
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
  for(let i=0;i<formations.length;i+=2){
    pages.push(formations.slice(i,i+2));
  }

  return `<section class="formation-box formation-list-box" aria-label="Probabili Formazioni">
    <div class="formation-box-head">
      <div>
        <b>Probabili Formazioni</b>
        <span>Fantacalcio.it · titolari + ruoli Mantra</span>
      </div>
      <small>2 squadre · scorri ↑</small>
    </div>

    <div class="formation-list-carousel formation-list-carousel-2col">
      ${pages.map((page,pageIndex)=>`
        <div class="formation-list-page formation-list-page-2col" data-page="${pageIndex+1}">
          ${page.map(f=>{
            const index=formations.indexOf(f);
            return formationListCardHTML(f,index);
          }).join("")}
        </div>
      `).join("")}
    </div>

    <div class="formation-page-hint formation-list-hint">
      <span>1</span><i></i><span>10</span>
      <small>2 squadre per pagina</small>
    </div>
  </section>`;
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
  const b=state.purchases[p.id], sold=isSold(p.id); const sig=b?signal(p,b.price):null;
  const strategic=!!p.strategic;
  return `<div class="player ${b?"bought":""} ${sold?"sold":""} ${strategic?"strategic-player":"market-player"}" data-id="${p.id}">
    <div>
      <h3>${p.name}
        ${p.notes&&p.notes.includes("TARGET")?'<span class="badge target">TARGET</span>':""}
        ${strategic?'<span class="badge strategic-badge">200</span>':'<span class="badge listone-badge">LISTONE</span>'}
      </h3>
      <div class="meta">${p.club} · ${p.role} · ${p.tier||"—"}</div>
      ${p.reparto==="ATT"&&primaryOffensiveRole(p)?`<span class="badge primary-role-badge">PRIM. ${primaryOffensiveRole(p)}</span>`:""}
      <span class="badge">FVM ${p.fvm||0}</span>
      ${strategic&&p.starter?`<span class="badge">${p.starter}</span>`:""}
      ${p.u23?'<span class="badge">U23</span>':""}${p.u21?'<span class="badge">U21</span>':""}
    </div>
    <div>
      <div class="price">${sold?"VENDUTO":b?fmt(b.price):"MAX "+fmt(p.maxPrice)}</div>
      <div class="meta">${sold?"altra squadra":b?sig.t:strategic?"strategico":"da FVM"}</div>
    </div>
  </div>`;
}
function renderPlayers(){
  let roles=["Tutti",...roleOrder,"Venduti"];
  const visiblePool=state.filter==="Venduti"
    ? allPlayers
    : state.poolMode==="all" ? allPlayers : strategicPlayers;

  const baseFiltered=visiblePool.filter(p=>{
    const q=state.query.trim().toLowerCase();
    const okq=!q || (p.name+" "+p.club+" "+p.role+" "+(p.primaryRole||"")).toLowerCase().includes(q);
    let okr;
    if(state.filter==="Venduti"){
      okr=isSold(p.id);
    }else{
      okr=playerMatchesRoleFilter(p,state.filter,state.poolMode) && !isSold(p.id);
    }
    return okq&&okr;
  });

  const sorter=(a,b)=>{
    const ta=(a.notes||"").includes("TARGET")?0:1;
    const tb=(b.notes||"").includes("TARGET")?0:1;
    return ta-tb || Number(b.maxPrice||0)-Number(a.maxPrice||0) || Number(b.fvm||0)-Number(a.fvm||0);
  };

  const list=baseFiltered.slice().sort(sorter);

  let content="";
  if(state.filter==="T"){
    const main=list.filter(p=>primaryOffensiveRole(p)==="T" || (state.poolMode==="all"&&roleTokens(p.role)[0]==="T"));
    const compatible=list.filter(p=>!main.includes(p));
    content=`
      <div class="role-sheet-summary">
        <div><span>T principali</span><strong>${main.length}</strong></div>
        <div><span>T compatibili</span><strong>${compatible.length}</strong></div>
        <div><span>Totale opzioni</span><strong>${list.length}</strong></div>
      </div>
      <div class="role-sheet-section">
        <div class="role-sheet-head">
          <div><b>T principali</b><span>ruolo T prioritario</span></div>
          <strong>${main.length}</strong>
        </div>
        ${main.length?main.map(playerRow).join(""):`<div class="card muted">Nessun T principale.</div>`}
      </div>
      <div class="role-sheet-section">
        <div class="role-sheet-head">
          <div><b>T compatibili</b><span>C/T · W/T · T/A</span></div>
          <strong>${compatible.length}</strong>
        </div>
        ${compatible.length?compatible.map(playerRow).join(""):`<div class="card muted">Nessun T compatibile.</div>`}
      </div>`;
  }else{
    content=`<div>${list.map(playerRow).join("")}</div>`;
  }

  const modePool=state.poolMode==="all"?allPlayers:strategicPlayers;
  const availableModePool=modePool.filter(p=>!isSold(p.id));
  const offensiveDist={
    W:modePool.filter(p=>primaryOffensiveRole(p)==="W").length,
    T:modePool.filter(p=>primaryOffensiveRole(p)==="T").length,
    A:modePool.filter(p=>primaryOffensiveRole(p)==="A").length,
    Pc:modePool.filter(p=>primaryOffensiveRole(p)==="Pc").length
  };

  $("#playersView").innerHTML=`
    <div class="pool-switch">
      <button id="poolStrategic" class="${state.poolMode==="strategic"?"active":""}">
        <b>Strategici</b><span>${strategicPlayers.length}</span>
      </button>
      <button id="poolAll" class="${state.poolMode==="all"?"active":""}">
        <b>Tutto il listone</b><span>${allPlayers.length}</span>
      </button>
    </div>

    <input class="search" id="searchInput" placeholder="Cerca giocatore, club o ruolo…" value="${state.query.replaceAll('"','&quot;')}">

    <div class="market-universe-strip">
      <span>${state.poolMode==="all"?"Universo mercato":"Shortlist strategica"}</span>
      <b>${availableModePool.length} disponibili</b>
      <b>${soldPlayers().length} venduti</b>
    </div>

    ${state.poolMode==="strategic"?`
      <div class="role-redistribution">
        <span>Offensivi principali</span>
        <b>W ${offensiveDist.W}</b><b>T ${offensiveDist.T}</b><b>A ${offensiveDist.A}</b><b>Pc ${offensiveDist.Pc}</b>
      </div>`:""}

    <div class="chips">
      ${roles.map(r=>{
        const poolForCount=r==="Venduti"?allPlayers:modePool;
        const count=r==="Tutti"
          ? poolForCount.filter(p=>!isSold(p.id)).length
          : r==="Venduti"
            ? soldPlayers().length
            : poolForCount.filter(p=>!isSold(p.id)&&playerMatchesRoleFilter(p,r,state.poolMode)).length;
        return `<button class="chip ${state.filter===r?"active":""}" data-role="${r}">
          ${r}<small>${count}</small>
        </button>`;
      }).join("")}
    </div>

    <div class="muted" style="margin:8px 2px">
      ${list.length} giocatori
      ${state.poolMode==="strategic"&&["W","A","Pc"].includes(state.filter)?" · ruolo offensivo principale":""}
      ${state.filter==="T"?" · principali + compatibili":""}
      ${state.filter==="Venduti"?" · assegnati ad altre squadre":""}
    </div>
    ${content}`;

  $("#poolStrategic").onclick=()=>{
    state.poolMode="strategic";
    localStorage.setItem("am_pool_mode","strategic");
    if(state.filter==="Venduti") state.filter="Tutti";
    renderPlayers();bindPlayers();
  };
  $("#poolAll").onclick=()=>{
    state.poolMode="all";
    localStorage.setItem("am_pool_mode","all");
    if(state.filter==="Venduti") state.filter="Tutti";
    renderPlayers();bindPlayers();
  };

  $("#searchInput").addEventListener("input",e=>{
    state.query=e.target.value;
    renderPlayers();bindPlayers();
  });
  $$(".chip").forEach(b=>b.onclick=()=>{
    state.filter=b.dataset.role;
    renderPlayers();bindPlayers();
  });
  bindPlayers();
}
function bindPlayers(){
  $$(".player[data-id]").forEach(el=>el.onclick=()=>openPlayer(el.dataset.id));
}
function openPlayer(id){
  const p=getPlayer(id); if(!p)return;
  const b=state.purchases[p.id],sold=isSold(p.id),strategic=!!p.strategic;
  $("#playerDialogContent").innerHTML=`<div class="dialog-body">
    <div class="section-title">
      <div><div class="eyebrow">${p.club} · ${p.role} · ${strategic?"STRATEGICO":"LISTONE"}</div><h2>${p.name}</h2></div>
      <button class="ghost" onclick="playerDialog.close()">✕</button>
    </div>
    <div class="grid">
      <div class="card metric"><span>FVM</span><strong>${p.fvm||0}</strong></div>
      <div class="card metric"><span>${strategic?"Prezzo MAX":"MAX da FVM"}</span><strong>${p.maxPrice}</strong></div>
    </div>
    <div class="card" style="margin-top:10px">
      <div class="line"><span>Ruoli Mantra</span><b>${p.role}</b></div>
      <div class="line"><span>Fascia</span><b>${p.tier||"—"}</b></div>
      ${strategic?`<div class="line"><span>Titolarità</span><b>${p.starter||"—"}</b></div>`:`<div class="line"><span>Dati</span><b>Listone completo</b></div>`}
      ${strategic?`<div class="line"><span>Rigori / piazzati</span><b>${p.setPieces||"—"}</b></div>`:""}
      ${p.reparto==="ATT"&&primaryOffensiveRole(p)?`<div class="line"><span>Ruolo offensivo principale</span><b>${primaryOffensiveRole(p)}</b></div>`:""}
      ${strategic?`<div class="line"><span>Giovane</span><b>${p.u21?"U21 + U23":p.u23?"U23":"—"}</b></div>`:""}
      ${strategic?`<div class="line"><span>Modificatore</span><b>${p.modifier||"—"}</b></div>`:""}
      <div class="line"><span>Fit ${state.strategy} · ${activeStrategy().module}</span><b>${strategyPlayerFit(p).length?strategyPlayerFit(p).join(" · "):"ruolo condiviso / non chiave"}</b></div>
      <div class="line"><span>Stato mercato</span><b>${b?"MIO":sold?"VENDUTO":"DISPONIBILE"}</b></div>
      ${p.notes?`<div class="line"><span>Note</span><b>${p.notes}</b></div>`:""}
    </div>
    <div class="dialog-actions">
      ${b
        ? `<button class="ghost" onclick='editPurchase(${idArg(p.id)})'>✏️ Modifica acquisto</button><button class="dangerbtn" onclick='removePurchase(${idArg(p.id)})'>Annulla acquisto</button>`
        : sold
          ? `<button class="ghost" onclick='restoreSold(${idArg(p.id)})'>↩️ Ripristina sul mercato</button>`
          : `<button class="primary" onclick='startPurchase(${idArg(p.id)})'>Acquista</button><button class="soldbtn" onclick='markSold(${idArg(p.id)})'>🔒 Venduto</button>`
      }
    </div>
  </div>`;
  $("#playerDialog").showModal();
}
let purchaseId=null;
let purchaseMode="new";

window.markSold=id=>{
  const p=getPlayer(id); if(!p || state.purchases[p.id]) return;
  id=p.id;
  state.sold[id]={at:Date.now()};
  saveSold();
  const d=$("#playerDialog");
  if(d.open) d.close();
  refresh();
};
window.restoreSold=id=>{
  const p=getPlayer(id); id=p?p.id:id;
  delete state.sold[id];
  saveSold();
  const d=$("#playerDialog");
  if(d.open) d.close();
  refresh();
};

function startPurchase(id){
  const p=getPlayer(id);
  if(!p || isSold(p.id)) return;
  purchaseId=p.id;
  purchaseMode="new";
  $("#playerDialog").close();
  $("#purchaseTitle").textContent="Acquista "+p.name;
  $("#confirmPurchase").textContent="Conferma";
  $("#purchasePrice").value="";
  $("#purchaseSignal").textContent="";
  $("#purchaseDialog").showModal();
  $("#purchasePrice").focus();
}

window.editPurchase=id=>{
  const p=getPlayer(id); if(!p)return;
  purchaseId=p.id;
  purchaseMode="edit";
  const current=state.purchases[p.id];
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
  const p=getPlayer(purchaseId),s=signal(p,e.target.value);
  $("#purchaseSignal").className="signal "+s.c; $("#purchaseSignal").textContent=s.t;
});
$("#cancelPurchase").addEventListener("click",()=>{
  if(document.activeElement) document.activeElement.blur();
  const dialog=$("#purchaseDialog");
  if(dialog.open) dialog.close();
  $("#purchasePrice").value="";
  $("#purchaseSignal").textContent="";
  purchaseId=null;
  purchaseMode="new";
});

$("#purchaseForm").addEventListener("submit",e=>{
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
  purchaseId=null;
  purchaseMode="new";
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
  const p=getPlayer(lastId);
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
function renderPlan(){
  const bought=purchasedPlayers();
  const st=activeStrategy();
  const rec=strategyRecommendation(bought);
  const lineup=bestLineupMatch(st,bought);
  const poolByRep={POR:0,DIF:0,CEN:0,ATT:0};
  strategicPlayers.forEach(p=>poolByRep[p.reparto]=(poolByRep[p.reparto]||0)+1);
  const movement=strategicPlayers.length-poolByRep.POR;

  const roleCounts={};
  ["Por","Ds","Dc","Dd","B","E","M","C","W","T","A","Pc"].forEach(r=>{
    roleCounts[r]=allPlayers.filter(p=>roleTokens(p.role).includes(r)).length;
  });

  const budgetText=Object.values(st.budgets).map(fmt).join(" · ");

  $("#planView").innerHTML=`
    <div class="section-title"><h2>Doppia strategia Mantra</h2></div>

    <div class="strategy-plan-card">
      <div class="strategy-plan-head">
        <div><span>Strategia attiva</span><strong>${state.strategy} · ${st.module}</strong></div>
        <div class="strategy-plan-score">${state.strategy==="A"?rec.A.score:rec.B.score}/100</div>
      </div>
      <div class="strategy-buttons">
        <button class="strategy-btn ${state.strategy==="A"?"active":""}" onclick="setStrategy('A')"><b>A</b><span>4-3-1-2</span></button>
        <button class="strategy-btn ${state.strategy==="B"?"active":""}" onclick="setStrategy('B')"><b>B</b><span>4-3-3</span></button>
      </div>
      <div class="strategy-reason"><b>${rec.headline}</b><br>${rec.reason}</div>
    </div>

    <div class="section-title"><h2>Confronto copertura</h2></div>
    <div class="grid strategy-compare-grid">
      <div class="card metric ${rec.recommended==="A"?"strategy-best":""}">
        <span>A · 4-3-1-2</span><strong>${rec.A.score}</strong>
        <span>XI ${rec.A.full.filled}/11 · mercato ${Math.round(rec.A.market.value*100)}%</span>
      </div>
      <div class="card metric ${rec.recommended==="B"?"strategy-best":""}">
        <span>B · 4-3-3</span><strong>${rec.B.score}</strong>
        <span>XI ${rec.B.full.filled}/11 · mercato ${Math.round(rec.B.market.value*100)}%</span>
      </div>
    </div>

    <div class="section-title"><h2>Budget ${state.strategy}</h2></div>
    <div class="card">
      <div class="line"><span>POR</span><b>${fmt(st.budgets.POR)}</b></div>
      <div class="line"><span>DIF</span><b>${fmt(st.budgets.DIF)}</b></div>
      <div class="line"><span>CEN / trequarti</span><b>${fmt(st.budgets.CEN)}</b></div>
      <div class="line"><span>ATT</span><b>${fmt(st.budgets.ATT)}</b></div>
      <div class="line"><span>Totale</span><b>${fmt(DEFAULT_BUDGET)}</b></div>
    </div>

    <div class="section-title"><h2>Priorità ${st.module}</h2></div>
    <div class="card">
      <div class="line"><span>Difesa</span><b>Dd · Dc · Dc · Ds</b></div>
      <div class="line"><span>Centrocampo</span><b>M/C · M · C</b></div>
      <div class="line"><span>Zona offensiva</span><b>${st.priority}</b></div>
      <div class="line"><span>Profondità target</span><b>${st.depth}</b></div>
      <div class="line"><span>Struttura rosa</span><b>3 POR · 8 DIF · 7 CEN · 7 ATT</b></div>
    </div>

    <div class="section-title"><h2>XI coperto dalla tua rosa</h2><span class="muted">${lineup.filled}/11</span></div>
    <div class="card">
      ${st.slots.map((slot,i)=>`<div class="line"><span>${slot.label}</span><b>${lineup.assign[i]?lineup.assign[i].name:"— manca copertura —"}</b></div>`).join("")}
    </div>

    <div class="section-title"><h2>Bacino strategico</h2></div>
    <div class="grid">
      <div class="card metric"><span>Shortlist</span><strong>${strategicPlayers.length}/200</strong><span>strategici</span></div>
      <div class="card metric"><span>Portieri</span><strong>${poolByRep.POR}/24</strong><span>3 × 8</span></div>
      <div class="card metric"><span>Movimento</span><strong>${movement}/176</strong><span>shortlist</span></div>
      <div class="card metric"><span>Listone algoritmo</span><strong>${allPlayers.length}</strong><span>universo mercato</span></div>
    </div>

    <div class="section-title"><h2>Distribuzione offensivi principali</h2></div>
    <div class="card">
      <div class="line"><span>W principali</span><b>${strategicPlayers.filter(p=>primaryOffensiveRole(p)==="W").length}</b></div>
      <div class="line"><span>T principali</span><b>${strategicPlayers.filter(p=>primaryOffensiveRole(p)==="T").length}</b></div>
      <div class="line"><span>A principali</span><b>${strategicPlayers.filter(p=>primaryOffensiveRole(p)==="A").length}</b></div>
      <div class="line"><span>Pc principali</span><b>${strategicPlayers.filter(p=>primaryOffensiveRole(p)==="Pc").length}</b></div>
      <div class="line"><span>T compatibili totali</span><b>${roleCounts.T||0}</b></div>
    </div>

    <div class="section-title"><h2>Mercato residuo completo</h2></div>
    <div class="card">
      ${["T","W","A","Pc","Dd","Ds","Dc"].map(r=>{
        const all=marketEligiblePlayers([r]);
        const rem=all.filter(p=>!state.purchases[p.id]&&!state.sold[p.id]);
        const qualityAll=all.reduce((s,p)=>s+playerQuality(p),0);
        const qualityRem=rem.reduce((s,p)=>s+playerQuality(p),0);
        const qPct=qualityAll?Math.round(qualityRem/qualityAll*100):0;
        return `<div class="line"><span>${r}</span><b>${rem.length}/${all.length} · qualità ${qPct}%</b></div>`;
      }).join("")}
    </div>

    <p class="install-note" style="margin-top:12px">
      L'indice confronta copertura dell'XI, slot offensivi distintivi, profondità della rosa, qualità dei profili acquistati e disponibilità residua del mercato.
      I giocatori marcati Venduto riducono il valore della strategia che dipende maggiormente dai loro ruoli. Il bottone A/B resta sempre manuale.
    </p>`;
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
  $("#resetBtn").onclick=()=>{if(confirm("Vuoi davvero cancellare acquisti e giocatori venduti?")){state.purchases={};state.sold={};save();saveSold();refresh()}};
  $("#exportBtn").onclick=()=>{let blob=new Blob([JSON.stringify({version:4,purchases:state.purchases,sold:state.sold,strategy:state.strategy,poolMode:state.poolMode},null,2)],{type:"application/json"});let a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="AstaMantra-backup.json";a.click();URL.revokeObjectURL(a.href)};
  $("#importFile").onchange=e=>{let f=e.target.files[0];if(!f)return;let rd=new FileReader();rd.onload=()=>{try{let o=JSON.parse(rd.result);state.purchases=o.purchases||{};state.sold=o.sold||{};if(STRATEGIES[o.strategy]){state.strategy=o.strategy;localStorage.setItem("am_strategy",o.strategy)}if(["strategic","all"].includes(o.poolMode)){state.poolMode=o.poolMode;localStorage.setItem("am_pool_mode",o.poolMode)}save();saveSold();refresh();alert("Backup importato.")}catch{alert("File non valido.")}};rd.readAsText(f)};
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
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js?v=1.20").catch(()=>{}));
