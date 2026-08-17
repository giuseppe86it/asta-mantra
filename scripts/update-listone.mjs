import { load } from "cheerio";

const SOURCE_URL = "https://www.fantacalcio.it/quotazioni-fantacalcio";
const CLUBS = new Set(["ATA","BOL","CAG","COM","FIO","FRO","GEN","INT","JUV","LAZ","LEC","MIL","MON","NAP","PAR","ROM","SAS","TOR","UDI","VEN"]);

function clean(s){
  return String(s || "").replace(/\s+/g," ").trim();
}
function short(s,n=260){
  const x=clean(s);
  return x.length>n ? x.slice(0,n)+"…" : x;
}
function attrs(node){
  return Object.entries(node?.attribs || {})
    .map(([k,v])=>`${k}=${JSON.stringify(String(v))}`)
    .join(" ");
}

console.log("=== ASTA MANTRA · DIAGNOSTICA LISTONE ===");
console.log("Questa esecuzione NON modifica listone-current.json.");
console.log(`Sorgente: ${SOURCE_URL}`);

const res = await fetch(SOURCE_URL, {
  headers: {
    "user-agent":"Mozilla/5.0 (compatible; AstaMantraListoneDiagnostic/1.0; +https://github.com/giuseppe86it/asta-mantra)",
    "accept-language":"it-IT,it;q=0.9,en;q=0.6"
  },
  redirect:"follow"
});

console.log(`HTTP: ${res.status} ${res.statusText}`);
if(!res.ok) throw new Error(`Fantacalcio.it HTTP ${res.status}`);

const html = await res.text();
console.log(`HTML ricevuto: ${html.length.toLocaleString("it-IT")} caratteri`);

const $ = load(html);
const tables = $("table").toArray();
const allRows = $("table tbody tr, table tr").toArray();
console.log(`Tabelle trovate: ${tables.length}`);
console.log(`Righe tabella trovate: ${allRows.length}`);

console.log("\n=== 1) PRIME RIGHE GIOCATORE RICONOSCIBILI ===");
let shown=0;
for(const tr of allRows){
  if(shown>=8) break;
  const $row=$(tr);
  const cells=$row.find("td").toArray();
  if(cells.length<7) continue;
  const texts=cells.map(td=>clean($(td).text()));
  if(!texts.some(t=>CLUBS.has(t.toUpperCase()))) continue;
  shown++;
  console.log(`\n--- RIGA ${shown} ---`);
  console.log(`TR attrs: ${attrs(tr) || "(nessuno)"}`);
  cells.forEach((td,i)=>{
    console.log(`TD[${i}] text=${JSON.stringify(short($(td).text(),120))}`);
    console.log(`TD[${i}] attrs=${attrs(td) || "(nessuno)"}`);
    const nested=$(td).find("*").toArray().slice(0,10);
    nested.forEach((node,j)=>{
      const a=attrs(node);
      if(a || clean($(node).text())){
        console.log(`  child[${j}] <${node.name}> attrs=${a || "(nessuno)"} text=${JSON.stringify(short($(node).text(),100))}`);
      }
    });
  });
}
if(!shown) console.log("Nessuna riga giocatore riconoscibile trovata.");

console.log("\n=== 2) OCCORRENZE HTML DI MANTRA / RUOLO / ROLE ===");
const probes=["mantra","ruolo","role","quotazioni","fvm"];
for(const probe of probes){
  const lower=html.toLowerCase();
  let start=0,count=0;
  console.log(`\n[${probe}]`);
  while(count<8){
    const idx=lower.indexOf(probe,start);
    if(idx<0) break;
    const from=Math.max(0,idx-180), to=Math.min(html.length,idx+360);
    console.log(`${count+1}. ${short(html.slice(from,to),520)}`);
    start=idx+probe.length;
    count++;
  }
  if(!count) console.log("Nessuna occorrenza.");
}

console.log("\n=== 3) SCRIPT E POSSIBILI ENDPOINT DATI ===");
const scriptSrcs=$("script[src]").toArray().map(x=>$(x).attr("src")).filter(Boolean);
scriptSrcs.slice(0,40).forEach((src,i)=>console.log(`script[${i+1}]: ${src}`));

const urlRegex=/(https?:\\?\/\\?\/[^\s"'<>]+|\/[^\s"'<>]*(?:api|quotaz|mantra|player|calciator)[^\s"'<>]*)/gi;
const candidates=[...new Set((html.match(urlRegex)||[]).map(x=>x.replace(/\\\//g,"/")))];
const interesting=candidates.filter(x=>/api|quotaz|mantra|player|calciator/i.test(x));
interesting.slice(0,60).forEach((u,i)=>console.log(`candidate[${i+1}]: ${short(u,500)}`));
if(!interesting.length) console.log("Nessun endpoint evidente trovato nell'HTML iniziale.");

console.log("\n=== 4) SCRIPT INLINE CHE CITANO MANTRA / RUOLO / QUOTAZIONI ===");
let inlineShown=0;
$("script:not([src])").each((_,node)=>{
  if(inlineShown>=12) return;
  const txt=$(node).html()||"";
  if(/mantra|ruol|quotaz|fvm/i.test(txt)){
    inlineShown++;
    console.log(`inline[${inlineShown}]: ${short(txt,1400)}`);
  }
});
if(!inlineShown) console.log("Nessuno script inline utile trovato.");

console.log("\n=== FINE DIAGNOSTICA ===");
console.log("Nessun file è stato modificato. Apri questo passaggio in Actions e inviami screenshot delle sezioni 1, 2 e 3.");
