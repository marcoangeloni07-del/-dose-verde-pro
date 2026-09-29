const dns = require('dns').promises;
const net = require('net');

function privateIp(ip){
  if(net.isIP(ip)===4){
    const p=ip.split('.').map(Number);
    return p[0]===10 || p[0]===127 || (p[0]===169&&p[1]===254) ||
      (p[0]===172&&p[1]>=16&&p[1]<=31) || (p[0]===192&&p[1]===168);
  }
  if(net.isIP(ip)===6){
    const s=ip.toLowerCase();
    return s==='::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
  }
  return true;
}
function cleanUrl(raw){
  let s=String(raw||'').trim();
  const md=s.match(/^\[[^\]]*\]\((https?:\/\/.+)\)$/i);
  if(md) s=md[1];
  s=s.replace(/^[<"'`]+|[>"'`]+$/g,'').trim();
  if(/^www\./i.test(s)) s='https://'+s;
  if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && /^[^\s/]+\.[^\s]+/i.test(s)) s='https://'+s;

  let u;
  try{u=new URL(s);}
  catch(e){throw new Error('URL non valido. Incolla il collegamento completo che inizia con https://');}

  if(/(^|\.)google\./i.test(u.hostname) || /(^|\.)bing\.com$/i.test(u.hostname)){
    const nested=u.searchParams.get('url') || u.searchParams.get('q') || u.searchParams.get('u');
    if(nested && /^https?:\/\//i.test(nested)){
      try{u=new URL(nested);}catch(e){}
    }
  }
  return u;
}
async function safeUrl(raw){
  const u=cleanUrl(raw);
  if(!['http:','https:'].includes(u.protocol)) throw new Error('Sono ammessi solo indirizzi http/https.');
  const hosts=await dns.lookup(u.hostname,{all:true});
  if(!hosts.length || hosts.some(x=>privateIp(x.address))) throw new Error('Host non consentito');
  return u;
}
function stripHtml(s){
  return String(s||'')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&')
    .replace(/\s+/g,' ').trim();
}
function n(v){return Number(String(v).replace(',','.'))}
function cleanContext(s){return String(s||'').replace(/\s+/g,' ').trim()}

function splitSentences(text){
  return cleanContext(text).split(/(?<=[.!?;])\s+|\s+(?=(?:ATTENZIONE|AVVERTENZE|IMPIEGHI|MODALITÀ|DOSI|COLTURE|INTERVALLO)\b)/i)
    .map(cleanContext).filter(x=>x.length>=15 && x.length<=700);
}
function uniqStrings(arr,limit=12){
  const seen=new Set(),out=[];
  for(const x0 of arr){
    const x=cleanContext(x0);
    const k=x.toLowerCase();
    if(!x || seen.has(k))continue;
    seen.add(k);out.push(x);
    if(out.length>=limit)break;
  }
  return out;
}
function extractLabelDetails(text){
  const sentences=splitSentences(text);
  const pick=(re,n=10)=>uniqStrings(sentences.filter(x=>re.test(x)),n);
  const crops=pick(/\b(coltur\w*|vite|melo|pero|pesco|albicocc\w*|susino|cilieg\w*|agrum\w*|olivo|pomodor\w*|melanz\w*|peperon\w*|patat\w*|lattug\w*|cavol\w*|ortic\w*|fruttif\w*|cereal\w*|mais|riso|soia|girasol\w*|prat\w*|tappet\w*|ornamental\w*|arbust\w*|alber\w*|floricol\w*|viva\w*|siepi?)\b/i,16);
  const targets=pick(/\b(contro|bersagli?\w*|afid\w*|aleurod\w*|tripid\w*|coccinigl\w*|acar\w*|insett\w*|larv\w*|minator\w*|oidio|peronospor\w*|ticchiol\w*|ruggin\w*|fung\w*|infestant\w*|malerb\w*|patogen\w*|nematod\w*|lumach\w*|limacc\w*)\b/i,16);
  const purposes=pick(/\b(per il controllo|per la lotta|per contenere|per prevenire|azione|funzione|finalit\w*|impieg\w*|trattament\w*)\b/i,12);
  const maxTreatments=pick(/\b(numero massimo|max(?:\.|imo)?\s*(?:di)?\s*\d*\s*tratt\w*|non più di\s*\d+\s*tratt\w*|massimo\s*\d+\s*(?:applic\w*|tratt\w*))\b/i,8);
  const intervals=pick(/\b(intervallo|intervalli|giorni\s+tra|ogni\s+\d+\s+giorni|ripetere\s+dopo|cadenza)\b/i,8);
  const limitations=pick(/\b(non applicare|non trattare|non usare|non impiegare|evitare|limitaz|restrizion|carenza|tempo di carenza|prima della raccolta)\b/i,12);
  const warnings=pick(/\b(avvertenz\w*|attenzione|pericolo|dpi|protezion\w*|api\b|alvear\w*|acque superficiali|deriva|vento|pioggia|temperatur\w*|fitotoss\w*)\b/i,12);
  const summaryCandidates=uniqStrings([
    ...pick(/\b(impieg\w*|modalit\w*|dose|dosi|dosaggio|trattament\w*|applic\w*)\b/i,6),
    ...crops.slice(0,2),...targets.slice(0,2)
  ],8);
  return {
    summary:summaryCandidates.join(' ').slice(0,1800),
    crops,targets,purposes,maxTreatments,intervals,limitations,warnings
  };
}
function scenarioMeta(context,scenario){
  const d=extractLabelDetails(context);
  return {
    crop:d.crops[0]||scenario||'',
    target:d.targets[0]||'',
    purpose:d.purposes[0]||'',
    details:d
  };
}

