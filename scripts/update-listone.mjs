import fs from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";

const ROOT = process.cwd();
const OUT_FILE = path.join(ROOT, "listone-current.json");
const SOURCE_URL = "https://www.fantacalcio.it/quotazioni-fantacalcio";
const CLUBS = new Set(["ATA","BOL","CAG","COM","FIO","FRO","GEN","INT","JUV","LAZ","LEC","MIL","MON","NAP","PAR","ROM","SAS","TOR","UDI","VEN"]);
const MANTRA_TOKENS = ["Por","Dd","Ds","Dc","Pc","B","E","M","C","W","T","A"];
const ROLE_RE = /^(Por|Dd|Ds|Dc|B|E|M|C|W|T|A|Pc)(\/(Por|Dd|Ds|Dc|B|E|M|C|W|T|A|Pc))*$/;

function norm(s){
  return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"").trim();
}
function clean(s){return String(s||"").replace(/\s+/g," ").trim()}
function num(s){
  const n=Number(String(s||"").replace(",",".").replace(/[^\d.-]/g,""));
  return Number.isFinite(n)?n:null;
}
function validRole(r){return ROLE_RE.test(String(r||""))}
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
function exactRoleFromText(raw){
  const x=clean(raw).replace(/\s+/g,"").replace(/[|,;+-]+/g,"/");
  if(validRole(x))return x;
  return "";
}
function roleFromAttr(raw){
  const s=String(raw||"");
  const direct=exactRoleFromText(s);
  if(direct)return direct;
  const lower=s.toLowerCase();
  const parts=[];
  for(const token of MANTRA_TOKENS){
    const tl=token.toLowerCase();
    const escaped=tl.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const semantic=new RegExp(`(?:role|ruolo|mantra)[_\\-/: ]*${escaped}(?:\\b|[_\\-/:])`,"i");
    if(semantic.test(lower))parts.push(token);
  }
  if(parts.length){
    const unique=[...new Set(parts)];
    const candidate=unique.join("/");
    if(validRole(candidate))return candidate;
  }
  return "";
}
function candidateScore(role, cellIndex){
  let s=0;
  if(role.includes("/"))s+=20;
  if(role.split("/").some(x=>!["C","A"].includes(x)))s+=10;
  s+=Math.min(3,cellIndex);
  return s;
}
function extractRole($, cells){
  const found=[];
  const inspect=Math.min(4,cells.length);
  for(let i=0;i<inspect;i++){
    const el=$(cells[i]);
    const txt=exactRoleFromText(el.text());
    if(txt)found.push({role:txt,score:candidateScore(txt,i),origin:"cell-text"});
    el.find("*").addBack().each((_,node)=>{
      const attrs=node.attribs||{};
      for(const [k,v] of Object.entries(attrs)){
        if(!["title","alt","aria-label","data-role","data-roles","data-ruolo","class","src","href"].includes(k))continue;
        const rr=roleFromAttr(v);
        if(rr)found.push({role:rr,score:candidateScore(rr,i)+(k.startsWith("data-")||k==="title"||k==="aria-label"?5:0),origin:k});
      }
    });
  }
  found.sort((a,b)=>b.score-a.score);
  return found[0]||null;
}
function extractClassic($, cells){
  for(let i=0;i<Math.min(3,cells.length);i++){
    const txt=clean($(cells[i]).text()).toUpperCase();
    if(["P","D","C","A"].includes(txt))return txt;
  }
  return "";
}
function extractPlayerName($row, cells, $){
  const anchors=$row.find("a").toArray()
    .map(a=>clean($(a).text()))
    .filter(x=>x && !CLUBS.has(x.toUpperCase()) && !/^\d+(?:[.,]\d+)?$/.test(x));
  if(anchors.length){
    anchors.sort((a,b)=>b.length-a.length);
    return anchors[0];
  }
  for(const td of cells){
    const t=clean($(td).text());
    if(!t || CLUBS.has(t.toUpperCase()) || /^\d+(?:[.,]\d+)?$/.test(t))continue;
    if(exactRoleFromText(t))continue;
    if(t.length>=2 && /[A-Za-zÀ-ÿ]/.test(t))return t;
  }
  return "";
}
function parseRows(html, previous){
  const $=load(html);
  const prevByKey=new Map((previous?.players||[]).map(p=>[p.key||norm(p.name),p]));
  const rows=[];

  $("table tbody tr, table tr").each((_,tr)=>{
    const $row=$(tr);
    const cells=$row.find("td").toArray();
    if(cells.length<7)return;

    const name=extractPlayerName($row,cells,$);
    if(!name || /calciatore/i.test(name))return;

    let club="";
    for(const td of cells){
      const t=clean($(td).text()).toUpperCase();
      if(CLUBS.has(t)){club=t;break}
    }
    if(!club)return;

    const numeric=cells.map(td=>num(clean($(td).text()))).filter(v=>v!==null);
    if(numeric.length<6)return;
    const last=numeric.slice(-6);
    const [qiClassic,qaClassic,fvmClassic,qiMantra,qaMantra,fvmMantra]=last;

    const key=norm(name);
    const prev=prevByKey.get(key);
    const roleHit=extractRole($,cells);
    const role=roleHit?.role || (validRole(prev?.role)?prev.role:"");
    const classic=extractClassic($,cells) || prev?.classic || "";
    const reparto=prev?.reparto || inferReparto(role,classic);

    rows.push({
      id:prev?.id ?? `fc_${key}`,
      key,name,club,role:role || "?",reparto,classic,
      quote:Number(qaMantra||0),fvm:Number(fvmMantra||0),
      strategic:!!prev?.strategic,active:true,
      roleOrigin:roleHit?"official-page":"previous",
      qiClassic,qaClassic,fvmClassic,qiMantra,qaMantra,fvmMantra
    });
  });

  const map=new Map();
  for(const row of rows)map.set(row.key,row);
  return [...map.values()];
}
async function readSource(){
  if(process.env.FC_SOURCE_FILE){
    return fs.readFile(path.resolve(process.env.FC_SOURCE_FILE),"utf8");
  }
  const res=await fetch(SOURCE_URL,{
    headers:{
      "user-agent":"Mozilla/5.0 (compatible; AstaMantraListoneSync/1.0; +https://github.com/giuseppe86it/asta-mantra)",
      "accept-language":"it-IT,it;q=0.9,en;q=0.6"
    },
    redirect:"follow"
  });
  if(!res.ok)throw new Error(`Fantacalcio.it HTTP ${res.status}`);
  return res.text();
}

