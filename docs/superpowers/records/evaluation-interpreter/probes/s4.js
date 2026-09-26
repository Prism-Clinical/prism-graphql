const fs=require('fs');const run=require('./run');
const mk=(name,nodes,edges)=>{const f=__dirname+'/graphs/syn-'+name+'.json';fs.writeFileSync(f,JSON.stringify({data:{pathwayGraph:{nodes:nodes.map(([id,type,p])=>({id,type,properties:JSON.stringify({title:id,...p})})),edges:edges.map(([from,to,type,p])=>({from,to,type,properties:p?JSON.stringify(p):null}))}}}));return f};
const base={patientId:'p',conditionCodes:[],medications:[],allergies:[],vitalSigns:{},freeformData:{},labResults:[],patientAttributes:{}};
const T=async(t,f,p,o)=>{console.log('\n=== '+t);try{run.show(await run(f,p,o))}catch(e){console.log('THREW',e.message.slice(0,200))}};
(async()=>{
// LLM gate
const L=mk('llm',[['root','Pathway'],['stage-1','Stage'],['step-1','Step'],['gate-llm','Gate',{gate_type:'llm_text_analysis',prompt:'urgent?',input_attribute:'freeform.note',branches:[{name:'urgent'},{name:'routine',is_safe_default:true}],confidence_threshold:0.75,default_behavior:'skip'}],['step-urgent','Step'],['step-routine','Step'],['med-a','Medication',{name:'A'}]],
 [['root','stage-1','HAS_STAGE'],['stage-1','step-1','HAS_STEP'],['step-1','gate-llm','HAS_GATE'],['gate-llm','step-urgent','BRANCHES_TO',{when:{equals:'urgent'}}],['gate-llm','step-routine','BRANCHES_TO',{when:{equals:'routine'}}],['step-urgent','med-a','USES_MEDICATION']]);
await T('LLM no evaluator',L,base,{});
await T('LLM urgent conf .9',L,base,{llm:async()=>({chosenBranch:'urgent',confidence:0.9,reasoning:'r'})});
await T('LLM urgent conf .5 (tentative)',L,base,{llm:async()=>({chosenBranch:'urgent',confidence:0.5,reasoning:'r'})});
await T('LLM failed',L,base,{llm:async()=>({failed:true,errorMessage:'timeout',chosenBranch:'',confidence:0})});
// prior_node_result depends_on a node inside a closed branch
const P=mk('dep',[['root','Pathway'],['stage-1','Stage'],['step-a','Step'],['gate-closed','Gate',{gate_type:'patient_attribute',condition:{field:'labs',value:'718-7',system:'LOINC',operator:'less_than',threshold:7},default_behavior:'skip'}],['step-hidden','Step'],['stage-2','Stage'],['step-b','Step'],['gate-dep','Gate',{gate_type:'prior_node_result',depends_on:[{node_id:'step-hidden',status:'INCLUDED'}],default_behavior:'skip'}],['step-after','Step'],['med-x','Medication',{name:'X'}]],
 [['root','stage-1','HAS_STAGE'],['root','stage-2','HAS_STAGE'],['stage-1','step-a','HAS_STEP'],['step-a','gate-closed','HAS_GATE'],['gate-closed','step-hidden','BRANCHES_TO'],['stage-2','step-b','HAS_STEP'],['step-b','gate-dep','HAS_GATE'],['gate-dep','step-after','BRANCHES_TO'],['step-after','med-x','USES_MEDICATION']]);
await T('depends_on node in closed branch, Hb 12 (closed)',P,{...base,labResults:[{code:'718-7',system:'LOINC',value:12,date:'2026-09-20'}]});
await T('depends_on node in closed branch, Hb 6 (open)',P,{...base,labResults:[{code:'718-7',system:'LOINC',value:6,date:'2026-09-20'}]});
// depends_on a node that is never reachable (orphan)
const O=mk('dep-orphan',[['root','Pathway'],['stage-1','Stage'],['step-b','Step'],['gate-dep','Gate',{gate_type:'prior_node_result',depends_on:[{node_id:'step-orphan',status:'INCLUDED'}],default_behavior:'skip'}],['step-after','Step'],['step-orphan','Step']],
 [['root','stage-1','HAS_STAGE'],['stage-1','step-b','HAS_STEP'],['step-b','gate-dep','HAS_GATE'],['gate-dep','step-after','BRANCHES_TO']]);
await T('depends_on unreachable orphan step',O,base);
// ESCALATES_TO
const E=mk('esc',[['root','Pathway'],['stage-1','Stage'],['step-1','Step'],['med-1','Medication',{name:'first'}],['med-2','Medication',{name:'second'}]],[['root','stage-1','HAS_STAGE'],['stage-1','step-1','HAS_STEP'],['step-1','med-1','USES_MEDICATION'],['med-1','med-2','ESCALATES_TO']]);
await T('ESCALATES_TO second-line',E,base);
})();
