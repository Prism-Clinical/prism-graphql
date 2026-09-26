const fs=require('fs');const f=process.argv[2];const j=JSON.parse(fs.readFileSync(f));if(j.errors){console.log('ERR',JSON.stringify(j.errors));process.exit()}
const g=j.data.pathwayGraph;const P=x=>typeof x==='string'?JSON.parse(x):x;
const nodes=g.nodes.map(n=>({...n,p:P(n.properties)}));const edges=g.edges.map(e=>({...e,p:P(e.properties)}));
const byType={};nodes.forEach(n=>byType[n.type]=(byType[n.type]||0)+1);console.log('NODES',nodes.length,JSON.stringify(byType));
const et={};edges.forEach(e=>et[e.type]=(et[e.type]||0)+1);console.log('EDGES',edges.length,JSON.stringify(et));
for(const n of nodes.filter(n=>n.type==='Gate'))console.log('GATE',n.id,JSON.stringify(n.p).slice(0,700));
for(const n of nodes.filter(n=>n.type==='DecisionPoint'))console.log('DP',n.id,JSON.stringify(n.p).slice(0,400));
for(const n of nodes)if(n.p&&(n.p.depends_on||n.p.dependsOn))console.log('DEPENDS',n.type,n.id,JSON.stringify(n.p.depends_on||n.p.dependsOn));
const par={};edges.forEach(e=>{(par[e.to]=par[e.to]||[]).push(`${e.from}-[${e.type}]`)});
for(const [k,v] of Object.entries(par))if(v.length>1){const t=nodes.find(n=>n.id===k);console.log('MULTIPARENT',t&&t.type,k,'<=',v.join(' , '))}
for(const e of edges)if(e.type==='BRANCHES_TO'||e.type==='ESCALATES_TO'||/GATE|DEPENDS|REQUIRES/.test(e.type))console.log('EDGE',e.type,e.from,'->',e.to,e.p&&Object.keys(e.p).length?JSON.stringify(e.p).slice(0,200):'');
// cycle detection
const adj={};edges.forEach(e=>(adj[e.from]=adj[e.from]||[]).push(e.to));const col={};let cyc=[];
function dfs(u,st){col[u]=1;st.push(u);for(const v of adj[u]||[]){if(col[v]===1)cyc.push(st.slice(st.indexOf(v)).concat(v).join('>'));else if(!col[v])dfs(v,st)}st.pop();col[u]=2}
nodes.forEach(n=>{if(!col[n.id])dfs(n.id,[])});console.log('CYCLES',cyc.length?cyc.join(' | '):'none');
const roots=nodes.filter(n=>!par[n.id]).map(n=>n.type+':'+n.id);console.log('ROOTS',roots.join(' '));
