// Sample data for local development, written only for workbooks missing
// from DATA_DIR. Drop the real master files into data/ to use them instead.
// Column names follow b2b_geo_pipeline.yaml.

const now = new Date();
const iso = (daysAgo = 0) => new Date(now.getTime() - daysAgo * 86400000).toISOString();
const month = (offset = 0) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const regions = [
  ["REG-BKK", "Bangkok"],
  ["REG-CEN", "Central"],
  ["REG-NOR", "North"],
  ["REG-NE", "Northeast"],
  ["REG-SOU", "South"],
];

const users = [
  ["USR-ADMIN", "E0001", "Admin User", "admin@local.test", "Admin", ""],
  ["USR-MGMT", "E0002", "Management User", "mgmt@local.test", "Management", ""],
  ["USR-SM1", "E0101", "สมชาย SM กรุงเทพ", "sm.bkk@local.test", "SM", "REG-BKK"],
  ["USR-SM2", "E0102", "สมหญิง SM ภูมิภาค", "sm.region@local.test", "SM", "REG-NOR"],
  ["USR-AE1", "E0201", "อนันต์ AE", "ae1@local.test", "AE", "REG-BKK"],
  ["USR-AE2", "E0202", "บุษบา AE", "ae2@local.test", "AE", "REG-BKK"],
  ["USR-AE3", "E0203", "ชัยวัฒน์ AE", "ae3@local.test", "AE", "REG-NOR"],
  ["USR-AE4", "E0204", "ปรียา AE", "ae4@local.test", "AE", "REG-NE"],
];

const userRegions = [
  ["USR-SM1", "REG-BKK"],
  ["USR-SM1", "REG-CEN"],
  ["USR-SM2", "REG-NOR"],
  ["USR-SM2", "REG-NE"],
  ["USR-SM2", "REG-SOU"],
  ["USR-AE1", "REG-BKK"],
  ["USR-AE2", "REG-BKK"],
  ["USR-AE3", "REG-NOR"],
  ["USR-AE4", "REG-NE"],
];

const categories = [
  ["CAT-CONN", "Connectivity"],
  ["CAT-CLOUD", "Cloud & Data Center"],
  ["CAT-SEC", "Cyber Security"],
  ["CAT-MOB", "Enterprise Mobility"],
];

const products = [
  ["PRD-INET", "Corporate Internet", "CAT-CONN"],
  ["PRD-MPLS", "MPLS / SD-WAN", "CAT-CONN"],
  ["PRD-IAAS", "Public Cloud IaaS", "CAT-CLOUD"],
  ["PRD-COLO", "Co-location", "CAT-CLOUD"],
  ["PRD-SOC", "Managed SOC", "CAT-SEC"],
  ["PRD-FW", "Managed Firewall", "CAT-SEC"],
  ["PRD-SIM", "Corporate SIM", "CAT-MOB"],
  ["PRD-IOT", "IoT Solution", "CAT-MOB"],
];

const stages = [
  ["STG-01", "Lead", 10],
  ["STG-02", "Qualified", 25],
  ["STG-03", "Proposal", 50],
  ["STG-04", "Negotiation", 75],
  ["STG-05", "Commit", 90],
];

const named = (prefix, names) => names.map((n, i) => [`${prefix}-${String(i + 1).padStart(2, "0")}`, n]);

const scenarios = named("SCN", ["New Customer", "Upsell", "Renewal", "Migration"]);
const lostReasons = named("LRS", [
  "Price",
  "Competitor",
  "Budget Issue",
  "Customer Postponed",
  "No Response",
  "Requirement Changed",
  "Internal Limitation",
  "Duplicate / Invalid Opportunity",
  "Other",
]);
const workingWith = named("TEAM", ["Presales", "Pricing", "Product", "Fulfillment", "Operation", "Other"]);
const supportTypes = named("SUP", ["Pricing", "Product", "Internal Coordination", "Customer Issue", "Other"]);

const customers = [
  "บริษัท สยามโลจิสติกส์ จำกัด",
  "โรงพยาบาลเชียงใหม่เวชการ",
  "มหาวิทยาลัยขอนแก่นเทคโนโลยี",
  "Bangkok Retail Group",
  "Thai Auto Parts Co., Ltd.",
  "กรมพัฒนาดิจิทัลท้องถิ่น",
  "Andaman Resort & Spa",
  "Northern Agro Industry",
  "Metro Condo Management",
  "Eastern Seaboard Factory",
  "ธนาคารชุมชนพัฒนา",
  "Smart School Network",
];

