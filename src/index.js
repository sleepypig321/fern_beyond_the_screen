import { ChatHub } from "./chat.js";
export { ChatHub };
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}
function clean(value, length) {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
function fileType(bytes) {
  if (bytes.length > 11 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length > 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return { mime: "image/png", ext: "png" };
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}
function toBase64(bytes) {
  let out = "";
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    out += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  }
  return btoa(out);
}
function configured(env) {
  return Boolean(env.CHAT_HUB && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
}
function hub(env){return env.CHAT_HUB.getByName("fern-private-chat-v1");}
function withNoCache(response){
  const headers=new Headers(response.headers);headers.set("Cache-Control","no-store");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
async function sendEmail(env,recipient,subject,body,attachments=[]){
  if(!env.RESEND_API_KEY||!env.INQUIRY_FROM_EMAIL)return false;
  const res=await fetch("https://api.resend.com/emails",{
    method:"POST",headers:{Authorization:"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({from:env.INQUIRY_FROM_EMAIL,to:[recipient],subject,text:body,attachments}),
    signal:AbortSignal.timeout(12000)
  });
  return res.ok;
}
async function verifyTurnstile(token, secret, ip) {
  const data = new FormData();
  data.append("secret", secret);
  data.append("response", token);
  if (ip) data.append("remoteip", ip);
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {method:"POST",body:data,signal:AbortSignal.timeout(8000)});
  if (!result.ok) return false;
  const answer = await result.json();
  return answer.success === true;
}
async function inquiry(request, env, ctx) {
  if (!configured(env)) return json({ ok:false, error:"Inquiries aren't available yet. Please try again later." }, 503);
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("multipart/form-data"))
    return json({ ok:false, error:"Please use the inquiry form." }, 415);
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return json({ok:false,error:"This form must be sent from the website."},403);
  const size = Number(request.headers.get("Content-Length") || 0);
  if (size > MAX_BODY_BYTES) return json({ok:false,error:"The uploaded photo is too large (maximum 3 MB)."},413);
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ok:false,error:"Please check your answers and photo, then try again."},400);
  }
  if (clean(form.get("website"), 150)) return json({ok:true,message:"Your note has been received."});
  const name = clean(form.get("first_name"), 80);
  const ageValue = clean(form.get("age"), 4);
  const age = Number(ageValue);
  const city = clean(form.get("city"), 100);
  const email = clean(form.get("email"), 254);
  const interests = clean(form.get("interests"), 400);
  const connection = clean(form.get("connection"), 300);
  const message = clean(form.get("message"), 1300);
  const consent = form.get("consent") === "yes";
  const turnstileToken = clean(form.get("cf-turnstile-response"), 2000);
  const photo = form.get("photo");
  if (name.length < 2 || !/^\d{2,3}$/.test(ageValue) || !Number.isInteger(age) || age < 25 || age > 110 ||
      city.length < 2 || !validEmail(email) || interests.length < 3 || connection.length < 3 ||
      message.length < 10 || !consent || !turnstileToken) {
    return json({ok:false,error:"Please complete every required field, confirm you're 25+, and finish the security check."},400);
  }
  if (!photo || typeof photo === "string" || typeof photo.arrayBuffer !== "function" ||
      photo.size < 100 || photo.size > MAX_PHOTO_BYTES) {
    return json({ok:false,error:"Please attach one JPG, PNG, or WebP photo under 3 MB."},400);
  }
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const type = fileType(bytes);
  if (!type || photo.type !== type.mime)
    return json({ok:false,error:"Please attach a valid JPG, PNG, or WebP image."},400);
  let verified = false;
  try { verified = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY,request.headers.get("CF-Connecting-IP")); }
  catch { return json({ok:false,error:"The security check couldn't finish. Please retry."},503); }
  if (!verified) return json({ok:false,error:"The security check expired. Please complete it again."},400);

  const id=crypto.randomUUID(), saved=await hub(env).fetch(new Request("https://chat-internal/api/chat/system/inquiry",{
    method:"POST",headers:{"Content-Type":"application/json","CF-Connecting-IP":request.headers.get("CF-Connecting-IP")||"unknown"},
    body:JSON.stringify({id,name,email:email.toLowerCase(),age,city,interests,connection,message,photo_type:type.mime,photo64:toBase64(bytes)})
  }));
  if(!saved.ok){
    const detail=await saved.json().catch(()=>({}));
    return json({ok:false,error:detail.error||"Your introduction could not be saved. Please retry."},saved.status);
  }
  // The admin inbox is authoritative. Optional email notifications are supplementary.
  if(env.RESEND_API_KEY && env.INQUIRY_FROM_EMAIL && env.INQUIRY_TO_EMAIL){
    const text=["New inquiry — Fern, Beyond the Screen","",
      "First name: "+name,"Age: "+age,"City/region: "+city,"Reply email: "+email,
      "Interests: "+interests,"What we might connect over: "+connection,
      "","Their introduction:",message,"",
      "The sender confirmed they are 25+ and consented to privately sharing their information and photograph.",
      "Review and approve this application through the private administrator dashboard."].join("\n");
    ctx.waitUntil(sendEmail(env,env.INQUIRY_TO_EMAIL,"New private introduction — Fern, Beyond the Screen",text,
      [{filename:"introduction-photo."+type.ext,content:toBase64(bytes),content_type:type.mime}])
      .catch(error=>console.error("Optional inquiry notification unavailable",String(error))));
  }
  return json({ok:true,message:"Your introduction has been received for private review. If approved, you'll receive a registration invitation."});

}
export default {
  async fetch(request, env, ctx) {
    const url=new URL(request.url);
    // No public access to internal admission endpoints, even if guessed.
    if(url.pathname.startsWith("/api/chat/system/"))return json({ok:false,error:"Not found"},404);
    if(url.pathname.startsWith("/api/chat/")){
      if(!env.CHAT_HUB)return json({ok:false,error:"Private chat is not configured yet."},503);
      if(["POST","PUT","PATCH","DELETE"].includes(request.method)){
        const origin=request.headers.get("Origin");
        if(!origin||origin!==url.origin)return json({ok:false,error:"Requests must come from this website."},403);
        if(Number(request.headers.get("Content-Length")||0)>20000)
          return json({ok:false,error:"Request too large."},413);
      }
      const response=await hub(env).fetch(request);
      if(url.pathname.match(/^\/api\/chat\/admin\/inquiries\/[a-f0-9-]{36}\/approve$/)&&request.method==="POST"&&response.ok){
        const details=await response.json();
        const invite=url.origin+"/chat/register/?token="+encodeURIComponent(details.token);
        let emailed=false;
        if(env.RESEND_API_KEY&&env.INQUIRY_FROM_EMAIL){
          try {emailed=await sendEmail(env,details.email,
            "Your private invitation — Fern, Beyond the Screen",
            "Hello "+details.name+",\n\nYour introduction has been approved. You can create a private chat account using the invitation below:\n\n"+invite+
            "\n\nThis invitation can be used only once and expires in seven days. Please do not forward it.\n\nFern, Beyond the Screen");}
          catch(e){console.log("Invitation email not delivered",String(e));}
        }
        return json({ok:true,inviteUrl:invite,emailed,expires:details.expires});
      }
      return withNoCache(response);
    }
    if(url.pathname==="/api/config" && request.method==="GET"){
      return json({ready:configured(env),turnstileSiteKey:configured(env)?env.TURNSTILE_SITE_KEY:null});
    }
    if(url.pathname==="/api/inquiry" && request.method==="POST"){
      return inquiry(request,env,ctx);
    }
    if(url.pathname.startsWith("/api/"))return json({ok:false,error:"Not found"},404);
    return env.ASSETS.fetch(request);
  }
};
