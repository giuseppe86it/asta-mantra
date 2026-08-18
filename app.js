const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const strategicPlayers = window.PLAYERS || [];
const marketSeed = window.MARKET_PLAYERS || [];
const marketMeta = window.MARKET_META || {};
const players = strategicPlayers; // compatibilità con il codice storico
const baseFormations = window.FORMATIONS || [];
let formations = baseFormations.slice();
const FORMATIONS_LIVE_STORAGE="am_formations_live_v1";
const FORMATIONS_LIVE_SCHEMA=1;
const FORMATIONS_LIVE_CHECKED_STORAGE="am_formations_live_checked_at";
let formationsLiveCheckedAt=Number(localStorage.getItem(FORMATIONS_LIVE_CHECKED_STORAGE)||0)||0;
let formationsLiveFeed=safeJsonParse(localStorage.getItem(FORMATIONS_LIVE_STORAGE),null);
let formationsLiveLoading=false;
let formationsLiveError="";

const LISTONE_SYNC_STORAGE="am_listone_sync";
const LISTONE_SYNC_SCHEMA=1;

function safeJsonParse(raw,fallback=null){
  try{return raw?JSON.parse(raw):fallback}catch{return fallback}
}
let appliedListoneSync=safeJsonParse(localStorage.getItem(LISTONE_SYNC_STORAGE),null);
let pendingListoneSnapshot=null;

function normalizePlayerName(name){
  return String(name||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}
function validMantraRole(role){
  const allowed=new Set(["Por","Dd","Ds","Dc","B","E","M","C","W","T","A","Pc"]);
  const tokens=String(role||"").split("/").filter(Boolean);
  return tokens.length>0 && tokens.every(x=>allowed.has(x));
}
function inferRepartoFromRole(role,classic=""){
  const c=String(classic||"").toUpperCase();
  if(c==="P")return "POR";
  if(c==="D")return "DIF";
  if(c==="C")return "CEN";
  if(c==="A")return "ATT";
  const t=String(role||"").split("/");
  if(t.includes("Por"))return "POR";
  if(t.some(x=>["W","T","A","Pc"].includes(x)))return "ATT";
  if(t.some(x=>["E","M","C"].includes(x)))return "CEN";
  return "DIF";
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
    maxPrice:Number(p.maxPrice??p.marketMax??Math.max(1,Math.round(Number(p.fvm||0)*2.5))),
    tier:p.tier||marketTier(p.fvm),
    starter:p.starter||"Listone",
    setPieces:p.setPieces||"—",
    u23:!!p.u23,
    u21:!!p.u21,
    modifier:p.modifier||"—",
    notes:p.notes||"LISTONE COMPLETO · MAX neutro da FVM ×2,5",
    strategic:!!p.strategic,
    officialActive:p.officialActive!==false,
    outOfListone:!!p.outOfListone,
    syncPendingRole:!!p.syncPendingRole
  };
}
function basePlayerMap(){
  const byName=new Map();
  marketSeed.forEach(p=>byName.set(normalizePlayerName(p.name),enrichMarketPlayer({...p,strategic:false})));
  strategicPlayers.forEach(p=>byName.set(normalizePlayerName(p.name),enrichMarketPlayer({...p,strategic:true})));
  return byName;
}
function buildAllPlayers(){
  const byName=basePlayerMap();
  const sync=appliedListoneSync;
  if(sync?.schema===LISTONE_SYNC_SCHEMA && Array.isArray(sync.players)){
    const seen=new Set();
    sync.players.forEach(s=>{
      const key=s.key||normalizePlayerName(s.name);
      if(!key)return;
      seen.add(key);
      const base=byName.get(key);
      const strategic=!!base?.strategic;
      const role=validMantraRole(s.role)?s.role:(base?.role||"?");
      const fvm=Number(s.fvm??base?.fvm??0);
      let merged={
        ...(base||{}),
        id:base?.id??s.id??`fc_${key}`,
        name:s.name||base?.name||key,
        club:s.club||base?.club||"—",
        role,
        reparto:s.reparto||base?.reparto||inferRepartoFromRole(role,s.classic||base?.classic||""),
        classic:s.classic||base?.classic||"",
        quote:Number(s.quote??base?.quote??0),
        fvm,
        strategic,
        officialActive:s.active!==false,
        outOfListone:s.active===false,
        syncPendingRole:!validMantraRole(role),
        syncSource:sync.sourceName||"Fantacalcio.it",
        syncGeneratedAt:sync.generatedAt||""
      };
      if(strategic){
        merged.maxPrice=Number(base.maxPrice||Math.max(1,Math.round(fvm*2.5)));
        merged.tier=base.tier;
        merged.starter=base.starter;
        merged.setPieces=base.setPieces;
        merged.u23=base.u23;
        merged.u21=base.u21;
        merged.modifier=base.modifier;
        merged.notes=base.notes;
        merged.primaryRole=base.primaryRole;
      }else{
        merged.marketMax=Math.max(1,Math.round(fvm*2.5));
        merged.maxPrice=merged.marketMax;
        merged.tier=marketTier(fvm);
        merged.notes=merged.outOfListone?"FUORI LISTONE · storico mercato":"LISTONE SINCRONIZZATO · MAX neutro da FVM ×2,5";
      }
      byName.set(key,enrichMarketPlayer(merged));
    });
    if(sync.complete===true){
      byName.forEach((p,key)=>{
        if(!seen.has(key))byName.set(key,enrichMarketPlayer({...p,officialActive:false,outOfListone:true}));
      });
    }
  }
  return [...byName.values()];
}
let allPlayers=buildAllPlayers();

function currentStrategicPlayers(){
  return allPlayers.filter(p=>p.strategic && (!p.outOfListone || state?.purchases?.[p.id] || state?.sold?.[p.id]));
}
function isMarketEligiblePlayer(p){
  return !!p && !p.outOfListone && validMantraRole(p.role);
}
function getPlayer(id){return allPlayers.find(p=>String(p.id)===String(id))}
function idArg(id){return JSON.stringify(String(id))}
function playerIsRosterAssigned(p){
  if(!p)return false;
  if(state?.purchases?.[p.id])return true;
  const sale=state?.sold?.[p.id];
  return !!sale?.teamId;
}
function playerNameText(p){
  if(!p)return "";
  return `${p.name}${p.outOfListone&&playerIsRosterAssigned(p)?" *":""}`;
}
function playerNameHTML(p){
  if(!p)return "";
  return `${esc(p.name)}${p.outOfListone&&playerIsRosterAssigned(p)?'<span class="out-name-marker" title="Fuori listone">*</span>':""}`;
}
function esc(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
}
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

const AUCTION_PHASES = [
  {id:"POR",label:"Portieri",icon:""},
  {id:"DIF",label:"Difensori",icon:""},
  {id:"CEN",label:"Centrocampisti",icon:""},
  {id:"ATT",label:"Attaccanti",icon:""}
];
const PHASE_ROLE_INDEX = {Por:0,Dd:1,Ds:1,Dc:1,B:1,E:2,M:2,C:2,W:3,T:3,A:3,Pc:3};
const INTEL_FAMILIES = [
  {id:"Dd",label:"Dd",roles:["Dd"]},
  {id:"Ds",label:"Ds",roles:["Ds"]},
  {id:"Dc",label:"Dc",roles:["Dc","B"]},
  {id:"MC",label:"M/C",roles:["M","C"]},
  {id:"T",label:"T",roles:["T"]},
  {id:"WA",label:"W/A",roles:["W","A"]},
  {id:"APc",label:"A/Pc",roles:["A","Pc"]},
  {id:"Pc",label:"Pc",roles:["Pc"]}
];

// Gli 11 schemi Mantra ufficiali. Gli slot alternativi sono rappresentati
// come insiemi di ruoli compatibili; servono per stimare la struttura potenziale
// delle rose avversarie durante l'asta a reparti.
const MANTRA_MODULES = [
  {id:"343",name:"3-4-3",slots:[
    ["Por"],["Dc"],["Dc"],["Dc","B"],["E"],["M","C"],["C"],["E"],["W","A"],["A","Pc"],["W","A"]]},
  {id:"3412",name:"3-4-1-2",slots:[
    ["Por"],["Dc"],["Dc"],["Dc","B"],["E"],["M","C"],["C"],["E"],["T"],["A","Pc"],["A","Pc"]]},
  {id:"3421",name:"3-4-2-1",slots:[
    ["Por"],["Dc"],["Dc"],["Dc","B"],["M"],["M","C"],["E","W"],["E"],["T"],["T","A"],["A","Pc"]]},
  {id:"352",name:"3-5-2",slots:[
    ["Por"],["Dc"],["Dc"],["Dc","B"],["E","W"],["M","C"],["M"],["C"],["E"],["A","Pc"],["A","Pc"]]},
  {id:"3511",name:"3-5-1-1",slots:[
    ["Por"],["Dc"],["Dc"],["Dc","B"],["E","W"],["M"],["M"],["C"],["E","W"],["T","A"],["A","Pc"]]},
  {id:"433",name:"4-3-3",slots:[
    ["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M","C"],["M"],["C"],["W","A"],["A","Pc"],["W","A"]]},
  {id:"4312",name:"4-3-1-2",slots:[
    ["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M","C"],["M"],["C"],["T"],["T","A","Pc"],["A","Pc"]]},
  {id:"442",name:"4-4-2",slots:[
    ["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M","C"],["C"],["E","W"],["E"],["A","Pc"],["A","Pc"]]},
  {id:"4141",name:"4-1-4-1",slots:[
    ["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M"],["C","T"],["T"],["E","W"],["W"],["A","Pc"]]},
  {id:"4411",name:"4-4-1-1",slots:[
    ["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M"],["C"],["E","W"],["E","W"],["T","A"],["A","Pc"]]},
  {id:"4231",name:"4-2-3-1",slots:[
    ["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M"],["M","C"],["W","T"],["T"],["W","A"],["A","Pc"]]}
].map(m=>({...m,slots:m.slots.map((roles,i)=>({label:roles.join("/"),roles}))}));

const SERIES_A_CLUBS = [
  ["ATA","Atalanta"],["BOL","Bologna"],["CAG","Cagliari"],["COM","Como"],["FIO","Fiorentina"],
  ["FRO","Frosinone"],["GEN","Genoa"],["INT","Inter"],["JUV","Juventus"],["LAZ","Lazio"],
  ["LEC","Lecce"],["MIL","Milan"],["MON","Monza"],["NAP","Napoli"],["PAR","Parma"],
  ["ROM","Roma"],["SAS","Sassuolo"],["TOR","Torino"],["UDI","Udinese"],["VEN","Venezia"]
];
const roleOrder = ["Por","Ds","Dc","Dd","B","E","M","C","W","T","A","Pc"];
const CLUB_KITS = {
  // Palette digitali ispirate ai colori sociali dichiarati dai club ufficiali.
  // Le maglie restano volutamente fantasy: nessun logo, sponsor o replica esatta del kit gara.
  ATA:"club-ata", BOL:"club-bol", CAG:"club-cag", COM:"club-com", FIO:"club-fio",
  FRO:"club-fro", GEN:"club-gen", INT:"club-int", JUV:"club-juv", LAZ:"club-laz",
  LEC:"club-lec", MIL:"club-mil", MON:"club-mon", NAP:"club-nap", PAR:"club-par",
  ROM:"club-rom", SAS:"club-sas", TOR:"club-tor", UDI:"club-udi", VEN:"club-ven"
};
function escAttr(s){return String(s??"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");}
function clubKitClass(club){return 'kit-'+String(CLUB_KITS[club]||'solid-neutral').replace(/[^a-z0-9-]/gi,'').toLowerCase();}
function kitHTML(club,size='sm',label=''){
  const aria=label?` aria-label="${escAttr(label)}" title="${escAttr(label)}"`:'';
  return `<span class="club-kit ${clubKitClass(club)} kit-${size}"${aria}></span>`;
}
const SET_PIECES_2627 = {
  ATA:{pens:["Scamacca","De Ketelaere","Samardzic"],free:["Samardzic","Gaetano","De Ketelaere","Raspadori"],corners:["Samardzic","Gaetano","Bernasconi","Bellanova"]},
  BOL:{pens:["Orsolini","Dovbyk","Bernardeschi"],free:["Orsolini","Bernardeschi","Ferguson"],corners:["Orsolini","Bernardeschi","Miranda","Ferguson"]},
  CAG:{pens:["Fazzini","Mina","Deiola"],free:["Maldini","Fazzini","Winks","Obert"],corners:["Fazzini","Obert","Romano","Maldini","Winks"]},
  COM:{pens:["Da Cunha","Nico Paz","Douvikas"],free:["Nico Paz","Baturina","Da Cunha","Perrone"],corners:["Baturina","Nico Paz","Da Cunha","Perrone"]},
  FIO:{pens:["Gudmundsson","Mandragora","Kean"],free:["Gudmundsson","Mastantuono","Mandragora","Fagioli"],corners:["Gudmundsson","Mastantuono","Mandragora","Fagioli"]},
  FRO:{pens:["Calò","Raimondo"],free:["Calò","Ghedjemis","Kvernadze"],corners:["Calò","Ghedjemis","Kvernadze"]},
  GEN:{pens:["Colombo","Messias","Vitinha"],free:["Baldanzi","Messias","Mitaj","Frendrup"],corners:["Mitaj","Baldanzi","Messias","Frendrup"]},
  INT:{pens:["Calhanoglu","Lautaro Martinez","Zielinski"],free:["Calhanoglu","Dimarco","Zielinski","Sucic"],corners:["Calhanoglu","Dimarco","Zielinski","Barella"]},
  JUV:{pens:["Yildiz","Locatelli","Kolo Muani"],free:["Yildiz","Locatelli","Koopmeiners","Cambiaso"],corners:["Yildiz","Cambiaso","Locatelli","Koopmeiners"]},
  LAZ:{pens:["Zaccagni","Cataldi","Kenneth Taylor"],free:["Zaccagni","Cataldi","Taylor","Rovella"],corners:["Zaccagni","Taylor","Rovella","Cataldi"]},
  LEC:{pens:["Geubbels","Stulic","Pierotti"],free:["Gallo","Pierotti","Berisha"],corners:["Gallo","Pierotti","Berisha"]},
  MIL:{pens:["Gonçalo Ramos","Pulisic","Nkunku"],free:["Modric","Pulisic","Nkunku","Ricci"],corners:["Modric","Pulisic","Bartesaghi","Jashari"]},
  MON:{pens:["Pessina","Cutrone","Petagna"],free:["Colpani","Pessina","Ciurria"],corners:["Pessina","Colpani","Ciurria"]},
  NAP:{pens:["De Bruyne","Højlund","Lukaku*"],free:["De Bruyne","Politano","Neres","Lobotka"],corners:["De Bruyne","Politano","Neres","Lobotka"],note:"* Lukaku resta candidato se rimane in rosa"},
  PAR:{pens:["El Bilal Touré","Bernabé"],free:["Bernabé","Nicolussi Caviglia","Valeri","Ordonez"],corners:["Bernabé","Nicolussi Caviglia","Valeri","Ordonez"]},
  ROM:{pens:["Malen","Dybala","Soulé"],free:["Dybala","Soulé","Pellegrini"],corners:["Dybala","Soulé","Pellegrini","Wesley"]},
  SAS:{pens:["Berardi","Pinamonti"],free:["Berardi","Laurienté","Volpato"],corners:["Berardi","Laurienté","Volpato","Doig"]},
  TOR:{pens:["Vlasic","Zapata","Simeone"],free:["Vlasic","Oristanio","Ilic","Coco"],corners:["Vlasic","Oristanio","Ilic"]},
  UDI:{pens:["Davis","Solet","Zaniolo"],free:["Zaniolo","Ekkelenkamp","Vojvoda","Miller"],corners:["Zaniolo","Vojvoda","Ekkelenkamp","Miller"]},
  VEN:{pens:["Akor Adams","Rrahmani"],free:["Busio","Basic","Kike Pérez","Helgason"],corners:["Busio","Kike Pérez","Basic","Helgason"]}
};
function setPieceHTML(club){
  const s=SET_PIECES_2627[club];
  if(!s)return "";
  const names=list=>list.map((name,i)=>`<span class="set-piece-name ${i===0?"first":""}">${i===0?"1. ":""}${esc(name)}</span>`).join("");
  return `<div class="set-piece-box">
    <div class="set-piece-title"><span>SP</span><b>BONUS DA FERMO</b><small>gerarchie indicative</small></div>
    <div class="set-piece-row penalties"><b>Rigori</b><div>${names(s.pens)}</div></div>
    <div class="set-piece-row"><b>Punizioni</b><div>${names(s.free)}</div></div>
    <div class="set-piece-row"><b>Corner</b><div>${names(s.corners)}</div></div>
    ${s.note?`<div class="set-piece-note">${esc(s.note)}</div>`:""}
  </div>`;
}
function sortedFormations(){
  return formations.slice().sort((a,b)=>String(a.team||"").localeCompare(String(b.team||""),"it",{sensitivity:"base"}));
}

const SET_PIECES_UPDATED_AT="2026-08-16T16:00:00+02:00";
const SAFETY_KEYS={
  protected:"am_protected_mode",
  watchlist:"am_watchlist",
  operationLog:"am_operation_log",
  undoStack:"am_undo_stack",
  snapshots:"am_snapshots",
  operationCount:"am_operation_count",
  backupActionCount:"am_backup_action_count",
  lastBackupActionCount:"am_last_backup_action_count"
};

