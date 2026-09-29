(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.DoseVerdeSyncCore=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function ts(v){var n=Date.parse(v||'');return Number.isFinite(n)?n:0}
  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
  function normalizeRemote(row){
    var p=clone(row&&row.payload)||null;
    if(p&&row.updated_at)p.updatedAt=row.updated_at;
    return p;
  }
  function planSync(localProducts,remoteRows,tombstones){
    localProducts=Array.isArray(localProducts)?localProducts:[];
    remoteRows=Array.isArray(remoteRows)?remoteRows:[];
    tombstones=tombstones&&typeof tombstones==='object'?tombstones:{};
    var lm={},rm={},ids={};
    localProducts.forEach(function(p){if(p&&p.id){lm[p.id]=clone(p);ids[p.id]=1}});
    remoteRows.forEach(function(r){if(r&&r.id){rm[r.id]=r;ids[r.id]=1}});
    Object.keys(tombstones).forEach(function(id){ids[id]=1});
    var merged=[],uploadIds=[],deleteIds=[];
    Object.keys(ids).forEach(function(id){
      var l=lm[id]||null,r=rm[id]||null,t=tombstones[id]||null;
      var lt=ts(l&&l.updatedAt),rt=ts(r&&r.updated_at),tt=ts(t&&t.updatedAt);
      if(t&&tt>Math.max(lt,rt)){
        deleteIds.push(id);return;
      }
      if(r){
        if(r.deleted_at){
          if(l&&lt>rt){merged.push(l);uploadIds.push(id)}
          return;
        }
        var rp=normalizeRemote(r);
        if(l&&lt>rt){merged.push(l);uploadIds.push(id)}
        else if(rp)merged.push(rp);
        return;
      }
      if(l){merged.push(l);uploadIds.push(id);return}
      if(t)deleteIds.push(id);
    });
    return {merged:merged,uploadIds:uploadIds,deleteIds:deleteIds};
  }
  return {planSync:planSync,_ts:ts};
});
