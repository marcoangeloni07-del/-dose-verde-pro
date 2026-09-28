const AdmZip=require('adm-zip');
const iconv=require('iconv-lite');

const CSV_ZIP='https://cmsras.regione.sardegna.it/api/assets/redazionaleras/9d6de36b-adcc-418f-959b-b1d7e77cfcbd/2026-ambito-regionale-csv.zip';
let cache={rows:null,at:0};

function norm(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/\s+/g,' ').trim();
}
function parseLine(line,delim){
  const out=[];let cur='',q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(q && line[i+1]==='"'){cur+='"';i++;}
      else q=!q;
    }else if(ch===delim && !q){
      out.push(cur.trim());cur='';
    }else cur+=ch;
  }
  out.push(cur.trim());
  return out;
}
function chooseDelimiter(line){
  const candidates=[';','\t',','];
  let best=';',count=-1;
  for(const d of candidates){
    const n=(line.split(d).length-1);
    if(n>count){best=d;count=n;}
  }
  return best;
}
function priceNum(v){
  let s=String(v||'').trim().replace(/[€\s]/g,'');
  if(!s)return null;
  if(s.includes(',') && s.includes('.')){
    if(s.lastIndexOf(',')>s.lastIndexOf('.')) s=s.replace(/\./g,'').replace(',','.');
    else s=s.replace(/,/g,'');
  }else if(s.includes(',')) s=s.replace(',','.');
  const n=Number(s);
  return Number.isFinite(n)?n:null;
}
function headerIndex(headers,tests){
  for(let i=0;i<headers.length;i++){
    const h=norm(headers[i]);
    if(tests.some(t=>t.test(h)))return i;
  }
  return -1;
}
function parseCsv(text,file){
  const lines=text.split(/\r?\n/).filter(x=>x.trim());
  if(lines.length<2)return [];
  const delim=chooseDelimiter(lines[0]);
  const headers=parseLine(lines[0],delim);
  const codeI=headerIndex(headers,[/^cod/,/codice/,/articolo/]);
  const descI=headerIndex(headers,[/descr/,/denomin/,/voce/]);
  const unitI=headerIndex(headers,[/^um$/,/^u\.?m/,/unita.*misura/,/unità.*misura/]);
  const priceI=headerIndex(headers,[/^prezzo$/,/prezzo.*unit/,/importo/,/^costo$/]);

  const rows=[];
  for(let i=1;i<lines.length;i++){
    const fields=parseLine(lines[i],delim);
    if(fields.length<2)continue;

    let code=codeI>=0?fields[codeI]:'';
    let description=descI>=0?fields[descI]:'';
    let unit=unitI>=0?fields[unitI]:'';
    let price=priceI>=0?priceNum(fields[priceI]):null;

    // Heuristic fallback if headers are unusual.
    if(!description){
      const long=fields
        .map((v,idx)=>({v,idx}))
        .filter(x=>String(x.v||'').length>20)
        .sort((a,b)=>String(b.v).length-String(a.v).length)[0];
      if(long)description=long.v;
    }
    if(!code){
      code=fields.find(v=>/^[A-Z0-9][A-Z0-9._/-]{3,}$/i.test(String(v||'').trim()))||'';
    }
    if(!unit){
      unit=fields.find(v=>/^(m2|m²|mq|m3|m³|kg|g|l|lt|h|ora|ore|cad|n\.|ha)$/i.test(String(v||'').trim()))||'';
    }
    if(price==null){
      for(let j=fields.length-1;j>=0;j--){
        const p=priceNum(fields[j]);
        if(p!=null && p>0 && p<100000){price=p;break;}
      }
    }
    if(!description)continue;
    rows.push({code:String(code||'').trim(),description:String(description).trim(),unit:String(unit||'').trim(),price,file});
  }
  return rows;
}
async function loadRows(){
  if(cache.rows && Date.now()-cache.at<6*60*60*1000)return cache.rows;
  const r=await fetch(CSV_ZIP,{
    headers:{
      'user-agent':'Mozilla/5.0 DoseVerde/1.4',
      'accept':'application/zip,application/octet-stream'
    }
  });
  if(!r.ok)throw new Error('Download Prezzario Sardegna non riuscito (HTTP '+r.status+')');
  const buf=Buffer.from(await r.arrayBuffer());
  const zip=new AdmZip(buf);
  const entries=zip.getEntries().filter(e=>!e.isDirectory && /\.csv$/i.test(e.entryName));
  if(!entries.length)throw new Error('Nessun CSV trovato nel pacchetto regionale');

  const rows=[];
  for(const e of entries){
    const raw=e.getData();
    let text=iconv.decode(raw,'utf8');
    if((text.match(/\uFFFD/g)||[]).length>5) text=iconv.decode(raw,'windows-1252');
    rows.push(...parseCsv(text,e.entryName));
  }
  if(!rows.length)throw new Error('Il pacchetto è stato scaricato ma non riconosco le righe del prezzario');
  cache={rows,at:Date.now()};
  return rows;
}
module.exports=async function(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=3600');
  try{
    const q=String(req.query.q||'').trim().slice(0,120);
    if(!q)return res.status(400).json({error:'Inserisci una voce da cercare'});
    const rows=await loadRows();
    const nq=norm(q);
    const toks=nq.split(' ').filter(x=>x.length>=3);

    const scored=[];
    for(const r of rows){
      const hay=norm(r.code+' '+r.description+' '+r.unit);
      let score=0;
      if(hay.includes(nq))score+=20;
      for(const t of toks) if(hay.includes(t))score+=4;
      if(/verde|prat|tappet|erb|diserb|manutenz|sfalcio|taglio|potatur|trattament|fitosanitar/.test(hay))score+=2;
      if(score>0)scored.push({...r,score});
    }
    scored.sort((a,b)=>b.score-a.score || a.description.localeCompare(b.description,'it'));

    const seen=new Set();
    const results=[];
    for(const x of scored){
      const key=x.code+'|'+x.description+'|'+x.unit+'|'+x.price;
      if(seen.has(key))continue;
      seen.add(key);
      results.push(x);
      if(results.length>=25)break;
    }
    return res.status(200).json({source:'Regione Sardegna · Prezzario LL.PP. 2026',results});
  }catch(e){
    return res.status(502).json({error:e.message||'Ricerca tariffario non disponibile'});
  }
};