const state = {
  purchases: JSON.parse(localStorage.getItem("am_purchases")||"{}"),
  sold: JSON.parse(localStorage.getItem("am_sold")||"{}"),
  pin: localStorage.getItem("am_pin")||"",
  view:"dashboardView",
  filter:"Tutti",
  query:"",
  clubFilter: safeJsonParse(localStorage.getItem("am_club_filter"),[])||[],
  strategy: localStorage.getItem("am_strategy") || "A",
  poolMode: localStorage.getItem("am_pool_mode") || "strategic",
  league: JSON.parse(localStorage.getItem("am_league")||"null"),
  auctionPhase: localStorage.getItem("am_auction_phase") || "POR",
  protectedMode: localStorage.getItem(SAFETY_KEYS.protected)==="1",
  watchlist: safeJsonParse(localStorage.getItem(SAFETY_KEYS.watchlist),{})||{},
  operationLog: safeJsonParse(localStorage.getItem(SAFETY_KEYS.operationLog),[])||[],
  undoStack: safeJsonParse(localStorage.getItem(SAFETY_KEYS.undoStack),[])||[],
  snapshots: safeJsonParse(localStorage.getItem(SAFETY_KEYS.snapshots),[])||[]
};
function save(){localStorage.setItem("am_purchases",JSON.stringify(state.purchases))}
function saveSold(){localStorage.setItem("am_sold",JSON.stringify(state.sold))}
function saveLeague(){
  if(state.league) localStorage.setItem("am_league",JSON.stringify(state.league));
  else localStorage.removeItem("am_league");
}
function saveAuctionPhase(){localStorage.setItem("am_auction_phase",state.auctionPhase)}
function cloneAuctionData(v){return JSON.parse(JSON.stringify(v??null))}
function saveSafetyState(){
  localStorage.setItem(SAFETY_KEYS.protected,state.protectedMode?"1":"0");
  localStorage.setItem(SAFETY_KEYS.watchlist,JSON.stringify(state.watchlist||{}));
  localStorage.setItem(SAFETY_KEYS.operationLog,JSON.stringify((state.operationLog||[]).slice(-100)));
  localStorage.setItem(SAFETY_KEYS.undoStack,JSON.stringify((state.undoStack||[]).slice(-10)));
  localStorage.setItem(SAFETY_KEYS.snapshots,JSON.stringify((state.snapshots||[]).slice(-8)));
}
function captureAuctionCore(){
  return {
    purchases:cloneAuctionData(state.purchases)||{},
    sold:cloneAuctionData(state.sold)||{},
    strategy:state.strategy,
    league:cloneAuctionData(state.league),
    auctionPhase:state.auctionPhase,
    watchlist:cloneAuctionData(state.watchlist)||{}
  };
}
function applyAuctionCore(core){
  if(!core)return;
  state.purchases=cloneAuctionData(core.purchases)||{};
  state.sold=cloneAuctionData(core.sold)||{};
  if(STRATEGIES[core.strategy])state.strategy=core.strategy;
  state.league=cloneAuctionData(core.league);
  if(AUCTION_PHASES.some(x=>x.id===core.auctionPhase))state.auctionPhase=core.auctionPhase;
  state.watchlist=cloneAuctionData(core.watchlist)||{};
  save();saveSold();saveLeague();saveAuctionPhase();
  localStorage.setItem("am_strategy",state.strategy);
  saveSafetyState();
  invalidateAuctionIntel();
}
function auditOnly(type,label){
  state.operationLog=[...(state.operationLog||[]),{id:`op_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,at:Date.now(),type,label}].slice(-100);
  saveSafetyState();
}
function createSafetySnapshot(reason="Snapshot manuale",silent=false){
  const snap={id:`snap_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,at:Date.now(),reason,state:captureAuctionCore()};
  state.snapshots=[...(state.snapshots||[]),snap].slice(-8);
  saveSafetyState();
  if(!silent)alert("Snapshot salvato.");
  return snap;
}
function ensureInitialSnapshot(){
  if(!(state.snapshots||[]).length)createSafetySnapshot("Ingresso v1.30 · punto iniziale",true);
}
function recordOperation(type,label,before,{undoable=true,count=true}={}){
  const id=`op_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const at=Date.now();
  state.operationLog=[...(state.operationLog||[]),{id,at,type,label}].slice(-100);
  if(undoable&&before){
    state.undoStack=[...(state.undoStack||[]),{id,at,type,label,before}].slice(-10);
  }
  if(count){
    const n=Number(localStorage.getItem(SAFETY_KEYS.operationCount)||0)+1;
    localStorage.setItem(SAFETY_KEYS.operationCount,String(n));
    if(n%10===0)createSafetySnapshot(`Automatico · ${n} operazioni`,true);
  }
  saveSafetyState();
}
function currentAssignmentCount(){
  return Object.keys(state.purchases||{}).length+Object.keys(state.sold||{}).length;
}
function getBackupActionCount(){
  const raw=localStorage.getItem(SAFETY_KEYS.backupActionCount);
  if(raw===null){
    const initial=currentAssignmentCount();
    localStorage.setItem(SAFETY_KEYS.backupActionCount,String(initial));
    return initial;
  }
  return Math.max(0,Number(raw)||0);
}
function getLastBackupActionCount(){
  return Math.max(0,Number(localStorage.getItem(SAFETY_KEYS.lastBackupActionCount)||0)||0);
}
function registerBackupRelevantAssignment(){
  const next=getBackupActionCount()+1;
  localStorage.setItem(SAFETY_KEYS.backupActionCount,String(next));
  updateBackupAlert();
}
function markExternalBackupDone(){
  const n=getBackupActionCount();
  localStorage.setItem(SAFETY_KEYS.lastBackupActionCount,String(n));
  updateBackupAlert();
}
function resetBackupReminderCounters(){
  localStorage.setItem(SAFETY_KEYS.backupActionCount,"0");
  localStorage.setItem(SAFETY_KEYS.lastBackupActionCount,"0");
  updateBackupAlert();
}
function updateBackupAlert(){
  const btn=$("#backupAlertBtn");
  if(!btn)return;
  const delta=getBackupActionCount()-getLastBackupActionCount();
  const due=delta>=10;
  btn.hidden=!due;
  btn.textContent="BACKUP";
  btn.setAttribute("aria-label",due?`Backup consigliato: ${delta} nuove assegnazioni dall'ultimo backup`:"Backup aggiornato");
  btn.title=due?`${delta} nuove assegnazioni dall'ultimo backup`:"";
}
function openBackupReminder(){
  switchView("settingsView");
  requestAnimationFrame(()=>{
    const card=$("#backupCard");
    if(card)card.scrollIntoView({behavior:"smooth",block:"center"});
  });
}
function protectedPermission(action){
  if(!state.protectedMode)return true;
  if(state.pin){
    const p=prompt(`Modalità ASTA PROTETTA attiva.\nInserisci il PIN per ${action}:`);
    if(p!==state.pin){if(p!==null)alert("PIN errato. Operazione annullata.");return false;}
    return true;
  }
  return confirm(`Modalità ASTA PROTETTA attiva.\n\nVuoi davvero ${action}?`);
}
function blockedByProtection(action){
  if(!state.protectedMode)return false;
  alert(`ASTA PROTETTA\n\n${action} è bloccato per evitare tocchi accidentali. Disattiva prima la protezione dalle Impostazioni.`);
  return true;
}
function toggleProtectedMode(){
  if(!state.protectedMode){
    createSafetySnapshot("Attivazione Asta protetta",true);
    state.protectedMode=true;saveSafetyState();auditOnly("PROTEZIONE","Modalità Asta protetta attivata");refresh();return;
  }
  if(!protectedPermission("disattivare la protezione"))return;
  state.protectedMode=false;saveSafetyState();auditOnly("PROTEZIONE","Modalità Asta protetta disattivata");refresh();
}
window.toggleProtectedMode=toggleProtectedMode;
function isWatchlisted(id){return !!state.watchlist?.[String(id)]}
function toggleWatchlist(id){
  const p=getPlayer(id);if(!p)return;
  const before=captureAuctionCore();
  const key=String(p.id);
  if(state.watchlist[key])delete state.watchlist[key];else state.watchlist[key]=true;
  saveSafetyState();
  recordOperation("WATCHLIST",`${state.watchlist[key]?"Aggiunto":"Rimosso"} ${p.name} ${state.watchlist[key]?"alla":"dalla"} watchlist`,before,{undoable:true,count:false});
  refresh();
  if($("#playerDialog")?.open)openPlayer(p.id);
}
window.toggleWatchlist=toggleWatchlist;
function formatLogTime(ts){
  return new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(ts));
}
function undoOperation(id){
  const stack=state.undoStack||[];
  const idx=stack.findIndex(x=>x.id===id);if(idx<0)return;
  const item=stack[idx];
  if(!confirm(`Ripristinare lo stato precedente a:\n\n${item.label}?`))return;
  applyAuctionCore(item.before);
  state.undoStack=stack.slice(0,idx);
  auditOnly("UNDO",`Ripristino: ${item.label}`);
  closeSafetyDialog();refresh();
}
window.undoOperation=undoOperation;
function restoreSafetySnapshot(id){
  const snap=(state.snapshots||[]).find(x=>x.id===id);if(!snap)return;
  if(!protectedPermission(`ripristinare lo snapshot “${snap.reason}”`))return;
  const before=captureAuctionCore();
  applyAuctionCore(snap.state);
  recordOperation("SNAPSHOT",`Ripristinato snapshot: ${snap.reason}`,before,{undoable:true,count:false});
  closeSafetyDialog();refresh();
}
window.restoreSafetySnapshot=restoreSafetySnapshot;
function closeSafetyDialog(){const d=$("#safetyDialog");if(d?.open)d.close()}
window.closeSafetyDialog=closeSafetyDialog;
function openSafetyCenter(){
  const logs=(state.operationLog||[]).slice().reverse().slice(0,30);
  const undo=(state.undoStack||[]).slice().reverse();
  const snaps=(state.snapshots||[]).slice().reverse();
  $("#safetyDialogContent").innerHTML=`<div class="dialog-body safety-dialog-body">
    <div class="safety-modal-head"><div><div class="eyebrow">Safety & Control</div><h2>Registro e ripristino</h2></div><button class="ghost" onclick="closeSafetyDialog()">✕</button></div>
    <div class="safety-tabs-summary"><span>Registro <b>${state.operationLog.length}</b></span><span>Undo <b>${state.undoStack.length}/10</b></span><span>Snapshot <b>${state.snapshots.length}/8</b></span></div>
    <div class="safety-action-row"><button class="primary" onclick="createSafetySnapshot('Snapshot manuale');closeSafetyDialog();refresh()">Salva snapshot</button><button class="ghost" onclick="openFinalReport()">Report asta</button></div>
    <section class="safety-section"><h3>Undo multiplo</h3>${undo.length?undo.map(x=>`<button class="undo-entry" onclick="undoOperation('${x.id}')"><span><b>${esc(x.label)}</b><small>${formatLogTime(x.at)}</small></span><strong>Ripristina</strong></button>`).join(""):`<div class="safety-empty">Nessuna operazione da annullare.</div>`}</section>
    <section class="safety-section"><h3>Snapshot</h3>${snaps.length?snaps.map(x=>`<button class="snapshot-entry" onclick="restoreSafetySnapshot('${x.id}')"><span><b>${esc(x.reason)}</b><small>${formatLogTime(x.at)}</small></span><strong>Apri</strong></button>`).join(""):`<div class="safety-empty">Nessuno snapshot.</div>`}</section>
    <section class="safety-section"><h3>Registro operazioni</h3>${logs.length?logs.map(x=>`<div class="log-entry"><span class="log-type">${esc(x.type)}</span><div><b>${esc(x.label)}</b><small>${formatLogTime(x.at)}</small></div></div>`).join(""):`<div class="safety-empty">Registro vuoto.</div>`}</section>
  </div>`;
  $("#safetyDialog").showModal();
}
window.openSafetyCenter=openSafetyCenter;
function parseFormationUpdated(raw){
  const m=String(raw||"").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m)return null;
  return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]),Number(m[4]||12),Number(m[5]||0));
}
function freshnessStatus(date,missingText="non disponibile"){
  if(!date||Number.isNaN(date.getTime()))return {cls:"stale",icon:"ATT",text:missingText};
  const h=Math.max(0,(Date.now()-date.getTime())/36e5);
  if(h<=24)return {cls:"fresh",icon:"OK",text:h<1?"adesso":`${Math.round(h)} h fa`};
  if(h<=72)return {cls:"aging",icon:"MID",text:`${Math.round(h)} h fa`};
  return {cls:"stale",icon:"OLD",text:`${Math.round(h/24)} gg fa`};
}
function dataFreshnessHTML(){
  const listDate=appliedListoneSync?.sourceKind==="official-fantacalcio"?new Date(appliedListoneSync.generatedAt):null;
  const formationDates=formations.map(f=>parseFormationUpdated(f.updated)).filter(Boolean);
  const formationDate=formationDates.sort((a,b)=>b-a)[0]||null;
  const piecesDate=new Date(SET_PIECES_UPDATED_AT);
  const l=freshnessStatus(listDate,"base locale"),f=freshnessStatus(formationDate),s=freshnessStatus(piecesDate);
  return `<section class="freshness-card"><div class="freshness-title"><b>FRESCHEZZA DATI</b><span>controllo rapido</span></div><div class="freshness-grid">
    <div class="${l.cls}"><span>${l.icon} Listone</span><b>${l.text}</b></div>
    <div class="${f.cls}"><span>${f.icon} Formazioni</span><b>${f.text}</b></div>
    <div class="${s.cls}"><span>${s.icon} Rigori/Piazzati</span><b>${s.text}</b></div>
  </div></section>`;
}
function watchlistDashboardHTML(){
  const list=allPlayers.filter(p=>isWatchlisted(p.id)&&isMarketEligiblePlayer(p)&&!state.purchases[p.id]&&!state.sold[p.id]);
  const top=list.slice().sort((a,b)=>liveMaxForPlayer(b).live-liveMaxForPlayer(a).live).slice(0,5);
  return `<section class="watch-dashboard-card"><div class="watch-dashboard-head"><div><span>WATCHLIST</span><b>${list.length} target ancora disponibili</b></div><button class="ghost" onclick="switchView('playersView');state.filter='Preferiti';renderPlayers()">Apri</button></div>
    ${top.length?`<div class="watch-dashboard-list">${top.map(p=>`<button onclick='openPlayer(${idArg(p.id)})'>${kitHTML(p.club,'xs',p.club)}<span><b>${esc(p.name)}</b><small>${p.club} · ${p.role}</small></span><strong>${fmt(liveMaxForPlayer(p).live)}<small>MAX live</small></strong></button>`).join("")}</div>`:`<div class="safety-empty">Usa SEGUI accanto a un giocatore per aggiungerlo.</div>`}
  </section>`;
}
function safetyDashboardHTML(){
  const last=state.operationLog?.[state.operationLog.length-1];
  return `<section class="safety-dashboard-card ${state.protectedMode?"protected":""}"><div class="safety-dashboard-status"><span>${state.protectedMode?"LOCK":"OPEN"}</span><div><b>${state.protectedMode?"ASTA PROTETTA":"Protezione disattivata"}</b><small>${last?`Ultima: ${esc(last.label)}`:"Registro pronto"}</small></div></div><div class="safety-dashboard-actions"><button class="${state.protectedMode?"protected-btn":"primary"}" onclick="toggleProtectedMode()">${state.protectedMode?"Sblocca":"Proteggi asta"}</button><button class="ghost" onclick="openSafetyCenter()">Registro</button></div></section>`;
}
function finalReportData(){
  const owned=purchasedPlayers();
  const total=spent(),remaining=DEFAULT_BUDGET-total;
  const byRep={POR:0,DIF:0,CEN:0,ATT:0};owned.forEach(p=>byRep[p.reparto]+=Number(state.purchases[p.id]?.price||0));
  const deals=owned.map(p=>({p,price:Number(state.purchases[p.id]?.price||0),ratio:Number(state.purchases[p.id]?.price||0)/Math.max(1,Number(p.maxPrice||1))})).sort((a,b)=>a.ratio-b.ratio);
  const overs=deals.filter(x=>x.ratio>1).sort((a,b)=>b.ratio-a.ratio);
  const u23=owned.filter(p=>p.u23).length,u21=owned.filter(p=>p.u21).length;
  const valid=owned.length===25&&owned.filter(p=>p.reparto==="POR").length===3&&u23>=2&&u21>=1&&SERIES_A_CLUBS.every(([c])=>owned.filter(p=>p.club===c).length<=5);
  return {owned,total,remaining,byRep,deals,overs,u23,u21,valid,avg:owned.length?Math.round(total/owned.length):0};
}
function openFinalReport(){
  const r=finalReportData();
  const topSpend=r.owned.slice().sort((a,b)=>Number(state.purchases[b.id]?.price||0)-Number(state.purchases[a.id]?.price||0)).slice(0,3);
  $("#safetyDialogContent").innerHTML=`<div class="dialog-body final-report-body"><div class="safety-modal-head"><div><div class="eyebrow">Report asta</div><h2>${r.owned.length===25?"Rosa completata":"Report parziale"}</h2></div><button class="ghost" onclick="closeSafetyDialog()">✕</button></div>
    <div class="report-status ${r.valid?"ok":"warn"}">${r.valid?"Rosa formalmente completa":"Rosa ancora in costruzione"} · ${r.owned.length}/25</div>
    <div class="report-kpis"><div><span>Speso</span><b>${fmt(r.total)}</b></div><div><span>Residuo</span><b>${fmt(r.remaining)}</b></div><div><span>Media</span><b>${fmt(r.avg)}</b></div><div><span>Modulo</span><b>${activeStrategy().module}</b></div></div>
    <div class="report-reps">${["POR","DIF","CEN","ATT"].map(rep=>`<div><span>${rep}</span><b>${fmt(r.byRep[rep])}</b></div>`).join("")}</div>
    <section class="report-section"><h3>Migliori affari vs MAX</h3>${r.deals.slice(0,3).map(x=>`<div><span>${playerNameHTML(x.p)}<small>${x.p.club} · MAX ${fmt(x.p.maxPrice)}</small></span><b>${fmt(x.price)} cr</b></div>`).join("")||'<div class="safety-empty">Nessun acquisto.</div>'}</section>
    <section class="report-section"><h3>Investimenti principali</h3>${topSpend.map(p=>`<div><span>${playerNameHTML(p)}<small>${p.club} · ${p.role}</small></span><b>${fmt(state.purchases[p.id]?.price)} cr</b></div>`).join("")||'<div class="safety-empty">Nessun acquisto.</div>'}</section>
    <section class="report-section"><h3>Sopra MAX</h3>${r.overs.slice(0,3).map(x=>`<div><span>${playerNameHTML(x.p)}<small>MAX ${fmt(x.p.maxPrice)}</small></span><b>+${Math.round((x.ratio-1)*100)}%</b></div>`).join("")||'<div class="safety-empty">Nessun acquisto sopra MAX.</div>'}</section>
    ${state.league?(()=>{const rows=state.league.teams.map(t=>({t,e:teamEconomy(t)})).sort((a,b)=>b.e.spent-a.e.spent);const myRank=rows.findIndex(x=>x.t.isMine)+1;return `<section class="report-section"><h3>Confronto lega</h3><div><span>Posizione per spesa<small>${state.league.size} squadre</small></span><b>${myRank}°</b></div><div><span>Leader spesa<small>${esc(rows[0]?.t.name||"—")}</small></span><b>${fmt(rows[0]?.e.spent||0)} cr</b></div><div><span>Leader crediti residui<small>${esc(rows.slice().sort((a,b)=>b.e.remaining-a.e.remaining)[0]?.t.name||"—")}</small></span><b>${fmt(rows.slice().sort((a,b)=>b.e.remaining-a.e.remaining)[0]?.e.remaining||0)} cr</b></div></section>`})():""}
    <button class="primary full-btn" onclick="closeSafetyDialog()">Chiudi report</button>
  </div>`;
  if(!$("#safetyDialog").open)$("#safetyDialog").showModal();
}
window.openFinalReport=openFinalReport;
function soldPlayers(){return allPlayers.filter(p=>state.sold[p.id])}
function isSold(id){return !!state.sold[id]}
function leagueTeamById(id){return state.league?.teams?.find(t=>t.id===id)||null}
function opponentTeams(){return state.league?.teams?.filter(t=>!t.isMine)||[]}
function soldTeamName(sale){
  if(!sale?.teamId) return "Non assegnato";
  const t=leagueTeamById(sale.teamId);
  return t?.name||"Squadra non disponibile";
}
function soldMeta(id){
  const sale=state.sold[id]; if(!sale)return "";
  const parts=[soldTeamName(sale)];
  if(Number(sale.price)>0) parts.push(`${fmt(sale.price)} cr`);
  return parts.join(" · ");
}
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
        const nvalue=data.value+10000+playerQuality(p)+Math.round(starterProbability(p).prob*1.5);
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
  return allPlayers.filter(p=>isMarketEligiblePlayer(p)&&roles.some(r=>roleTokens(p.role).includes(r)));
}
function marketRemainingPlayers(roles){
  return marketEligiblePlayers(roles).filter(p=>!state.purchases[p.id]&&!state.sold[p.id]);
}
function marketRoleHealth(roles,needed){
  if(needed<=0) return {value:1,remaining:marketRemainingPlayers(roles).length,total:marketEligiblePlayers(roles).length};
  const all=marketEligiblePlayers(roles);
  const remaining=all.filter(p=>!state.purchases[p.id]&&!state.sold[p.id]);
  if(!all.length) return {value:0,remaining:0,total:0};

  const weight=p=>1+Math.min(5,playerQuality(p)/120)+2.2*(starterProbability(p).prob/100);
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
function strategyScore(strategyId,bought=purchasedPlayers(),intel=null){
  const st=STRATEGIES[strategyId];
  const full=bestLineupMatch(st,bought);
  const key=bestLineupMatch(st,bought,st.keySlots);
  const depth=strategyDepth(strategyId,bought);
  const market=strategyMarket(strategyId,bought);
  const starterMarket=strategyStarterMarket(strategyId,bought);
  const ownedStarterFull=lineupStarterValue(full.assign);
  const ownedStarterKey=lineupStarterValue(key.assign);
  const starterValue=ownedStarterFull===null?starterMarket.value:(.45*ownedStarterFull+.35*(ownedStarterKey??ownedStarterFull)+.20*starterMarket.value);
  const starterAdjustment=Math.round((starterValue-.5)*12);
  const keyPlayers=key.assign.filter(Boolean);
  const qsum=keyPlayers.reduce((a,p)=>a+playerQuality(p),0);
  const quality=Math.min(1,qsum/900);
  const prior=strategyId==="A"?3:0;
  const riskFor=id=>Number(intel?.scarcity?.[id]?.risk||0);
  const strategicRisk=strategyId==="A"
    ? .58*riskFor("T")+.42*riskFor("APc")
    : .62*riskFor("WA")+.38*riskFor("APc");
  const auctionAdjustment=intel?Math.round(3-8*(strategicRisk/100)):0;

  const score=Math.round(
    35
    +20*(full.filled/full.total)
    +18*(key.filled/3)
    +9*depth.value
    +6*quality
    +12*market.value
    +prior
    +auctionAdjustment
    +starterAdjustment
  );

  return {score:Math.min(100,Math.max(0,score)),full,key,depth,quality,market,starterMarket,starterValue,starterAdjustment,auctionAdjustment,strategicRisk};
}
function strategyRecommendation(bought=purchasedPlayers(),intel=null){
  const A=strategyScore("A",bought,intel),B=strategyScore("B",bought,intel);
  const delta=A.score-B.score;
  let recommended="A",status="BASE";
  if(bought.length<3){
    if(delta>=3){recommended="A";status="A"}
    else if(delta<=-3){recommended="B";status="B"}
    else {recommended="A";status="BASE"}
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
    reason=`Confronto iniziale anche sulla titolarità: A ${Math.round(A.starterValue*100)}% · B ${Math.round(B.starterValue*100)}% · ${recommended==="A"?A.starterMarket.text:B.starterMarket.text}.`;
  }else if(recommended==="A"){
    reason=`A è più coperta: ${A.depth.text} · titolarità ${Math.round(A.starterValue*100)}% · ${A.market.text}.`;
  }else{
    reason=`B è più coperta: ${B.depth.text} · titolarità ${Math.round(B.starterValue*100)}% · ${B.market.text}.`;
  }
  return {A,B,recommended,status,headline,reason};
}
function setStrategy(id){
  if(!STRATEGIES[id]||state.strategy===id) return;
  const before=captureAuctionCore(),oldId=state.strategy;
  state.strategy=id;
  localStorage.setItem("am_strategy",id);
  recordOperation("STRATEGIA",`Strategia ${oldId} → ${id} · ${STRATEGIES[id].module}`,before,{undoable:true,count:false});
  refresh();
}
window.setStrategy=setStrategy;
function primaryOffensiveRole(p){
  if(!p) return null;
  if(["W","T","A","Pc"].includes(p.primaryRole)) return p.primaryRole;
  if(p.reparto!=="ATT") return null;
  return roleTokens(p.role).find(r=>["W","T","A","Pc"].includes(r)) || null;
}
const ROLE_DETAIL_FILTERS=new Set(["Por","Ds","Dc","Dd","B","E","M","C","W","T","A","Pc"]);
function roleFilterCount(role){
  if(!ROLE_DETAIL_FILTERS.has(role)) return 0;
  return currentStrategicPlayers().filter(p=>roleTokens(p.role).includes(role)).length;
}
function playerMatchesRoleFilter(p,role,mode=state.poolMode){
  if(role==="Tutti") return true;
  if(role==="Preferiti") return isWatchlisted(p.id);
  if(ROLE_DETAIL_FILTERS.has(role)) return roleTokens(p.role).includes(role);
  return false;
}
function isPrimaryForRole(p,role){
  const tokens=roleTokens(p?.role);
  if(!tokens.includes(role)) return false;
  if(["W","T","A","Pc"].includes(role)){
    const offensivePrimary=primaryOffensiveRole(p);
    if(offensivePrimary) return offensivePrimary===role;
  }
  return tokens[0]===role;
}
function roleCompatibilityLabel(role){
  if(["W","T","A","Pc"].includes(role)) return `${role} presente tra i ruoli offensivi compatibili`;
  return `${role} presente tra i ruoli secondari`;
}
function fmt(n){return Number(n||0).toLocaleString("it-IT")}
function purchasedPlayers(){return allPlayers.filter(p=>state.purchases[p.id])}
function spent(){return Object.values(state.purchases).reduce((a,x)=>a+Number(x.price||0),0)}
function countClub(club){return purchasedPlayers().filter(p=>p.club===club).length}

function formationFeedValid(feed){
  return !!feed && feed.schema===FORMATIONS_LIVE_SCHEMA && Array.isArray(feed.teams) && feed.teams.length>0;
}
function formationDisplayDate(value){
  const d=new Date(value||0);if(Number.isNaN(d.getTime()))return "—";
  return new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(d).replace(",","");
}
function formationFeedAgeMinutes(){
  if(!formationFeedValid(formationsLiveFeed))return Infinity;
  const ts=formationsLiveCheckedAt||new Date(formationsLiveFeed.generatedAt||0).getTime();
  if(!Number.isFinite(ts)||!ts)return Infinity;
  return Math.max(0,(Date.now()-ts)/6e4);
}
function formationPlayerCandidate(name,club){
  const key=normalizePlayerName(name),candidates=allPlayers.filter(p=>p.club===club);
  let hit=candidates.find(p=>normalizePlayerName(p.name)===key);if(hit)return hit;
  const close=candidates.filter(p=>{
    const k=normalizePlayerName(p.name);
    return key.length>=5&&k.length>=5&&(key.startsWith(k)||k.startsWith(key)||key.includes(k)||k.includes(key));
  });
  return close.length===1?close[0]:null;
}
function formationRoleFor(name,club){return formationPlayerCandidate(name,club)?.role||"?"}
function moduleLineCounts(module){
  const nums=String(module||"").split("-").map(Number).filter(Number.isFinite);
  return nums.length&&nums.reduce((a,b)=>a+b,0)===10?[1,...nums]:null;
}
function buildLiveFormationLines(team,base){
  const starters=(team.starters||[]).slice(0,11).map(x=>({name:x.name,role:formationRoleFor(x.name,team.club),probability:Number(x.probability||0)}));
  const counts=moduleLineCounts(team.module);
  if(starters.length===11&&counts){
    const lines=[];let pos=0;
    counts.forEach(n=>{lines.push(starters.slice(pos,pos+n));pos+=n});
    return lines;
  }
  return (base?.lines||[]).map(line=>line.map(p=>{
    const live=[...(team.starters||[]),...(team.bench||[])].find(x=>normalizePlayerName(x.name)===normalizePlayerName(p.name));
    return {...p,probability:Number(live?.probability||0)};
  }));
}
function mergedLiveFormations(feed){
  if(!formationFeedValid(feed))return baseFormations.slice();
  const byClub=new Map((feed.teams||[]).map(t=>[t.club,t]));
  return baseFormations.map(base=>{
    const team=byClub.get(base.club);if(!team)return base;
    return {...base,team:team.team||base.team,module:team.module||base.module,updated:formationDisplayDate(feed.generatedAt),lines:buildLiveFormationLines(team,base),bench:(team.bench||[]).map(x=>({...x,role:formationRoleFor(x.name,team.club)})),liveSource:true,sourceUrl:feed.sourceUrl||"https://www.fantacalcio.it/probabili-formazioni-serie-a"};
  });
}
function applyFormationLiveFeed(feed,{persist=true}={}){
  if(!formationFeedValid(feed))return false;
  formationsLiveFeed=feed;formations=mergedLiveFormations(feed);formationsLiveError="";
  if(persist)localStorage.setItem(FORMATIONS_LIVE_STORAGE,JSON.stringify(feed));
  return true;
}
function starterProbability(p){
  if(!p)return {prob:45,source:"unknown"};
  if(formationFeedValid(formationsLiveFeed)){
    const team=formationsLiveFeed.teams.find(t=>t.club===p.club);
    if(team){
      const pools=[...(team.starters||[]).map(x=>({...x,kind:"starter"})),...(team.bench||[]).map(x=>({...x,kind:"bench"}))];
      const key=normalizePlayerName(p.name);
      let hit=pools.find(x=>normalizePlayerName(x.name)===key);
      if(!hit){
        const close=pools.filter(x=>{const k=normalizePlayerName(x.name);return key.length>=5&&k.length>=5&&(key.startsWith(k)||k.startsWith(key)||key.includes(k)||k.includes(key))});
        if(close.length===1)hit=close[0];
      }
      if(hit)return {prob:clamp(Number(hit.probability||0),0,100),source:"live",kind:hit.kind};
      return {prob:12,source:"live",kind:"absent"};
    }
  }
  const base=baseFormations.find(f=>f.club===p.club);
  if(base){
    const inXI=(base.lines||[]).flat().some(x=>normalizePlayerName(x.name)===normalizePlayerName(p.name));
    return {prob:inXI?72:32,source:"base",kind:inXI?"starter":"bench"};
  }
  const txt=String(p.starter||"").toLowerCase();
  if(txt.includes("titol"))return {prob:74,source:"profile"};
  if(txt.includes("ballott"))return {prob:55,source:"profile"};
  if(txt.includes("rotaz"))return {prob:42,source:"profile"};
  return {prob:45,source:"unknown"};
}
function starterPriorityBonus(p){
  const pr=starterProbability(p).prob;
  if(pr>=85)return 16;if(pr>=70)return 12;if(pr>=55)return 7;if(pr>=40)return 2;if(pr>=25)return -4;return -9;
}
function starterStatus(pr){
  if(pr>=85)return {label:"TITOLARE",cls:"sure"};
  if(pr>=70)return {label:"PROBABILE",cls:"probable"};
  if(pr>=50)return {label:"BALLOTTAGGIO",cls:"battle"};
  if(pr>=30)return {label:"RISERVA ATTIVA",cls:"rotation"};
  return {label:"RISERVA",cls:"reserve"};
}
function marketStarterHealth(roles,needed){
  if(needed<=0)return {value:1,avg:100,count:0};
  const candidates=marketRemainingPlayers(roles).map(p=>({p,prob:starterProbability(p).prob})).sort((a,b)=>b.prob-a.prob||playerQuality(b.p)-playerQuality(a.p));
  if(!candidates.length)return {value:0,avg:0,count:0};
  const take=candidates.slice(0,Math.max(needed*2,3));
  const avg=take.reduce((a,x)=>a+x.prob,0)/take.length;
  const usable=candidates.filter(x=>x.prob>=55).length;
  const quantity=Math.min(1,usable/Math.max(1,needed*2));
  return {value:clamp(.72*(avg/100)+.28*quantity),avg, count:usable};
}
function strategyStarterMarket(strategyId,bought=purchasedPlayers()){
  const countOwned=roles=>bought.filter(p=>roles.some(r=>roleTokens(p.role).includes(r))).length;
  if(strategyId==="A"){
    const t=marketStarterHealth(["T"],Math.max(0,2-countOwned(["T"]))),apc=marketStarterHealth(["A","Pc"],Math.max(0,4-countOwned(["A","Pc"])));
    const value=.58*t.value+.42*apc.value;
    return {value,text:`titolarità T ${Math.round(t.avg)}% · A/Pc ${Math.round(apc.avg)}%`};
  }
  const wa=marketStarterHealth(["W","A"],Math.max(0,4-countOwned(["W","A"]))),apc=marketStarterHealth(["A","Pc"],Math.max(0,3-countOwned(["A","Pc"])));
  const value=.62*wa.value+.38*apc.value;
  return {value,text:`titolarità W/A ${Math.round(wa.avg)}% · A/Pc ${Math.round(apc.avg)}%`};
}
function lineupStarterValue(assign){
  const rows=assign.filter(Boolean);if(!rows.length)return null;
  return rows.reduce((a,p)=>a+starterProbability(p).prob,0)/(rows.length*100);
}
async function refreshFormationsLiveInternal({manual=false}={}){
  if(formationsLiveLoading)return false;
  formationsLiveLoading=true;formationsLiveError="";
  if(manual&&state.view==="formationsView")renderFormationsView();
  try{
    const res=await fetch(`./formations-current.json?ts=${Date.now()}`,{cache:"no-store"});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const feed=await res.json();if(!applyFormationLiveFeed(feed))throw new Error("Feed non valido");
    formationsLiveCheckedAt=Date.now();localStorage.setItem(FORMATIONS_LIVE_CHECKED_STORAGE,String(formationsLiveCheckedAt));
    formationsLiveLoading=false;
    renderDashboard();renderFormationsView();
    if($("#liveDialog")?.open){renderAuctionLive();updateLiveResults($("#liveSearchInput")?.value||"")}
    return true;
  }catch(err){
    formationsLiveLoading=false;formationsLiveError=String(err?.message||err||"Aggiornamento non disponibile");
    if(manual&&state.view==="formationsView")renderFormationsView();
    return false;
  }
}
window.refreshFormationsLive=()=>refreshFormationsLiveInternal({manual:true});
function maybeRefreshFormationsLive(){if(formationFeedAgeMinutes()>10)refreshFormationsLiveInternal({manual:false})}

if(formationFeedValid(formationsLiveFeed))applyFormationLiveFeed(formationsLiveFeed,{persist:false});

function clamp(v,min=0,max=1){return Math.min(max,Math.max(min,v))}
function phaseIndex(id=state.auctionPhase){
  const i=AUCTION_PHASES.findIndex(x=>x.id===id);
  return i<0?0:i;
}
function rolePhaseIndex(role){return PHASE_ROLE_INDEX[role]??3}
function playerAuctionPhase(p){
  const tokens=roleTokens(p?.role);
  if(tokens.includes("Por"))return "POR";
  if(tokens.some(r=>["W","T","A","Pc"].includes(r)))return "ATT";
  if(tokens.some(r=>["E","M","C"].includes(r)))return "CEN";
  return "DIF";
}
function phaseForRep(rep){return ({POR:"POR",DIF:"DIF",CEN:"CEN",ATT:"ATT"})[rep]||"ATT"}
function setAuctionPhase(id){
  if(!AUCTION_PHASES.some(x=>x.id===id)||state.auctionPhase===id)return;
  const before=captureAuctionCore(),old=state.auctionPhase;
  state.auctionPhase=id;saveAuctionPhase();
  recordOperation("FASE",`Fase asta ${old} → ${id}`,before,{undoable:true,count:false});
  refresh();
}
window.setAuctionPhase=setAuctionPhase;
function nextAuctionPhase(){
  const i=phaseIndex();
  if(i<AUCTION_PHASES.length-1)setAuctionPhase(AUCTION_PHASES[i+1].id);
}
window.nextAuctionPhase=nextAuctionPhase;

function teamItems(team,excludePlayerId=null){
  let items=rosterForLeagueTeam(team);
  if(excludePlayerId!=null)items=items.filter(x=>String(x.p.id)!==String(excludePlayerId));
  return items;
}
function teamEconomy(team,excludePlayerId=null){
  const items=teamItems(team,excludePlayerId);
  const spentValue=items.reduce((a,x)=>a+Number(x.price||0),0);
  const remaining=Math.max(0,DEFAULT_BUDGET-spentValue);
  const missing=Math.max(0,25-items.length);
  const minimumToFinish=missing;
  const free=Math.max(0,remaining-minimumToFinish);
  const maxNext=missing>0?Math.max(0,remaining-Math.max(0,missing-1)):0;
  const byRep={POR:0,DIF:0,CEN:0,ATT:0};
  items.forEach(x=>{const rep=playerAuctionPhase(x.p);if(byRep[rep]!=null)byRep[rep]+=Number(x.price||0)});
  return {items,spent:spentValue,remaining,missing,minimumToFinish,free,maxNext,byRep};
}
function teamClubCount(team,club,excludePlayerId=null){
  return teamItems(team,excludePlayerId).filter(x=>x.p?.club===club).length;
}
function clubLimitMessage(team,p){
  const name=team?.isMine?"La tua rosa":(team?.name||"Questa squadra");
  return `${name} ha già 5 giocatori del ${p.club}. Il regolamento non consente un sesto giocatore dello stesso club.`;
}
function mineTeam(){return state.league?.teams?.find(t=>t.isMine)||{id:"mine",name:"La mia squadra",isMine:true}}

function neutralPrice(p){return Math.max(1,Math.round(Number(p?.fvm||0)*2.5))}
function auctionTransactions(){
  const tx=[];
  Object.entries(state.purchases).forEach(([id,data])=>{const p=getPlayer(id);if(p&&Number(data.price)>0)tx.push({p,price:Number(data.price),teamId:"mine",at:data.at||0})});
  Object.entries(state.sold).forEach(([id,data])=>{const p=getPlayer(id);if(p&&Number(data.price)>0)tx.push({p,price:Number(data.price),teamId:data.teamId||"",at:data.at||0})});
  return tx;
}
function inflationStats(filterFn=()=>true){
  const rows=auctionTransactions().filter(x=>filterFn(x.p,x));
  const actual=rows.reduce((a,x)=>a+x.price,0);
  const expected=rows.reduce((a,x)=>a+neutralPrice(x.p),0);
  const pct=expected?((actual/expected)-1)*100:0;
  return {count:rows.length,actual,expected,pct,confidence:clamp(rows.length/8)};
}
function familyById(id){return INTEL_FAMILIES.find(x=>x.id===id)}
function playerMatchesFamily(p,family){
  const f=typeof family==="string"?familyById(family):family;
  if(!f)return false;
  const tokens=roleTokens(p.role);
  return f.roles.some(r=>tokens.includes(r));
}
function familyInflation(id){return inflationStats(p=>playerMatchesFamily(p,id))}
function familyMarketHealth(id){
  const f=familyById(id); if(!f)return {total:0,remaining:0,countShare:0,qualityShare:0};
  const all=allPlayers.filter(p=>isMarketEligiblePlayer(p)&&playerMatchesFamily(p,f));
  const remaining=all.filter(p=>!state.purchases[p.id]&&!state.sold[p.id]);
  const qAll=all.reduce((a,p)=>a+Math.max(1,playerQuality(p)),0);
  const qRem=remaining.reduce((a,p)=>a+Math.max(1,playerQuality(p)),0);
  return {total:all.length,remaining:remaining.length,countShare:all.length?remaining.length/all.length:0,qualityShare:qAll?qRem/qAll:0};
}

function fastSlotMatch(slots,players){
  const ordered=players.slice().sort((a,b)=>playerQuality(b)-playerQuality(a));
  const assigned=Array(slots.length).fill(null);
  function tryPlayer(p,seen){
    const opts=[];
    for(let i=0;i<slots.length;i++)if(slotCompatible(p,slots[i]))opts.push(i);
    opts.sort((a,b)=>{
      const aa=assigned[a]?1:0,bb=assigned[b]?1:0;
      return aa-bb || slots[a].roles.length-slots[b].roles.length;
    });
    for(const i of opts){
      if(seen.has(i))continue;
      seen.add(i);
      if(!assigned[i] || tryPlayer(assigned[i],seen)){
        assigned[i]=p;return true;
      }
    }
    return false;
  }
  ordered.forEach(p=>tryPlayer(p,new Set()));
  return {assign:assigned,filled:assigned.filter(Boolean).length,total:slots.length};
}
function slotFinality(slot,currentPhase=phaseIndex()){
  const phases=slot.roles.map(rolePhaseIndex);
  const minP=Math.min(...phases),maxP=Math.max(...phases);
  if(currentPhase>maxP)return 1;
  if(currentPhase===maxP)return .62;
  if(currentPhase>=minP)return .35;
  return .10;
}
function modulePredictionForTeam(team){
  const econ=teamEconomy(team);
  const roster=econ.items.map(x=>x.p);
  const movement=roster.filter(p=>!roleTokens(p.role).includes("Por"));
  const spendTotal=Math.max(1,econ.items.reduce((a,x)=>a+x.price,0));
  const recent=econ.items.slice().sort((a,b)=>(b.p&&((state.purchases[b.p.id]?.at)||(state.sold[b.p.id]?.at))||0)-((a.p&&((state.purchases[a.p.id]?.at)||(state.sold[a.p.id]?.at)))||0)).slice(0,4);

  const scored=MANTRA_MODULES.map(module=>{
    const match=fastSlotMatch(module.slots,roster);
    let weightedPossible=0,weightedFilled=0,quality=0,depth=0;
    module.slots.forEach((slot,i)=>{
      if(slot.roles.includes("Por"))return;
      const f=.35+1.65*slotFinality(slot);
      weightedPossible+=f;
      if(match.assign[i]){
        weightedFilled+=f;
        quality+=f*clamp(playerQuality(match.assign[i])/220);
      }
      const compatible=roster.filter(p=>slotCompatible(p,slot)).length;
      depth+=f*clamp((compatible-1)/2);
    });
    const coverage=weightedPossible?weightedFilled/weightedPossible:0;
    const qualityScore=weightedPossible?quality/weightedPossible:0;
    const depthScore=weightedPossible?depth/weightedPossible:0;
    const assignedIds=new Set(match.assign.filter(Boolean).map(p=>String(p.id)));
    const coherentSpend=econ.items.filter(x=>assignedIds.has(String(x.p.id))).reduce((a,x)=>a+x.price,0)/spendTotal;
    const recentFit=recent.length?recent.filter(x=>module.slots.some(slot=>slotCompatible(x.p,slot))).length/recent.length:0;
    const score=100*(.52*coverage+.15*qualityScore+.10*depthScore+.15*coherentSpend+.08*recentFit);
    return {module,score,match,coverage,quality:qualityScore,depth:depthScore,coherentSpend,recentFit};
  });
  const maxScore=Math.max(...scored.map(x=>x.score),0);
  const temp=8;
  const weights=scored.map(x=>Math.exp((x.score-maxScore)/temp));
  const wsum=weights.reduce((a,b)=>a+b,0)||1;
  scored.forEach((x,i)=>x.prob=weights[i]/wsum);
  scored.sort((a,b)=>b.prob-a.prob);
  const gap=(scored[0]?.prob||0)-(scored[1]?.prob||0);
  const phaseBase=[.08,.25,.48,.72][phaseIndex()]||.08;
  const sample=clamp(movement.length/14);
  const confidence=clamp(phaseBase*.55+sample*.35+gap*.75,0.05,.96);
  return {team,econ,ranked:scored,top:scored[0],confidence};
}
function missingDemandForPrediction(pred,familyId){
  const family=familyById(familyId);if(!family)return 0;
  let demand=0;
  pred.ranked.forEach(r=>{
    let units=0;
    r.module.slots.forEach((slot,i)=>{
      if(r.match.assign[i])return;
      const intersection=slot.roles.filter(role=>family.roles.includes(role));
      if(!intersection.length)return;
      const share=intersection.length/slot.roles.length;
      units+=Math.max(.45,share);
    });
    demand+=r.prob*units;
  });
  return demand;
}
function buildAuctionIntel(){
  const teams=state.league?.teams?.length?state.league.teams:[mineTeam()];
  const predictions={};
  teams.forEach(t=>predictions[t.id]=modulePredictionForTeam(t));
  const opponents=teams.filter(t=>!t.isMine);
  const demand={};
  INTEL_FAMILIES.forEach(f=>{
    const teamRows=opponents.map(t=>{
      const pred=predictions[t.id];
      const units=missingDemandForPrediction(pred,f.id);
      const econ=pred.econ;
      const money=clamp(econ.maxNext/350);
      const need=clamp(units/1.5);
      const pressure=need*(.45+.55*money)*pred.confidence;
      return {team:t,units,pressure,maxNext:econ.maxNext,pred};
    }).sort((a,b)=>b.pressure-a.pressure);
    demand[f.id]={teams:teamRows,totalPressure:teamRows.reduce((a,x)=>a+x.pressure,0),likelyTeams:teamRows.filter(x=>x.pressure>=.22).length};
  });
  const scarcity={};
  INTEL_FAMILIES.forEach(f=>{
    const health=familyMarketHealth(f.id);
    const inf=familyInflation(f.id);
    const supply=.5*health.countShare+.5*health.qualityShare;
    const demandNorm=clamp((demand[f.id]?.totalPressure||0)/Math.max(1,health.remaining/8));
    const infNorm=inf.count?clamp(Math.max(0,inf.pct)/50):0;
    const risk=Math.round(100*clamp(.56*(1-supply)+.29*demandNorm+.15*infNorm));
    scarcity[f.id]={...health,inflation:inf,risk,demandNorm,likelyTeams:demand[f.id]?.likelyTeams||0};
  });
  const economy=teams.map(t=>({team:t,...teamEconomy(t)})).sort((a,b)=>b.remaining-a.remaining||b.maxNext-a.maxNext);
  const repInflation={};
  ["POR","DIF","CEN","ATT"].forEach(rep=>repInflation[rep]=inflationStats(p=>playerAuctionPhase(p)===rep));
  const leagueSpend={POR:0,DIF:0,CEN:0,ATT:0};
  economy.forEach(e=>Object.keys(leagueSpend).forEach(r=>leagueSpend[r]+=e.byRep[r]||0));
  return {predictions,demand,scarcity,economy,repInflation,overallInflation:inflationStats(),leagueSpend};
}
let auctionIntelCache=null;
function getAuctionIntel(){return auctionIntelCache||(auctionIntelCache=buildAuctionIntel())}
function invalidateAuctionIntel(){auctionIntelCache=null}

function riskClass(risk){return risk>=70?"risk-red":risk>=50?"risk-orange":risk>=30?"risk-yellow":"risk-green"}
function riskIcon(risk){return risk>=70?"ALTO":risk>=50?"MED":risk>=30?"BASSO":"OK"}
function familyRiskForPlayer(p,intel=getAuctionIntel()){
  const ids=INTEL_FAMILIES.filter(f=>playerMatchesFamily(p,f)).map(f=>f.id);
  if(!ids.length)return {risk:0,ids:[]};
  const values=ids.map(id=>intel.scarcity[id]?.risk||0);
  return {risk:Math.round(values.reduce((a,b)=>a+b,0)/values.length),ids};
}
function playerInflation(p,intel=getAuctionIntel()){
  const familyIds=INTEL_FAMILIES.filter(f=>playerMatchesFamily(p,f)).map(f=>f.id);
  const stats=familyIds.map(id=>intel.scarcity[id]?.inflation).filter(x=>x&&x.count);
  if(stats.length)return stats.reduce((a,x)=>a+x.pct,0)/stats.length;
  return intel.repInflation[p.reparto]?.pct||intel.overallInflation.pct||0;
}
function competitionForPlayer(p,intel=getAuctionIntel()){
  if(!state.league)return [];
  return opponentTeams().map(team=>{
    const pred=intel.predictions[team.id];
    const matching=INTEL_FAMILIES.filter(f=>playerMatchesFamily(p,f));
    const pressure=matching.length?Math.max(...matching.map(f=>intel.demand[f.id]?.teams.find(x=>x.team.id===team.id)?.pressure||0)):0;
    return {team,pressure,maxNext:pred?.econ.maxNext||0,module:pred?.top?.module.name||"—",confidence:pred?.confidence||0};
  }).sort((a,b)=>b.pressure-a.pressure||b.maxNext-a.maxNext);
}
function liveMaxForPlayer(p,intel=getAuctionIntel()){
  const base=Math.max(1,Number(p.maxPrice||neutralPrice(p)));
  const inf=clamp(playerInflation(p,intel),-35,70);
  const risk=familyRiskForPlayer(p,intel).risk;
  const comp=competitionForPlayer(p,intel);
  const activeComp=comp.filter(x=>x.pressure>=.22).length;
  const factor=clamp(1+(inf/100)*.25+((risk-35)/100)*.16+Math.min(.07,activeComp*.018),.78,1.25);
  const mine=teamEconomy(mineTeam());
  const live=Math.round(base*factor);
  return {base,live:Math.min(live,mine.maxNext||live),rawLive:live,inflation:inf,risk,activeComp,competition:comp};
}

/* v1.43 — Target dinamici Asta Live.
   I TARGET originali restano immutati; quando uno viene perso il motore
   promuove automaticamente la migliore alternativa ancora disponibile. */
function isStaticTarget(p){return !!p && p.strategic && String(p.notes||"").toUpperCase().includes("TARGET")}
function staticTargets(){return allPlayers.filter(isStaticTarget)}
function lostStaticTargets(){
  return staticTargets().filter(p=>!state.purchases[p.id] && (state.sold[p.id] || p.outOfListone));
}
function availableStaticTargets(){
  return staticTargets().filter(p=>isMarketEligiblePlayer(p)&&!state.purchases[p.id]&&!state.sold[p.id]);
}
function currentMissingStrategySlots(){
  const st=activeStrategy(),match=bestLineupMatch(st,purchasedPlayers());
  return st.slots.map((slot,i)=>({slot,i,filled:!!match.assign[i]})).filter(x=>!x.filled);
}
function phaseBudgetRemaining(phase){
  const guide=Number(activeStrategy().budgets?.[phase]||0);
  const used=purchasedPlayers().filter(p=>playerAuctionPhase(p)===phase).reduce((a,p)=>a+Number(state.purchases[p.id]?.price||0),0);
  return Math.max(0,guide-used);
}
function roleAffinityScore(candidate,lost){
  const ct=roleTokens(candidate.role),lt=roleTokens(lost.role);
  const overlap=ct.filter(x=>lt.includes(x)).length;
  let score=overlap?24+Math.min(10,(overlap-1)*5):0;
  const cp=primaryOffensiveRole(candidate),lp=primaryOffensiveRole(lost);
  if(cp&&lp&&cp===lp)score+=16;
  const sharedFamilies=INTEL_FAMILIES.filter(f=>playerMatchesFamily(candidate,f)&&playerMatchesFamily(lost,f)).length;
  score+=Math.min(14,sharedFamilies*7);
  const cf=strategyPlayerFit(candidate),lf=strategyPlayerFit(lost);
  if(cf.some(x=>lf.includes(x)))score+=12;
  return Math.min(58,score);
}
function dynamicAlternativeScore(candidate,lost,intel=getAuctionIntel(),ctx=null){
  if(!candidate||!lost||String(candidate.id)===String(lost.id))return -Infinity;
  if(!isMarketEligiblePlayer(candidate)||state.purchases[candidate.id]||state.sold[candidate.id])return -Infinity;
  if(playerAuctionPhase(candidate)!==playerAuctionPhase(lost))return -Infinity;
  if(countClub(candidate.club)>=5)return -Infinity;

  let score=roleAffinityScore(candidate,lost);
  if(score<18)return -Infinity; // evita alternative solo nominalmente nello stesso reparto

  const missing=ctx?.missing||currentMissingStrategySlots();
  const missingFits=missing.filter(x=>slotCompatible(candidate,x.slot));
  score+=Math.min(18,missingFits.length*6);
  if(missingFits.some(x=>activeStrategy().keySlots.some(k=>k.label===x.slot.label)))score+=8;

  const quality=Math.max(1,playerQuality(candidate));
  const lostQuality=Math.max(1,playerQuality(lost));
  score+=Math.min(15,15*clamp(quality/lostQuality,0,1.2));

  if(candidate.strategic)score+=12;
  if(isStaticTarget(candidate))score+=8;
  score+=starterPriorityBonus(candidate);

  const mine=ctx?.mine||teamEconomy(mineTeam());
  const guide=ctx?.guide??phaseBudgetRemaining(playerAuctionPhase(candidate));
  if(quality<=mine.maxNext)score+=5;
  if(guide>0 && quality<=guide)score+=4;
  else if(guide>0 && quality>guide*1.35)score-=5;

  const u23Owned=ctx?.u23Owned??purchasedPlayers().filter(p=>p.u23).length;
  const u21Owned=ctx?.u21Owned??purchasedPlayers().filter(p=>p.u21).length;
  if(u23Owned<2 && candidate.u23)score+=4;
  if(u21Owned<1 && candidate.u21)score+=5;

  const risk=familyRiskForPlayer(candidate,intel).risk;
  score+=Math.min(8,risk*.08); // se il ruolo si sta esaurendo, priorità maggiore
  return Math.round(score);
}
function bestAlternativeForTarget(lost,intel=getAuctionIntel()){
  if(!lost)return null;
  const owned=purchasedPlayers();
  const ctx={
    missing:currentMissingStrategySlots(),
    mine:teamEconomy(mineTeam()),
    guide:phaseBudgetRemaining(playerAuctionPhase(lost)),
    u23Owned:owned.filter(p=>p.u23).length,
    u21Owned:owned.filter(p=>p.u21).length
  };
  const rank=pool=>pool
    .map(p=>({p,score:dynamicAlternativeScore(p,lost,intel,ctx)}))
    .filter(x=>Number.isFinite(x.score))
    .sort((a,b)=>b.score-a.score||playerQuality(b.p)-playerQuality(a.p));
  // Prima lavora sulla shortlist strategica da 200; il listone completo è solo fallback.
  let candidates=rank(allPlayers.filter(p=>p.strategic));
  if(!candidates.length)candidates=rank(allPlayers);
  if(!candidates.length)return null;
  const best=candidates[0];
  const fit=strategyPlayerFit(best.p);
  const reason=[
    roleTokens(best.p.role).some(r=>roleTokens(lost.role).includes(r))?`ruolo ${best.p.role}`:"profilo compatibile",
    fit.length?`fit ${fit.join("/")}`:`fit ${activeStrategy().module}`,
    `MAX live ${fmt(liveMaxForPlayer(best.p,intel).live)}`
  ].join(" · ");
  return {lost,player:best.p,score:best.score,reason};
}
function dynamicTargetRecommendations(intel=getAuctionIntel()){
  return lostStaticTargets()
    .map(lost=>bestAlternativeForTarget(lost,intel))
    .filter(Boolean)
    .sort((a,b)=>{
      const pa=playerAuctionPhase(a.lost)===state.auctionPhase?0:1;
      const pb=playerAuctionPhase(b.lost)===state.auctionPhase?0:1;
      return pa-pb||b.score-a.score;
    });
}
function dynamicAlternativeForPlayer(p,intel=getAuctionIntel(),recommendations=null){
  const recs=recommendations||dynamicTargetRecommendations(intel);
  return recs.find(x=>String(x.player.id)===String(p?.id))||null;
}
function liveTargetBannerHTML(intel=getAuctionIntel()){
  const current=dynamicTargetRecommendations(intel).find(x=>playerAuctionPhase(x.lost)===state.auctionPhase);
  if(!current)return "";
  return `<div class="live-target-alert urgent">
    <div><span>TARGET PERSO · ${esc(current.lost.name)}</span><b>${kitHTML(current.player.club,'xs',current.player.club)} ${esc(current.player.name)}</b><small>${esc(current.reason)}</small></div>
    <button type="button" onclick='selectLivePlayer(${idArg(current.player.id)})'>PARTECIPA</button>
  </div>`;
}

function updateSoldEconomicNote(){
  const team=leagueTeamById($("#soldTeamSelect")?.value);
  if(!team){
    if($("#soldLeagueNote"))$("#soldLeagueNote").textContent="Nessuna lega creata: vendita registrata senza squadra.";
    return;
  }
  const econ=teamEconomy(team,soldPlayerId);
  $("#soldLeagueNote").textContent=`${team.name}: ${fmt(econ.remaining)} cr residui · ${econ.missing} posti · MAX prossimo ${fmt(econ.maxNext)}.`;
}

function signal(p, price){
  price=Number(price||0); let m=Number(p.maxPrice||0);
  if(!price) return {t:"Inserisci il prezzo",c:""};
  if(price<=m*.75) return {t:"AFFARE",c:"green"};
  if(price<=m*.92) return {t:"OK",c:"green"};
  if(price<=m) return {t:"LIMITE",c:"orange"};
  return {t:"STOP",c:"red"};
}
function pctLabel(v,count=1){
  if(!count)return "—";
  const n=Math.round(Number(v||0));
  return `${n>0?"+":""}${n}%`;
}
function renderDashboard(){
  invalidateAuctionIntel();
  const intel=getAuctionIntel();
  const bought=purchasedPlayers(), s=spent(), rem=DEFAULT_BUDGET-s;
  const st=activeStrategy(), budgets=st.budgets, rec=strategyRecommendation(bought,intel);
  const byRep={POR:0,DIF:0,CEN:0,ATT:0};
  bought.forEach(p=>byRep[p.reparto]+=Number(state.purchases[p.id].price||0));

  const u23=bought.filter(p=>p.u23).length;
  const u21=bought.filter(p=>p.u21).length;
  const porCount=bought.filter(p=>p.reparto==="POR").length;
  const movCount=bought.length-porCount;
  const mineEcon=teamEconomy(mineTeam());
  const currentPhase=AUCTION_PHASES[phaseIndex()];
  const nextPhase=AUCTION_PHASES[phaseIndex()+1]||null;
  const leader=intel.economy[0];
  const clubAlerts=SERIES_A_CLUBS.map(([code])=>[code,countClub(code)]).filter(([,count])=>count>5);
  const recent=bought.slice().sort((a,b)=>(state.purchases[b.id]?.at||0)-(state.purchases[a.id]?.at||0)).slice(0,5);
  const scarcityOrder=["Dd","Ds","Dc","MC","T","WA","APc","Pc"];
  const pressure=scarcityOrder.map(id=>({id,x:intel.scarcity[id],f:familyById(id)})).sort((a,b)=>(b.x?.risk||0)-(a.x?.risk||0))[0];
  const leagueOverview=(state.league?.teams||[])
    .map((team,index)=>({team,index,...teamEconomy(team)}))
    .sort((a,b)=>b.remaining-a.remaining||a.index-b.index);
  const watchCount=allPlayers.filter(p=>isWatchlisted(p.id)&&isMarketEligiblePlayer(p)&&!state.purchases[p.id]&&!state.sold[p.id]).length;

  let alerts=[];
  if(bought.length>25) alerts.push(`Rosa oltre limite: ${bought.length}/25`);
  if(porCount>3) alerts.push(`Portieri oltre limite: ${porCount}/3`);
  if(movCount>22) alerts.push(`Movimento oltre limite: ${movCount}/22`);
  if(clubAlerts.length) alerts.push("Club oltre 5: "+clubAlerts.map(([c,n])=>`${c} ${n}/5`).join(", "));
  if(mineEcon.remaining<mineEcon.minimumToFinish) alerts.push(`Crediti insufficienti per chiudere ${mineEcon.missing} slot a 1`);

  const repLabel={POR:"Portieri",DIF:"Difensori",CEN:"Centrocampisti",ATT:"Attaccanti"};
  const repCards=["POR","DIF","CEN","ATT"].map(rep=>{
    const guide=Math.max(1,Number(budgets[rep]||0));
    const pct=Math.min(100,Math.max(0,byRep[rep]/guide*100));
    return `<div class="finance-rep"><span data-short="${rep}">${repLabel[rep]}</span><strong>${fmt(byRep[rep])}</strong><small>su ${fmt(guide)} crediti</small><i><em style="width:${pct}%"></em></i><b>${Math.round(pct)}%</b></div>`;
  }).join("");

  const recentRows=recent.length?recent.map(p=>{
    const tr=state.purchases[p.id]||{};
    const time=tr.at?new Date(tr.at).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}):"—";
    return `<button class="finance-recent-row" onclick='openPlayer(${idArg(p.id)})'><time>${time}</time>${kitHTML(p.club,'xs',p.club)}<span><b>${playerNameHTML(p)}</b><small>${p.club} · ${p.role}</small></span><strong>${fmt(tr.price)}<small>cr</small></strong></button>`;
  }).join(""):`<div class="finance-empty">Nessun acquisto ancora.</div>`;

  $("#dashboardView").innerHTML=`
    <div class="finance-dashboard">
      <section id="auctionLivePanel" class="finance-panel finance-live-panel finance-live-panel-top">
        <div class="finance-panel-title"><b>ASTA LIVE</b><span>accesso rapido</span></div>
        <div class="finance-live-main"><span>FASE ATTIVA</span><strong>${currentPhase.id}</strong><small>${currentPhase.label} · ${mineEcon.missing} posti mancanti</small></div>
        <div class="finance-live-metrics">
          <div class="finance-live-sub"><span>MAX PROSSIMO</span><b>${fmt(mineEcon.maxNext)}</b></div>
          <div class="finance-live-sub"><span>WATCHLIST</span><b>${watchCount}</b></div>
        </div>
        <div class="finance-live-actions">
          <button id="openLiveBtn" class="primary finance-live-btn">ENTRA IN ASTA</button>
          <div class="finance-phase-track">${AUCTION_PHASES.map((ph,i)=>`<button class="${ph.id===state.auctionPhase?"active":""} ${i<phaseIndex()?"done":""}" onclick="setAuctionPhase('${ph.id}')">${ph.id}</button>`).join("")}</div>
          ${nextPhase?`<button id="nextPhaseBtn" class="finance-text-btn">Termina ${currentPhase.id} · passa a ${nextPhase.id}</button>`:""}
        </div>
      </section>

      <section class="finance-kpis">
        <div class="finance-kpi finance-kpi-primary"><span>BUDGET RESIDUO</span><strong>${fmt(rem)}</strong><small>CREDITI</small></div>
        <div class="finance-kpi"><span>ROSA</span><strong>${bought.length}<em>/25</em></strong><small>${porCount} POR · ${movCount} MOV.</small></div>
        <div class="finance-kpi ${u23>=2?"ok":"warn"}"><span>U23</span><strong>${u23}<em>/2</em></strong><small>REQUISITO</small></div>
        <div class="finance-kpi ${u21>=1?"ok":"warn"}"><span>U21</span><strong>${u21}<em>/1</em></strong><small>REQUISITO</small></div>
      </section>

      <section class="finance-panel finance-budget-panel">
        <div class="finance-panel-title"><b>BUDGET PER REPARTO</b><span>spesa / guida ${state.strategy}</span></div>
        <div class="finance-rep-grid">${repCards}</div>
      </section>

      <section class="finance-intel-grid">
        <div class="finance-stat"><span>CREDITI LIBERI REALI</span><strong>${fmt(mineEcon.free)}</strong><small>MAX prossimo ${fmt(mineEcon.maxNext)}</small></div>
        <div class="finance-stat"><span>LEADER CREDITI</span><b>${leader?esc(leader.team.name):"—"}</b><strong>${leader?fmt(leader.remaining):"—"}</strong><small>crediti residui</small></div>
        <div class="finance-stat finance-stat-warn"><span>INFLAZIONE ASTA</span><strong>${pctLabel(intel.overallInflation.pct,intel.overallInflation.count)}</strong><small>vs FVM ×2,5</small></div>
      </section>

      <section class="finance-strategy-grid">
        <div class="finance-strategy-card"><span>STRATEGIA CONSIGLIATA</span><strong>${rec.recommended==="A"?"4-3-1-2":"4-3-3"}</strong><small>${rec.recommended===state.strategy?"strategia attiva coerente":"valuta il cambio strategia"}</small></div>
        <div class="finance-strategy-card ${pressure?.x?.risk>=60?"warn":""}"><span>PRESSIONE MERCATO</span><strong>${pressure?.f?.label||currentPhase.label}</strong><div class="finance-pressure"><i style="width:${Math.min(100,pressure?.x?.risk||0)}%"></i></div><small>${pressure?.x?.risk||0}/100 · ${pressure?.x?.remaining||0} disponibili</small></div>
        <div class="finance-strategy-card"><span>MODULO TARGET</span><strong>${st.module}</strong><small>${state.strategy==="A"?"Strategia A":"Strategia B"}</small></div>
      </section>

      <section class="finance-market-grid">
        <div class="finance-panel finance-league-overview">
          <div class="finance-panel-title"><b>PANORAMICA LEGA</b><span>${state.league?state.league.size+" squadre":"lega non creata"}</span></div>
          ${leagueOverview.length?`<div class="finance-league-list">${leagueOverview.map((e,i)=>`
            <div class="finance-league-row ${e.team.isMine?"mine":""} ${i===0?"leader":""}">
              <b class="finance-league-rank">${i+1}</b>
              <span class="finance-league-team"><strong>${esc(e.team.name)}</strong>${e.team.isMine?'<small class="finance-mine-label">MIA SQUADRA</small>':''}</span>
              <span class="finance-league-roster"><strong>${e.items.length}<em>/25</em></strong><small>giocatori</small></span>
              <span class="finance-league-credit"><strong>${fmt(e.remaining)}</strong><small>crediti</small></span>
            </div>`).join("")}</div>`:`<div class="finance-empty">Crea una lega per il confronto avversari.</div>`}
        </div>
        <div class="finance-panel finance-club-panel">
          <div class="finance-panel-title"><b>GIOCATORI PER CLUB</b><span>quota massima 5</span></div>
          ${clubCounterHTML(bought)}
        </div>
      </section>

      <section class="finance-bottom-grid finance-bottom-grid-single">
        <div class="finance-panel finance-recent-panel">
          <div class="finance-panel-title"><b>ULTIMI 5 ACQUISTI</b><span>${fmt(s)} crediti spesi</span></div>
          <div class="finance-recent-list">${recentRows}</div>
          ${recent.length?`<button id="undoLastPurchaseBtn" class="finance-text-btn">Annulla ultimo acquisto</button>`:""}
        </div>
      </section>

      ${alerts.length?`<div class="dash-critical">${alerts.join(" · ")}</div>`:""}

      <details class="finance-system-details">
        <summary><span>SISTEMA & CONTROLLO</span><small>protezione, dati, watchlist, report</small></summary>
        <div class="finance-system-content">
          ${safetyDashboardHTML()}
          ${dataFreshnessHTML()}
          ${listoneDashboardBadgeHTML()}
          ${watchlistDashboardHTML()}
          <button class="final-report-launch" onclick="openFinalReport()"><span>REPORT ASTA</span><b>${bought.length===25?"Rosa completata · apri report":"Report parziale · "+bought.length+"/25"}</b><strong>›</strong></button>
        </div>
      </details>

      <details class="dashboard-plan-details finance-plan-details">
        <summary><span>PIANO STRATEGICO COMPLETO</span><small>apri / chiudi</small></summary>
        <div id="dashboardPlanContent"></div>
      </details>
    </div>`;

  const undoBtn=$("#undoLastPurchaseBtn");if(undoBtn)undoBtn.onclick=undoLastPurchase;
  const nextBtn=$("#nextPhaseBtn");if(nextBtn)nextBtn.onclick=nextAuctionPhase;
  const liveBtn=$("#openLiveBtn");if(liveBtn)liveBtn.onclick=openAuctionLive;
  const listoneBtn=$("#dashboardListoneBtn");if(listoneBtn)listoneBtn.onclick=()=>switchView("playersView");
  renderPlan("#dashboardPlanContent");
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
        ${kitHTML(club,'tile',fullName)}
        <span class="club-tile-copy"><b>${club}</b><strong>${count}/5</strong></span>
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