function opportunities() {
  const aeRegion = { "USR-AE1": "REG-BKK", "USR-AE2": "REG-BKK", "USR-AE3": "REG-NOR", "USR-AE4": "REG-NE" };
  const aes = Object.keys(aeRegion);
  return customers.map((customer, i) => {
    const owner = aes[i % aes.length];
    const product = products[i % products.length];
    const stage = stages[i % stages.length];
    const handedToSm = i % 4 === 1;
    const handler = handedToSm ? (aeRegion[owner] === "REG-BKK" ? "USR-SM1" : "USR-SM2") : owner;
    const created = 20 + i * 3;
    const status = i === 10 ? "Won" : i === 11 ? "Lost" : "Open";
    return {
      opportunity_id: `OPP-${String(1001 + i)}`,
      customer_name: customer,
      business_id: `BID-${String(5000 + i)}`,
      customer_type: ["Enterprise", "Government", "SME", "Education"][i % 4],
      scenario_id: scenarios[i % scenarios.length][0],
      region_id: aeRegion[owner],
      territory_id: "",
      original_owner_user_id: owner,
      owner_user_id: owner,
      current_handler_user_id: handler,
      product_category_id: product[2],
      product_id: product[0],
      stage_id: stage[0],
      status,
      expected_close_month: month(i % 4),
      quantity: 1 + (i % 5),
      rc: 25000 * (1 + (i % 6)),
      oc: 50000 * (i % 3),
      discount_pct: (i % 3) * 5,
      contract_period_months: [12, 24, 36][i % 3],
      pipeline_value: 300000 * (1 + (i % 7)),
      created_at: iso(created),
      updated_at: iso(i % 9),
      created_month: iso(created).slice(0, 7),
      created_by_user_id: owner,
      stage_entered_at: iso(3 + ((i * 5) % 40)),
      handler_since: iso(handedToSm ? 2 + (i % 10) : created),
      working_with_id: i % 3 === 0 ? workingWith[i % workingWith.length][0] : "",
      working_with_since: i % 3 === 0 ? iso(5 + i) : "",
      support_needed: i % 5 === 2 ? "Yes" : "No",
      support_type_id: i % 5 === 2 ? "SUP-01" : "",
      support_note: i % 5 === 2 ? "ลูกค้าขอส่วนลดเพิ่ม 10% ต้องการอนุมัติ" : "",
      won_at: status === "Won" ? iso(1) : "",
      won_by_user_id: status === "Won" ? owner : "",
      lost_at: status === "Lost" ? iso(2) : "",
      lost_by_user_id: status === "Lost" ? owner : "",
      lost_reason_id: status === "Lost" ? "LRS-02" : "",
      lost_note: status === "Lost" ? "เลือกผู้ให้บริการรายอื่น" : "",
    };
  });
}

function events(opps) {
  const rows = [];
  opps.forEach((o, i) => {
    rows.push({
      event_id: "",
      opportunity_id: o.opportunity_id,
      event_type: "create",
      field_name: "",
      previous_value: "",
      new_value: "Opportunity created",
      actor_user_id: o.owner_user_id,
      actor_name: users.find((u) => u[0] === o.owner_user_id)[2],
      event_at: o.created_at,
      remark: "",
    });
    if (o.current_handler_user_id !== o.owner_user_id) {
      rows.push({
        event_id: "",
        opportunity_id: o.opportunity_id,
        event_type: "handler_change",
        field_name: "current_handler",
        previous_value: users.find((u) => u[0] === o.owner_user_id)[2],
        new_value: users.find((u) => u[0] === o.current_handler_user_id)[2],
        actor_user_id: o.owner_user_id,
        actor_name: users.find((u) => u[0] === o.owner_user_id)[2],
        event_at: o.handler_since,
        remark: "ช่วยอนุมัติส่วนลด",
      });
    }
  });
  return rows.map((r, i) => ({ ...r, event_id: `EVT${String(i + 1).padStart(6, "0")}` }));
}

const t = (rows) => rows;
const active = (rows, cols) => rows.map((r, i) => ({ ...Object.fromEntries(cols.map((c, j) => [c, r[j]])), sort_order: i + 1, active: "Yes" }));

export function seedData() {
  const opps = opportunities();
  return {
    "B2B_GEO_User_Org_Master.xlsx": {
      Users: t(
        users.map(([user_id, employee_id, display_name, email, role, default_region_id]) => ({
          user_id,
          employee_id,
          display_name,
          email,
          role,
          status: "Active",
          default_region_id,
          default_territory_id: "",
        }))
      ),
      User_Region: userRegions.map(([user_id, region_id], i) => ({
        user_region_id: `UR-${String(i + 1).padStart(3, "0")}`,
        user_id,
        region_id,
        is_primary: users.find((u) => u[0] === user_id)[5] === region_id ? "Yes" : "No",
        active: "Yes",
        effective_from: "",
        effective_to: "",
      })),
      Regions: active(regions, ["region_id", "region_name"]),
      Territories: regions.map(([region_id, name], i) => ({
        territory_id: `TER-${String(i + 1).padStart(2, "0")}`,
        territory_name: `${name} Metro`,
        region_id,
        active: "Yes",
      })),
    },
    "B2B_Product_Master.xlsx": {
      Product_Categories: active(categories, ["category_id", "category_name"]),
      Products: active(products, ["product_id", "product_name", "category_id"]),
    },
    "B2B_GEO_Pipeline_Config.xlsx": {
      Stages: active(stages, ["stage_id", "stage_name", "weight_pct"]),
      Scenarios: active(scenarios, ["scenario_id", "scenario_name"]),
      Lost_Reasons: active(lostReasons, ["reason_id", "reason_name"]),
      Working_With: active(workingWith, ["team_id", "team_name"]),
      Support_Types: active(supportTypes, ["support_type_id", "support_type_name"]),
      Aging_Settings: [
        { setting_id: "AGE001", setting_name: "Stage Aging — Stuck Pipeline", threshold_days: 14, active: "Yes", notes: "" },
      ],
    },
    "B2B_GEO_Pipeline_DB.xlsx": {
      Opportunities: opps,
      Opportunity_Events: events(opps),
      Monthly_Snapshots: [],
    },
  };
}
