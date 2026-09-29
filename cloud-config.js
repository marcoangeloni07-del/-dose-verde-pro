module.exports=function(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  var url=process.env.SUPABASE_URL||'';
  var key=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||'';
  res.status(200).json({enabled:Boolean(url&&key),url:url,key:key});
};