function formationListCardHTML(f,index,showSetPieces=true){
  const groups={POR:[],DIF:[],CEN:[],ATT:[]};
  (f.lines||[]).flat().forEach(p=>{const g=formationBroadGroup(p.role);groups[g].push(p)});
  const labels={POR:"POR",DIF:"DIF",CEN:"CEN",ATT:"ATT"};
  const bench=(f.bench||[]).filter(x=>Number(x.probability)>=30).sort((a,b)=>Number(b.probability)-Number(a.probability)).slice(0,7);
  return `<article class="formation-list-card ${f.liveSource?"formation-live-card":""}"
      role="button" tabindex="0" onclick="openFormation(${index})"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openFormation(${index})}"
      aria-label="${f.team}, ${f.module}">
    <div class="formation-list-head"><div><b>${f.team}</b><span>${f.club}${f.liveSource?' · LIVE':''}</span></div><strong>${f.module}</strong></div>
    ${showSetPieces?setPieceHTML(f.club):""}
    <div class="formation-role-list">
      ${["POR","DIF","CEN","ATT"].map(group=>`<div class="formation-role-row formation-role-${group.toLowerCase()}">
        <div class="formation-role-label">${labels[group]}</div><div class="formation-role-players">
          ${groups[group].map(p=>{const pr=Number(p.probability||starterProbability(formationPlayerCandidate(p.name,f.club)).prob);const st=starterStatus(pr);return `<span class="formation-name-chip"><span class="formation-chip-text"><b>${esc(p.name)}</b><em>${esc(p.role)}</em></span><small class="starter-prob ${st.cls}">${Math.round(pr)}%</small></span>`}).join("")||`<span class="formation-empty">—</span>`}
        </div></div>`).join("")}
    </div>
    ${bench.length?`<div class="formation-ballottaggi"><b>Alternative / ballottaggi</b><div>${bench.map(x=>`<span>${esc(x.name)} <strong>${Math.round(Number(x.probability||0))}%</strong></span>`).join("")}</div></div>`:""}
    <div class="formation-list-foot"><span>Agg. ${f.updated}</span><span>${f.liveSource?'dati live · ':''}tocca per dettaglio ›</span></div>
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

  const ordered=sortedFormations();
  const pages=[];
  for(let i=0;i<ordered.length;i+=2){
    pages.push(ordered.slice(i,i+2));
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
            return formationListCardHTML(f,index,false);
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


function formationUpdateTimestamp(value){
  const m=String(value||"").match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if(!m)return 0;
  return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]),Number(m[4]),Number(m[5])).getTime();
}
function latestFormationUpdate(){
  return formations.slice().sort((a,b)=>formationUpdateTimestamp(b.updated)-formationUpdateTimestamp(a.updated))[0]?.updated||"—";
}

function renderFormationsView(){
  const live=formationFeedValid(formationsLiveFeed),age=formationFeedAgeMinutes();
  const syncText=formationsLiveLoading?"Aggiornamento…":live?(age<=20?"LIVE":"CACHE"):"BASE LOCALE";
  $("#formationsView").innerHTML=`
    <div class="section-title formations-page-title">
      <div><div class="eyebrow">Serie A 26/27</div><h2>Probabili Formazioni</h2></div>
      <span class="muted">${formations.length} squadre</span>
    </div>
    <div class="formations-update-card ${live?"live":"base"}">
      <div><span>ULTIMO AGGIORNAMENTO FORMAZIONI</span><b>${latestFormationUpdate()}</b><small>${live?`Fantacalcio.it · sincronizzato ${Math.round(age)} min fa`:"Fallback formations.js"}${formationsLiveError?` · ${esc(formationsLiveError)}`:""}</small></div>
      <button class="formation-refresh-btn" onclick="refreshFormationsLive()" ${formationsLiveLoading?"disabled":""}>${syncText}</button>
    </div>
    <div class="formation-algo-note"><b>Titolarità collegata all'algoritmo</b><span>Le percentuali influenzano Strategia A/B, TARGET dinamici, ALT 1-3 e ranking Asta Live.</span></div>
    ${formations.length?`<div class="formations-dedicated-grid">${sortedFormations().map(f=>formationListCardHTML(f,formations.indexOf(f))).join("")}</div>`:`<div class="card muted">Formazioni non disponibili.</div>`}`;
}

window.openFormation=index=>{
  const f=formations[index]; if(!f)return;
  const pitchLines=f.lines.slice().reverse().map(line=>`<div class="formation-line large">${line.map(p=>{const pr=Number(p.probability||starterProbability(formationPlayerCandidate(p.name,f.club)).prob);return `<div class="formation-player large"><b>${esc(p.name)}</b><span>${esc(p.role)} · ${Math.round(pr)}%</span></div>`}).join("")}</div>`).join("");
  const bench=(f.bench||[]).filter(x=>Number(x.probability)>=20).sort((a,b)=>Number(b.probability)-Number(a.probability)).slice(0,12);
  $("#formationDialogContent").innerHTML=`<div class="dialog-body formation-dialog-body">
    <div class="formation-modal-head"><div><div class="eyebrow">Probabile formazione ${f.liveSource?'· LIVE':''}</div><h2>${f.team} · ${f.module}</h2><p>Ruoli Mantra · aggiornamento ${f.updated}</p></div><button class="ghost" onclick="formationDialog.close()">✕</button></div>
    <div class="large-pitch"><i class="pitch-half"></i><i class="pitch-circle"></i><div class="formation-lines">${pitchLines}</div></div>
    ${bench.length?`<div class="formation-dialog-bench"><b>Possibili titolari / ballottaggi</b><div>${bench.map(x=>`<span>${esc(x.name)} <strong>${Math.round(Number(x.probability||0))}%</strong><small>${esc(x.role||formationRoleFor(x.name,f.club))}</small></span>`).join("")}</div></div>`:""}
    ${setPieceHTML(f.club)}
    <p class="formation-source">${f.liveSource?'Probabilità: feed aggiornato da Fantacalcio.it · ':''}Ruoli: Listone/guida Mantra 2026/27 · le percentuali di titolarità entrano nel motore strategico.</p>
  </div>`;
  $("#formationDialog").showModal();
};


let actionReturnContext=null;

function captureActionReturnContext(playerId){
  if($("#liveDialog")?.open){
    return {
      type:"live",
      playerId,
      query:$("#liveSearchInput")?.value||""
    };
  }
  if($("#playerDialog")?.open){
    return {type:"player",playerId};
  }
  return null;
}

function restoreActionReturnContext(){
  const ctx=actionReturnContext;
  actionReturnContext=null;
  if(!ctx)return;

  if(ctx.type==="player"){
    openPlayer(ctx.playerId);
    return;
  }

  if(ctx.type==="live"){
    liveSelectedId=null;
    renderAuctionLive();
    $("#liveDialog").showModal();
    const input=$("#liveSearchInput");
    if(input){
      input.value=ctx.query||"";
      updateLiveResults(input.value);
    }
    if(ctx.playerId)selectLivePlayer(ctx.playerId);
    setTimeout(()=>$("#liveSearchInput")?.focus(),30);
  }
}

function finishAuctionActionNavigation(){
  const ctx=actionReturnContext;
  actionReturnContext=null;
  refresh();
  if(ctx?.type!=="live")return;

  if(state.view!=="dashboardView")switchView("dashboardView");
  requestAnimationFrame(()=>{
    const panel=document.getElementById("auctionLivePanel");
    if(panel)panel.scrollIntoView({behavior:"auto",block:"start"});
    openAuctionLive();
  });
}

let liveSelectedId=null;
/* v1.44 — Priorità strategica dell'elenco Asta Live.
   TARGET → alternativa dinamica → migliori alternative → resto dei profili. */
function liveGeneralOpportunityScore(p,intel=getAuctionIntel(),ctx=null){
  if(!p)return -Infinity;
  const mine=ctx?.mine||teamEconomy(mineTeam());
  const missing=ctx?.missing||currentMissingStrategySlots();
  let score=0;
  if(p.strategic)score+=24;
  const fits=strategyPlayerFit(p);
  score+=Math.min(20,fits.length*10);
  const missingFits=missing.filter(x=>slotCompatible(p,x.slot));
  score+=Math.min(24,missingFits.length*6);
  if(missingFits.some(x=>activeStrategy().keySlots.some(k=>k.label===x.slot.label)))score+=8;
  const quality=playerQuality(p);
  score+=Math.min(20,Math.round(Math.sqrt(Math.max(0,quality))*1.05));
  score+=starterPriorityBonus(p);
  const risk=familyRiskForPlayer(p,intel).risk;
  score+=Math.min(10,Math.round(risk*.10));
  if(quality<=mine.maxNext)score+=6;
  else score-=12;
  const owned=purchasedPlayers();
  if(owned.filter(x=>x.u23).length<2&&p.u23)score+=5;
  if(owned.filter(x=>x.u21).length<1&&p.u21)score+=6;
  if(countClub(p.club)>=4)score-=6;
  return score;
}
function livePriorityRows(list,intel=getAuctionIntel(),recommendations=null){
  const recs=recommendations||dynamicTargetRecommendations(intel);
  const dynamicById=new Map();
  recs.forEach(rec=>{
    const key=String(rec.player.id),prev=dynamicById.get(key);
    if(!prev||rec.score>prev.score)dynamicById.set(key,rec);
  });
  const phaseCtx=new Map(),phaseTargets=new Map();
  const ctxFor=phase=>{
    if(!phaseCtx.has(phase)){
      const owned=purchasedPlayers();
      phaseCtx.set(phase,{
        missing:currentMissingStrategySlots(),
        mine:teamEconomy(mineTeam()),
        guide:phaseBudgetRemaining(phase),
        u23Owned:owned.filter(p=>p.u23).length,
        u21Owned:owned.filter(p=>p.u21).length
      });
    }
    return phaseCtx.get(phase);
  };
  const targetsFor=phase=>{
    if(!phaseTargets.has(phase)){
      phaseTargets.set(phase,staticTargets().filter(t=>playerAuctionPhase(t)===phase&&!state.purchases[t.id]));
    }
    return phaseTargets.get(phase);
  };
  const rows=list.map(p=>{
    const phase=playerAuctionPhase(p),dynamic=dynamicById.get(String(p.id))||null;
    const staticTarget=isStaticTarget(p);
    const ctx=ctxFor(phase);
    let altScore=-Infinity;
    if(!staticTarget){
      for(const target of targetsFor(phase)){
        const score=dynamicAlternativeScore(p,target,intel,ctx);
        if(score>altScore)altScore=score;
      }
    }
    const general=liveGeneralOpportunityScore(p,intel,ctx);
    const tier=staticTarget?0:dynamic?1:Number.isFinite(altScore)?2:3;
    const score=staticTarget?1000+general:dynamic?dynamic.score: Number.isFinite(altScore)?altScore:general;
    return {p,meta:{tier,score,altScore,general,dynamic,altRank:null}};
  });
  rows.sort((a,b)=>{
    const phaseA=playerAuctionPhase(a.p)===state.auctionPhase?0:1;
    const phaseB=playerAuctionPhase(b.p)===state.auctionPhase?0:1;
    return phaseA-phaseB||a.meta.tier-b.meta.tier||b.meta.score-a.meta.score||b.meta.general-a.meta.general||playerQuality(b.p)-playerQuality(a.p)||String(a.p.name).localeCompare(String(b.p.name),'it');
  });
  const counters={};
  rows.forEach(row=>{
    if(isStaticTarget(row.p))return;
    if(row.meta.tier>2)return;
    const phase=playerAuctionPhase(row.p);
    counters[phase]=(counters[phase]||0)+1;
    row.meta.altRank=counters[phase];
  });
  return rows;
}
function liveCandidateList(query="",intel=getAuctionIntel(),recommendations=null){
  const q=String(query||"").trim().toLowerCase();
  let list=allPlayers.filter(p=>isMarketEligiblePlayer(p)&&!state.purchases[p.id]&&!state.sold[p.id]);
  if(q){
    list=list.filter(p=>(p.name+" "+p.club+" "+p.role).toLowerCase().includes(q));
  }else{
    list=list.filter(p=>playerAuctionPhase(p)===state.auctionPhase);
  }
  return livePriorityRows(list,intel,recommendations).slice(0,18);
}
function liveResultHTML(p,intel=getAuctionIntel(),recommendations=null,meta=null){
  const live=liveMaxForPlayer(p,intel),dynamic=dynamicAlternativeForPlayer(p,intel,recommendations);
  const staticTarget=isStaticTarget(p);
  const altBadge=!staticTarget&&!dynamic&&meta?.altRank&&meta.altRank<=3?`<em class="live-result-badge alternative">ALT ${meta.altRank}</em>`:"";
  const starter=starterProbability(p),starterBadge=`<em class="live-result-badge starter ${starterStatus(starter.prob).cls}">${Math.round(starter.prob)}%</em>`;
  const badges=[staticTarget?'<em class="live-result-badge target">TARGET</em>':"",dynamic?'<em class="live-result-badge dynamic">DA PRENDERE</em>':"",altBadge,starterBadge].join("");
  const rankedClass=dynamic?"dynamic-target":(!staticTarget&&meta?.altRank&&meta.altRank<=3?"ranked-alternative":"");
  return `<button class="live-result ${rankedClass}" data-id="${p.id}"><span class="live-result-main">${kitHTML(p.club,'sm',p.club)}<span><b>${esc(p.name)} ${badges}</b><small>${p.club} · ${p.role} · FVM ${p.fvm||0}</small></span></span><strong>${riskIcon(live.risk)} ${fmt(live.live)}<small>MAX live</small></strong></button>`;
}
function updateLiveResults(query=""){
  const intel=getAuctionIntel(),recommendations=dynamicTargetRecommendations(intel),rows=liveCandidateList(query,intel,recommendations);
  const target=$("#liveResults");if(!target)return;
  target.innerHTML=rows.length?rows.map(({p,meta})=>liveResultHTML(p,intel,recommendations,meta)).join(""):'<div class="live-empty">Nessun giocatore trovato.</div>';
  $$("#liveResults .live-result").forEach(btn=>btn.onclick=()=>selectLivePlayer(btn.dataset.id));
}
function selectLivePlayer(id){
  const p=getPlayer(id);if(!p)return;
  liveSelectedId=p.id;
  const intel=getAuctionIntel(),live=liveMaxForPlayer(p,intel),mine=teamEconomy(mineTeam());
  const comp=live.competition.slice(0,5);
  const dynamic=dynamicAlternativeForPlayer(p,intel);
  const staticTarget=isStaticTarget(p);
  const targetSignal=staticTarget&&dynamic
    ? `<div class="live-strategy-signal dynamic"><span class="live-target-symbol">TARGET</span><div><b>PARTECIPA ALL'ASTA</b><small>Obiettivo strategico ancora disponibile e migliore alternativa a ${esc(dynamic.lost.name)} · ${esc(dynamic.reason)}.</small></div></div>`
    : staticTarget
      ? `<div class="live-strategy-signal static"><span class="live-target-symbol">TARGET</span><div><b>OBIETTIVO STRATEGICO</b><small>Giocatore già inserito nel piano · partecipa all'asta rispettando il MAX live.</small></div></div>`
      : dynamic
        ? `<div class="live-strategy-signal dynamic"><span class="live-target-symbol">DA PRENDERE</span><div><b>PARTECIPA ALL'ASTA</b><small>Alternativa automatica a ${esc(dynamic.lost.name)} · ${esc(dynamic.reason)}.</small></div></div>`
        : "";
  const target=$("#liveSelected");if(!target)return;
  target.innerHTML=`<div class="live-player-card ${dynamic?"recommended":""}">
    ${targetSignal}
    <div class="live-player-head"><div class="live-player-identity">${kitHTML(p.club,'live',p.club)}<div><span>${p.club} · ${p.role} · Titolarità ${Math.round(starterProbability(p).prob)}%</span><b>${esc(p.name)}${staticTarget?' <em class="live-inline-target">TARGET</em>':""}${dynamic?' <em class="live-inline-dynamic">DA PRENDERE</em>':""}</b><button type="button" class="live-watch ${isWatchlisted(p.id)?"active":""}" onclick='toggleWatchlist(${idArg(p.id)})'>${isWatchlisted(p.id)?"SEGUITO":"SEGUI"}</button></div></div><strong>${riskIcon(live.risk)} ${live.risk}</strong></div>
    <div class="live-price-grid">
      <div><span>FVM</span><b>${p.fvm||0}</b></div>
      <div><span>MAX iniziale</span><b>${fmt(live.base)}</b></div>
      <div class="live-max"><span>MAX LIVE</span><b>${fmt(live.live)}</b></div>
      <div><span>Inflazione</span><b>${pctLabel(live.inflation,1)}</b></div>
    </div>
    <div class="live-own-money"><span>Noi: ${fmt(mine.remaining)} cr · ${mine.missing} posti</span><b>MAX possibile ${fmt(mine.maxNext)}</b></div>
    <div class="live-competition-title">Concorrenza prevista</div>
    ${state.league?`<div class="live-competition">${comp.map(x=>`<div class="${x.pressure>=.45?"hot":x.pressure>=.22?"warm":"cool"}"><span><b>${esc(x.team.name)}</b><small>${x.module} · conf. ${Math.round(x.confidence*100)}%</small></span><strong>${Math.round(x.pressure*100)}%<small>MAX ${fmt(x.maxNext)}</small></strong></div>`).join("")}</div>`:'<div class="live-empty">Crea una lega per stimare la concorrenza avversaria.</div>'}
    <div class="live-actions"><button class="primary" onclick='liveBuy(${idArg(p.id)})'>ACQUISTA</button><button class="soldbtn" onclick='liveSell(${idArg(p.id)})'>VENDUTO</button></div>
  </div>`;
}