const previous=JSON.parse(await fs.readFile(OUT_FILE,"utf8"));
const html=await readSource();
const active=parseRows(html,previous);

if(active.length<450){
  throw new Error(`Validazione fallita: trovati solo ${active.length} giocatori (minimo 450). Il vecchio snapshot resta intatto.`);
}
const teams=new Set(active.map(p=>p.club));
if(teams.size<18){
  throw new Error(`Validazione fallita: trovate solo ${teams.size} squadre.`);
}
const roleParsed=active.filter(p=>p.roleOrigin==="official-page" && validRole(p.role)).length;
const roleCoverage=roleParsed/active.length;
if(roleCoverage<0.80){
  throw new Error(`Validazione ruoli fallita: ruoli letti direttamente dalla pagina ${(roleCoverage*100).toFixed(1)}% (minimo 80%). Il vecchio snapshot resta intatto.`);
}
const unclassified=active.filter(p=>!validRole(p.role)).length;
if(unclassified>0){
  throw new Error(`Validazione fallita: ${unclassified} giocatori senza ruolo Mantra riconosciuto. Il vecchio snapshot resta intatto.`);
}

const activeByKey=new Map(active.map(p=>[p.key,p]));
const retired=(previous.players||[])
  .filter(p=>p.active!==false && !activeByKey.has(p.key||norm(p.name)))
  .map(p=>({...p,active:false}));
const olderRetired=(previous.players||[])
  .filter(p=>p.active===false && !activeByKey.has(p.key||norm(p.name)))
  .filter(p=>!retired.some(x=>(x.key||norm(x.name))===(p.key||norm(p.name))));

const players=[...active,...retired,...olderRetired];
const snapshot={
  schema:1,complete:true,sourceKind:"official-fantacalcio",
  sourceName:"Fantacalcio.it · Quotazioni e FVM 2026/27",
  sourceUrl:SOURCE_URL,generatedAt:new Date().toISOString(),
  activePlayers:active.length,totalPlayers:players.length,
  roleParsedCount:roleParsed,unclassified,players
};

const tmp=OUT_FILE+".tmp";
await fs.writeFile(tmp,JSON.stringify(snapshot,null,2));
await fs.rename(tmp,OUT_FILE);
console.log(`OK: ${active.length} attivi · ${retired.length} usciti · ${roleParsed} ruoli letti dalla pagina · ${teams.size} club`);
