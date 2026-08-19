import fs from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";

const ROOT=process.cwd();
const LISTONE_FILE=path.join(ROOT,"listone-current.json");
const YOUTH_FILE=path.join(ROOT,"youth-current.json");
const SOURCE_URL="https://www.fantacalcio.it/quotazioni-fantacalcio";
const U23_MIN_YEAR=2003;
const U21_MIN_YEAR=2005;
const MONTHS={gen:1,feb:2,mar:3,apr:4,mag:5,giu:6,lug:7,ago:8,set:9,ott:10,nov:11,dic:12};

function norm(s){
  return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"").trim();
}
function clean(s){return String(s||"").replace(/\s+/g," ").trim()}
function stripOut(s){return clean(s).replace(/\s*\*+\s*$/g,"").trim()}
function absoluteUrl(href){
  if(!href)return "";
  try{return new URL(href,SOURCE_URL).href}catch{return ""}
}
function parseBirthDate(html){
  const $=load(html);
  const text=clean($.root().text());
  const m=text.match(/Nato il\s+(\d{1,2})\s+(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-zàèéìòù]*\s+(\d{4})/i);
  if(!m)return "";
  const day=String(Number(m[1])).padStart(2,"0");
  const mon=String(MONTHS[m[2].slice(0,3).toLowerCase()]||0).padStart(2,"0");
  const year=Number(m[3]);
  if(!year || mon==="00")return "";
  return `${year}-${mon}-${day}`;
}
async function fetchText(url,{timeoutMs=12000}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(url,{
      headers:{
        "user-agent":"Mozilla/5.0 (compatible; AstaMantraYouthSync/1.0; +https://github.com/giuseppe86it/asta-mantra)",
        "accept-language":"it-IT,it;q=0.9,en;q=0.6",
        "accept":"text/html,application/xhtml+xml"
      },
      redirect:"follow",
      signal:controller.signal
    });
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }finally{clearTimeout(timer)}
}
async function loadYouthCache(){
  try{return JSON.parse(await fs.readFile(YOUTH_FILE,"utf8"))}catch{return {schema:1,players:[]}}
}
function quotationProfiles(html){
  const $=load(html),map=new Map();
  $("tr.player-row, table tbody tr, table tr").each((_,tr)=>{
    const $row=$(tr);
    const fromFilter=stripOut($row.attr("data-filter-keywords"));
    let name=fromFilter;
    let link="";
    const anchors=$row.find('a[href*="/serie-a/squadre/"]').toArray();
    for(const a of anchors){
      const href=$(a).attr("href")||"";
      const txt=stripOut($(a).text());
      if(!name && txt)name=txt;
      if(href){link=absoluteUrl(href);break;}
    }
    if(name&&link)map.set(norm(name),{name,profileUrl:link});
  });
  return map;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const listone=JSON.parse(await fs.readFile(LISTONE_FILE,"utf8"));
  if(!Array.isArray(listone.players)||listone.players.length<450)throw new Error("listone-current.json non valido");

  const oldCache=await loadYouthCache();
  const cached=new Map((oldCache.players||[]).map(p=>[p.key||norm(p.name),p]));
  const quoteHtml=await fetchText(SOURCE_URL,{timeoutMs:16000});
  const profiles=quotationProfiles(quoteHtml);
  if(profiles.size<450)throw new Error(`Profili Fantacalcio individuati solo per ${profiles.size} giocatori`);

  const records=new Map();
  for(const p of listone.players){
    const key=p.key||norm(p.name);
    const old=cached.get(key)||{};
    const profile=profiles.get(key)||{};
    records.set(key,{
      key,
      name:p.name||old.name||profile.name||key,
      profileUrl:profile.profileUrl||old.profileUrl||p.profileUrl||"",
      birthDate:p.birthDate||old.birthDate||"",
      checkedAt:old.checkedAt||""
    });
  }
  // Mantieni anche gli storici non più nel listone.
  for(const [key,old] of cached){if(!records.has(key))records.set(key,old)}

  const missing=[...records.values()].filter(r=>!/^\d{4}-\d{2}-\d{2}$/.test(r.birthDate||"")&&r.profileUrl);
  let cursor=0,found=0,failed=0;
  const workers=Array.from({length:3},async()=>{
    while(true){
      const i=cursor++;
      if(i>=missing.length)return;
      const r=missing[i];
      try{
        let birth="";
        for(let attempt=0;attempt<2&&!birth;attempt++){
          try{birth=parseBirthDate(await fetchText(r.profileUrl));}
          catch(err){if(attempt===1)throw err;await sleep(600);}
        }
        if(birth){r.birthDate=birth;r.checkedAt=new Date().toISOString();found++;}
        else failed++;
      }catch(err){
        failed++;
        console.warn(`DOB non letto: ${r.name} · ${String(err?.message||err)}`);
      }
      await sleep(350);
    }
  });
  await Promise.all(workers);

  const byKey=records;
  let withBirth=0,u23=0,u21=0;
  listone.players=listone.players.map(p=>{
    const key=p.key||norm(p.name),r=byKey.get(key)||{};
    const birthDate=/^\d{4}-\d{2}-\d{2}$/.test(r.birthDate||"")?r.birthDate:"";
    const birthYear=birthDate?Number(birthDate.slice(0,4)):0;
    if(birthYear){withBirth++;if(birthYear>=U23_MIN_YEAR)u23++;if(birthYear>=U21_MIN_YEAR)u21++;}
    return {...p,profileUrl:r.profileUrl||p.profileUrl||"",birthDate,birthYear:birthYear||undefined};
  });
  listone.youthMeta={sourceName:"Fantacalcio.it · profili calciatori",generatedAt:new Date().toISOString(),birthDateCoverage:withBirth,u23MinBirthYear:U23_MIN_YEAR,u21MinBirthYear:U21_MIN_YEAR};

  const cachePlayers=[...records.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name),"it"));
  const youth={schema:1,sourceName:"Fantacalcio.it · profili calciatori",sourceUrl:SOURCE_URL,generatedAt:new Date().toISOString(),u23MinBirthYear:U23_MIN_YEAR,u21MinBirthYear:U21_MIN_YEAR,players:cachePlayers};

  await fs.writeFile(LISTONE_FILE,JSON.stringify(listone,null,2));
  await fs.writeFile(YOUTH_FILE,JSON.stringify(youth,null,2));
  console.log(`OK giovani: ${withBirth}/${listone.players.length} date di nascita · U23 ${u23} · U21 ${u21} · nuove ${found} · non lette ${failed}`);
}

await main();