function renderAuctionLive(){
  const phase=AUCTION_PHASES[phaseIndex()];
  $("#liveDialogContent").innerHTML=`<div class="dialog-body live-dialog-body">
    <div class="live-dialog-head"><div><span class="eyebrow">${phase.icon} Fase ${phase.id}</span><h2>Asta Live</h2></div><button id="closeLiveBtn" class="ghost">✕</button></div>
    ${liveTargetBannerHTML()}
    <input id="liveSearchInput" class="search live-search" placeholder="Cerca giocatore…" autocomplete="off" autocapitalize="off" spellcheck="false">
    <div id="liveSelected"></div>
    <div class="live-results-label"><span>${phase.label}</span><small>TARGET → alternative → migliori profili</small></div>
    <div id="liveResults"></div>
  </div>`;
  $("#closeLiveBtn").onclick=()=>$("#liveDialog").close();
  $("#liveSearchInput").addEventListener("input",e=>updateLiveResults(e.target.value));
  updateLiveResults("");
}
function openAuctionLive(){
  liveSelectedId=null;renderAuctionLive();$("#liveDialog").showModal();
  setTimeout(()=>$("#liveSearchInput")?.focus(),30);
}
window.openAuctionLive=openAuctionLive;
window.liveBuy=id=>{
  const ctx=captureActionReturnContext(id);
  if($("#liveDialog").open)$("#liveDialog").close();
  startPurchase(id,ctx);
};
window.liveSell=id=>{
  const ctx=captureActionReturnContext(id);
  if($("#liveDialog").open)$("#liveDialog").close();
  openSoldDialog(id,ctx);
};


