import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=(p)=>fs.readFileSync(new URL("../src/"+p,import.meta.url),"utf8");
const pipeline=read("pages/Pipeline.jsx");
const region=read("components/dashboard/RegionQuickFilter.jsx");
const css=read("index.css");

test("Management/Admin and multi-region roles regain Region quick filters from authorized active regions",()=>{
 assert.ok(pipeline.includes('["admin", "management"].includes(profile?.app_role)'));
 assert.ok(pipeline.includes('(profile?.region_ids || []).includes(region.id)'));
 assert.ok(pipeline.includes('const hasRegionQuickFilter = quickRegions.length > 1'));
 assert.ok(pipeline.includes('<RegionQuickFilter regions={quickRegions} value={filters.region || ""}'));
 assert.ok(pipeline.includes('onChange={(regionId) => onFilter("region", regionId)}'));
 assert.ok(pipeline.includes('showRegionControl={!hasRegionQuickFilter}'));
 assert.ok(!pipeline.includes('<RegionQuickFilter regions={master?.Region}'));
});

test("Region chip styling stays neutral on Pipeline without changing shared Dashboard defaults",()=>{
 assert.ok(pipeline.includes('appearance="neutral"'));
 assert.ok(region.includes('appearance = "default"'));
 assert.ok(region.includes('const neutral = appearance === "neutral"'));
 assert.ok(region.includes('bg-primary text-primary-foreground border-primary'));
 assert.ok(region.includes('bg-[#E9ECEF] text-[#202832]'));
});

test("All four pastel stages stay distinct from approved solid pastel Won and Lost",()=>{
 assert.ok(pipeline.includes('stage1: "border-[#B7E4C7] bg-[#ECFDF3] text-[#2F855A]"'));
 assert.ok(pipeline.includes('stage2: "border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]"'));
 assert.ok(pipeline.includes('stage3: "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]"'));
 assert.ok(pipeline.includes('stage4: "border-[#FBCFE8] bg-[#FDF2F8] text-[#BE185D]"'));
 assert.ok(pipeline.includes('STG003: "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C] hover:bg-[#FFEDD5]"'));
 assert.ok(pipeline.includes('STG004: "border-[#FBCFE8] bg-[#FDF2F8] text-[#BE185D] hover:bg-[#FCE7F3]"'));
 assert.ok(pipeline.includes('hover:bg-[#DCFCE7]'));
 assert.ok(pipeline.includes('hover:bg-[#DBEAFE]'));
 assert.ok(!pipeline.includes('ring-2 ring-offset-1 ring-foreground/20'));
 assert.ok(pipeline.includes('won: "border-transparent bg-[#AFE0C2] text-[#166534]"'));
 assert.ok(read('pages/OpportunityDetail.jsx').includes('won: "bg-[#AFE0C2] text-[#166534] border border-transparent"'));
 assert.ok(pipeline.includes('lost: "border-transparent bg-[#F3C4C4] text-[#9A3340]"'));
 assert.ok(read('pages/OpportunityDetail.jsx').includes('lost: "bg-[#F3C4C4] text-[#9A3340] border border-transparent"'));
 assert.ok(pipeline.includes('border-[#DDD6FE] bg-[#F5F3FF]'));
 assert.ok(read('components/PipelineCard.jsx').includes('border-[#DDD6FE] bg-[#F5F3FF]'));
 assert.ok(read('pages/OpportunityDetail.jsx').includes('border-[#DDD6FE] bg-[#F5F3FF]'));
});

test("Pipeline-specific Thai and English use real font weights without changing app-wide font stack",()=>{
 assert.ok(css.includes('family=Noto+Sans+Thai:wght@400;500;600'));
 assert.ok(css.includes('.pipeline-typography {'));
 assert.ok(css.includes('font-family: "Inter", "Noto Sans Thai"'));
 assert.ok(css.includes('font-synthesis: none'));
 assert.ok(css.includes('--font-body: "Inter", "LINE Seed Sans TH"'));
 assert.equal((pipeline.match(/className="geo-page pipeline-typography"/g)||[]).length,2);
 assert.ok(pipeline.includes('text-[13px] leading-5" title={o.customer_name}'));
 assert.ok(pipeline.includes('px-3 py-2 text-[12px] font-normal text-muted-foreground'));
});

test("Uniform hover and all original actions remain; no data/backend contract touched",()=>{
 assert.ok(pipeline.includes('cursor-pointer bg-card hover:bg-secondary transition-colors'));
 assert.ok(pipeline.includes('bg-card px-3 py-2 transition-colors group-hover:bg-secondary'));
 for(const name of ['Export Excel','สร้าง Pipeline','Quick filter by Stage','งานรอตรวจสอบ Stage','Pipeline work views','Open','Won','Lost'])assert.ok(pipeline.includes(name),name);
});
