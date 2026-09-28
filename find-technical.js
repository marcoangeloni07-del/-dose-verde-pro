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
module.exports = async function(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  try{
    const q=String(req.query.q||'').trim().slice(0,100);
    const reg=String(req.query.reg||'').replace(/\D/g,'').slice(0,12);
    if(!q && !reg) return res.status(400).json({error:'Nome o registrazione mancanti'});
    const query=[q,reg,'etichetta scheda tecnica dosi pdf'].filter(Boolean).map(x=>'"'+x+'"').join(' ');
    const url='https://www.bing.com/search?format=rss&q='+encodeURIComponent(query);
    const r=await fetch(url,{headers:{
      'user-agent':'Mozilla/5.0 DoseVerde/1.3.1',
      'accept':'application/rss+xml,application/xml,text/xml'
    }});
    if(!r.ok) throw new Error('Motore di ricerca non disponibile');
    const xml=await r.text();
    const blocks=xml.match(/<item>[\s\S]*?<\/item>/gi)||[];
    const results=[];
    for(const b of blocks){
      const title=textBetween(b,'title');
      const link=textBetween(b,'link');
      const description=textBetween(b,'description');
      if(!/^https?:\/\//i.test(link)) continue;
      let score=0;
      const s=(title+' '+link+' '+description).toLowerCase();
      if(/etichetta|scheda tecnica|technical data|label/.test(s))score+=4;
      if(/\.pdf(?:$|\?)/.test(link.toLowerCase()))score+=3;
      if(reg && s.includes(reg))score+=5;
      if(q && s.includes(q.toLowerCase()))score+=3;
      if(/salute\.gov\.it|gazzettaufficiale\.it/.test(link))score+=4;
      if(/amazon|ebay|temu/.test(link))score-=5;
      results.push({title,url:link,description,score});
    }
    results.sort((a,b)=>b.score-a.score);
    return res.status(200).json({results:results.slice(0,8)});
  }catch(e){
    return res.status(502).json({error:e.message||'Ricerca tecnica non disponibile'});
  }
};