function listoneSyncDateLabel(iso){
  if(!iso)return "mai";
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return "data non disponibile";
  return new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}).format(d);
}
function listoneSyncAgeLabel(){
  const iso=appliedListoneSync?.generatedAt;
  if(!iso)return "base inclusa nell'app";
  const ms=Date.now()-new Date(iso).getTime();
  if(!Number.isFinite(ms)||ms<0)return listoneSyncDateLabel(iso);
  const min=Math.floor(ms/60000);
  if(min<1)return "adesso";
  if(min<60)return `${min} min fa`;
  const h=Math.floor(min/60);
  if(h<24)return `${h} h fa`;
  return listoneSyncDateLabel(iso);
}
function listoneSyncIsOfficial(){return appliedListoneSync?.sourceKind==="official-fantacalcio"}
function listoneSyncCardHTML(){
  const official=listoneSyncIsOfficial();
  const active=allPlayers.filter(p=>isMarketEligiblePlayer(p)).length;
  return `<section class="listone-sync-card ${official?"synced":"bootstrap"}">
    <div class="listone-sync-copy">
      <span class="listone-sync-kicker">LISTONE FANTACALCIO</span>
      <b>${official?"Sincronizzato":"In attesa del primo sync GitHub"}</b>
      <small>${active} attivi · ${official?`ultimo controllo ${listoneSyncAgeLabel()}`:"la base locale resta utilizzabile"}</small>
    </div>
    <button id="updateListoneBtn" class="listone-sync-btn">Aggiorna</button>
  </section>`;
}
function listoneDashboardBadgeHTML(){
  const official=listoneSyncIsOfficial();
  return `<button class="listone-dashboard-status ${official?"ok":""}" id="dashboardListoneBtn">
    <span>${official?"SYNC":"WAIT"} LISTONE</span>
    <b>${official?listoneSyncAgeLabel():"sync da attivare"}</b>
  </button>`;
}
function syncSnapshotValid(snapshot){
  return snapshot&&snapshot.schema===LISTONE_SYNC_SCHEMA&&snapshot.complete===true
    &&snapshot.sourceKind==="official-fantacalcio"&&Array.isArray(snapshot.players)
    &&Number(snapshot.activePlayers)>=450&&Number(snapshot.unclassified||0)===0;
}
function computeListoneChanges(snapshot){
  const current=new Map(allPlayers.map(p=>[normalizePlayerName(p.name),p]));
  const incoming=new Map(snapshot.players.map(p=>[p.key||normalizePlayerName(p.name),p]));
  const changes=[];
  incoming.forEach((s,key)=>{
    const cur=current.get(key);
    if(s.active!==false&&!cur){changes.push({type:"new",name:s.name,text:`Nuovo · ${s.club} · ${s.role} · FVM ${s.fvm||0}`});return}
    if(!cur)return;
    if(s.active===false&&!cur.outOfListone){changes.push({type:"out",name:cur.name,text:"Esce dal listone ufficiale · storico preservato"});return}
    if(s.active===false)return;
    if(s.club&&s.club!==cur.club)changes.push({type:"club",name:s.name,text:`Club ${cur.club} → ${s.club}`});
    if(validMantraRole(s.role)&&s.role!==cur.role)changes.push({type:"role",name:s.name,text:`Ruolo Mantra ${cur.role} → ${s.role}`});
    if(Number(s.fvm)!==Number(cur.fvm))changes.push({type:"fvm",name:s.name,text:`FVM ${cur.fvm||0} → ${s.fvm||0}`});
    if(Number(s.quote||0)!==Number(cur.quote||0)&&Number(s.quote||0)>0)changes.push({type:"quote",name:s.name,text:`Quotazione ${cur.quote||0} → ${s.quote||0}`});
  });
  current.forEach((cur,key)=>{
    if(!cur.outOfListone&&!incoming.has(key))changes.push({type:"out",name:cur.name,text:"Non presente nel nuovo snapshot · storico preservato"});
  });
  const counts={new:0,out:0,club:0,role:0,fvm:0,quote:0};
  changes.forEach(x=>counts[x.type]=(counts[x.type]||0)+1);
  return {changes,counts};
}
function syncChangeTag(type){return ({new:"NUOVO",out:"FUORI",club:"CLUB",role:"RUOLO",fvm:"FVM",quote:"QUOTA"})[type]||type.toUpperCase()}
function openListoneSyncDialog(html){
  $("#listoneSyncDialogContent").innerHTML=html;
  const d=$("#listoneSyncDialog");if(!d.open)d.showModal();
}
function closeListoneSyncDialog(){pendingListoneSnapshot=null;if($("#listoneSyncDialog").open)$("#listoneSyncDialog").close()}
window.closeListoneSyncDialog=closeListoneSyncDialog;

