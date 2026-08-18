import fs from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";

const ROOT = process.cwd();
const OUT_FILE = path.join(ROOT, "listone-current.json");
const SOURCE_URL = "https://www.fantacalcio.it/quotazioni-fantacalcio";
const ROLE_RE = /^(Por|Dd|Ds|Dc|B|E|M|C|W|T|A|Pc)(\/(Por|Dd|Ds|Dc|B|E|M|C|W|T|A|Pc))*$/;
const ROLE_CANON = Object.freeze({
  por:"Por", dd:"Dd", ds:"Ds", dc:"Dc", b:"B", e:"E", m:"M", c:"C", w:"W", t:"T", a:"A", pc:"Pc"
});

function norm(s){
  return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"").trim();
}
function clean(s){ return String(s||"").replace(/\s+/g," ").trim(); }
function num(s){
  const n=Number(String(s||"").replace(",",".").replace(/[^\d.-]/g,""));
  return Number.isFinite(n)?n:null;
}
function validRole(r){ return ROLE_RE.test(String(r||"")); }
function escapeRe(s){ return String(s||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }

function inferReparto(role, classic=""){
  const c=String(classic||"").trim().toUpperCase();
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

// Il ruolo Mantra viene letto dal dato ufficiale sulla riga giocatore,
// es. data-filter-role-mantra="pc" o "w;a".
function roleFromMantraAttr(raw){
  const parts=String(raw||"")
    .toLowerCase()
    .trim()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map(x=>ROLE_CANON[x])
    .filter(Boolean);
  const unique=[...new Set(parts)];
  const role=unique.join("/");
  return validRole(role)?role:"";
}

function classicFromAttr(raw){
  const x=String(raw||"").trim().toUpperCase();
  return ["P","D","C","A"].includes(x)?x:"";
}

function stripOfficialOutMarker(raw){
  return clean(raw).replace(/\s*\*+\s*$/g,"").trim();
}

function rowName($row,$){
  // Dato stabile della pagina Fantacalcio.
  const fromFilter=stripOfficialOutMarker($row.attr("data-filter-keywords"));
  if(fromFilter)return fromFilter;

  // Fallback prudenziale sul link del calciatore.
  const anchors=$row.find("a").toArray()
    .map(a=>stripOfficialOutMarker($(a).text()))
    .filter(x=>x && !/^\d+(?:[.,]\d+)?$/.test(x));
  if(anchors.length){
    anchors.sort((a,b)=>b.length-a.length);
    return anchors[0];
  }
  return "";
}

function rowClub($row,$){
  const direct=clean($row.find('[data-col-key="sq"], .player-team').first().text()).toUpperCase();
  if(/^[A-Z]{3}$/.test(direct))return direct;
  return "";
}

function colNum($row,$,key){
  const el=$row.find(`[data-col-key="${key}"]`).first();
  if(!el.length)return null;
  return num(clean(el.text()));
}

function rowPrices($row,$){
  const direct={
    qiClassic:colNum($row,$,"c_qi"),
    qaClassic:colNum($row,$,"c_qa"),
    fvmClassic:colNum($row,$,"c_fvm"),
    qiMantra:colNum($row,$,"m_qi"),
    qaMantra:colNum($row,$,"m_qa"),
    fvmMantra:colNum($row,$,"m_fvm")
  };
  if(Object.values(direct).every(v=>v!==null))return direct;

  // Fallback compatibile con il vecchio markup: ultime 6 celle numeriche.
  const cells=$row.find("td").toArray();
  const numeric=cells.map(td=>num(clean($(td).text()))).filter(v=>v!==null);
  if(numeric.length<6)return null;
  const [qiClassic,qaClassic,fvmClassic,qiMantra,qaMantra,fvmMantra]=numeric.slice(-6);
  return {qiClassic,qaClassic,fvmClassic,qiMantra,qaMantra,fvmMantra};
}

function rowHasOfficialOutMarker($row,name){
  // Fantacalcio mantiene in tabella i giocatori usciti e mostra "Nome *".
  const filterRaw=clean($row.attr("data-filter-keywords"));
  if(/\*\s*$/.test(filterRaw))return true;

  const rowText=clean($row.text());
  if(!name || !rowText)return false;
  return new RegExp(`${escapeRe(name)}\\s*\\*`,"i").test(rowText);
}

function parseRows(html,previous){
  const $=load(html);
  const prevByKey=new Map((previous?.players||[]).map(p=>[p.key||norm(p.name),p]));
  const rows=[];
  const unknownRoleAttrs=new Set();

  $("tr.player-row, table tbody tr, table tr").each((_,tr)=>{
    const $row=$(tr);
    // Evita righe non-giocatore e duplicati del selettore multiplo.
    if(!$row.is("tr.player-row") && $row.attr("data-index")==null)return;

    const name=rowName($row,$);
    const club=rowClub($row,$);
    if(!name || !club || /calciatore/i.test(name))return;

    const prices=rowPrices($row,$);
    if(!prices)return;

    const key=norm(name);
    const prev=prevByKey.get(key);

    const rawMantra=$row.attr("data-filter-role-mantra") || "";
    const officialRole=roleFromMantraAttr(rawMantra);
    if(rawMantra && !officialRole)unknownRoleAttrs.add(rawMantra);

    const role=officialRole || (validRole(prev?.role)?prev.role:"");
    const classic=classicFromAttr($row.attr("data-filter-role-classic")) || prev?.classic || "";
    const reparto=prev?.reparto || inferReparto(role,classic);
    const outMarker=rowHasOfficialOutMarker($row,name);

    rows.push({
      id:prev?.id ?? `fc_${key}`,
      key,name,club,
      role:role || "?",
      reparto,classic,
      quote:Number(prices.qaMantra||0),
      fvm:Number(prices.fvmMantra||0),
      strategic:!!prev?.strategic,
      active:!outMarker,
      officialOutMarker:outMarker,
      roleOrigin:officialRole?"official-row-attribute":"previous",
      ...prices
    });
  });

  const map=new Map();
  for(const row of rows)map.set(row.key,row);
  return {players:[...map.values()],unknownRoleAttrs:[...unknownRoleAttrs]};
}

async function readSource(){
  if(process.env.FC_SOURCE_FILE){
    return fs.readFile(path.resolve(process.env.FC_SOURCE_FILE),"utf8");
  }
  const res=await fetch(SOURCE_URL,{
    headers:{
      "user-agent":"Mozilla/5.0 (compatible; AstaMantraListoneSync/1.2; +https://github.com/giuseppe86it/asta-mantra)",
      "accept-language":"it-IT,it;q=0.9,en;q=0.6",
      "accept":"text/html,application/xhtml+xml"
    },
    redirect:"follow"
  });
  if(!res.ok)throw new Error(`Fantacalcio.it HTTP ${res.status}`);
  return res.text();
}

const previous=JSON.parse(await fs.readFile(OUT_FILE,"utf8"));
const html=await readSource();
const parsed=parseRows(html,previous);
const active=parsed.players.filter(p=>p.active!==false);
const markedRetired=parsed.players.filter(p=>p.active===false);

// Sicurezze: se cambia pesantemente il markup, NON sovrascrivere il vecchio snapshot.
if(parsed.players.length<500){
  throw new Error(`Validazione fallita: trovate solo ${parsed.players.length} righe giocatore (minimo 500). Il vecchio snapshot resta intatto.`);
}
if(active.length<450){
  throw new Error(`Validazione fallita: trovati solo ${active.length} giocatori attivi (minimo 450). Il vecchio snapshot resta intatto.`);
}
const teams=new Set(active.map(p=>p.club));
if(teams.size<18){
  throw new Error(`Validazione fallita: trovate solo ${teams.size} squadre. Il vecchio snapshot resta intatto.`);
}
const roleParsed=active.filter(p=>p.roleOrigin==="official-row-attribute" && validRole(p.role)).length;
const roleCoverage=roleParsed/active.length;
if(roleCoverage<0.80){
  const extra=parsed.unknownRoleAttrs.length?` Valori ruolo non riconosciuti: ${parsed.unknownRoleAttrs.slice(0,12).join(", ")}`:"";
  throw new Error(`Validazione ruoli fallita: ruoli letti direttamente dalla pagina ${(roleCoverage*100).toFixed(1)}% (minimo 80%).${extra} Il vecchio snapshot resta intatto.`);
}
const unclassified=active.filter(p=>!validRole(p.role)).length;
if(unclassified>0){
  const examples=active.filter(p=>!validRole(p.role)).slice(0,10).map(p=>p.name).join(", ");
  throw new Error(`Validazione fallita: ${unclassified} giocatori senza ruolo Mantra riconosciuto${examples?` (${examples})`:""}. Il vecchio snapshot resta intatto.`);
}

// I giocatori con * restano nello snapshot ma active:false.
// Anche chi sparisce del tutto dalla pagina viene preservato come storico fuori listone.
const parsedByKey=new Map(parsed.players.map(p=>[p.key,p]));
const retiredByKey=new Map(markedRetired.map(p=>[p.key,p]));
for(const p of (previous.players||[])){
  const key=p.key||norm(p.name);
  if(parsedByKey.has(key))continue;
  retiredByKey.set(key,{...p,key,active:false,officialOutMarker:!!p.officialOutMarker});
}

const retired=[...retiredByKey.values()];
const players=[...active,...retired];
const snapshot={
  schema:1,
  complete:true,
  sourceKind:"official-fantacalcio",
  sourceName:"Fantacalcio.it · Quotazioni e FVM 2026/27",
  sourceUrl:SOURCE_URL,
  generatedAt:new Date().toISOString(),
  activePlayers:active.length,
  totalPlayers:players.length,
  roleParsedCount:roleParsed,
  unclassified,
  players
};

const tmp=OUT_FILE+".tmp";
await fs.writeFile(tmp,JSON.stringify(snapshot,null,2));
await fs.rename(tmp,OUT_FILE);
console.log(`OK: ${active.length} attivi · ${retired.length} fuori listone · ${roleParsed} ruoli Mantra letti dalla pagina · ${teams.size} club`);
