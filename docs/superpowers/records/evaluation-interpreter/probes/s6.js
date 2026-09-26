const run=require('./run');const G=__dirname+'/graphs/';
const H=G+'9ee949c9-625a-48ac-873b-c121e8fd24e2.json',A=G+'a1774566-42ce-43cc-b83c-1a5749b240e1.json',L=G+'syn-llm.json';
const base={patientId:'p',conditionCodes:[],medications:[],allergies:[],vitalSigns:{},freeformData:{},patientAttributes:{}};
const bp=[{code:'8480-6',system:'LOINC',value:150,date:'2026-09-23'},{code:'8462-4',system:'LOINC',value:95,date:'2026-09-23'}];
const ov=(id,a)=>new Map([[id,{action:a,originalStatus:'PENDING_QUESTION',originalConfidence:0}]]);
(async()=>{
console.log('=== H7 GHTN BP high, override INCLUDE gate-htn-confirmed (reachable, 2 unmapped arms)');run.show(await run(H,{...base,labResults:bp},{overrides:ov('gate-htn-confirmed','INCLUDE')}),['gate-htn','step-2-3','step-2-4','dp-1','stage-3']);
console.log('=== L2 LLM gate override INCLUDE (mapped arms)');run.show(await run(L,base,{overrides:ov('gate-llm','INCLUDE'),llm:async()=>({chosenBranch:'routine',confidence:0.95,reasoning:''})}));
console.log('=== A11 anemia override INCLUDE dp-1 (one_of, both arms), Hb 9 T1');run.show(await run(A,{...base,labResults:[{code:'718-7',system:'LOINC',value:9,date:'2026-09-20'},{code:'2276-4',system:'LOINC',value:12,date:'2026-09-20'}],patientAttributes:{trimester:1}},{overrides:ov('dp-1','INCLUDE')}),['dp-1','step-2-3','step-3-1','gate-iron','lab-5','crit']);
console.log('=== H8 override EXCLUDE gate-bp-elevated with BP high');run.show(await run(H,{...base,labResults:bp},{overrides:ov('gate-bp-elevated','EXCLUDE')}),['gate-bp','step-2-2','gate-htn-confirmed']);
})();