async function checkListoneUpdate(){
  openListoneSyncDialog(`<div class="dialog-body listone-sync-dialog">
    <div class="listone-sync-modal-head"><div><span class="eyebrow">FANTACALCIO.IT</span><h2>Controllo listone</h2></div><button class="ghost" onclick="closeListoneSyncDialog()">✕</button></div>
    <div class="listone-sync-loading"><span class="sync-spinner"></span><b>Scarico l'ultimo snapshot validato…</b><small>Nessun dato dell'asta viene modificato durante il controllo.</small></div>
    <button class="ghost full-btn" onclick="closeListoneSyncDialog()">Annulla controllo</button>
  </div>`);
  try{
    const res=await fetch(`./listone-current.json?t=${Date.now()}`,{cache:"no-store"});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const snapshot=await res.json();
    if(snapshot?.sourceKind!=="official-fantacalcio"){
      openListoneSyncDialog(`<div class="dialog-body listone-sync-dialog">
        <div class="listone-sync-modal-head"><div><span class="eyebrow">PRIMO AVVIO</span><h2>Sync non ancora pronto</h2></div><button class="ghost" onclick="closeListoneSyncDialog()">✕</button></div>
        <div class="listone-sync-warning">⏳ Il file presente è ancora la base iniziale dell'app. Il workflow GitHub deve completare almeno un controllo ufficiale prima di poter aggiornare.</div>
        <p class="muted">La tua asta non viene toccata. Puoi continuare a usare normalmente il listone già presente e riprovare tra qualche minuto.</p>
        <button class="primary full-btn" onclick="closeListoneSyncDialog()">Chiudi</button>
      </div>`);return;
    }
    if(!syncSnapshotValid(snapshot))throw new Error(`snapshot non valido (${snapshot?.activePlayers||0} attivi, ${snapshot?.unclassified||0} senza ruolo)`);
    const diff=computeListoneChanges(snapshot);
    pendingListoneSnapshot=snapshot;
    if(!diff.changes.length){
      openListoneSyncDialog(`<div class="dialog-body listone-sync-dialog">
        <div class="listone-sync-modal-head"><div><span class="eyebrow">LISTONE UFFICIALE</span><h2>Sei già aggiornato</h2></div><button class="ghost" onclick="closeListoneSyncDialog()">✕</button></div>
        <div class="listone-sync-success-box"><b>${snapshot.activePlayers} giocatori attivi</b><span>Snapshot ${listoneSyncDateLabel(snapshot.generatedAt)}</span></div>
        <p class="muted">Non risultano differenze rispetto ai dati applicati nell'app.</p><button class="primary full-btn" onclick="closeListoneSyncDialog()">Continua</button>
      </div>`);return;
    }
    const c=diff.counts,preview=diff.changes.slice(0,24);
    openListoneSyncDialog(`<div class="dialog-body listone-sync-dialog">
      <div class="listone-sync-modal-head"><div><span class="eyebrow">LISTONE UFFICIALE</span><h2>Aggiornamento trovato</h2><small class="muted">${snapshot.activePlayers} attivi · ${listoneSyncDateLabel(snapshot.generatedAt)}</small></div><button class="ghost" onclick="closeListoneSyncDialog()">✕</button></div>
      <div class="sync-summary-grid">
        <div><strong>+${c.new||0}</strong><span>nuovi</span></div><div><strong>−${c.out||0}</strong><span>fuori</span></div>
        <div><strong>${(c.club||0)+(c.role||0)}</strong><span>club/ruoli</span></div><div><strong>${(c.fvm||0)+(c.quote||0)}</strong><span>valori</span></div>
      </div>
      <div class="sync-change-list">
        ${preview.map(x=>`<div class="sync-change-row"><span class="sync-change-tag ${x.type}">${syncChangeTag(x.type)}</span><div><b>${esc(x.name)}</b><small>${esc(x.text)}</small></div></div>`).join("")}
        ${diff.changes.length>preview.length?`<div class="muted sync-more">+ altre ${diff.changes.length-preview.length} modifiche</div>`:""}
      </div>
      <div class="sync-preserve-note">Restano intatti acquisti, Venduti, prezzi pagati, squadre, lega e MAX strategici personalizzati.</div>
      <div class="sync-dialog-actions"><button class="ghost" onclick="closeListoneSyncDialog()">Annulla</button><button class="primary" id="applyListoneSyncBtn">Aggiorna listone</button></div>
    </div>`);
    $("#applyListoneSyncBtn").onclick=applyPendingListoneUpdate;
  }catch(err){
    openListoneSyncDialog(`<div class="dialog-body listone-sync-dialog">
      <div class="listone-sync-modal-head"><div><span class="eyebrow">NESSUNA MODIFICA APPLICATA</span><h2>Controllo non riuscito</h2></div><button class="ghost" onclick="closeListoneSyncDialog()">✕</button></div>
      <div class="listone-sync-warning">${esc(err?.message||"Errore di rete")}</div>
      <p class="muted">Per sicurezza l'app mantiene l'ultimo listone valido. L'asta e le rose non vengono modificate.</p>
      <button class="primary full-btn" onclick="closeListoneSyncDialog()">Chiudi</button>
    </div>`);
  }
}
window.checkListoneUpdate=checkListoneUpdate;
function applyPendingListoneUpdate(){
  const snapshot=pendingListoneSnapshot;if(!syncSnapshotValid(snapshot))return;
  appliedListoneSync=snapshot;localStorage.setItem(LISTONE_SYNC_STORAGE,JSON.stringify(snapshot));
  allPlayers=buildAllPlayers();pendingListoneSnapshot=null;invalidateAuctionIntel();refresh();
  openListoneSyncDialog(`<div class="dialog-body listone-sync-dialog">
    <div class="listone-sync-modal-head"><div></div><button class="ghost" onclick="closeListoneSyncDialog()">✕</button></div>
    <div class="listone-sync-finished"><span>OK</span><h2>Listone aggiornato</h2><p>${snapshot.activePlayers} giocatori attivi · ${listoneSyncDateLabel(snapshot.generatedAt)}</p></div>
    <div class="listone-sync-success-box"><b>Dati asta preservati</b><span>Ricalcolati scarsità, mercato, inflazione e Auction Intelligence.</span></div>
    <button class="primary full-btn" onclick="closeListoneSyncDialog()">Continua</button>
  </div>`);
}
window.applyPendingListoneUpdate=applyPendingListoneUpdate;

function playerRow(p){
  const b=state.purchases[p.id], sold=isSold(p.id); const sig=b?signal(p,b.price):null;
  const strategic=!!p.strategic;
  return `<div class="player ${b?"bought":""} ${sold?"sold":""} ${strategic?"strategic-player":"market-player"}" data-id="${p.id}">
    <div class="player-main">
      ${kitHTML(p.club,'row',p.club)}
      <div class="player-copy">
        <h3>${playerNameHTML(p)}<button type="button" class="watch-btn ${isWatchlisted(p.id)?"active":""}" aria-label="Watchlist" onclick='event.stopPropagation();toggleWatchlist(${idArg(p.id)})'>${isWatchlisted(p.id)?"SEG":"+"}</button>
          ${p.notes&&p.notes.includes("TARGET")?'<span class="badge target">TARGET</span>':""}
          ${strategic?'<span class="badge strategic-badge">200</span>':'<span class="badge listone-badge">LISTONE</span>'}
          ${p.outOfListone?'<span class="badge out-listone-badge">FUORI LISTONE</span>':""}
        </h3>
        <div class="meta">${p.club} · ${p.role} · ${p.tier||"—"}</div>
        ${p.reparto==="ATT"&&primaryOffensiveRole(p)?`<span class="badge primary-role-badge">PRIM. ${primaryOffensiveRole(p)}</span>`:""}
        <span class="badge">FVM ${p.fvm||0}</span>
        ${strategic&&p.starter?`<span class="badge">${p.starter}</span>`:""}
        ${p.u23?'<span class="badge">U23</span>':""}${p.u21?'<span class="badge">U21</span>':""}
      </div>
    </div>
    <div>
      <div class="price">${sold?"VENDUTO":b?fmt(b.price):"MAX "+fmt(p.maxPrice)}</div>
      <div class="meta">${sold?soldMeta(p.id):b?sig.t:strategic?"strategico":"da FVM"}</div>
    </div>
  </div>`;
}
function currentClubOptions(){
  const names=Object.fromEntries(SERIES_A_CLUBS);
  const codes=[...new Set(allPlayers.filter(p=>isMarketEligiblePlayer(p)&&p.club).map(p=>String(p.club)))];
  return codes.map(code=>[code,names[code]||code]).sort((a,b)=>String(a[1]).localeCompare(String(b[1]),"it",{sensitivity:"base"}));
}
function clubDisplayAbbr(code,name){
  const clean=String(name||code||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z]/g,"");
  return (clean.slice(0,3)||String(code||"").slice(0,3)).toUpperCase();
}
function selectedClubSet(){
  return new Set(Array.isArray(state.clubFilter)?state.clubFilter.map(String):[]);
}
function playerMatchesClubFilter(p){
  const selected=selectedClubSet();
  return selected.size===0 || selected.has(String(p?.club||""));
}
function saveClubFilter(){
  localStorage.setItem("am_club_filter",JSON.stringify(Array.isArray(state.clubFilter)?state.clubFilter:[]));
}
function clubFilterButtonLabel(){
  const selected=Array.isArray(state.clubFilter)?state.clubFilter:[];
  if(!selected.length) return `<span>Squadre</span><small>Tutte</small>`;
  if(selected.length===1) return `<span>Squadre</span><small>${esc(selected[0])}</small>`;
  return `<span>Squadre</span><small>${selected.length} scelte</small>`;
}
let clubFilterDraft=[];
function renderClubFilterDialog(){
  const dialog=$("#clubFilterDialog");
  const body=$("#clubFilterDialogContent");
  if(!dialog||!body)return;
  const selected=new Set(clubFilterDraft.map(String));
  const clubs=currentClubOptions();
  body.innerHTML=`<div class="club-filter-dialog-body">
    <div class="club-filter-dialog-head">
      <div><div class="eyebrow">FILTRO GIOCATORI</div><h2>Squadre</h2><p>Seleziona una o più squadre. Il filtro si combina con ruolo, Tutti, Preferiti, Venduti e ricerca.</p></div>
      <button type="button" class="ghost club-filter-close" id="closeClubFilter" aria-label="Chiudi">Chiudi</button>
    </div>
    <button type="button" class="club-filter-all ${selected.size===0?"active":""}" id="allClubsChoice">
      <span>Tutte le squadre</span><small>${clubs.length} club</small>
    </button>
    <div class="club-filter-grid">
      ${clubs.map(([code,name])=>`<button type="button" class="club-choice ${selected.has(code)?"active":""}" data-club="${escAttr(code)}">${kitHTML(code,"sm",name)}<span><b>${esc(name)}</b><small>${esc(code)}</small></span><i>${selected.has(code)?"✓":""}</i></button>`).join("")}
    </div>
    <div class="club-filter-dialog-actions">
      <button type="button" class="ghost" id="clearClubFilter">Azzera filtro</button>
      <button type="button" class="primary" id="applyClubFilter">Applica${selected.size?` · ${selected.size}`:""}</button>
    </div>
  </div>`;
  $("#closeClubFilter").onclick=()=>dialog.close();
  $("#allClubsChoice").onclick=()=>{clubFilterDraft=[];renderClubFilterDialog();};
  $("#clearClubFilter").onclick=()=>{clubFilterDraft=[];renderClubFilterDialog();};
  [...body.querySelectorAll(".club-choice")].forEach(btn=>btn.onclick=()=>{
    const code=String(btn.dataset.club);
    const set=new Set(clubFilterDraft.map(String));
    if(set.has(code))set.delete(code);else set.add(code);
    clubFilterDraft=[...set];
    renderClubFilterDialog();
  });
  $("#applyClubFilter").onclick=()=>{
    state.clubFilter=[...clubFilterDraft];
    saveClubFilter();
    dialog.close();
    renderPlayers();
  };
}
function openClubFilter(){
  clubFilterDraft=Array.isArray(state.clubFilter)?[...state.clubFilter]:[];
  renderClubFilterDialog();
  $("#clubFilterDialog").showModal();
}
window.openClubFilter=openClubFilter;

function playerViewData(){
  const visiblePool=state.filter==="Venduti"
    ? allPlayers
    : state.poolMode==="all" ? allPlayers : currentStrategicPlayers();

  const baseFiltered=visiblePool.filter(p=>{
    const q=state.query.trim().toLowerCase();
    const okq=!q || (p.name+" "+p.club+" "+p.role+" "+(p.primaryRole||"")).toLowerCase().includes(q);
    let okr;
    if(state.filter==="Venduti"){
      okr=isSold(p.id);
    }else{
      const visibleMarket=!p.outOfListone || !!state.purchases[p.id];
      okr=visibleMarket && playerMatchesRoleFilter(p,state.filter,state.poolMode) && !isSold(p.id);
    }
    const okc=playerMatchesClubFilter(p);
    return okq&&okr&&okc;
  });

  const sorter=(a,b)=>{
    const ta=(a.notes||"").includes("TARGET")?0:1;
    const tb=(b.notes||"").includes("TARGET")?0:1;
    return ta-tb || Number(b.maxPrice||0)-Number(a.maxPrice||0) || Number(b.fvm||0)-Number(a.fvm||0);
  };

  const list=baseFiltered.slice().sort(sorter);

  let content="";
  if(ROLE_DETAIL_FILTERS.has(state.filter)){
    const role=state.filter;
    const main=list.filter(p=>isPrimaryForRole(p,role));
    const compatible=list.filter(p=>!isPrimaryForRole(p,role));
    content=`
      <div class="role-sheet-summary">
        <div><span>${role} principali</span><strong>${main.length}</strong></div>
        <div><span>${role} compatibili</span><strong>${compatible.length}</strong></div>
        <div><span>Totale opzioni</span><strong>${list.length}</strong></div>
      </div>
      <div class="role-sheet-section">
        <div class="role-sheet-head">
          <div><b>${role} principali</b><span>ruolo ${role} prioritario</span></div>
          <strong>${main.length}</strong>
        </div>
        ${main.length?main.map(playerRow).join(""):`<div class="card muted">Nessun ${role} principale.</div>`}
      </div>
      <div class="role-sheet-section">
        <div class="role-sheet-head">
          <div><b>${role} compatibili</b><span>${roleCompatibilityLabel(role)}</span></div>
          <strong>${compatible.length}</strong>
        </div>
        ${compatible.length?compatible.map(playerRow).join(""):`<div class="card muted">Nessun ${role} compatibile.</div>`}
      </div>`;
  }else{
    content=`<div>${list.map(playerRow).join("")}</div>`;
  }

  return {list,content};
}

function playerResultsInfo(list){
  return `${list.length} giocatori
    ${ROLE_DETAIL_FILTERS.has(state.filter)?" · principali + compatibili":""}
    ${state.filter==="Venduti"?" · assegnati ad altre squadre":""}
    ${state.filter==="Preferiti"?" · watchlist personale":""}
    ${state.clubFilter?.length?` · ${state.clubFilter.length===1?state.clubFilter[0]:state.clubFilter.length+" squadre"}`:""}`;
}

function updatePlayerSearchResults(){
  const data=playerViewData();
  const count=$("#playerResultsCount");
  const results=$("#playerResults");
  if(count) count.textContent=playerResultsInfo(data.list);
  if(results) results.innerHTML=data.content;
  bindPlayers();
}

