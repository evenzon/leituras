/* Armazenamento local (IndexedDB) com a mesma interface que a página usava: db + assets. */
(function(){
  var DB_NAME='leituras',mem={},blobs={},urls={},listeners=[],idb=null;

  function open(){
    return new Promise(function(res,rej){
      var r=indexedDB.open(DB_NAME,1);
      r.onupgradeneeded=function(){var d=r.result;d.createObjectStore('docs');d.createObjectStore('blobs')};
      r.onsuccess=function(){res(r.result)};
      r.onerror=function(){rej(r.error)};
    });
  }
  function readAll(store){
    return new Promise(function(res,rej){
      var out={},q=idb.transaction(store).objectStore(store).openCursor();
      q.onsuccess=function(){var c=q.result;if(c){out[c.key]=c.value;c.continue()}else res(out)};
      q.onerror=function(){rej(q.error)};
    });
  }
  function mirror(){try{localStorage.setItem('leituras-docs',JSON.stringify(mem))}catch(e){}}
  function put(store,key,val){
    if(store==='docs')mirror();
    if(!idb)return Promise.resolve();
    return new Promise(function(res){
      var rej=function(e){console.error('idb',e);res()};
      var t=idb.transaction(store,'readwrite');
      if(val===undefined)t.objectStore(store).delete(key);else t.objectStore(store).put(val,key);
      t.oncomplete=function(){res()};t.onerror=function(){rej(t.error)};t.onabort=function(){rej(t.error)};
    });
  }
  function clone(o){return JSON.parse(JSON.stringify(o))}
  function rid(){var s='',c='abcdefghijklmnopqrstuvwxyz0123456789';for(var i=0;i<20;i++)s+=c[Math.floor(Math.random()*c.length)];return s}
  function notify(){listeners.slice().forEach(function(f){try{f()}catch(e){console.error(e)}})}
  function colDocs(col){
    var p=col+'/',out=[];
    Object.keys(mem).forEach(function(k){
      if(k.indexOf(p)===0&&k.indexOf('/',p.length)<0){
        (function(id,data){out.push({id:id,data:function(){return Object.freeze(clone(data))}})})(k.slice(p.length),mem[k]);
      }
    });
    return out;
  }
  function write(path,data){mem[path]=clone(data);return put('docs',path,mem[path]).then(notify)}
  function remove(path){delete mem[path];return put('docs',path,undefined).then(notify)}

  var db={
    collection:function(col){
      return {
        onSnapshot:function(cb){
          var f=function(){cb({docs:colDocs(col)})};
          listeners.push(f);setTimeout(f,0);
          return function(){listeners=listeners.filter(function(x){return x!==f})};
        },
        doc:function(id){id=id||rid();return docRef(col+'/'+id,id)}
      };
    },
    doc:function(path){return docRef(path,path.split('/').pop())}
  };
  function docRef(path,id){
    return {
      id:id,
      onSnapshot:function(cb){
        var f=function(){cb({data:function(){return mem[path]?Object.freeze(clone(mem[path])):undefined}})};
        listeners.push(f);setTimeout(f,0);
        return function(){listeners=listeners.filter(function(x){return x!==f})};
      },
      set:function(d){return write(path,d)},
      update:function(d){var cur=clone(mem[path]||{});Object.keys(d).forEach(function(k){cur[k]=d[k]});return write(path,cur)},
      delete:function(){return remove(path)}
    };
  }

  var assets={
    upload:function(blob){
      var id=rid()+rid();
      blobs[id]=blob;
      return put('blobs',id,blob).then(function(){return {id:id}});
    },
    delete:function(id){
      delete blobs[id];
      if(urls[id]){URL.revokeObjectURL(urls[id]);delete urls[id]}
      return put('blobs',id,undefined);
    }
  };
  window.coverSrc=function(id){
    if(!blobs[id])return '';
    if(!urls[id])urls[id]=URL.createObjectURL(blobs[id]);
    return urls[id];
  };

  var ready=open().then(function(d){idb=d;return Promise.all([readAll('docs'),readAll('blobs')])}).catch(function(e){
    console.error('idb open',e);idb=null;return [{},{}];
  }).then(function(r){
    mem=r[0];blobs=r[1];
    try{var ls=JSON.parse(localStorage.getItem('leituras-docs')||'{}');Object.keys(ls).forEach(function(k){if(!(k in mem))mem[k]=ls[k]})}catch(e){}
    if(navigator.storage&&navigator.storage.persist){navigator.storage.persist().catch(function(){})}
  });
  window.claude={use:function(name){
    return ready.then(function(){return name==='db'?db:name==='assets'?assets:null});
  }};

  /* ---- Cópia de segurança ---- */
  function b2d(b){return new Promise(function(res){var r=new FileReader();r.onload=function(){res(r.result)};r.readAsDataURL(b)})}
  function d2b(u){return fetch(u).then(function(r){return r.blob()})}
  window.exportBackup=async function(){
    await ready;
    var out={version:1,docs:mem,blobs:{}};
    for(var k in blobs){out.blobs[k]=await b2d(blobs[k])}
    var blob=new Blob([JSON.stringify(out)],{type:'application/json'});
    var name='leituras-'+new Date().toISOString().slice(0,10)+'.json';
    var file=new File([blob],name,{type:'application/json'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      try{await navigator.share({files:[file],title:'Cópia das leituras'});return 'ok'}catch(e){if(e&&e.name==='AbortError')return 'cancel'}
    }
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();
    return 'ok';
  };
  window.importBackup=async function(file){
    await ready;
    var j=JSON.parse(await file.text());
    if(!j||!j.docs)throw new Error('arquivo inválido');
    for(var p in j.docs){mem[p]=j.docs[p];await put('docs',p,mem[p])}
    for(var id in (j.blobs||{})){blobs[id]=await d2b(j.blobs[id]);await put('blobs',id,blobs[id])}
    notify();
  };
})();
