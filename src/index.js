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
  return Boolean(env.RESEND_API_KEY && env.INQUIRY_FROM_EMAIL && env.INQUIRY_TO_EMAIL && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
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
async function inquiry(request, env) {
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
  const text = [
    "New inquiry — Fern, Beyond the Screen", "",
    "First name: " + name,
    "Age: " + age,
    "City/region: " + city,
    "Reply email: " + email,
    "Interests: " + interests,
    "What we might connect over: " + connection,
    "",
    "Their introduction:",
    message,
    "",
    "The sender confirmed they are 25+ and consented to emailing this information and their photo.",
    "The photo is attached to this email. It is not publicly posted by the website."
  ].join("\n");
  let sent;
  try {
    sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type":"application/json" },
      body: JSON.stringify({
        from: env.INQUIRY_FROM_EMAIL,
        to: [env.INQUIRY_TO_EMAIL],
        reply_to: email,
        subject: "New private introduction — Fern, Beyond the Screen",
        text,
        attachments: [{filename:"introduction-photo." + type.ext, content:toBase64(bytes), content_type:type.mime}]
      }),
      signal: AbortSignal.timeout(12000)
    });
  } catch {
    return json({ok:false,error:"Email delivery is temporarily unavailable. Please try again."},502);
  }
  if (!sent.ok) {
    console.log("Inquiry email delivery failure:",sent.status);
    return json({ok:false,error:"Your message could not be delivered. Please try again later."},502);
  }
  return json({ok:true,message:"Your introduction has been sent privately. Thank you!"});
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/config" && request.method === "GET") {
      return json({ready:configured(env),turnstileSiteKey:configured(env) ? env.TURNSTILE_SITE_KEY : null});
    }
    if (url.pathname === "/api/inquiry" && request.method === "POST") {
      return inquiry(request,env);
    }
    if (url.pathname.startsWith("/api/")) return json({ok:false,error:"Not found"},404);
    return env.ASSETS.fetch(request);
  }
};