function renderPlayers(){
  let roles=["Tutti","Preferiti",...roleOrder,"Venduti"];
  const data=playerViewData();

  const modePool=state.poolMode==="all"?allPlayers:currentStrategicPlayers();
  const clubModePool=modePool.filter(playerMatchesClubFilter);
  const availableModePool=clubModePool.filter(p=>isMarketEligiblePlayer(p)&&!isSold(p.id)&&!state.purchases[p.id]);
  const offensiveDist={
    W:clubModePool.filter(p=>primaryOffensiveRole(p)==="W").length,
    T:clubModePool.filter(p=>primaryOffensiveRole(p)==="T").length,
    A:clubModePool.filter(p=>primaryOffensiveRole(p)==="A").length,
    Pc:clubModePool.filter(p=>primaryOffensiveRole(p)==="Pc").length
  };

  $("#playersView").innerHTML=`
    ${listoneSyncCardHTML()}
    <div class="pool-switch">
      <button id="poolStrategic" class="${state.poolMode==="strategic"?"active":""}">
        <b>Strategici</b><span>${currentStrategicPlayers().filter(p=>!p.outOfListone).length}</span>
      </button>
      <button id="poolAll" class="${state.poolMode==="all"?"active":""}">
        <b>Tutto il listone</b><span>${allPlayers.filter(p=>!p.outOfListone).length}</span>
      </button>
    </div>

    <input class="search" id="searchInput"
      placeholder="Cerca giocatore, club o ruolo…"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      value="${state.query.replaceAll('"','&quot;')}">

    <div class="market-universe-strip">
      <span>${state.poolMode==="all"?"Universo mercato":"Shortlist strategica"}</span>
      <b>${availableModePool.length} disponibili</b>
      <b>${soldPlayers().filter(playerMatchesClubFilter).length} venduti</b>
    </div>

    ${state.poolMode==="strategic"?`
      <div class="role-redistribution">
        <span>Offensivi principali</span>
        <b>W ${offensiveDist.W}</b><b>T ${offensiveDist.T}</b><b>A ${offensiveDist.A}</b><b>Pc ${offensiveDist.Pc}</b>
      </div>`:""}

    <div class="inline-club-filter">
      <div class="inline-club-filter-head">
        <span>Squadre</span>
        <small>selezione multipla</small>
      </div>
      <div class="club-chips" aria-label="Filtro squadre Serie A">
        <button type="button" class="club-chip club-chip-all ${!state.clubFilter?.length?"active":""}" data-club="__ALL__"><span>TUT</span></button>
        ${currentClubOptions().map(([code,name])=>`<button type="button" class="club-chip ${selectedClubSet().has(code)?"active":""}" data-club="${escAttr(code)}" title="${escAttr(name)}">${kitHTML(code,"xs",name)}<span>${clubDisplayAbbr(code,name)}</span></button>`).join("")}
      </div>
    </div>

    <div class="chips role-filter-chips">
      ${roles.map(r=>{
        const poolForCount=(r==="Venduti"?allPlayers:modePool).filter(playerMatchesClubFilter);
        const count=r==="Tutti"
          ? poolForCount.filter(p=>!isSold(p.id)).length
          : r==="Preferiti"
            ? poolForCount.filter(p=>!isSold(p.id)&&isWatchlisted(p.id)).length
          : r==="Venduti"
            ? poolForCount.filter(p=>isSold(p.id)).length
            : poolForCount.filter(p=>!isSold(p.id)&&playerMatchesRoleFilter(p,r,state.poolMode)).length;
        return `<button class="chip ${state.filter===r?"active":""}" data-role="${r}">
          ${r}<small>${count}</small>
        </button>`;
      }).join("")}
    </div>

    <div id="playerResultsCount" class="muted" style="margin:8px 2px">${playerResultsInfo(data.list)}</div>
    <div id="playerResults">${data.content}</div>`;

  $("#updateListoneBtn").onclick=checkListoneUpdate;

  $("#poolStrategic").onclick=()=>{
    state.poolMode="strategic";
    localStorage.setItem("am_pool_mode","strategic");
    if(state.filter==="Venduti") state.filter="Tutti";
    renderPlayers();
  };

  $$(".club-chip").forEach(btn=>btn.onclick=()=>{
    const code=String(btn.dataset.club||"");
    if(code==="__ALL__"){
      state.clubFilter=[];
    }else{
      const selected=selectedClubSet();
      if(selected.has(code)) selected.delete(code); else selected.add(code);
      state.clubFilter=[...selected];
    }
    saveClubFilter();
    renderPlayers();
  });

  $("#poolAll").onclick=()=>{
    state.poolMode="all";
    localStorage.setItem("am_pool_mode","all");
    if(state.filter==="Venduti") state.filter="Tutti";
    renderPlayers();
  };

  /*
   * IMPORTANTE iPhone/Safari:
   * durante la digitazione NON ricreiamo #playersView e NON sostituiamo
   * #searchInput. Aggiorniamo soltanto contatore e risultati.
   * In questo modo il campo conserva il focus e la tastiera resta aperta.
   */
  $("#searchInput").addEventListener("input",e=>{
    state.query=e.target.value;
    updatePlayerSearchResults();
  });

  $$(".chip").forEach(b=>b.onclick=()=>{
    state.filter=b.dataset.role;
    renderPlayers();
  });

  bindPlayers();
}
function bindPlayers(){
  $$(".player[data-id]").forEach(el=>el.onclick=()=>openPlayer(el.dataset.id));
}
function openPlayer(id){
  const p=getPlayer(id); if(!p)return;
  const b=state.purchases[p.id],sold=isSold(p.id),strategic=!!p.strategic;
  const live=liveMaxForPlayer(p);
  $("#playerDialogContent").innerHTML=`<div class="dialog-body">
    <div class="section-title">
      <div class="player-dialog-title">${kitHTML(p.club,'dialog',p.club)}<div><div class="eyebrow">${p.club} · ${p.role} · ${strategic?"STRATEGICO":"LISTONE"}</div><h2>${playerNameHTML(p)}</h2></div></div>
      <div class="player-title-actions"><button type="button" class="watch-detail ${isWatchlisted(p.id)?"active":""}" onclick='toggleWatchlist(${idArg(p.id)})'>${isWatchlisted(p.id)?"Seguito":"Segui"}</button><button class="ghost" onclick="playerDialog.close()">✕</button></div>
    </div>
    <div class="grid">
      <div class="card metric"><span>FVM</span><strong>${p.fvm||0}</strong></div>
      <div class="card metric"><span>${strategic?"MAX iniziale":"MAX da FVM"}</span><strong>${p.maxPrice}</strong></div>
      <div class="card metric"><span>MAX LIVE</span><strong>${fmt(live.live)}</strong></div>
      <div class="card metric"><span>Inflazione</span><strong>${pctLabel(live.inflation,1)}</strong></div>
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
      <div class="line"><span>Stato mercato</span><b>${b?"MIO":sold?"VENDUTO":p.outOfListone?"FUORI LISTONE":"DISPONIBILE"}</b></div>
      ${p.syncGeneratedAt?`<div class="line"><span>Listone ufficiale</span><b>${listoneSyncDateLabel(p.syncGeneratedAt)}</b></div>`:""}
      <div class="line"><span>Scarsità live</span><b>${riskIcon(live.risk)} ${live.risk}/100 · ${live.activeComp} rivali probabili</b></div>
      ${sold?`<div class="line"><span>Assegnato a</span><b>${esc(soldTeamName(state.sold[p.id]))}</b></div>`:""}
      ${sold?`<div class="line"><span>Prezzo vendita</span><b>${Number(state.sold[p.id]?.price)>0?fmt(state.sold[p.id].price)+" cr":"—"}</b></div>`:""}
      ${p.notes?`<div class="line"><span>Note</span><b>${p.notes}</b></div>`:""}
    </div>
    <div class="dialog-actions">
      ${b
        ? `<button class="ghost" onclick='editPurchase(${idArg(p.id)})'>Modifica acquisto</button><button class="dangerbtn" onclick='removePurchase(${idArg(p.id)})'>Annulla acquisto</button>`
        : sold
          ? `<button class="ghost" onclick='editSold(${idArg(p.id)})'>Modifica vendita</button><button class="ghost" onclick='restoreSold(${idArg(p.id)})'>Ripristina mercato</button>`
          : p.outOfListone
            ? `<button class="ghost" onclick="playerDialog.close()">Chiudi</button>`
            : `<button class="primary" onclick='startPurchase(${idArg(p.id)})'>Acquista</button><button class="soldbtn" onclick='markSold(${idArg(p.id)})'>Venduto</button>`
      }
    </div>
  </div>`;
  $("#playerDialog").showModal();
}
let purchaseId=null;
let purchaseMode="new";

let soldPlayerId=null;
function openSoldDialog(id,returnContext=undefined){
  const p=getPlayer(id); if(!p || state.purchases[p.id]) return;
  actionReturnContext=returnContext===undefined?captureActionReturnContext(p.id):returnContext;
  soldPlayerId=p.id;
  const previous=state.sold[p.id]||{};
  $("#playerDialog").close();
  $("#soldTitle").textContent=(previous.price?"Modifica vendita · ":"Venduto · ")+playerNameText(p);

  const teams=opponentTeams();
  if(teams.length){
    $("#soldTeamSelect").innerHTML=teams.map(t=>`<option value="${t.id}">${t.name}</option>`).join("");
    const preferred=teams.some(t=>t.id===previous.teamId)?previous.teamId:teams[0].id;
    $("#soldTeamSelect").value=preferred;
    $("#soldTeamSelect").disabled=false;
    updateSoldEconomicNote();
  }else{
    $("#soldTeamSelect").innerHTML='<option value="">Non assegnato</option>';
    $("#soldTeamSelect").disabled=true;
    $("#soldLeagueNote").textContent="Nessuna lega creata: il giocatore sarà registrato come venduto non assegnato. Puoi creare la lega dal menu Leghe e modificarlo dopo.";
  }
  $("#soldPriceInput").value=previous.price||"";
  $("#soldDialog").showModal();
  $("#soldPriceInput").focus();
  $("#soldPriceInput").select();
}
$("#soldTeamSelect").addEventListener("change",updateSoldEconomicNote);
window.markSold=id=>openSoldDialog(id);
window.editSold=id=>openSoldDialog(id);
window.restoreSold=id=>{
  const p=getPlayer(id); id=p?p.id:id;
  const previous=state.sold[id];if(!previous)return;
  const before=captureAuctionCore();
  delete state.sold[id];saveSold();
  recordOperation("RIPRISTINA_MERCATO",`${p?.name||"Giocatore"} ripristinato al mercato`,before);
  const d=$("#playerDialog");
  if(d.open) d.close();
  refresh();
};

function cancelSoldFlow(){
  if(document.activeElement) document.activeElement.blur();
  if($("#soldDialog").open) $("#soldDialog").close();
  soldPlayerId=null;
  $("#soldPriceInput").value="";
  restoreActionReturnContext();
}
$("#cancelSold").addEventListener("click",cancelSoldFlow);
$("#soldDialog").addEventListener("cancel",e=>{
  e.preventDefault();
  cancelSoldFlow();
});

$("#soldForm").addEventListener("submit",e=>{
  e.preventDefault();
  const p=getPlayer(soldPlayerId); if(!p)return;
  const price=Number($("#soldPriceInput").value);
  if(!Number.isInteger(price)||price<1)return;
  const previous=state.sold[p.id]||{};
  const before=captureAuctionCore(),wasEdit=!!previous.price;
  const teamId=opponentTeams().length?$("#soldTeamSelect").value:"";
  const team=leagueTeamById(teamId);
  if(team){
    const isExistingAssignment=!!previous.price;
    const clubCount=teamClubCount(team,p.club,isExistingAssignment?p.id:null);
    if(clubCount>=5){alert(clubLimitMessage(team,p));return;}
    const econ=teamEconomy(team,p.id);
    if(price>econ.maxNext){alert(`${team.name} può spendere al massimo ${econ.maxNext} crediti sul prossimo giocatore, altrimenti non potrebbe completare la rosa a 1 credito.`);return;}
  }
  state.sold[p.id]={
    at:previous.at||Date.now(),
    price,
    teamId,
    leagueId:state.league?.id||""
  };
  saveSold();
  if(!wasEdit)registerBackupRelevantAssignment();
  recordOperation(wasEdit?"MODIFICA_VENDITA":"VENDUTO",wasEdit?`${p.name}: vendita aggiornata a ${price} cr · ${soldTeamName(state.sold[p.id])}`:`${p.name} → ${soldTeamName(state.sold[p.id])} · ${price} cr`,before);
  $("#soldDialog").close();
  soldPlayerId=null;
  finishAuctionActionNavigation();
});

function startPurchase(id,returnContext=undefined){
  const p=getPlayer(id);
  if(!p || isSold(p.id)) return;
  if(teamClubCount(mineTeam(),p.club)>=5){
    alert(clubLimitMessage(mineTeam(),p));
    return;
  }
  actionReturnContext=returnContext===undefined?captureActionReturnContext(p.id):returnContext;
  purchaseId=p.id;
  purchaseMode="new";
  $("#playerDialog").close();
  $("#purchaseTitle").textContent="Acquista "+playerNameText(p);
  $("#confirmPurchase").textContent="Conferma";
  $("#purchasePrice").value="";
  $("#purchaseSignal").textContent="";
  const econ=teamEconomy(mineTeam()),live=liveMaxForPlayer(p);
  $("#purchaseEconomicInfo").innerHTML=`<span>MAX possibile <b>${fmt(econ.maxNext)}</b></span><span>MAX live <b>${fmt(live.live)}</b></span>`;
  $("#purchaseDialog").showModal();
  $("#purchasePrice").focus();
}

window.editPurchase=id=>{
  const p=getPlayer(id); if(!p)return;
  actionReturnContext=captureActionReturnContext(p.id);
  purchaseId=p.id;
  purchaseMode="edit";
  const current=state.purchases[p.id];
  $("#playerDialog").close();
  $("#purchaseTitle").textContent="Modifica "+playerNameText(p);
  $("#confirmPurchase").textContent="Salva";
  $("#purchasePrice").value=current?.price ?? "";
  const s=signal(p,current?.price ?? "");
  $("#purchaseSignal").className="signal "+s.c;
  $("#purchaseSignal").textContent=s.t;
  const econ=teamEconomy(mineTeam(),p.id),live=liveMaxForPlayer(p);
  $("#purchaseEconomicInfo").innerHTML=`<span>MAX possibile <b>${fmt(econ.maxNext)}</b></span><span>MAX live <b>${fmt(live.live)}</b></span>`;
  $("#purchaseDialog").showModal();
  $("#purchasePrice").focus();
  $("#purchasePrice").select();
};
$("#purchasePrice").addEventListener("input",e=>{
  const p=getPlayer(purchaseId),s=signal(p,e.target.value);
  $("#purchaseSignal").className="signal "+s.c; $("#purchaseSignal").textContent=s.t;
});
function cancelPurchaseFlow(){
  if(document.activeElement) document.activeElement.blur();
  const dialog=$("#purchaseDialog");
  if(dialog.open) dialog.close();
  $("#purchasePrice").value="";
  $("#purchaseSignal").textContent="";
  $("#purchaseEconomicInfo").textContent="";
  purchaseId=null;
  purchaseMode="new";
  restoreActionReturnContext();
}
$("#cancelPurchase").addEventListener("click",cancelPurchaseFlow);
$("#purchaseDialog").addEventListener("cancel",e=>{
  e.preventDefault();
  cancelPurchaseFlow();
});

$("#purchaseForm").addEventListener("submit",e=>{
  e.preventDefault();
  const price=Number($("#purchasePrice").value);
  if(!Number.isInteger(price) || price < 1) return;
  const p=getPlayer(purchaseId);
  if(purchaseMode==="new" && p && teamClubCount(mineTeam(),p.club)>=5){
    alert(clubLimitMessage(mineTeam(),p));
    return;
  }
  const econ=teamEconomy(mineTeam(),purchaseMode==="edit"?purchaseId:null);
  if(price>econ.maxNext){alert(`Puoi spendere al massimo ${econ.maxNext} crediti sul prossimo giocatore, conservando 1 credito per ogni slot successivo.`);return;}
  const previous=state.purchases[purchaseId];
  const before=captureAuctionCore(),wasEdit=purchaseMode==="edit";
  state.purchases[purchaseId]={
    price,
    at: wasEdit && previous?.at ? previous.at : Date.now()
  };
  save();
  if(!wasEdit)registerBackupRelevantAssignment();
  recordOperation(wasEdit?"MODIFICA_ACQUISTO":"ACQUISTO",wasEdit?`${p?.name||"Giocatore"}: ${previous?.price||"—"} → ${price} cr`:`${p?.name||"Giocatore"} acquistato a ${price} cr`,before);
  $("#purchaseDialog").close();
  purchaseId=null;
  purchaseMode="new";
  finishAuctionActionNavigation();
});
window.removePurchase=id=>{
  const p=getPlayer(id),previous=state.purchases[id];if(!previous)return;
  const before=captureAuctionCore();
  delete state.purchases[id];save();
  recordOperation("ANNULLA_ACQUISTO",`${p?.name||"Giocatore"}: acquisto ${previous.price} cr annullato`,before);
  $("#playerDialog").close();refresh();
}

function undoLastPurchase(){
  const entries=Object.entries(state.purchases);
  if(!entries.length) return;
  const [lastId,lastData]=entries.sort((a,b)=>(b[1]?.at||0)-(a[1]?.at||0))[0];
  const p=getPlayer(lastId);
  if(!p) return;
  if(confirm(`Annullare l'ultimo acquisto?\n\n${p.name} — ${lastData.price} crediti`)){
    const before=captureAuctionCore();
    delete state.purchases[lastId];save();
    recordOperation("UNDO_ACQUISTO",`${p.name}: ultimo acquisto ${lastData.price} cr annullato`,before);
    refresh();
  }
}

