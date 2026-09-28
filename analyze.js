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
async function safeUrl(raw){
  const u=new URL(raw);
  if(!['http:','https:'].includes(u.protocol)) throw new Error('URL non valido');
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
function findRanges(text){
  const compact=text.replace(/\s+/g,' ');
  const dose=[],water=[];
  const re=/(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*(ml|l|litri|kg|g)\s*(?:\/|per)\s*(ha|ettaro|ettari|100\s*(?:m²|m2|mq))/gi;
  let m;
  while((m=re.exec(compact))!==null){
    const before=compact.slice(Math.max(0,m.index-160),m.index);
    const after=compact.slice(re.lastIndex,Math.min(compact.length,re.lastIndex+160));
    const ctx=(before+' '+m[0]+' '+after);
    const lc=ctx.toLowerCase();
    const item={
      min:n(m[1]),max:n(m[2]),
      unit:m[3].toLowerCase(),area:m[4].toLowerCase(),
      label:m[1]+'–'+m[2]+' '+m[3]+'/'+m[4],
      context:ctx.slice(0,360)
    };
    if(/acqua|volume|miscela|dilu/.test(lc) && (item.unit==='l'||item.unit==='litri') && item.min>=20) water.push(item);
    else if(/dose|dosi|impiego|applic|distribu/.test(lc)) dose.push(item);
  }
  function uniq(arr){
    const s=new Set();
    return arr.filter(x=>{
      const k=[x.min,x.max,x.unit,x.area].join('|');
      if(s.has(k))return false;s.add(k);return true;
    }).slice(0,8);
  }
  return {dose:uniq(dose),water:uniq(water)};
}
module.exports = async function(req,res){
  try{
    const raw=String(req.query.url||'').trim();
    if(!raw) return res.status(400).json({error:'URL mancante'});
    const u=await safeUrl(raw);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    const r=await fetch(u.toString(),{
      redirect:'follow',
      signal:controller.signal,
      headers:{'user-agent':'Mozilla/5.0 DoseVerde/1.3'}
    });
    clearTimeout(timer);
    if(!r.ok) throw new Error('Fonte non raggiungibile');
    const len=Number(r.headers.get('content-length')||0);
    if(len>12*1024*1024) throw new Error('Documento troppo grande');
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
    if(!text) throw new Error('Nessun testo leggibile');
    const ranges=findRanges(text);
    const key=text.toLowerCase().search(/dose|dosi|modalit[aà].{0,20}impiego|impiego/);
    const start=key>=0?Math.max(0,key-220):0;
    const snippet=text.slice(start,start+900).replace(/\s+/g,' ').trim();
    return res.status(200).json({
      source:u.toString(),
      doseCandidates:ranges.dose,
      waterCandidates:ranges.water,
      snippet
    });
  }catch(e){
    return res.status(502).json({error:e.name==='AbortError'?'Timeout durante il recupero della fonte':(e.message||'Analisi fallita')});
  }
};