function detectScenario(context){
  const lc=context.toLowerCase();

  if(/(?:1°|1º|primo)\s*anno|anno\s+di\s+impianto|nuov[oi]\s+impiant/.test(lc))
    return "1° anno d'impianto";

  if(/dal\s+(?:2°|2º|secondo)\s+anno|a\s+partire\s+dal\s+(?:2°|2º|secondo)\s+anno|anni?\s+successiv/.test(lc))
    return 'Dal 2° anno';

  if(/tappet[io]\s+erbos|prat[oi]|turf/.test(lc))
    return 'Tappeti erbosi';

  if(/camp[io]\s+sportiv|campo\s+da\s+golf|golf/.test(lc))
    return 'Tappeti erbosi sportivi';

  if(/ornamental|aree\s+verdi|verde\s+pubblico/.test(lc))
    return 'Aree ornamentali';

  // Short meaningful phrase before the dosage, when available.
  const bits=context.split(/[.;:]/).map(x=>cleanContext(x)).filter(Boolean);
  const candidate=bits.find(x=>/prat|tappet|anno|impiant|ornamental|sportiv|golf/i.test(x));
  if(candidate) return candidate.slice(0,90);

  return '';
}

function normalizeUnit(unit,area,min,max){
  const u=unit.toLowerCase();
  const a=area.toLowerCase();
  return {unit:u,area:a,min,max};
}