function renderSquad(){
  const b=purchasedPlayers();
  const econ=teamEconomy(mineTeam());
  const byRep={POR:0,DIF:0,CEN:0,ATT:0};
  b.forEach(p=>byRep[p.reparto]+=Number(state.purchases[p.id]?.price||0));
  const quota={POR:3,DIF:8,CEN:7,ATT:7};
  const groupRows=rep=>{
    const rows=b.filter(p=>p.reparto===rep);
    if(!rows.length)return `<div class="hybrid-empty-roster"><span>＋</span><small>${rep==='ATT'?'Attaccanti ancora da acquistare':'Nessun giocatore acquistato'}</small></div>`;
    return rows.map(p=>`<button class="hybrid-roster-player ${p.outOfListone?"out-of-listone":""}" onclick='openPlayer(${idArg(p.id)})'><span><b>${playerNameHTML(p)}</b><small>${p.club} · ${p.role}${p.outOfListone?" · FUORI LISTONE":""}</small></span><strong>${fmt(state.purchases[p.id]?.price||0)} cr</strong></button>`).join("");
  };
  const counts={POR:0,DIF:0,CEN:0,ATT:0};b.forEach(p=>counts[p.reparto]++);
  const outOfListoneOwned=b.filter(p=>p.outOfListone).length;
  $("#squadView").innerHTML=`
    <div class="hybrid-page-head"><div><div class="eyebrow">La tua rosa</div><h2>Rosa Mantra</h2></div><span>25 posti</span></div>
    <div class="hybrid-squad-kpis">
      <div><span>Speso</span><b>${fmt(econ.spent)}</b></div><div><span>Residuo</span><b>${fmt(econ.remaining)}</b></div><div><span>Posti</span><b>${b.length}/25</b></div><div><span>MAX prossimo</span><b>${fmt(econ.maxNext)}</b></div>
    </div>
    <div class="hybrid-squad-reps">${["POR","DIF","CEN","ATT"].map(rep=>`<div><span>${rep}</span><b>${fmt(byRep[rep])}</b></div>`).join("")}</div>
    <div class="hybrid-squad-strategy">
      <button class="${state.strategy==='A'?'active':''}" onclick="setStrategy('A')"><i>A</i><span>Strategia nostra · A<b>4-3-1-2</b></span></button>
      <button class="${state.strategy==='B'?'active':''}" onclick="setStrategy('B')"><i>B</i><span>Alternativa · B<b>4-3-3</b></span></button>
    </div>
    ${outOfListoneOwned?`<div class="out-listone-roster-legend"><b>* Fuori listone</b><span>${outOfListoneOwned} ${outOfListoneOwned===1?"giocatore da gestire":"giocatori da gestire"} nell'asta di riparazione</span></div>`:""}
    <div class="hybrid-roster-groups">
      ${["POR","DIF","CEN","ATT"].map(rep=>`<section class="hybrid-roster-group"><div class="hybrid-roster-head"><b>${rep}</b><span>${counts[rep]}/${quota[rep]}</span></div>${groupRows(rep)}</section>`).join("")}
    </div>`;
}
function renderPlan(targetSelector="#dashboardPlanContent"){
  const target=$(targetSelector);if(!target)return;
  const bought=purchasedPlayers();
  const st=activeStrategy();
  const rec=strategyRecommendation(bought,getAuctionIntel());
  const lineup=bestLineupMatch(st,bought);
  const poolByRep={POR:0,DIF:0,CEN:0,ATT:0};
  const strategicNow=currentStrategicPlayers().filter(p=>!p.outOfListone);
  strategicNow.forEach(p=>poolByRep[p.reparto]=(poolByRep[p.reparto]||0)+1);
  const movement=strategicNow.length-poolByRep.POR;

  const roleCounts={};
  ["Por","Ds","Dc","Dd","B","E","M","C","W","T","A","Pc"].forEach(r=>{
    roleCounts[r]=allPlayers.filter(p=>roleTokens(p.role).includes(r)).length;
  });

  const budgetText=Object.values(st.budgets).map(fmt).join(" · ");

  target.innerHTML=`
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
      <div class="card metric"><span>Shortlist</span><strong>${strategicNow.length}/200</strong><span>strategici</span></div>
      <div class="card metric"><span>Portieri</span><strong>${poolByRep.POR}/24</strong><span>3 × 8</span></div>
      <div class="card metric"><span>Movimento</span><strong>${movement}/176</strong><span>shortlist</span></div>
      <div class="card metric"><span>Listone algoritmo</span><strong>${allPlayers.length}</strong><span>universo mercato</span></div>
    </div>

    <div class="section-title"><h2>Distribuzione offensivi principali</h2></div>
    <div class="card">
      <div class="line"><span>W principali</span><b>${strategicNow.filter(p=>primaryOffensiveRole(p)==="W").length}</b></div>
      <div class="line"><span>T principali</span><b>${strategicNow.filter(p=>primaryOffensiveRole(p)==="T").length}</b></div>
      <div class="line"><span>A principali</span><b>${strategicNow.filter(p=>primaryOffensiveRole(p)==="A").length}</b></div>
      <div class="line"><span>Pc principali</span><b>${strategicNow.filter(p=>primaryOffensiveRole(p)==="Pc").length}</b></div>
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
      L'indice confronta copertura dell'XI, slot offensivi distintivi, profondità, qualità e mercato residuo. Nella v1.25 aggiunge anche scarsità, inflazione e pressione prevista degli avversari sui ruoli chiave. Il bottone A/B resta sempre manuale.
    </p>`;
}
function createLeague(){
  $("#leagueNameInput").value="";
  $("#leagueSizeInput").value="8";
  $("#leagueDialog").showModal();
  $("#leagueNameInput").focus();
}
window.createLeague=createLeague;

$("#cancelLeagueCreate").addEventListener("click",()=>{
  if($("#leagueDialog").open) $("#leagueDialog").close();
});

$("#leagueForm").addEventListener("submit",e=>{
  e.preventDefault();
  const name=$("#leagueNameInput").value.trim();
  const size=Number($("#leagueSizeInput").value);
  if(!name || !Number.isInteger(size) || size<4 || size>20)return;
  if(state.league&&blockedByProtection("Creare o sostituire la struttura della lega"))return;
  const before=captureAuctionCore();
  const teams=[{id:"mine",name:"La mia squadra",isMine:true}];
  for(let i=2;i<=size;i++) teams.push({id:`team${i}`,name:`Squadra ${i}`,isMine:false});
  state.league={id:`league_${Date.now()}`,name,size,teams,createdAt:Date.now()};
  saveLeague();
  recordOperation("LEGA",`Creata lega “${name}” · ${size} squadre`,before);
  $("#leagueDialog").close();
  refresh();
  switchView("leagueView");
});

function rosterForLeagueTeam(team){
  if(team.isMine){
    return purchasedPlayers().map(p=>({p,price:Number(state.purchases[p.id]?.price||0)}));
  }
  return soldPlayers()
    .filter(p=>{
      const s=state.sold[p.id];
      return s?.teamId===team.id && (!s.leagueId || s.leagueId===state.league?.id);
    })
    .map(p=>({p,price:Number(state.sold[p.id]?.price||0)}));
}
function leagueRosterRows(items){
  if(!items.length)return '<div class="league-empty">Nessun giocatore assegnato.</div>';
  const groups=["POR","DIF","CEN","ATT"];
  return groups.map(rep=>{
    const rows=items.filter(x=>x.p.reparto===rep);
    if(!rows.length)return "";
    return `<div class="league-role-block"><b>${rep}</b>${rows.map(x=>`<div class="league-player-row ${x.p.outOfListone?"out-of-listone":""}"><span>${playerNameHTML(x.p)}<small>${x.p.role}${x.p.outOfListone?" · FUORI LISTONE":""}</small></span><strong>${x.price?fmt(x.price)+" cr":"—"}</strong></div>`).join("")}</div>`;
  }).join("");
}
function renderLeagues(){
  if(!state.league){
    $("#leagueView").innerHTML=`
      <div class="section-title"><h2>Leghe</h2></div>
      <div class="card league-empty-state">
        <h3>Nessuna lega creata</h3>
        <p class="muted">Crea la lega per assegnare i giocatori venduti, calcolare crediti residui, spesa per reparto e prevedere i moduli degli avversari.</p>
        <button id="createLeagueBtn" class="primary">＋ Crea lega</button>
      </div>`;
    $("#createLeagueBtn").onclick=createLeague;
    return;
  }

  const league=state.league;
  const intel=getAuctionIntel();
  const leader=intel.economy[0];
  const unassigned=soldPlayers().filter(p=>!state.sold[p.id]?.teamId || (state.sold[p.id]?.leagueId && state.sold[p.id]?.leagueId!==league.id));
  const assignedOutCount=league.teams.reduce((sum,team)=>sum+rosterForLeagueTeam(team).filter(x=>x.p.outOfListone).length,0);

  $("#leagueView").innerHTML=`
    <div class="section-title league-title-row">
      <div><div class="eyebrow">Lega attiva · fase ${state.auctionPhase}</div><h2>${esc(league.name)}</h2></div>
      <span class="muted">${league.size} squadre</span>
    </div>

    <div class="league-summary-grid intelligence-league-summary">
      <div class="card metric"><span>Partecipanti</span><strong>${league.size}</strong></div>
      <div class="card metric"><span>Venduti assegnati</span><strong>${soldPlayers().length-unassigned.length}</strong></div>
      <div class="card metric"><span>Inflazione</span><strong>${pctLabel(intel.overallInflation.pct,intel.overallInflation.count)}</strong></div>
      <div class="card metric"><span>Leader crediti</span><strong>${leader?fmt(leader.remaining):"—"}</strong><span>${leader?esc(leader.team.name):"—"}</span></div>
    </div>

    <details class="league-edit-details">
      <summary><span>Rinomina lega e squadre</span><small>${league.size} partecipanti</small></summary>
      <div class="card league-edit-card">
        <label>Nome lega<input id="editLeagueName" type="text" maxlength="40" value="${esc(league.name)}"></label>
        <div class="league-team-inputs">
          ${league.teams.map((t,i)=>`<label><span>${t.isMine?"Mia squadra":`Squadra ${i+1}`}</span><input class="team-name-input" data-team-id="${t.id}" maxlength="32" value="${esc(t.name)}"></label>`).join("")}
        </div>
        <div class="dialog-actions league-edit-actions"><button id="deleteLeagueBtn" class="dangerbtn">Elimina lega</button><button id="saveLeagueNamesBtn" class="primary">Salva nomi</button></div>
      </div>
    </details>

    <div class="section-title"><h2>Rose + Auction Intelligence</h2><span class="muted">tocca per aprire</span></div>
    ${assignedOutCount?`<div class="out-listone-roster-legend league-out-legend"><b>* Fuori listone</b><span>${assignedOutCount} ${assignedOutCount===1?"giocatore assegnato":"giocatori assegnati"} da gestire nelle riparazioni</span></div>`:""}
    <div class="league-rosters intelligence-rosters">
      ${league.teams.map(team=>{
        const econ=teamEconomy(team);
        const pred=intel.predictions[team.id];
        const isLeader=leader?.team.id===team.id;
        const likelyNeeds=INTEL_FAMILIES.map(f=>{
          const row=intel.demand[f.id]?.teams.find(x=>x.team.id===team.id);
          return row&&row.pressure>=.22?{f,row}:null;
        }).filter(Boolean).sort((a,b)=>b.row.pressure-a.row.pressure).slice(0,4);
        return `<details class="league-team-card intelligence-team-card ${isLeader?"credit-leader-card":""}" ${team.isMine?"open":""}>
          <summary>
            <div><b>${isLeader?"TOP ":""}${esc(team.name)}</b>${team.isMine?'<span class="mine-badge">MIA</span>':''}${isLeader?'<span class="leader-badge">LEADER CREDITI</span>':''}</div>
            <span>${econ.items.length}/25 · ${fmt(econ.remaining)} cr · MAX ${fmt(econ.maxNext)}</span>
          </summary>
          <div class="league-roster-body">
            <div class="team-economy-grid">
              <div><span>Speso</span><b>${fmt(econ.spent)}</b></div><div><span>Residuo</span><b>${fmt(econ.remaining)}</b></div><div><span>Posti</span><b>${econ.missing}</b></div><div><span>MAX prossimo</span><b>${fmt(econ.maxNext)}</b></div>
            </div>
            <div class="team-rep-spend">
              ${["POR","DIF","CEN","ATT"].map(rep=>`<div><span>${rep}</span><b>${fmt(econ.byRep[rep])}</b></div>`).join("")}
            </div>
            ${team.isMine?`<div class="team-module-box mine-module"><span>Strategia nostra</span><b>${state.strategy} · ${activeStrategy().module}</b><small>Il motore A/B resta dedicato alla nostra rosa.</small></div>`:`<div class="team-module-box">
              <span>Modulo previsto · confidenza ${Math.round((pred?.confidence||0)*100)}%</span>
              <b>${pred?.top?.module.name||"—"} · ${Math.round((pred?.top?.prob||0)*100)}%</b>
              <small>${(pred?.ranked||[]).slice(1,3).map(x=>`${x.module.name} ${Math.round(x.prob*100)}%`).join(" · ")||"Dati ancora insufficienti"}</small>
            </div>
            <div class="team-needs-box"><span>Domanda futura stimata</span><b>${likelyNeeds.length?likelyNeeds.map(x=>`${x.f.label} ${Math.round(x.row.pressure*100)}%`).join(" · "):"nessun ruolo forte ancora"}</b></div>`}
            ${leagueRosterRows(econ.items)}
          </div>
        </details>`;
      }).join("")}
    </div>

    ${unassigned.length?`<div class="section-title"><h2>Venduti non assegnati</h2><span class="muted">${unassigned.length}</span></div><div class="card">${unassigned.map(p=>`<button class="unassigned-sale" data-id="${p.id}"><span>${playerNameHTML(p)}<small>${p.club} · ${p.role}</small></span><b>${state.sold[p.id]?.price?fmt(state.sold[p.id].price)+" cr":"—"}</b></button>`).join("")}</div>`:""}
  `;

  $("#saveLeagueNamesBtn").onclick=()=>{
    const before=captureAuctionCore(),oldName=state.league.name;
    const leagueName=$("#editLeagueName").value.trim();if(leagueName)state.league.name=leagueName;
    $$(".team-name-input").forEach(inp=>{const t=leagueTeamById(inp.dataset.teamId),name=inp.value.trim();if(t&&name)t.name=name});
    saveLeague();recordOperation("LEGA",`Nomi lega/squadre aggiornati${oldName!==state.league.name?` · ${oldName} → ${state.league.name}`:""}`,before,{undoable:true,count:false});refresh();
  };
  $("#deleteLeagueBtn").onclick=()=>{
    if(blockedByProtection("Eliminare la lega"))return;
    if(!confirm(`Eliminare la lega “${state.league.name}”? I giocatori resteranno Venduti ma senza squadra assegnata.`))return;
    const before=captureAuctionCore(),leagueName=state.league.name;
    Object.values(state.sold).forEach(s=>{s.teamId="";s.leagueId=""});saveSold();state.league=null;saveLeague();
    recordOperation("ELIMINA_LEGA",`Eliminata lega “${leagueName}”`,before);refresh();
  };
  $$(".unassigned-sale").forEach(btn=>btn.onclick=()=>editSold(btn.dataset.id));
}

function renderSettings(){
  $("#settingsView").innerHTML=`<div class="section-title"><h2>Impostazioni</h2></div>
    <div class="card safety-settings-card ${state.protectedMode?"protected":""}">
      <div class="safety-settings-head"><span>${state.protectedMode?"LOCK":"OPEN"}</span><div><h3>Modalità Asta protetta</h3><p>${state.protectedMode?"Reset, import backup ed eliminazione lega sono bloccati.":"Attivala prima dell'asta per evitare operazioni distruttive accidentali."}</p></div></div>
      <button id="toggleProtectionBtn" class="${state.protectedMode?"dangerbtn":"primary"}">${state.protectedMode?"Disattiva protezione":"Attiva protezione"}</button>
      <div class="toolbar safety-settings-toolbar"><button id="openSafetyCenterBtn" class="ghost">Registro / Undo</button><button id="manualSnapshotBtn" class="ghost">Snapshot ora</button></div>
    </div>
    <div class="card" style="margin-top:10px"><h3>Watchlist</h3><p class="muted">${Object.keys(state.watchlist||{}).length} giocatori seguiti. Usa SEGUI nelle liste o in Asta Live.</p><button id="openWatchlistBtn" class="ghost">Apri watchlist</button></div>
    <div class="card" style="margin-top:10px"><h3>Privacy</h3><p class="muted">Tutti i dati dell'asta restano nel browser del dispositivo. Nessun account e nessun tracciamento.</p>
      <div class="toolbar"><button id="setPin" class="ghost">${state.pin?"Cambia PIN":"Imposta PIN"}</button>${state.pin?'<button id="removePin" class="ghost">Rimuovi PIN</button>':""}</div>
    </div>
    <div id="backupCard" class="card backup-settings-card" style="margin-top:10px"><h3>Backup</h3>
      <div class="toolbar"><button id="exportBtn" class="primary">Esporta backup</button><label class="ghost ${state.protectedMode?"disabled-control":""}" style="margin:0">Importa backup<input id="importFile" type="file" accept=".json" hidden ${state.protectedMode?"disabled":""}></label></div>
      ${state.protectedMode?'<p class="muted safety-lock-note">Import bloccato durante Asta protetta.</p>':""}
    </div>
    <div class="card" style="margin-top:10px"><h3>Report</h3><button id="finalReportBtn" class="ghost">Apri report asta</button></div>
    <div class="card" style="margin-top:10px"><h3>Reset</h3><button id="resetBtn" class="dangerbtn" ${state.protectedMode?"disabled":""}>${state.protectedMode?"Reset bloccato":"Azzera tutta l'asta"}</button></div>
    <div class="card install-note" style="margin-top:10px"><b>Installazione su iPhone</b><br>Apri il sito in Safari → Condividi → Aggiungi alla schermata Home → attiva “Apri come app” se disponibile.</div>`;
  $("#toggleProtectionBtn").onclick=toggleProtectedMode;
  $("#openSafetyCenterBtn").onclick=openSafetyCenter;
  $("#manualSnapshotBtn").onclick=()=>{createSafetySnapshot("Snapshot manuale");renderSettings()};
  $("#openWatchlistBtn").onclick=()=>{state.filter="Preferiti";switchView("playersView")};
  $("#finalReportBtn").onclick=openFinalReport;
  $("#setPin").onclick=()=>{let p=prompt("Scegli un PIN numerico (4-8 cifre):");if(/^\d{4,8}$/.test(p||"")){localStorage.setItem("am_pin",p);state.pin=p;alert("PIN salvato.");renderSettings()}};
  if($("#removePin"))$("#removePin").onclick=()=>{if(state.protectedMode&&!protectedPermission("rimuovere il PIN"))return;localStorage.removeItem("am_pin");state.pin="";renderSettings()};
  $("#resetBtn").onclick=()=>{
    if(blockedByProtection("Azzera tutta l'asta"))return;
    if(confirm("Vuoi davvero cancellare acquisti e giocatori venduti e riportare la fase asta ai POR?")){
      const before=captureAuctionCore();state.purchases={};state.sold={};state.auctionPhase="POR";save();saveSold();saveAuctionPhase();resetBackupReminderCounters();recordOperation("RESET","Asta azzerata",before);refresh();
    }
  };
  $("#exportBtn").onclick=()=>{
    const backupActionCount=getBackupActionCount();
    let blob=new Blob([JSON.stringify({version:9,purchases:state.purchases,sold:state.sold,strategy:state.strategy,poolMode:state.poolMode,league:state.league,auctionPhase:state.auctionPhase,listoneSync:appliedListoneSync,watchlist:state.watchlist,protectedMode:state.protectedMode,operationLog:state.operationLog,snapshots:state.snapshots,backupActionCount},null,2)],{type:"application/json"});
    const backupUrl=URL.createObjectURL(blob);
    let a=document.createElement("a");a.href=backupUrl;a.download="AstaMantra-backup-v9.json";document.body.appendChild(a);a.click();a.remove();
    if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
    markExternalBackupDone();
    settleIOSViewport();
    setTimeout(()=>URL.revokeObjectURL(backupUrl),1500);
  };
  $("#importFile").onchange=e=>{
    if(blockedByProtection("Importare un backup")){e.target.value="";return;}
    let f=e.target.files[0];if(!f)return;let rd=new FileReader();rd.onload=()=>{try{
      let o=JSON.parse(rd.result),before=captureAuctionCore();
      state.purchases=o.purchases||{};state.sold=o.sold||{};state.league=o.league||state.league||null;
      if(STRATEGIES[o.strategy]){state.strategy=o.strategy;localStorage.setItem("am_strategy",o.strategy)}
      if(["strategic","all"].includes(o.poolMode)){state.poolMode=o.poolMode;localStorage.setItem("am_pool_mode",o.poolMode)}
      if(AUCTION_PHASES.some(x=>x.id===o.auctionPhase)){state.auctionPhase=o.auctionPhase;saveAuctionPhase()}
      if(o.listoneSync?.schema===LISTONE_SYNC_SCHEMA&&Array.isArray(o.listoneSync.players)){appliedListoneSync=o.listoneSync;localStorage.setItem(LISTONE_SYNC_STORAGE,JSON.stringify(appliedListoneSync));allPlayers=buildAllPlayers()}
      state.watchlist=o.watchlist||{};
      if(Array.isArray(o.operationLog))state.operationLog=o.operationLog.slice(-100);
      if(Array.isArray(o.snapshots))state.snapshots=o.snapshots.slice(-8);
      const importedBackupCount=Math.max(Number(o.backupActionCount)||0,Object.keys(state.purchases||{}).length+Object.keys(state.sold||{}).length);
      localStorage.setItem(SAFETY_KEYS.backupActionCount,String(importedBackupCount));
      localStorage.setItem(SAFETY_KEYS.lastBackupActionCount,String(importedBackupCount));
      save();saveSold();saveLeague();saveSafetyState();invalidateAuctionIntel();recordOperation("IMPORT","Backup importato",before,{undoable:true,count:false});refresh();alert("Backup importato.")
    }catch{alert("File non valido.")}};rd.readAsText(f)
  };
}
function switchView(id){
  state.view=id;$$('.view').forEach(v=>v.classList.toggle("active",v.id===id));$$('.tab').forEach(t=>t.classList.toggle("active",t.dataset.view===id));
  if(id==="dashboardView")renderDashboard();
  if(id==="playersView")renderPlayers();
  if(id==="squadView")renderSquad();
  if(id==="leagueView")renderLeagues();
  if(id==="formationsView")renderFormationsView();
  if(id==="settingsView")renderSettings();
  normalizeIOSViewport();
}
$$('.tab').forEach(t=>t.onclick=()=>switchView(t.dataset.view));
$("#settingsBtn").onclick=()=>switchView("settingsView");
$("#backupAlertBtn").onclick=openBackupReminder;
function refresh(){
  renderDashboard();renderPlayers();renderSquad();renderLeagues();renderFormationsView();
  if(state.view==="settingsView")renderSettings();
  updateBackupAlert();
}


/* v1.42.2 — viewport iOS stabile.
   La barra inferiore non viene più spostata in JavaScript.
   Il contenuto scorre dentro #app; la pagina radice resta ferma. */
function normalizeIOSViewport(){
  const app=document.getElementById("app");
  const appY=app ? app.scrollTop : 0;
  window.scrollTo(0,0);
  document.documentElement.scrollTop=0;
  document.body.scrollTop=0;
  if(app && app.scrollTop!==appY)app.scrollTop=appY;
}
function settleIOSViewport(){
  [0,80,220,500].forEach(ms=>setTimeout(normalizeIOSViewport,ms));
}
window.addEventListener("pageshow",settleIOSViewport,{passive:true});
window.addEventListener("orientationchange",()=>setTimeout(settleIOSViewport,250),{passive:true});
document.addEventListener("focusout",e=>{
  if(e.target && e.target.matches && e.target.matches("input, textarea, select"))settleIOSViewport();
},{passive:true});

function lockInit(){
  if(!state.pin)return;
  $("#lock").classList.remove("hidden");$("#disablePinBtn").style.display="none";
  $("#unlockBtn").onclick=()=>{if($("#pinInput").value===state.pin)$("#lock").classList.add("hidden");else $("#lockText").textContent="PIN errato. Riprova."};
}
ensureInitialSnapshot();refresh();lockInit();maybeRefreshFormationsLive();
setInterval(()=>{if(document.visibilityState==="visible")maybeRefreshFormationsLive()},5*60*1000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")maybeRefreshFormationsLive()},{passive:true});
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js?v=1.45").catch(()=>{}));
