function decodeXml(s){
  return String(s||'')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}
function textBetween(block,tag){
  const m=block.match(new RegExp('<'+tag+'[^>]*>([\\s\\S]*?)<\\/'+tag+'>','i'));
  return m?decodeXml(m[1]).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim():'';
}
function norm(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function tokens(s){
  const stop=new Set(['plus','expert','pro','new','italia','italy','ml','lt','l']);
  return norm(s).split(' ').filter(x=>x.length>=3 && !stop.has(x));
}
function hostOf(url){
  try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch(e){return '';}
}
function blockedHost(host){
  return [
    'city-data.com','reddit.com','facebook.com','instagram.com','youtube.com',
    'pinterest.com','linkedin.com','x.com','twitter.com','tiktok.com',
    'amazon.it','amazon.com','ebay.it','ebay.com','temu.com','aliexpress.com',
    'quora.com','tripadvisor.com'
  ].some(d=>host===d || host.endsWith('.'+d));
}
function sourceType(host,url,text){
  if(host==='winbdf.it' || host.endsWith('.winbdf.it')) return 'Etichetta autorizzata · BDF';
  if(host==='salute.gov.it' || host.endsWith('.salute.gov.it')) return 'Ministero della Salute';
  if(host==='gazzettaufficiale.it' || host.endsWith('.gazzettaufficiale.it')) return 'Gazzetta Ufficiale';
  if(/\.pdf(?:$|\?)/i.test(url)) return 'PDF tecnico';
  if(/scheda tecnica|etichetta|scheda di sicurezza/i.test(text)) return 'Fonte tecnica';
  return 'Fonte pertinente';
}
async function existsPdf(url){
  try{
    let r=await fetch(url,{
      method:'HEAD',redirect:'follow',
      headers:{'user-agent':'Mozilla/5.0 DoseVerde/1.3.3'}
    });
    if(r.ok){
      const t=(r.headers.get('content-type')||'').toLowerCase();
      return t.includes('pdf') || url.toLowerCase().includes('.pdf');
    }
    if(r.status===405 || r.status===403){
      r=await fetch(url,{
        method:'GET',redirect:'follow',
        headers:{
          'user-agent':'Mozilla/5.0 DoseVerde/1.3.3',
          'range':'bytes=0-1023'
        }
      });
      return r.ok || r.status===206;
    }
  }catch(e){}
  return false;
}
function relevantResult({title,link,description,q,reg,holder,activity}){
  const host=hostOf(link);
  if(!host || blockedHost(host)) return null;

  const joined=norm(title+' '+description+' '+link);
  const nameTokens=tokens(q);
  const holderTokens=tokens(holder);
  const activityTokens=tokens(activity);

  const regHit=reg && joined.includes(reg);
  const exactName=q && joined.includes(norm(q));
  const tokenHits=nameTokens.filter(t=>joined.includes(t)).length;
  const nameEnough=nameTokens.length===0 ? false :
    (nameTokens.length===1 ? tokenHits===1 : tokenHits>=Math.min(2,nameTokens.length));
  const holderHit=holderTokens.length && holderTokens.some(t=>joined.includes(t));
  const activityHit=activityTokens.length && activityTokens.some(t=>joined.includes(t));

  const techEvidence=/etichetta|scheda tecnica|scheda di sicurezza|safety data|label|fitosanit|agrofarm|erbicid|diserb|fungicid|insetticid|registrazione|ministero/.test(joined);
  const pdf=/\.pdf(?:$|\?)/i.test(link);

  // A result must actually refer to the product (or its registration) and look technical.
  if(!(regHit || exactName || nameEnough)) return null;
  if(!(techEvidence || pdf)) return null;

  let score=0;
  if(regHit) score+=12;
  if(exactName) score+=9;
  score+=Math.min(tokenHits,3)*3;
  if(holderHit) score+=4;
  if(activityHit) score+=2;
  if(pdf) score+=5;
  if(/etichetta/.test(joined)) score+=5;
  if(/scheda tecnica/.test(joined)) score+=4;
  if(/scheda di sicurezza|safety data/.test(joined)) score+=1; // lower than label/technical sheet

  if(host==='winbdf.it' || host.endsWith('.winbdf.it')) score+=30;
  if(host==='salute.gov.it' || host.endsWith('.salute.gov.it')) score+=25;
  if(host==='gazzettaufficiale.it' || host.endsWith('.gazzettaufficiale.it')) score+=18;

  // Generic forums/news are never useful even if keyword collision happens.
  if(/forum|thread|community|news|blog/.test(joined) && !pdf) score-=15;

  if(score<10) return null;

  return {
    title, url:link, description, score,
    sourceType:sourceType(host,link,title+' '+description),
    trusted:(
      host==='winbdf.it' || host.endsWith('.winbdf.it') ||
      host==='salute.gov.it' || host.endsWith('.salute.gov.it') ||
      host==='gazzettaufficiale.it' || host.endsWith('.gazzettaufficiale.it')
    )
  };
}
module.exports=async function(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=1800');
  try{
    const q=String(req.query.q||'').trim().slice(0,120);
    const reg=String(req.query.reg||'').replace(/\D/g,'').slice(0,12);
    const holder=String(req.query.holder||'').trim().slice(0,120);
    const activity=String(req.query.activity||'').trim().slice(0,120);

    if(!q && !reg) return res.status(400).json({error:'Nome o registrazione mancanti'});

    const results=[];

    // 1. For registered Italian plant-protection products, try the BDF authorized-label archive directly.
    // The archive URL is keyed by Ministry registration number.
    if(reg){
      const labelUrl='https://www.winbdf.it/bdf-archivi/etichette1/'+reg+'.pdf';
      if(await existsPdf(labelUrl)){
        results.push({
          title:(q || 'Prodotto')+' — etichetta autorizzata',
          url:labelUrl,
          description:'Etichetta del prodotto indicizzata tramite numero di registrazione '+reg+'.',
          score:100,
          sourceType:'Etichetta autorizzata · BDF',
          trusted:true
        });
      }
    }

    // 2. Search the web only as a fallback, with strict product/technical filtering.
    const terms=[];
    if(q) terms.push('"'+q.replace(/"/g,'')+'"');
    if(reg) terms.push('"'+reg+'"');
    if(holder) terms.push('"'+holder.replace(/"/g,'')+'"');
    terms.push('(etichetta OR "scheda tecnica" OR pdf)');
    const query=terms.join(' ');

    const url='https://www.bing.com/search?format=rss&count=20&q='+encodeURIComponent(query);
    const r=await fetch(url,{headers:{
      'user-agent':'Mozilla/5.0 DoseVerde/1.3.3',
      'accept':'application/rss+xml,application/xml,text/xml'
    }});
    if(r.ok){
      const xml=await r.text();
      const blocks=xml.match(/<item>[\s\S]*?<\/item>/gi)||[];
      for(const b of blocks){
        const title=textBetween(b,'title');
        const link=textBetween(b,'link');
        const description=textBetween(b,'description');
        if(!/^https?:\/\//i.test(link)) continue;

        const candidate=relevantResult({title,link,description,q,reg,holder,activity});
        if(candidate) results.push(candidate);
      }
    }

    // de-duplicate URLs and keep only high-quality results
    const seen=new Set();
    const clean=results
      .sort((a,b)=>b.score-a.score)
      .filter(x=>{
        const key=x.url.replace(/^https?:\/\/www\./i,'https://').replace(/\/$/,'');
        if(seen.has(key)) return false;
        seen.add(key); return true;
      })
      .slice(0,8);

    return res.status(200).json({results:clean});
  }catch(e){
    return res.status(502).json({error:e.message||'Ricerca tecnica non disponibile'});
  }
};
