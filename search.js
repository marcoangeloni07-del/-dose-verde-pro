let cache = { items: null, at: 0, datasetDate: null };

function norm(v){
  return String(v == null ? '' : v)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/\s+/g,' ').trim();
}
function scalar(v){
  if(v == null) return '';
  if(Array.isArray(v)) return v.map(scalar).filter(Boolean).join('; ');
  if(typeof v === 'object') return Object.values(v).map(scalar).filter(Boolean).join('; ');
  return String(v);
}
function collect(node,out){
  if(!node) return;
  if(Array.isArray(node)){ for(const x of node) collect(x,out); return; }
  if(typeof node !== 'object') return;
  const keys=Object.keys(node);
  if(keys.includes('denominazione_prodotto') || keys.includes('num_registrazione')){
    out.push(node); return;
  }
  for(const v of Object.values(node)) collect(v,out);
}
function yyyymmdd(d){
  return d.getUTCFullYear().toString()+
    String(d.getUTCMonth()+1).padStart(2,'0')+
    String(d.getUTCDate()).padStart(2,'0');
}
async function discoverDataset(){
  // First try the catalogue page. We only need the date token, not the exact href.
  try{
    const page=await fetch('https://www.dati.salute.gov.it/it/dataset/fitosanitari/',{
      headers:{
        'user-agent':'Mozilla/5.0 (compatible; DoseVerde/1.3.1)',
        'accept':'text/html,application/xhtml+xml'
      }
    });
    if(page.ok){
      const text=await page.text();
      const hits=[...text.matchAll(/PROD_FTS_6_(\d{8})\.(?:json|csv|xml)/gi)]
        .map(m=>m[1]);
      if(hits.length){
        hits.sort().reverse();
        return {
          date:hits[0],
          url:'https://www.dati.salute.gov.it/sites/default/files/opendata/PROD_FTS_6_'+hits[0]+'.json'
        };
      }
      // Fallback: use the visible "last update" date if present.
      const dm=text.match(/(?:ultimo aggiornamento|data ultimo aggiornamento)[\s\S]{0,250}?(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i);
      if(dm){
        const date=dm[3]+dm[2]+dm[1];
        return {
          date,
          url:'https://www.dati.salute.gov.it/sites/default/files/opendata/PROD_FTS_6_'+date+'.json'
        };
      }
    }
  }catch(e){}

  // Last-resort: try today and the previous 21 days.
  const now=new Date();
  for(let i=0;i<=21;i++){
    const d=new Date(now.getTime()-i*86400000);
    const date=yyyymmdd(d);
    const url='https://www.dati.salute.gov.it/sites/default/files/opendata/PROD_FTS_6_'+date+'.json';
    try{
      const r=await fetch(url,{
        headers:{
          'user-agent':'Mozilla/5.0 (compatible; DoseVerde/1.3.1)',
          'accept':'application/json'
        }
      });
      if(r.ok) return {date,url,response:r};
      if(r.status!==404) continue;
    }catch(e){}
  }
  throw new Error('Non riesco a individuare il file Open Data aggiornato.');
}
async function getDataset(){
  if(cache.items && Date.now()-cache.at < 6*60*60*1000) return cache;

  const found=await discoverDataset();
  let r=found.response;
  if(!r){
    r=await fetch(found.url,{
      headers:{
        'user-agent':'Mozilla/5.0 (compatible; DoseVerde/1.3.1)',
        'accept':'application/json'
      }
    });
  }
  if(!r.ok) throw new Error('Il dataset del Ministero non è raggiungibile (HTTP '+r.status+').');

  const rawText=await r.text();
  let data;
  try{
    data=JSON.parse(rawText);
  }catch(e){
    throw new Error('Il file Open Data del Ministero non è un JSON valido.');
  }

  const raw=[];
  collect(data,raw);
  if(!raw.length){
    throw new Error('Il dataset è stato scaricato, ma non riconosco la sua struttura.');
  }

  const seen=new Set(),items=[];
  for(const x of raw){
    const registration=scalar(x.num_registrazione).trim();
    const name=scalar(x.denominazione_prodotto).trim();
    const key=registration+'|'+name;
    if(!name || seen.has(key)) continue;
    seen.add(key);
    items.push({
      registration,
      name,
      holder:scalar(x.ragione_sociale).trim(),
      active:scalar(x.sostanze_attive).trim(),
      activity:scalar(x.attivita).trim(),
      formulation:scalar(x.descrizione_formulazione).trim(),
      status:scalar(x.stato_amministrativo).trim(),
      expiry:scalar(x.data_scadenza_autorizzazione).trim(),
      danger:scalar(x.indicazioni_di_pericolo).trim()
    });
  }
  cache={items,at:Date.now(),datasetDate:found.date};
  return cache;
}

module.exports=async function(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=3600');
  try{
    const q=String(req.query.q||'').trim().slice(0,100);
    const reg=String(req.query.reg||'').replace(/\D/g,'').slice(0,12);
    if(!q && !reg) return res.status(400).json({error:'Inserisci nome o numero di registrazione'});

    const db=await getDataset();
    const nq=norm(q);
    let results=db.items.filter(p=>{
      const preg=p.registration.replace(/\D/g,'');
      if(reg && preg===reg) return true;
      if(nq && norm(p.name).includes(nq)) return true;
      return false;
    });

    results.sort((a,b)=>{
      const aa=/^autorizzato/i.test(a.status)?0:1;
      const bb=/^autorizzato/i.test(b.status)?0:1;
      if(aa!==bb) return aa-bb;
      if(reg){
        const ar=a.registration.replace(/\D/g,'')===reg?0:1;
        const br=b.registration.replace(/\D/g,'')===reg?0:1;
        if(ar!==br) return ar-br;
      }
      const an=nq && norm(a.name)===nq?0:1;
      const bn=nq && norm(b.name)===nq?0:1;
      if(an!==bn) return an-bn;
      return a.name.localeCompare(b.name,'it');
    });

    const d=db.datasetDate;
    return res.status(200).json({
      datasetDate:d&&d.length===8?d.slice(6,8)+'/'+d.slice(4,6)+'/'+d.slice(0,4):d,
      matches:results.slice(0,20)
    });
  }catch(e){
    return res.status(502).json({error:e.message||'Errore ricerca ufficiale'});
  }
};
