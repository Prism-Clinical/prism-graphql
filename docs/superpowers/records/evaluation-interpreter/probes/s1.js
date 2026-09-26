const run=require('./run');const G=__dirname+'/graphs/';
(async()=>{
const A=G+'a1774566-42ce-43cc-b83c-1a5749b240e1.json';
const base={patientId:'p',conditionCodes:[],medications:[],allergies:[],vitalSigns:{},freeformData:{}};
console.log('=== ANEMIA 1.4 (ACTIVE), non-anemic T2 patient Hb 12.5, ferritin 80, dated');
let t=await run(A,{...base,labResults:[{code:'718-7',system:'LOINC',value:12.5,date:'2026-09-20'},{code:'2276-4',system:'LOINC',value:80,date:'2026-09-20'}],patientAttributes:{trimester:2}});
run.show(t,['step','gate','dp','med','proc','stage']);
})().catch(e=>{console.error(e);process.exit(1)});
