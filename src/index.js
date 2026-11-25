import { ChatHub } from "./chat.js";
export { ChatHub };
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Permissions-Policy": "geolocation=(), camera=(), microphone=()" };
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
  const headers=new Headers(response.headers);headers.set("Cache-Control","no-store");headers.set("Referrer-Policy","no-referrer");headers.set("X-Content-Type-Options","nosniff");headers.set("X-Frame-Options","DENY");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
function escapeEmail(value){
 return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function elegantEmail({eyebrow,title,paragraphs=[],actionText="",actionUrl="",footnote=""}){
 const p=paragraphs.map(line=>'<p style="font:16px/1.8 Georgia,serif;color:#f1dacf;margin:0 0 18px">'+escapeEmail(line)+'</p>').join("");
 const action=actionText&&actionUrl?'<p style="margin:32px 0"><a href="'+escapeEmail(actionUrl)+'" style="display:inline-block;background:#d9b592;color:#2d0e1a;text-decoration:none;font:bold 13px/1.4 Arial,sans-serif;letter-spacing:1px;padding:17px 23px;border:1px solid #efd5b7">'+escapeEmail(actionText)+'</a></p>':"";
 return '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:32px 12px;background:#10070d"><div style="max-width:590px;margin:auto;padding:46px 35px;border:1px solid #b88676;background:#260d19"><p style="font:11px Arial,sans-serif;letter-spacing:2px;color:#d4a095;text-transform:uppercase">'+escapeEmail(eyebrow)+'</p><h1 style="font:normal 43px/1.1 Georgia,serif;color:#f6e7dc;margin:20px 0 30px">'+escapeEmail(title)+'</h1>'+p+action+'<div style="border-top:1px solid #805463;padding-top:22px;font:12px/1.7 Arial,sans-serif;color:#c6a7a2">'+escapeEmail(footnote)+'<p style="margin:18px 0 0;color:#e8c4ae">Fern, Beyond the Screen · Private Correspondence</p></div></div></body></html>';
}
// Use the same EmailJS REST transport as Sites by Fern. Keys stay in Worker secrets.
function emailJsReady(env){
 return Boolean(env.EMAILJS_SERVICE_ID&&env.EMAILJS_PUBLIC_KEY&&env.EMAILJS_DECISION_TEMPLATE_ID);
}
function resendReady(env){
 return Boolean(env.RESEND_API_KEY&&env.INQUIRY_FROM_EMAIL);
}
function emailReady(env){return emailJsReady(env)||resendReady(env);}
async function sendEmail(env,recipient,subject,body,attachments=[],html="",options={}){
 if(!validEmail(recipient))return false;
 if(emailJsReady(env)){
   // Existing Sites by Fern decision template expects these four fields.
   // Never send applicant photographs through EmailJS: they stay inside the admin inbox.
   if(attachments.length)return false;
   const data={
     service_id:env.EMAILJS_SERVICE_ID,
     template_id:env.EMAILJS_DECISION_TEMPLATE_ID,
     user_id:env.EMAILJS_PUBLIC_KEY,
     template_params:{
       to_email:recipient,
       subject,
       message:body,
       action_url:options.actionUrl||"",
       action_label:options.actionLabel||""
     }
   };
   if(env.EMAILJS_PRIVATE_KEY)data.accessToken=env.EMAILJS_PRIVATE_KEY;
   const res=await fetch("https://api.emailjs.com/api/v1.0/email/send",{
     method:"POST",
     headers:{"Content-Type":"application/json"},
     body:JSON.stringify(data),
     signal:AbortSignal.timeout(12000)
   });
   if(!res.ok)console.log("EmailJS delivery rejected request",res.status);
   return res.ok;
 }
 if(!resendReady(env))return false;
 const data={from:env.INQUIRY_FROM_EMAIL,to:[recipient],subject,text:body};
 if(attachments.length)data.attachments=attachments;
 if(html)data.html=html;
 const res=await fetch("https://api.resend.com/emails",{
   method:"POST",headers:{Authorization:"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},
   body:JSON.stringify(data),signal:AbortSignal.timeout(12000)
 });
 if(!res.ok)console.log("Resend email delivery failed",res.status);
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
  const emailConfirm = clean(form.get("email_confirm"), 254);
  if(!validEmail(email)||!validEmail(emailConfirm)||email.toLowerCase()!==emailConfirm.toLowerCase())return json({ok:false,error:"Please enter a valid email address twice and make sure both entries match."},400);
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
  // Notify Fern, but keep applicant images and detailed answers in the secured inbox.
  if(emailReady(env) && env.INQUIRY_TO_EMAIL){
    const inboxUrl=new URL("/admin/?inquiry="+encodeURIComponent(id),request.url).toString();
    const body=[
      "You've received an inquiry — Fern, Beyond the Screen","",
      name+" has submitted a private introduction.",
      "Sign in to your private admin inbox to see the photo and full application, then approve or decline:",
      inboxUrl,"","Administrator sign-in is required."
    ].join("\n");
    const html=elegantEmail({
      eyebrow:"A letter awaits",
      title:"You've received an inquiry.",
      paragraphs:[name+" has submitted a private introduction.","Open your administrator inbox to read the letter, review the photograph, and decide whether to invite them into private chat."],
      actionText:"REVIEW THIS INQUIRY",actionUrl:inboxUrl,
      footnote:"This link leads to the password-protected admin area. No decision can be made directly from email."
    });
    ctx.waitUntil(sendEmail(env,env.INQUIRY_TO_EMAIL,"New inquiry — Fern, Beyond the Screen",body,[],html,{actionUrl:inboxUrl,actionLabel:"REVIEW THIS INQUIRY"})
      .catch(error=>console.error("Inquiry email notification failed",String(error))));
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
      const decision=url.pathname.match(/^\/api\/chat\/admin\/inquiries\/([a-f0-9-]{36})\/(approve|decline)$/);
      if(decision&&request.method==="POST"&&response.ok){
        const result=await response.json();
        // We never email a rejection's name from a URL or an unverified public field:
        // these details come from the authenticated admin decision in the ChatHub.
        const name=result.name||"there",recipient=result.email;
        if(decision[2]==="approve"){
          const invite=url.origin+"/chat/register/?token="+encodeURIComponent(result.token);
          const body=["Hello "+name+",","","Thank you for your thoughtful introduction.",
            "I'd like to invite you to continue our conversation somewhere a little more private.",
            "Create your personal chat account with this invitation:",invite,"",
            "The link is for you alone, is valid once, and expires in seven days.",
            "Once registered, you'll be guided to your private chat, where you may also install the app on your phone.",
            "","Warmly,","Fern"].join("\n");
          const html=elegantEmail({
            eyebrow:"Your introduction was accepted",
            title:"An invitation, just for you.",
            paragraphs:["Hello "+name+",","Thank you for your thoughtful introduction. I'd like to invite you to continue our conversation somewhere a little more private.","Use the button below to create your account. After registering, you can install our private chat on your phone, if you wish."],
            actionText:"ACCEPT YOUR INVITATION",actionUrl:invite,
            footnote:"This private invitation can be used once and expires in seven days. Please don't forward this link."
          });
          let emailed=false;
          try{emailed=await sendEmail(env,recipient,"A private invitation — Fern, Beyond the Screen",body,[],html,{actionUrl:invite,actionLabel:"ACCEPT YOUR INVITATION"});}
          catch(error){console.log("Approval invitation email error",String(error));}
          return json({ok:true,inviteUrl:invite,emailed,expires:result.expires});
        }
        const body=["Hello "+name+",","","Thank you for taking the time to introduce yourself.",
          "I appreciate the thought you put into reaching out. After considering your introduction, I won't be moving forward with a private conversation.",
          "I wish you all the best in finding a meaningful connection.",
          "","Warmly,","Fern"].join("\n");
        const html=elegantEmail({
          eyebrow:"A personal note",
          title:"Thank you for reaching out.",
          paragraphs:["Hello "+name+",","I appreciate you taking the time to share a little of yourself with me. After considering your introduction, I won't be continuing into a private conversation.","I hope you find a connection that feels easy, genuine, and right for you."],
          footnote:"No registration link has been issued. You do not need to take any further action."
        });
        let emailed=false;
        try{emailed=await sendEmail(env,recipient,"Thank you for your introduction — Fern, Beyond the Screen",body,[],html,{actionUrl:url.origin,actionLabel:"FERN, BEYOND THE SCREEN"});}
        catch(error){console.log("Decline response email error",String(error));}
        const emailError=emailed?undefined:!emailReady(env)
          ?"Introduction declined. Email delivery is not configured."
          :emailJsReady(env)&&!env.EMAILJS_PRIVATE_KEY
            ?"Introduction declined. Check that EMAILJS_PRIVATE_KEY is set in Cloudflare, then retry."
            :"Introduction declined. The email provider did not accept the message. Check email delivery settings, then retry.";
        return json({ok:true,emailed,emailError});
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
