import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../apps-script/Main.js", import.meta.url),"utf8");
const start=source.indexOf("// ---- Credentials Sheet integrity guard");
const end=source.indexOf("// Editor-only, READ-ONLY diagnostic for the UAT first-login password flow.",start);
assert.ok(start>=0 && end>start);

function fixture(){
  const headers=["user_id","employee_id / username","temporary_password","password_hash",
    "credential_status","activation_code_hash","activation_expires_at","activation_used_at",
    "password_set_at","password_changed_at","password_hash_version","display_name","role"];
  const vals=[headers,["U1","90001","temp-password","","","","","","","","","Example","AE"]];
  const rules=Array.from({length:10},()=>Array(13).fill(null));
  const roleRule={getCriteriaType:()=> "VALUE_IN_LIST",
    getCriteriaValues:()=>[["AE","SM","Management","Admin"]]};
  for(const col of [3,5,6,7,8,9,10,11])rules[1][col]=roleRule;
  rules[1][4]={getCriteriaType:()=> "VALUE_IN_LIST",
    getCriteriaValues:()=>[["pending_activation","active","disabled"]]};
  rules[1][12]=roleRule;
  const sheet={
    getLastRow:()=>2,getLastColumn:()=>13,getMaxRows:()=>10,
    getRange:(r,c,n=1,m=1)=>({
      getDisplayValues:()=>Array.from({length:n},(_,i)=>vals[r-1+i]?.slice(c-1,c-1+m)||Array(m).fill("")),
      getDataValidations:()=>Array.from({length:n},(_,i)=>rules[r-1+i].slice(c-1,c-1+m)),
      getDataValidation:()=>rules[r-1][c-1],
      clearDataValidations:()=>{for(let i=0;i<n;i++)for(let j=0;j<m;j++)rules[r-1+i][c-1+j]=null;},
    }),
  };
  const book={getName:()=> "UAT_Credentials",getSheetByName:n=>n==="UAT_Credentials"?sheet:null};
  const properties=new Map([["GEO_ENVIRONMENT","UAT"]]);
  const logs=[];
  const ctx={
    PropertiesService:{getScriptProperties:()=>({
      getProperty:k=>properties.get(k)||"",
      setProperty:(k,v)=>properties.set(k,v),
      deleteProperty:k=>properties.delete(k),
    })},
    SpreadsheetApp:{DataValidationCriteria:{VALUE_IN_LIST:"VALUE_IN_LIST"},
      openById:id=>{assert.equal(id,"test-id");return book;},flush:()=>{}},
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
    sheetIdFor_:()=> "test-id",
    throwUatError_:(status,msg)=>{const err=new Error(msg);err.status=status;throw err;},
    console:{log:x=>logs.push(x)},
    Set,JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start,end),ctx);
  const credential={user_id:"U1", "employee_id / username":"90001",
    password_hash:"",password_set_at:"",password_changed_at:"",credential_status:"",
    password_hash_version:"",temporary_password:"temp-password"};
  const store={geoCredentialUserToVerify:"U1",book_:()=>book,
    table:()=>({rows:[credential]})};
  return {ctx,props:properties,credential,store,vals,rules,logs,roleRule};
}
test("read-only schema preflight detects misplaced Role dropdowns without revealing any data",()=>{
  const x=fixture();
  const out=x.ctx.debugUatCredentialValidationReadiness();
  assert.equal(out.rows,1);
  assert.equal(out.role_dropdowns_on_password_fields,8);
  assert.equal(out.other_rules_on_password_fields,0);
  assert.equal(out.writable,false);
  assert.doesNotMatch(x.logs.join(""),/temp-password|Example|90001/);
  assert.throws(()=>x.ctx.geoAssertUatCredentialRowWritable_(x.store,x.credential),
    err=>err.status===503);
  assert.equal(x.credential.password_hash,"");
});
test("repair requires approval + exact workbook binding and changes no data or status/role dropdown",()=>{
  const x=fixture();
  assert.throws(()=>x.ctx.repairUatCredentialValidationApproved(),/explicit UAT approval/);
  x.props.set("GEO_UAT_CREDENTIAL_VALIDATION_FIX_APPROVED","YES");
  assert.throws(()=>x.ctx.repairUatCredentialValidationApproved(),/administrator-approved binding/);
  x.props.set("GEO_APPROVED_CREDENTIALS_SHEET_ID","test-id");
  const before=JSON.stringify(x.vals);
  const r=x.ctx.repairUatCredentialValidationApproved();
  assert.equal(r.ok,true);
  assert.equal(r.cleared_columns,9);
  assert.equal(r.values_changed,0);
  assert.equal(JSON.stringify(x.vals),before);
  assert.equal(x.rules[1][4]?.getCriteriaType(),"VALUE_IN_LIST","status must stay validated");
  assert.equal(x.rules[1][12]?.getCriteriaType(),"VALUE_IN_LIST","role must stay validated");
  assert.equal(x.ctx.debugUatCredentialValidationReadiness().writable,true);
  assert.equal(x.props.has("GEO_UAT_CREDENTIAL_VALIDATION_FIX_APPROVED"),false);
  assert.doesNotThrow(()=>x.ctx.geoAssertUatCredentialRowWritable_(x.store,x.credential));
});
test("unexpected custom validation blocks the entire repair before any rule is removed",()=>{
  const x=fixture();
  x.props.set("GEO_UAT_CREDENTIAL_VALIDATION_FIX_APPROVED","YES");
  x.props.set("GEO_APPROVED_CREDENTIALS_SHEET_ID","test-id");
  x.rules[1][9]={getCriteriaType:()=> "DATE_IS_VALID",getCriteriaValues:()=>[]};
  assert.throws(()=>x.ctx.repairUatCredentialValidationApproved(),/Unexpected validation/);
  assert.equal(x.rules[1][3],x.roleRule);
  assert.equal(x.rules[1][4]?.getCriteriaType(),"VALUE_IN_LIST");
});
test("physical post-flush readback must match hash/status/timestamps and never relies only on memory",()=>{
  const x=fixture();
  x.ctx.repairUatCredentialValidationApproved =()=>{}; // separate approved schema repair already tested
  x.credential.password_hash="hmac-sha256-v1$"+ "a".repeat(32) +"$"+"z".repeat(43);
  x.credential.password_hash_version="hmac-sha256-v1";
  x.credential.password_set_at="2026-10-27T01:00:00.000Z";
  x.credential.password_changed_at="2026-10-27T01:00:00.000Z";
  x.credential.credential_status="active";
  x.credential.temporary_password="";
  for(const [field,v] of Object.entries(x.credential)){
    const col=x.vals[0].indexOf(field);if(col>=0)x.vals[1][col]=v;
  }
  assert.doesNotThrow(()=>x.ctx.geoVerifyUatCredentialPersisted_(x.store));
  x.vals[1][3]="";
  assert.throws(()=>x.ctx.geoVerifyUatCredentialPersisted_(x.store),e=>e.status===503);
  x.vals[1][3]=x.credential.password_hash;
  x.vals[1][4]="pending_activation";
  assert.throws(()=>x.ctx.geoVerifyUatCredentialPersisted_(x.store),e=>e.status===503);
});
test("password write paths use guard before mutation and post-flush physical verification",()=>{
  const handle=source.slice(source.indexOf("function handle_(req)"),source.indexOf("function uatLogin_("));
  assert.match(handle,/store\.flush\(\);\s*geoVerifyUatCredentialPersisted_\(store\);\s*return activationResult;/);
  assert.match(handle,/store\.flush\(\);\s*geoVerifyUatCredentialPersisted_\(store\);\s*return passwordSetupResult;/);
  const temp=source.slice(source.indexOf("function completeUatTemporaryPasswordSetup_"),source.indexOf("// ---- Opt-in UAT Corporate Email Activation"));
  assert.ok(temp.indexOf("geoAssertUatCredentialRowWritable_(store, c)")<temp.indexOf("c.password_hash ="));
  const activation=source.slice(source.indexOf("function completeUatActivation_"),source.indexOf("// Read-only UAT setup audit."));
  assert.ok(activation.indexOf("geoAssertUatCredentialRowWritable_(store, c)")<activation.indexOf("c.password_hash ="));
  assert.doesNotMatch(handle,/debugUatCredentialValidationReadiness|repairUatCredentialValidationApproved/);
});