function findCandidates(text){
  const compact=cleanContext(text);
  const dose=[],water=[];

  function addItem(m,min,max,unit,basis,pos,ctx){
    const lc=ctx.toLowerCase();
    const item={
      min,max,unit:unit.toLowerCase(),area:basis.toLowerCase(),basis:basis.toLowerCase(),
      label:(min===max?String(min):min+'–'+max)+' '+unit+'/'+basis,
      context:ctx.slice(0,500),pos,
      scenario:detectScenario(ctx)
    };
    const waterWords=/volume\s*(?:d['’]acqua|acqua)|acqua|miscela|bagnatura|diluizione|irrorazione/.test(lc);
    const isArea=/ha|ettar|100\s*(?:m²|m2|mq)/i.test(basis);
    if(waterWords && isArea && (item.unit==='l'||item.unit==='litri') && item.min>=20){
      water.push(item);
    }else{
      dose.push(item);
    }
  }

  // Area, water, plant and linear-meter bases.
  const re=/(\d+(?:[.,]\d+)?)\s*(?:(?:-|–|—|÷|\ba\b|\bfino\s+a\b)\s*(\d+(?:[.,]\d+)?))?\s*(ml|l|litri|kg|g)\s*(?:\/|per)\s*(ha|ettaro|ettari|1000\s*(?:m²|m2|mq)|100\s*(?:m²|m2|mq)|m²|m2|mq|metro\s+quadrato|metri\s+quadrati|100\s*l(?:itri)?|10\s*l(?:itri)?|l(?:itro|itri)?\s*(?:d['’]acqua|acqua)?|pianta|piante|esemplare|esemplari|albero|alberi|arbusto|arbusti|vaso|vasi|m(?:etro|etri)?\s*(?:lineare|lineari)?)/gi;

  let m;
  while((m=re.exec(compact))!==null){
    const min=n(m[1]),max=m[2]?n(m[2]):min;
    const before=compact.slice(Math.max(0,m.index-240),m.index);
    const after=compact.slice(re.lastIndex,Math.min(compact.length,re.lastIndex+240));
    const ctx=cleanContext(before+' '+m[0]+' '+after);
    addItem(m,min,max,m[3],m[4],m.index,ctx);
  }

  function uniq(arr){
    const seen=new Set();
    return arr.filter(x=>{
      const k=[x.min,x.max,x.unit,x.area,x.scenario].join('|');
      if(seen.has(k))return false;
      seen.add(k);return true;
    }).slice(0,16);
  }
  return {dose:uniq(dose),water:uniq(water)};
}

function pairScenarios(doses,waters){
  const scenarios=[];
  for(const d of doses){
    let best=null;
    if(waters.length===1){
      best=waters[0];
    }else if(waters.length>1){
      const sameScenario=waters.filter(w=>w.scenario && d.scenario && w.scenario===d.scenario);
      const pool=sameScenario.length?sameScenario:waters;
      best=pool.slice().sort((a,b)=>Math.abs(a.pos-d.pos)-Math.abs(b.pos-d.pos))[0]||null;
      if(best && Math.abs(best.pos-d.pos)>1800 && !sameScenario.length) best=null;
    }

    let scenario=d.scenario || (best&&best.scenario) || '';
    if(!scenario && doses.length===1) scenario='Impiego rilevato';

    const meta=scenarioMeta(d.context,scenario);
    scenarios.push({
      scenario,
      crop:meta.crop,target:meta.target,purpose:meta.purpose,details:meta.details,
      dose:d,
      water:best,
      context:d.context
    });
  }

  const seen=new Set();
  return scenarios.filter(s=>{
    const d=s.dose||{};
    const w=s.water||{};
    const k=[s.scenario,d.min,d.max,d.unit,d.area,w.min,w.max].join('|');
    if(seen.has(k))return false;
    seen.add(k);return true;
  }).slice(0,10);
}

module.exports=async function(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  try{
    const raw=String(req.query.url||'').trim();
    if(!raw) return res.status(400).json({error:'URL mancante'});

    const u=await safeUrl(raw);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),18000);

    const r=await fetch(u.toString(),{
      redirect:'follow',
      signal:controller.signal,
      headers:{'user-agent':'Mozilla/5.0 DoseVerde/1.7'}
    });
    clearTimeout(timer);

    if(!r.ok) throw new Error('Fonte non raggiungibile (HTTP '+r.status+')');

    const len=Number(r.headers.get('content-length')||0);
    if(len>14*1024*1024) throw new Error('Documento troppo grande');

    const type=(r.headers.get('content-type')||'').toLowerCase();
    let text='';

    if(type.includes('pdf') || u.pathname.toLowerCase().endsWith('.pdf')){
      const buf=Buffer.from(await r.arrayBuffer());
      const pdfParse=require('pdf-parse');
      const parsed=await pdfParse(buf);
      text=parsed.text||'';
    }else{
      text=stripHtml(await r.text());
    }

    if(!text) throw new Error('Nessun testo leggibile nella fonte');

    const found=findCandidates(text);
    const scenarios=pairScenarios(found.dose,found.water);

    const key=text.toLowerCase().search(/dose|dosi|dosaggio|modalit[aà].{0,30}impiego|impiego|volume.{0,15}acqua/);
    const start=key>=0?Math.max(0,key-260):0;
    const snippet=cleanContext(text.slice(start,start+1200));

    const details=extractLabelDetails(text);
    return res.status(200).json({
      source:u.toString(),
      sourceTitle:u.hostname,
      details,
      doseCandidates:found.dose.map(({pos,...x})=>x),
      waterCandidates:found.water.map(({pos,...x})=>x),
      scenarios:scenarios.map(s=>({
        scenario:s.scenario,crop:s.crop,target:s.target,purpose:s.purpose,details:s.details,
        dose:s.dose?Object.fromEntries(Object.entries(s.dose).filter(([k])=>k!=='pos')):null,
        water:s.water?Object.fromEntries(Object.entries(s.water).filter(([k])=>k!=='pos')):null,
        context:s.context
      })),
      snippet
    });
  }catch(e){
    return res.status(502).json({
      error:e.name==='AbortError'?'Timeout durante il recupero della fonte':(e.message||'Analisi fallita')
    });
  }
};

module.exports._test={findCandidates,pairScenarios,extractLabelDetails,detectScenario};
