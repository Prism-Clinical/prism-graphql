const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[2]));const g=j.data.pathwayGraph;const P=x=>typeof x==='string'?JSON.parse(x):x;
const N={};g.nodes.forEach(n=>N[n.id]={...n,p:P(n.properties)});const skip=new Set(['CITES_EVIDENCE','HAS_CODE','HAS_QUALITY_METRIC']);
const adj={};g.edges.forEach(e=>{if(!skip.has(e.type))(adj[e.from]=adj[e.from]||[]).push(e)});
const seen=new Set();function t(id,d,via){const n=N[id];const p=n.p||{};const extra=['branch_mode','default_behavior','gate_type','answer_type','name','interpretation','depends_on','outcome','drug','role','branch_value','condition_value'].filter(k=>p[k]!==undefined).map(k=>k+'='+JSON.stringify(p[k]).slice(0,120)).join(' ');
console.log('  '.repeat(d)+(via?'['+via+'] ':'')+n.type+' '+id+' "'+(p.title||p.name||p.description||'').slice(0,70)+'" '+extra+(seen.has(id)?' (seen)':''));if(seen.has(id))return;seen.add(id);for(const e of adj[id]||[]){const ep=P(e.properties);t(e.to,d+1,e.type+(ep&&Object.keys(ep).length?' '+JSON.stringify(ep).slice(0,150):''))}}
t('root',0,'');
