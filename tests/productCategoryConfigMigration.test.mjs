import test from "node:test";
import assert from "node:assert/strict";
import { loadContract } from "../server/contract.js";
import { ENTITIES } from "../server/entities.js";
import { createCore } from "../server/core.js";
import { seedData } from "../server/seed.js";
import { readFileSync } from "node:fs";

const contract = loadContract(new URL("../b2b_geo_pipeline.yaml", import.meta.url));
const CFG = "B2B_GEO_Pipeline_Config.xlsx";
const ORG = "B2B_GEO_User_Org_Master.xlsx";

test("Config is the only runtime product-category source", () => {
  const files = contract.access.files;
  assert.equal(files["B2B_Product_Master.xlsx"], undefined);
  assert.equal(files[CFG].sheets.Product_Categories.entity, "product_categories");
  assert.equal(files[CFG].sheets.Product_Categories.primary_key, "category_id");
  assert.equal(ENTITIES.Product, undefined);
  assert.equal(contract.columns.product_categories.includes("category_id"), true);
  assert.equal(contract.references.product_categories.some(r => r.entity === "opportunities" && r.col === "product_category_id"), true);
});

test("Frontend never fetches Products master and uses free-text product_details", () => {
  const dataContext = readFileSync(new URL("../src/lib/dataContext.jsx", import.meta.url), "utf8");
  const create = readFileSync(new URL("../src/components/CreatePipelineModal.jsx", import.meta.url), "utf8");
  const edit = readFileSync(new URL("../src/components/OpportunityForm.jsx", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../src/pages/Admin.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(dataContext, /"Product",/);
  assert.doesNotMatch(admin, /ProductManager/);
  for (const form of [create,edit]) {
    assert.match(form, /value=\{form\.product_details(?: \|\| "")?\}/);
    assert.match(form, /onChange=\{\(e\) => set\("product_details", e\.target\.value\)\}/);
  }
});

test("Backend reads Config categories and persists arbitrary product description", () => {
  const seed = seedData(), tables = {};
  const store = {
    table(file,sheet) {
      const key = file+"/"+sheet;
      if(!tables[key]) tables[key] = {
        headers: Object.keys((seed[file]?.[sheet]||[])[0]||{}),
        rows: structuredClone(seed[file]?.[sheet]||[])
      };
      return tables[key];
    },
    touch(){},
  };
  let n = 0;
  const core = createCore({contract,store,now:()=>"2026-10-19T08:00:00.000Z",uuid:()=>String(++n)});
  const admin = "USR-ADMIN";
  // Use any configured active admin account in seed and read category list.
  const users = store.table(ORG,"Users").rows;
  const id = users.find(u=>u.role==="Admin")?.user_id;
  assert.ok(id,"Admin seed account is required");
  const cats = core.handle({method:"GET",path:"entities/ProductCategory",userId:id});
  assert.ok(cats.length>0);
  assert.equal(cats[0].name,seed[CFG].Product_Categories[0].category_name);
  const ops = core.handle({method:"GET",path:"entities/Opportunity",userId:id});
  assert.ok(ops.length>0);
  const chosen=ops[0];
  const phrase="Special tailored circuit + on-site installation";
  const updated=core.handle({method:"PUT",path:"entities/Opportunity/"+encodeURIComponent(chosen.id),userId:id,body:{product_details:phrase,expected_updated_at:String(chosen.updated_date||"")}});
  assert.equal(updated.product_details,phrase);
});
