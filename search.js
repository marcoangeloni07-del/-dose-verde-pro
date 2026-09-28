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
  const keys = Object.keys(node);
  if(keys.includes('denominazione_prodotto') || keys.includes('num_registrazione')){
    out.push(node);
    return;
  }
  for(const v of Object.values(node)) collect(v,out);
}
async function getDataset(){
  if(cache.items && Date.now()-cache.at < 6*60*60*1000) return cache;
  const page = await fetch('https://www.dati.salute.gov.it/it/dataset/fitosanitari/', {
    headers:{'user-agent':'DoseVerde/1.3'}
  });
  if(!page.ok) throw new Error('Pagina Open Data non raggiungibile');
  const pageText = await page.text();
  const m = pageText.match(/https?:\/\/[^"' ]*PROD_FTS_6_(\d{8})\.json|\/sites\/default\/files\/opendata\/PROD_FTS_6_(\d{8})\.json/);
  if(!m) throw new Error('URL del dataset JSON non trovato');
  const date = m[1] || m[2];
  let url = m[0];
  if(url.startsWith('/')) url = 'https://www.dati.salute.gov.it'+url;
  const r = await fetch(url,{headers:{'user-agent':'DoseVerde/1.3'}});
  if(!r.ok) throw new Error('Dataset ufficiale non disponibile');
  const data = await r.json();
  const raw=[];
  collect(data,raw);
  const seen=new Set();
  const items=[];
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
  cache={items,at:Date.now(),datasetDate:date};
  return cache;
}
module.exports = async function(req,res){
  try{
    const q=String(req.query.q||'').trim().slice(0,100);
    const reg=String(req.query.reg||'').replace(/\D/g,'').slice(0,12);
    if(!q && !reg) return res.status(400).json({error:'Inserisci nome o numero di registrazione'});
    const db=await getDataset();
    const nq=norm(q);
    let results=db.items.filter(p=>{
      if(reg && p.registration.replace(/\D/g,'')===reg) return true;
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
      return a.name.localeCompare(b.name,'it');
    });
    return res.status(200).json({
      datasetDate: db.datasetDate ? db.datasetDate.slice(6,8)+'/'+db.datasetDate.slice(4,6)+'/'+db.datasetDate.slice(0,4) : null,
      matches:results.slice(0,20)
    });
  }catch(e){
    return res.status(502).json({error:e.message||'Errore ricerca ufficiale'});
  }
};
