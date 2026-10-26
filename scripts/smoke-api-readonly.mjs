// Optional read-only Apps Script endpoint smoke test.
// Do not run with customer credentials or in public CI.
// Usage: GEO_API_URL=<approved existing Apps Script /exec> node scripts/smoke-api-readonly.mjs
// Optional authorized test account only: GEO_TEST_SESSION_TOKEN=<short-lived test token>.
import { validateApiContract } from "../src/lib/apiContract.js";

export async function probeApi({ apiUrl, sessionToken = "", fetchImpl = fetch }) {
  let url;
  try { url = new URL(apiUrl); } catch { throw Error("GEO_API_URL must be an absolute URL"); }
  if(url.protocol !== "https:" || url.hostname !== "script.google.com" ||
     !url.pathname.endsWith("/exec") || url.username || url.password || url.search || url.hash) {
    throw Error("GEO_API_URL must be an approved script.google.com HTTPS /exec endpoint without query data");
  }
  // Public health is a read-only GET. No session token is used here.
  const healthResponse=await fetchImpl(url.href,{method:"GET",redirect:"follow"});
  const health=await healthResponse.json().catch(()=>null);
  if(!healthResponse.ok || health?.status !== 200 ||
     health?.health !== true || health?.body?.service !== "B2B GEO Pipeline API") {
    throw Error("Backend health response does not match the expected API envelope");
  }
  if(!sessionToken) return { health: "ok", contract: "not-checked-no-test-session" };
  // This call reads only signed session identity/capabilities; no customer rows.
  const response=await fetchImpl(url.href,{
    method:"POST",redirect:"follow",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({method:"GET",path:"session/me",sessionToken})
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok || result?.status !== 200) {
    throw Error("Authorized test session check failed (no customer data requested)");
  }
  // The shared frontend validator requires matching contract + capabilities.
  validateApiContract(result.body);
  return {health:"ok",contract:"compatible"};
}
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  try {
    const result=await probeApi({
      apiUrl:process.env.GEO_API_URL,
      sessionToken:process.env.GEO_TEST_SESSION_TOKEN||"",
    });
    process.stdout.write(JSON.stringify(result)+"\n");
  } catch(error) {
    process.stderr.write("Read-only API smoke failed: "+error.message+"\n");
    process.exitCode=1;
  }
}
