const fs=require('fs');const run=require('./run');
const mk=(name,nodes,edges)=>{const f=__dirname+'/graphs/syn-'+name+'.json';fs.writeFileSync(f,JSON.stringify({data:{pathwayGraph:{nodes:nodes.map(([id,type,p])=>({id,type,properties:JSON.stringify({title:id,...p})})),edges:edges.map(([from,to,type,p])=>({from,to,type,properties:p?JSON.stringify(p):null}))}}}));return f};
const base={patientId:'p',conditionCodes:[],medications:[],allergies:[],vitalSigns:{},freeformData:{},patientAttributes:{},labResults:[{code:'718-7',system:'LOINC',value:12,date:'2026-09-20'}]};
(async()=>{
// dependent gate reached BEFORE the closing gate (stage-2 edge listed first, and dep gate shallower)
const P=mk('dep-order',[['root','Pathway'],['stage-1','Stage'],['step-a','Step'],['gate-closed','Gate',{gate_type:'patient_attribute',condition:{field:'labs',value:'718-7',system:'LOINC',operator:'less_than',threshold:7},default_behavior:'skip'}],['step-hidden','Step'],['stage-2','Stage'],['gate-dep','Gate',{gate_type:'prior_node_result',depends_on:[{node_id:'step-hidden',status:'INCLUDED'}],default_behavior:'skip'}],['step-after','Step'],['med-x','Medication',{name:'X'}]],
 [['root','stage-2','HAS_STAGE'],['root','stage-1','HAS_STAGE'],['stage-1','step-a','HAS_STEP'],['step-a','gate-closed','HAS_GATE'],['gate-closed','step-hidden','BRANCHES_TO'],['stage-2','gate-dep','HAS_GATE'],['gate-dep','step-after','BRANCHES_TO'],['step-after','med-x','USES_MEDICATION']]);
console.log('=== dep gate evaluated before closing gate (Hb 12 => closed)');run.show(await run(P,base));
// reconverge order: step-r reachable via closed gate (listed first) and via open stage
const R=mk('reconv',[['root','Pathway'],['stage-1','Stage'],['gate-no','Gate',{gate_type:'patient_attribute',condition:{field:'labs',value:'718-7',system:'LOINC',operator:'less_than',threshold:7},default_behavior:'skip'}],['step-r','Step'],['med-r','Medication',{name:'R'}],['stage-2','Stage']],
 [['root','stage-1','HAS_STAGE'],['root','stage-2','HAS_STAGE'],['stage-1','gate-no','HAS_GATE'],['gate-no','step-r','BRANCHES_TO'],['stage-2','step-r','HAS_STEP'],['step-r','med-r','USES_MEDICATION']]);
console.log('=== reconverge: gate(closed) at depth2 and stage-2 HAS_STEP at depth2 -> step-r depth 3 vs 2');run.show(await run(R,base));
const R2=mk('reconv2',[['root','Pathway'],['stage-1','Stage'],['gate-no','Gate',{gate_type:'patient_attribute',condition:{field:'labs',value:'718-7',system:'LOINC',operator:'less_than',threshold:7},default_behavior:'skip'}],['step-r','Step'],['med-r','Medication',{name:'R'}],['stage-2','Stage'],['step-mid','Step']],
 [['root','stage-1','HAS_STAGE'],['root','stage-2','HAS_STAGE'],['stage-1','gate-no','HAS_GATE'],['gate-no','step-r','BRANCHES_TO'],['stage-2','step-mid','HAS_STEP'],['step-mid','step-r','HAS_STEP'],['step-r','med-r','USES_MEDICATION']]);
console.log('=== reconverge equal depth: closed gate path vs open path, both depth 3 (gate first)');run.show(await run(R2,base));
})();
