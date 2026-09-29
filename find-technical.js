function htmlDecode(s){
  return String(s||'')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/&quot;/gi,'"').replace(/&#39;|&#x27;/gi,"'")
    .replace(/&#x2F;/gi,'/').replace(/&nbsp;/gi,' ');
}
function stripTags(s){
  return htmlDecode(String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' '))
    .replace(/\s+/g,' ').trim();
}
function textBetween(block,tag){
  const m=block.match(new RegExp('<'+tag+'[^>]*>([\\s\\S]*?)<\\/'+tag+'>','i'));
  return m?stripTags(m[1]):'';
}
function norm(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function tokens(s){
  const stop=new Set([
    'plus','expert','pro','new','italia','italy','ml','lt','litri','kg',
    'sc','wg','wp','ec','sl','se','cs','od','gr','df','sg'
  ]);
  return norm(s).split(' ').filter(x=>x.length>=2 && !stop.has(x));
}
function hostOf(url){
  try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch(e){return '';}
}
function blockedHost(host){
  return [
    'city-data.com','reddit.com','facebook.com','instagram.com','youtube.com',
    'pinterest.com','linkedin.com','x.com','twitter.com','tiktok.com',
    'amazon.it','amazon.com','ebay.it','ebay.com','temu.com','aliexpress.com',
    'quora.com','tripadvisor.com','wikipedia.org'
  ].some(d=>host===d || host.endsWith('.'+d));
}
function companyDomain(holder){
  const h=norm(holder);
  const rules=[
    [/bayer|envu/,'cropscience.bayer.it'],
    [/syngenta/,'syngenta.it'],
    [/basf/,'agro.basf.it'],
    [/corteva|dow agro|dupont/,'corteva.it'],
    [/adama/,'adama.com'],
    [/sipcam/,'sipcam.com'],
    [/sumitomo/,'sumitomo-chem.it'],
    [/certis|belchim/,'certisbelchim.it'],
    [/\bupl\b|united phosphorus/,'upl-ltd.com'],
    [/fmc/,'fmcagro.it'],
    [/nufarm/,'nufarm.com'],
    [/compo/,'compo-expert.com'],
    [/copyr/,'copyr.eu'],
    [/diachem/,'diachemitalia.it'],
    [/chimiberg/,'chimiberg.com'],
    [/ascenza|sapec/,'ascenza.it']
  ];
  for(const [re,d] of rules) if(re.test(h)) return d;
  return '';
}
function isAuthority(host){
  return host==='salute.gov.it' || host.endsWith('.salute.gov.it') ||
    host==='gazzettaufficiale.it' || host.endsWith('.gazzettaufficiale.it');
}
function isBdf(host){
  return host==='winbdf.it' || host.endsWith('.winbdf.it');
}
function sourceType(host,url,text,vendorDomain){
  if(isBdf(host)) return 'BDF / archivio tecnico';
  if(isAuthority(host)) return 'Fonte istituzionale';
  if(vendorDomain && (host===vendorDomain || host.endsWith('.'+vendorDomain))) return 'Sito del produttore';
  if(/\.pdf(?:$|[?#])/i.test(url)) return 'PDF tecnico';
  if(/etichetta|scheda tecnica|scheda di sicurezza|label/i.test(text)) return 'Fonte tecnica';
  return 'Pagina prodotto';
}
function unwrapSearchUrl(raw){
  try{
    let u=new URL(htmlDecode(raw));
    if(/duckduckgo\.com$/i.test(u.hostname) || /duckduckgo\.com$/i.test(u.hostname.replace(/^www\./,''))){
      const uddg=u.searchParams.get('uddg');
      if(uddg) return decodeURIComponent(uddg);
    }
    if(/bing\.com$/i.test(u.hostname.replace(/^www\./,''))){
      const target=u.searchParams.get('url') || u.searchParams.get('u');
      if(target && /^https?:/i.test(target)) return target;
    }
    return u.toString();
  }catch(e){
    return htmlDecode(raw);
  }
}
async function fetchText(url,headers={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),9000);
  try{
    const r=await fetch(url,{
      redirect:'follow',
      signal:controller.signal,
      headers:Object.assign({
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'accept-language':'it-IT,it;q=0.9,en;q=0.7'
      },headers)
    });
    if(!r.ok) return '';
    return await r.text();
  }catch(e){
    return '';
  }finally{
    clearTimeout(timer);
  }
}
async function existsPdf(url){
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),7000);
    let r=await fetch(url,{
      method:'HEAD',redirect:'follow',signal:controller.signal,
      headers:{'user-agent':'Mozilla/5.0 DoseVerde/1.5.3'}
    });
    clearTimeout(timer);
    if(r.ok){
      const t=(r.headers.get('content-type')||'').toLowerCase();
      return t.includes('pdf') || /\.pdf(?:$|[?#])/i.test(url);
    }
  }catch(e){}
  return false;
}
function scoreResult({title,link,description,q,reg,holder,activity,vendorDomain}){
  const host=hostOf(link);
  if(!host || blockedHost(host)) return null;

  const joinedRaw=(title+' '+description+' '+link);
  const joined=norm(joinedRaw);
  const nameNorm=norm(q);
  const nameTokens=tokens(q);
  const holderTokens=tokens(holder);
  const activityTokens=tokens(activity);

  const regHit=!!(reg && joined.includes(reg));
  const exactName=!!(nameNorm && joined.includes(nameNorm));
  const tokenHits=nameTokens.filter(t=>joined.includes(t)).length;
  const tokenRatio=nameTokens.length ? tokenHits/nameTokens.length : 0;
  const nameEnough=nameTokens.length===1 ? tokenHits===1 :
    (nameTokens.length>1 && (tokenHits>=2 || tokenRatio>=0.7));

  const vendorHit=!!(vendorDomain && (host===vendorDomain || host.endsWith('.'+vendorDomain)));
  const holderHit=holderTokens.some(t=>joined.includes(t));
  const activityHit=activityTokens.some(t=>joined.includes(t));
  const pdf=/\.pdf(?:$|[?#])/i.test(link);
  const label=/etichetta|label|foglio illustrativo/.test(joined);
  const tech=/scheda tecnica|technical sheet|scheda prodotto|catalogo/.test(joined);
  const sds=/scheda di sicurezza|safety data|sds/.test(joined);
  const cropScience=/fitosanit|agrofarm|erbicid|diserb|fungicid|insetticid|acaricid|nematocid|molluschicid/.test(joined);

  // The result must refer to the product by name (or registration).
  if(!(regHit || exactName || nameEnough)) return null;

  // Generic pages are accepted only from the manufacturer's domain.
  if(!(pdf || label || tech || sds || cropScience || vendorHit || isBdf(host) || isAuthority(host))) return null;

  let score=0;
  if(regHit) score+=16;
  if(exactName) score+=14;
  score+=Math.min(tokenHits,4)*3;
  if(vendorHit) score+=12;
  if(holderHit) score+=4;
  if(activityHit) score+=2;
  if(pdf) score+=7;
  if(label) score+=8;
  if(tech) score+=6;
  if(cropScience) score+=3;
  if(sds) score+=1;
  if(isAuthority(host)) score+=20;
  if(isBdf(host)) score+=14;

  if(/forum|thread|community|blog|news|notizie|shop|store|ecommerce/.test(joined) && !pdf) score-=10;
  if(score<10) return null;

  return {
    title:title||q||'Fonte online',
    url:link,
    description:description||'',
    score,
    sourceType:sourceType(host,link,joinedRaw,vendorDomain),
    autoAnalyze:isAuthority(host) || (isBdf(host) && pdf),
    trusted:isAuthority(host) || isBdf(host) || vendorHit
  };
}
async function searchBingRss(query){
  const url='https://www.bing.com/search?format=rss&count=25&q='+encodeURIComponent(query);
  const xml=await fetchText(url,{'accept':'application/rss+xml,application/xml,text/xml'});
  if(!xml) return [];
  const blocks=xml.match(/<item>[\s\S]*?<\/item>/gi)||[];
  return blocks.map(b=>({
    title:textBetween(b,'title'),
    link:textBetween(b,'link'),
    description:textBetween(b,'description'),
    via:'Bing'
  })).filter(x=>/^https?:\/\//i.test(x.link));
}
async function searchBingHtml(query){
  const url='https://www.bing.com/search?count=25&setlang=it-IT&q='+encodeURIComponent(query);
  const html=await fetchText(url,{'accept':'text/html,application/xhtml+xml'});
  if(!html) return [];
  const out=[];
  const blocks=html.match(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/gi)||[];
  for(const b of blocks){
    const m=b.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if(!m) continue;
    const sn=b.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    out.push({
      title:stripTags(m[2]),
      link:unwrapSearchUrl(m[1]),
      description:sn?stripTags(sn[1]):'',
      via:'Bing'
    });
  }
  return out;
}
async function searchDuck(query){
  const url='https://html.duckduckgo.com/html/?kl=it-it&q='+encodeURIComponent(query);
  const html=await fetchText(url,{
    'accept':'text/html,application/xhtml+xml',
    'referer':'https://duckduckgo.com/'
  });
  if(!html) return [];
  const out=[];
  const re=/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(html))!==null){
    const after=html.slice(re.lastIndex,Math.min(html.length,re.lastIndex+1800));
    const sn=after.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    out.push({
      title:stripTags(m[2]),
      link:unwrapSearchUrl(m[1]),
      description:sn?stripTags(sn[1]):'',
      via:'DuckDuckGo'
    });
  }
  return out.slice(0,25);
}
function dedupe(items){
  const seen=new Set(),out=[];
  for(const x of items){
    let key=x.url;
    try{
      const u=new URL(x.url);
      u.hash='';
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(k=>u.searchParams.delete(k));
      key=u.toString().replace(/\/$/,'');
    }catch(e){}
    if(seen.has(key)) continue;
    seen.add(key);out.push(x);
  }
  return out;
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

    const vendorDomain=companyDomain(holder);
    const raw=[];
    let attempts=0;

    // 1) Direct authorized-label pattern, when available.
    if(reg){
      attempts++;
      const labelUrl='https://www.winbdf.it/bdf-archivi/etichette1/'+reg+'.pdf';
      if(await existsPdf(labelUrl)){
        raw.push({
          title:(q||'Prodotto')+' — etichetta',
          link:labelUrl,
          description:'Etichetta individuata tramite numero di registrazione '+reg+'.',
          via:'Ricerca diretta'
        });
      }
    }

    // 2) Several deliberately different queries; do not over-constrain all fields at once.
    const queries=[];
    if(q){
      queries.push('"'+q.replace(/"/g,'')+'" etichetta pdf');
      queries.push('"'+q.replace(/"/g,'')+'" "scheda tecnica"');
      if(reg) queries.push('"'+q.replace(/"/g,'')+'" '+reg+' pdf');
      queries.push('site:winbdf.it "'+q.replace(/"/g,'')+'" pdf');
      if(vendorDomain) queries.push('site:'+vendorDomain+' "'+q.replace(/"/g,'')+'"');
    }else if(reg){
      queries.push('"'+reg+'" etichetta fitosanitario pdf');
    }

    // Sequential small batches reduce the chance of rate-limits and allow early useful results.
    for(const query of queries.slice(0,5)){
      attempts++;
      let got=await searchBingRss(query);
      raw.push(...got);
      if(got.length<3){
        attempts++;
        got=await searchBingHtml(query);
        raw.push(...got);
      }
      if(got.length<2){
        attempts++;
        got=await searchDuck(query);
        raw.push(...got);
      }
    }

    const scored=[];
    for(const x of raw){
      if(!/^https?:\/\//i.test(x.link||'')) continue;
      const c=scoreResult({
        title:x.title,link:x.link,description:x.description,
        q,reg,holder,activity,vendorDomain
      });
      if(c){
        c.via=x.via||'Web';
        scored.push(c);
      }
    }

    const results=dedupe(scored)
      .sort((a,b)=>b.score-a.score)
      .slice(0,12);

    return res.status(200).json({
      results,
      attempts,
      vendorDomain:vendorDomain||null
    });
  }catch(e){
    return res.status(502).json({error:e.message||'Ricerca tecnica non disponibile'});
  }
};
