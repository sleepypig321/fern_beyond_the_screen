import { pbkdf2 } from "node:crypto";
import { DurableObject } from "cloudflare:workers";
import { buildPushPayload } from "@block65/webcrypto-web-push";

const json=(o,s=200,headers={})=>new Response(JSON.stringify(o),{status:s,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...headers}});
const err=(s,m)=>json({ok:false,error:m},s);
const t=()=>Date.now();
const CHAT_INACTIVITY_MS=72*60*60*1000;
const rand=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
const hex=async value=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,"0")).join("");
const validId=s=>typeof s==="string"&&/^[a-f0-9-]{36}$/.test(s);
const readJson=async request=>{if(Number(request.headers.get("content-length"))>6000000)throw Error("too large");return request.json()};
const trimmed=(value,n)=>typeof value==="string"?value.trim().slice(0,n):"";
const cookie=(k,value,age)=>k+"="+value+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+age;
const clearCookie=name=>cookie(name,"",0);
const cookieValue=(request,name)=>request.headers.get("cookie")?.match(new RegExp("(?:^|; )"+name+"=([^;]+)"))?.[1]||"";
const sqlRows=(db,s,...params)=>db.exec(s,...params).toArray();
function validPush(s) {
  if(!s||typeof s.endpoint!=="string"||s.endpoint.length>1200||!s.keys||typeof s.keys.auth!=="string"||typeof s.keys.p256dh!=="string")return false;
  try{
    const u=new URL(s.endpoint);
    const allowed=u.hostname==="fcm.googleapis.com"||u.hostname==="updates.push.services.mozilla.com"||u.hostname==="push.services.mozilla.com"||u.hostname==="web.push.apple.com"||u.hostname.endsWith(".push.apple.com")||u.hostname.endsWith(".notify.windows.com");
    return u.protocol==="https:"&&allowed&&s.keys.auth.length<150&&s.keys.p256dh.length<200;
  }catch{return false}
}
const passwordHashPrefix = "pbkdf2-sha256:100000:";
async function deliverPush(env, subscription, payload, ttl) {
 const vapid={
  subject:env.VAPID_SUBJECT.trim(),
  publicKey:env.VAPID_PUBLIC_KEY.trim(),
  privateKey:env.VAPID_PRIVATE_KEY.trim()
 };
 if(!/^[A-Za-z0-9_-]{87}$/.test(vapid.publicKey)||!/^[A-Za-z0-9_-]{43}$/.test(vapid.privateKey)){
  throw new Error("Check the VAPID key format in Cloudflare.",{cause:"keys"});
 }
 let request;
 try {
  request=await buildPushPayload({data:payload,options:{ttl}},subscription,vapid);
 } catch(error) {
  console.error("Push request preparation failed",error.name,error.code);
  throw new Error("The Worker could not encrypt or sign the push request.",{cause:"prepare"});
 }
 try {
  const headers=new Headers(request.headers);
  headers.delete("Content-Length");
  return await fetch(subscription.endpoint,{
   method:"POST",headers,body:Uint8Array.from(request.body).buffer,redirect:"manual",signal:AbortSignal.timeout(8000)
  });
 } catch(error) {
  console.error("Push network request failed",error.name,error.code);
  throw new Error("The Worker could not reach the device push service.",{cause:"network"});
 }
}
async function testPush(env, subscription, url) {
 if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)return "Push configuration is incomplete.";
 try {
  const response=await deliverPush(env,subscription,{title:"Fern · Notification test",body:"Notifications are reaching this device.",url,tag:"fern-push-test"},60);
  return response.ok?"Test accepted by the push service. Check your device notifications.":"Push service rejected the test (HTTP "+response.status+").";
 } catch(error) {
  console.error("Push test failed",error.name,error.code);
  return ["keys","prepare","network"].includes(error.cause)?error.message:"The Worker could not complete the push test.";
 }
}
async function passwordHash(password, salt, storedHash = passwordHashPrefix) {
 if (!storedHash.startsWith(passwordHashPrefix)) {
  // Preserve verification for any unprefixed hashes created by earlier versions.
  return new Promise((resolve, reject) => {
   pbkdf2(password, salt, 160000, 32, "sha256", (error, hash) => {
    if (error) reject(error);
    else resolve(hash.toString("hex"));
   });
  });
 }
 const encoder = new TextEncoder();
 const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
 const bits = await crypto.subtle.deriveBits({
  name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100000
 }, key, 256);
 return passwordHashPrefix + Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, "0")).join("");
}

export class ChatHub extends DurableObject {
 constructor(ctx,env){
  super(ctx,env);
  this.db=ctx.storage.sql;
  this.db.exec("CREATE TABLE IF NOT EXISTS inquiries(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,age INTEGER NOT NULL,city TEXT NOT NULL,interests TEXT NOT NULL,connection TEXT NOT NULL,message TEXT NOT NULL,photo_type TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',invite_hash TEXT,invite_expires INTEGER,invite_used INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)");
  this.db.exec("CREATE INDEX IF NOT EXISTS inquiries_updated ON inquiries(updated_at DESC)");
  this.db.exec("CREATE TABLE IF NOT EXISTS chat_users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at INTEGER NOT NULL)");
  this.db.exec("CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,thread_id TEXT NOT NULL,sender TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL)");
  this.db.exec("CREATE INDEX IF NOT EXISTS thread_messages ON messages(thread_id,id)");
  this.db.exec("CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,kind TEXT NOT NULL,user_id TEXT,expires INTEGER NOT NULL)");
  this.db.exec("CREATE TABLE IF NOT EXISTS push_subscriptions(endpoint TEXT PRIMARY KEY,subscription TEXT NOT NULL,created_at INTEGER NOT NULL)");
  this.db.exec("CREATE TABLE IF NOT EXISTS chat_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
  this.db.exec("CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,since INTEGER NOT NULL)");
  this.db.exec("CREATE TABLE IF NOT EXISTS confirmed_chat_profiles(user_id TEXT PRIMARY KEY)");
  this.db.exec("CREATE TABLE IF NOT EXISTS registration_activity (inquiry_id TEXT PRIMARY KEY, checked_at INTEGER, attempted_at INTEGER, failed_at INTEGER, failure TEXT)");
  this.db.exec("CREATE TABLE IF NOT EXISTS visitor_presence(user_id TEXT PRIMARY KEY,last_seen INTEGER NOT NULL)");
  // Additive tables retain existing inquiries, messages and established sessions.
  this.db.exec("CREATE TABLE IF NOT EXISTS chat_profiles(user_id TEXT PRIMARY KEY,preferred_name TEXT NOT NULL DEFAULT '',region TEXT NOT NULL DEFAULT '',occupation TEXT NOT NULL DEFAULT '',about TEXT NOT NULL DEFAULT '',interests TEXT NOT NULL DEFAULT '',talking_points TEXT NOT NULL DEFAULT '',intentions TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL)");
  this.db.exec("CREATE TABLE IF NOT EXISTS admin_profile_notes(user_id TEXT PRIMARY KEY,note TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL)");
  this.db.exec("CREATE TABLE IF NOT EXISTS visitor_push_subscriptions(endpoint TEXT PRIMARY KEY,user_id TEXT NOT NULL,subscription TEXT NOT NULL,created_at INTEGER NOT NULL)");
  this.db.exec("CREATE INDEX IF NOT EXISTS visitor_push_by_user ON visitor_push_subscriptions(user_id)");
  // Existing accounts get a full grace period after first deployment.
  this.db.exec("CREATE TABLE IF NOT EXISTS chat_activity(user_id TEXT PRIMARY KEY,last_contact_at INTEGER NOT NULL)");
  this.db.exec("INSERT OR IGNORE INTO chat_activity(user_id,last_contact_at) SELECT id,? FROM chat_users",t());
 }
 expireInactiveChats(){
  const expired=this.rows("SELECT u.id FROM chat_users u JOIN chat_activity a ON a.user_id=u.id WHERE u.status='active' AND a.last_contact_at<=?",t()-CHAT_INACTIVITY_MS);
  if(!expired.length)return 0;
  this.ctx.storage.transactionSync(()=>{
   for(const {id} of expired){
    this.db.exec("UPDATE chat_users SET status='inactive' WHERE id=? AND status='active'",id);
    this.db.exec("DELETE FROM sessions WHERE user_id=?",id);
    this.db.exec("DELETE FROM visitor_push_subscriptions WHERE user_id=?",id);
   }
  });
  return expired.length;
 }
 async scheduleInactivityAlarm(){
  const earliest=this.rows("SELECT MIN(a.last_contact_at) AS last_at FROM chat_activity a JOIN chat_users u ON u.id=a.user_id WHERE u.status='active'")[0]?.last_at;
  if(earliest==null){await this.ctx.storage.deleteAlarm();return;}
  await this.ctx.storage.setAlarm(Number(earliest)+CHAT_INACTIVITY_MS);
 }
 async alarm(){
  this.expireInactiveChats();
  await this.scheduleInactivityAlarm();
 }
 rows(query,...args){return sqlRows(this.db,query,...args)}
 profileComplete(id){
  const profile=this.rows("SELECT p.* FROM chat_profiles p JOIN confirmed_chat_profiles c ON c.user_id=p.user_id WHERE p.user_id=?",id)[0];
  return Boolean(profile&&profile.preferred_name.trim().length>=2&&["region","occupation","about","interests","talking_points","intentions"].every(field=>profile[field].trim().length>0));
 }
 profile(id){
   const row=this.rows("SELECT u.id,u.name AS account_name,u.email,i.age,i.city,i.interests AS original_interests,i.connection AS original_connection,i.message AS original_message,i.created_at AS applied_at,p.preferred_name,p.region,p.occupation,p.about,p.interests,p.talking_points,p.intentions,p.updated_at AS profile_updated FROM chat_users u JOIN inquiries i ON i.id=u.id LEFT JOIN chat_profiles p ON p.user_id=u.id WHERE u.id=?",id)[0];
   if(!row)return null;
   return {
     id:row.id,account_name:row.account_name,email:row.email,age:row.age,
     original_region:row.city,original_interests:row.original_interests,
     original_connection:row.original_connection,original_message:row.original_message,
     applied_at:row.applied_at,
     preferred_name:row.preferred_name||row.account_name,
     region:row.region??row.city,occupation:row.occupation||"",
     about:row.about||"",interests:row.interests??row.original_interests,
     talking_points:row.talking_points??row.original_connection,
     intentions:row.intentions||"",profile_updated:row.profile_updated||null
   };
 }
 async rate(request,purpose,max,ms){
  const visitorIp=request.headers.get("CF-Connecting-IP")||"anonymous";
  const key=purpose+":"+(await hex((this.env.ADMIN_PASSWORD||"private") + ":" + visitorIp)),when=t(),r=this.rows("SELECT count,since FROM rate_limits WHERE key=?",key)[0];
  if(!r||when-r.since>ms){this.db.exec("INSERT OR REPLACE INTO rate_limits(key,count,since) VALUES(?,1,?)",key,when);return false}
  if(r.count>=max)return true;
  this.db.exec("UPDATE rate_limits SET count=count+1 WHERE key=?",key);return false;
 }
 setting(key){return this.rows("SELECT value FROM chat_settings WHERE key=?",key)[0]?.value||""}
 set(key,val){this.db.exec("INSERT OR REPLACE INTO chat_settings(key,value) VALUES(?,?)",key,String(val))}
 online(){return this.setting("online_enabled")==="1"&&t()-Number(this.setting("online_ping")||0)<95000}
 async session(request,kind){
  const val=cookieValue(request,kind==="admin"?"fern_admin_session":"fern_chat_session");
  if(!val||val.length<32||val.length>150)return null;
  const hashed=await hex(val);
  const record=this.rows("SELECT * FROM sessions WHERE hash=? AND kind=? AND expires>?",hashed,kind,t())[0];
  if(!record)return null;
  if(kind==="visitor"){
    const user=this.rows("SELECT id,name,status FROM chat_users WHERE id=?",record.user_id)[0];
    if(!user||user.status!=="active")return null;
    return user;
  }
  return {kind:"admin"};
 }
 async newSession(kind,userId){
  const value=rand(),maxAge=kind==="admin"?14*86400:30*86400;
  this.db.exec("INSERT INTO sessions(hash,kind,user_id,expires) VALUES(?,?,?,?)",await hex(value),kind,userId||null,t()+maxAge*1000);
  return cookie(kind==="admin"?"fern_admin_session":"fern_chat_session",value,maxAge);
 }
 async logout(request,kind){
  const value=cookieValue(request,kind==="admin"?"fern_admin_session":"fern_chat_session");
  if(value)this.db.exec("DELETE FROM sessions WHERE hash=?",await hex(value));
  return json({ok:true},200,{"Set-Cookie":clearCookie(kind==="admin"?"fern_admin_session":"fern_chat_session")});
 }
 async announce(payload){
  if(!this.env.VAPID_PUBLIC_KEY||!this.env.VAPID_PRIVATE_KEY||!this.env.VAPID_SUBJECT)return;
  const subs=this.rows("SELECT endpoint,subscription FROM push_subscriptions");
  await Promise.allSettled(subs.map(async row=>{
    try {
      const response=await deliverPush(this.env,JSON.parse(row.subscription),payload,240);
      if([404,410].includes(response.status))this.db.exec("DELETE FROM push_subscriptions WHERE endpoint=?",row.endpoint);
      else if(!response.ok)console.error("Admin push rejected",response.status);
    } catch(error){console.error("Admin push failed",error.name,error.code);}
  }));
 }
 async announceVisitor(userId){
  if(!this.env.VAPID_PUBLIC_KEY||!this.env.VAPID_PRIVATE_KEY||!this.env.VAPID_SUBJECT)return;
  const subs=this.rows("SELECT endpoint,subscription FROM visitor_push_subscriptions WHERE user_id=?",userId);
  // Intentionally generic notification text; never expose private messages in a lock-screen alert.
  await Promise.allSettled(subs.map(async row=>{
    try {
      const response=await deliverPush(this.env,JSON.parse(row.subscription),{title:"Fern · Private Chat",body:"You have a new private reply.",url:"/chat/",tag:"fern-private-reply"},360);
      if([404,410].includes(response.status))this.db.exec("DELETE FROM visitor_push_subscriptions WHERE endpoint=?",row.endpoint);
      else if(!response.ok)console.error("Visitor push rejected",response.status);
    } catch(error){console.error("Visitor push failed",error.name,error.code);}
  }));
 }
 async fetch(request){
  const u=new URL(request.url),path=u.pathname,method=request.method;
  try{
   const expired=this.expireInactiveChats();
   if(expired || await this.ctx.storage.getAlarm()===null)await this.scheduleInactivityAlarm();
   // Public: the only side channel is whether Fern is currently available.
   if(method==="GET"&&path==="/api/chat/presence")return json({ok:true,online:this.online()});
   if(method==="GET"&&path==="/api/chat/config")return json({ok:true,registration:"approval-only",pushDiagnostics:true,pushReady:Boolean(this.env.VAPID_PUBLIC_KEY&&this.env.VAPID_PRIVATE_KEY&&this.env.VAPID_SUBJECT)});
   if(method==="POST"&&path==="/api/chat/system/inquiry"){
    const d=await readJson(request);
    if(!d||!validId(d.id)||!d.name||!d.email||!d.message||d.age<25||d.age>110||!["image/png","image/jpeg","image/webp"].includes(d.photo_type)||typeof d.photo64!=="string"||d.photo64.length>4200000)return err(400,"Invalid introduction.");
    if(await this.rate(request,"new-inquiry",6,3600000))return err(429,"Please try again later.");
    this.db.exec("INSERT INTO inquiries(id,name,email,age,city,interests,connection,message,photo_type,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?)",d.id,d.name,d.email,d.age,d.city,d.interests,d.connection,d.message,d.photo_type,t(),t());
    // Split large photographs into storage-safe values; the 3 MB attachment remains private.
    const pieces=Math.ceil(d.photo64.length/96000);
    await Promise.all(Array.from({length:pieces},(_,i)=>this.ctx.storage.put("photo:"+d.id+":"+i,d.photo64.slice(i*96000,(i+1)*96000))));
    await this.ctx.storage.put("photo:"+d.id+":length",pieces);
    this.ctx.waitUntil(this.announce({title:"New private introduction",body:"You have a new inquiry to review.",url:"/admin/?inquiries=1",tag:"fern-inquiry"}));
    return json({ok:true,id:d.id});
   }
   // Single administrator: login requires a Cloudflare secret, not a public signup form.
   if(method==="POST"&&path==="/api/chat/admin/login"){
     if(!this.env.ADMIN_PASSWORD)return err(503,"Admin login hasn't been configured.");
     if(await this.rate(request,"admin-login",8,15*60000))return err(429,"Too many attempts. Try again later.");
     const d=await readJson(request);
     if(typeof d.password!=="string"||d.password.length>300||await hex(d.password)!==await hex(this.env.ADMIN_PASSWORD))return err(401,"Incorrect password.");
     return json({ok:true},200,{"Set-Cookie":await this.newSession("admin")});
   }
   if(method==="POST"&&path==="/api/chat/admin/logout")return this.session(request,"admin").then(s=>s?this.logout(request,"admin"):err(401,"Not signed in."));
   if(path.startsWith("/api/chat/admin/")){
     if(!await this.session(request,"admin"))return err(401,"Administrator login required.");
     if(method==="GET"&&path==="/api/chat/admin/me")return json({ok:true,admin:true,online:this.online(),enabled:this.setting("online_enabled")==="1",pushConfigured:Boolean(this.env.VAPID_PUBLIC_KEY&&this.env.VAPID_PRIVATE_KEY&&this.env.VAPID_SUBJECT)});
     if(method==="POST"&&path==="/api/chat/admin/availability"){
       const d=await readJson(request);this.set("online_enabled",d.online===true?"1":"0");this.set("online_ping",t());return json({ok:true,online:this.online()});
     }
     if(method==="POST"&&path==="/api/chat/admin/heartbeat"){
       if(this.setting("online_enabled")==="1")this.set("online_ping",t());
       return json({ok:true,online:this.online()});
     }
     if(method==="GET"&&path==="/api/chat/admin/inquiries"){
       return json({ok:true,inquiries:this.rows("SELECT id,name,email,age,city,interests,connection,message,status,created_at,updated_at,invite_expires,invite_used,(SELECT checked_at FROM registration_activity WHERE inquiry_id=inquiries.id) AS registration_checked_at,(SELECT attempted_at FROM registration_activity WHERE inquiry_id=inquiries.id) AS registration_attempted_at,(SELECT failed_at FROM registration_activity WHERE inquiry_id=inquiries.id) AS registration_failed_at,(SELECT failure FROM registration_activity WHERE inquiry_id=inquiries.id) AS registration_failure FROM inquiries ORDER BY created_at DESC LIMIT 120")});
     }
     const photoMatch=path.match(/^\/api\/chat\/admin\/inquiries\/([0-9a-f-]{36})\/photo$/);
     if(method==="GET"&&photoMatch){
       const id=photoMatch[1],r=this.rows("SELECT photo_type FROM inquiries WHERE id=?",id)[0];
       if(!r)return err(404,"Not found.");
       const count=await this.ctx.storage.get("photo:"+id+":length");
       if(!Number.isInteger(count)||count<1||count>48)return err(404,"Photo unavailable.");
       const parts=await Promise.all(Array.from({length:count},(_,i)=>this.ctx.storage.get("photo:"+id+":"+i)));
       if(parts.some(p=>typeof p!=="string"))return err(404,"Photo unavailable.");
       const raw=atob(parts.join("")),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
       return new Response(bytes,{headers:{"Content-Type":r.photo_type,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
     }
     const action=path.match(/^\/api\/chat\/admin\/inquiries\/([0-9a-f-]{36})\/(approve|decline)$/);
     if(method==="POST"&&action){
       const id=action[1],kind=action[2],row=this.rows("SELECT id,name,email,status FROM inquiries WHERE id=?",id)[0];
       if(!row)return err(404,"Inquiry not found.");
       if(kind==="decline"){
         if(row.status==="declined")return json({ok:true,name:row.name,email:row.email});
         this.db.exec("UPDATE inquiries SET status='declined',invite_hash=NULL,invite_expires=NULL,updated_at=? WHERE id=?",t(),id);
         this.db.exec("UPDATE chat_users SET status='blocked' WHERE id=?",id);
         this.db.exec("DELETE FROM sessions WHERE user_id=?",id);
         this.db.exec("DELETE FROM visitor_push_subscriptions WHERE user_id=?",id);
         return json({ok:true,name:row.name,email:row.email});
       }
       if(row.status==="declined")return err(409,"Declined inquiries cannot be approved without reopening them.");
       if(row.status==="approved"&&this.rows("SELECT id FROM chat_users WHERE id=?",id).length)return err(409,"Already registered.");
       const invite=rand(),expires=t()+7*86400000;
       this.db.exec("UPDATE inquiries SET status='approved',invite_hash=?,invite_expires=?,invite_used=0,updated_at=? WHERE id=?",await hex(invite),expires,t(),id);
       return json({ok:true,token:invite,name:row.name,email:row.email,expires});
     }
     if(method==="GET"&&path==="/api/chat/admin/threads"){
       return json({ok:true,threads:this.rows("SELECT u.id,u.name,u.email,u.status,COALESCE((SELECT body FROM messages WHERE thread_id=u.id ORDER BY id DESC LIMIT 1),'') AS last_message,COALESCE((SELECT MAX(created_at) FROM messages WHERE thread_id=u.id),u.created_at) AS last_at,COALESCE((SELECT COUNT(*) FROM messages WHERE thread_id=u.id AND sender='visitor'),0) AS incoming,(SELECT last_seen FROM visitor_presence WHERE user_id=u.id) AS last_seen FROM chat_users u ORDER BY last_at DESC LIMIT 160")});
     }
     const restore=path.match(/^\/api\/chat\/admin\/threads\/([0-9a-f-]{36})\/restore$/);
     if(method==="POST"&&restore){
       const id=restore[1],user=this.rows("SELECT id,status FROM chat_users WHERE id=?",id)[0];
       if(!user)return err(404,"Conversation not found.");
       if(user.status!=="inactive")return err(409,"Only conversations closed for inactivity can be reopened.");
       this.ctx.storage.transactionSync(()=>{
        this.db.exec("UPDATE chat_users SET status='active' WHERE id=? AND status='inactive'",id);
        this.db.exec("INSERT INTO chat_activity(user_id,last_contact_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_contact_at=excluded.last_contact_at",id,t());
       });
       await this.scheduleInactivityAlarm();
       return json({ok:true,message:"Access restored. They can sign in again with their existing password."});
     }
     const thread=path.match(/^\/api\/chat\/admin\/threads\/([0-9a-f-]{36})\/messages$/);
     if(thread){
       const id=thread[1],user=this.rows("SELECT id,name,status FROM chat_users WHERE id=?",id)[0];
       if(!user)return err(404,"Conversation not found.");
       if(method==="GET")return json({ok:true,user,profile:this.profile(id),private_note:this.rows("SELECT note FROM admin_profile_notes WHERE user_id=?",id)[0]?.note||"",messages:this.rows("SELECT id,sender,body,created_at FROM messages WHERE thread_id=? ORDER BY id DESC LIMIT 180",id).reverse()});
       if(method==="POST"){
         const d=await readJson(request),body=trimmed(d.message,1001);
         if(body.length<1||body.length>1000)return err(400,"Message must be 1–1000 characters.");
         if(user.status!=="active")return err(403,"This conversation is closed.");
         const now=t();
         this.ctx.storage.transactionSync(()=>{
          this.db.exec("INSERT INTO messages(thread_id,sender,body,created_at) VALUES(?,'admin',?,?)",id,body,now);
          this.db.exec("INSERT INTO chat_activity(user_id,last_contact_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_contact_at=excluded.last_contact_at",id,now);
         });
         await this.scheduleInactivityAlarm();
         this.ctx.waitUntil(this.announceVisitor(id));
         return json({ok:true});
       }
     }
     const notesRoute=path.match(/^\/api\/chat\/admin\/threads\/([a-f0-9-]{36})\/notes$/);
     if(notesRoute&&method==="POST"){
       const id=notesRoute[1];
       if(!this.rows("SELECT id FROM chat_users WHERE id=?",id).length)return err(404,"Chat profile not found.");
       const d=await readJson(request);
       if(typeof d.note!=="string"||d.note.length>2000)return err(400,"Private notes must be under 2,000 characters.");
       const note=d.note.trim();
       this.db.exec("INSERT INTO admin_profile_notes(user_id,note,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at",id,note,t());
       return json({ok:true});
     }
     if(method==="GET"&&path==="/api/chat/admin/push-key")return json({ok:true,publicKey:this.env.VAPID_PUBLIC_KEY||null});
     if(method==="POST"&&path==="/api/chat/admin/push-subscribe"){
       const d=await readJson(request);
       if(!validPush(d.subscription))return err(400,"Invalid browser push subscription.");
       const sub=d.subscription;
       this.db.exec("INSERT OR REPLACE INTO push_subscriptions(endpoint,subscription,created_at) VALUES(?,?,?)",sub.endpoint,JSON.stringify(sub),t());
       const testStatus=d.test===true
         ?await this.rate(request,"admin-push-test",6,60000)
           ?"Too many notification tests. Try again in a minute."
           :await testPush(this.env,sub,"/admin/")
         :undefined;
       return json({ok:true,testStatus});
     }
     if(method==="POST"&&path==="/api/chat/admin/push-unsubscribe"){
       const d=await readJson(request);
       if(typeof d.endpoint==="string")this.db.exec("DELETE FROM push_subscriptions WHERE endpoint=?",d.endpoint);
       return json({ok:true});
     }
     return err(404,"Unknown admin route.");
   }
   // Only an approved, unused email invitation can create a user account.
   if(method==="GET"&&path==="/api/chat/invite"){
     const input=u.searchParams.get("token")||"";
     if(input.length<32||input.length>150)return err(404,"Invitation not found.");
     const row=this.rows("SELECT id,name,email,invite_expires,invite_used FROM inquiries WHERE invite_hash=? AND status='approved'",await hex(input))[0];
     if(!row||row.invite_used||row.invite_expires<t())return err(410,"Invitation has expired or was already used.");
     this.db.exec("INSERT INTO registration_activity(inquiry_id,checked_at) VALUES(?,?) ON CONFLICT(inquiry_id) DO UPDATE SET checked_at=COALESCE(checked_at,excluded.checked_at)",row.id,t());
     return json({ok:true,name:row.name});
   }
   if(method==="POST"&&path==="/api/chat/register"){
     if(await this.rate(request,"chat-register",12,3600000))return err(429,"Please try later.");
     const d=await readJson(request),pass=d.password,inv=d.token;
     if(typeof pass!=="string"||pass.length<12||pass.length>128||typeof inv!=="string"||inv.length<32||inv.length>150)return err(400,"A valid invitation and a password of 12–128 characters are required.");
     const row=this.rows("SELECT id,name,email,invite_expires,invite_used FROM inquiries WHERE invite_hash=? AND status='approved'",await hex(inv))[0];
     if(!row||row.invite_used||row.invite_expires<t())return err(410,"The invitation is invalid or expired.");
     this.db.exec("INSERT INTO registration_activity(inquiry_id,attempted_at) VALUES(?,?) ON CONFLICT(inquiry_id) DO UPDATE SET attempted_at=excluded.attempted_at,failed_at=NULL,failure=NULL",row.id,t());
     const recordFailure=(reason)=>this.db.exec("UPDATE registration_activity SET failed_at=?,failure=? WHERE inquiry_id=?",t(),reason,row.id);
     if(this.rows("SELECT id FROM chat_users WHERE email=?",row.email).length){recordFailure("Account already exists");return err(409,"This email already has a chat account.");}
     const salt=rand();
     let hash;
     try {
       hash=await passwordHash(pass,salt);
     } catch(error) {
       recordFailure("Password hashing failed");
       console.error("Chat registration password hashing failed", error.name, error.code);
       return err(500,"Registration could not create your password hash. No account was created.");
     }
     const sessionToken=rand(),sessionHash=await hex(sessionToken),maxAge=30*86400;
     const invitationHash=await hex(inv);
     try {
       const response=this.ctx.storage.transactionSync(()=>{
         const current=this.rows("SELECT invite_expires,invite_used FROM inquiries WHERE id=? AND invite_hash=? AND status='approved'",row.id,invitationHash)[0];
         if(!current||current.invite_used||current.invite_expires<t())return err(410,"The invitation is invalid or expired.");
         if(this.rows("SELECT id FROM chat_users WHERE email=?",row.email).length)return err(409,"This email already has a chat account. Try signing in.");
         const now=t();
         this.db.exec("INSERT INTO chat_users(id,email,name,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)",row.id,row.email,row.name,salt,hash,now);
         this.db.exec("INSERT INTO chat_activity(user_id,last_contact_at) VALUES(?,?)",row.id,now);
         this.db.exec("INSERT OR IGNORE INTO chat_profiles(user_id,preferred_name,region,interests,talking_points,updated_at) SELECT id,name,city,interests,connection,? FROM inquiries WHERE id=?",now,row.id);
         this.db.exec("INSERT INTO sessions(hash,kind,user_id,expires) VALUES(?,?,?,?)",sessionHash,"visitor",row.id,now+maxAge*1000);
         this.db.exec("UPDATE inquiries SET invite_used=1,invite_hash=NULL,updated_at=? WHERE id=?",now,row.id);
         return json({ok:true,name:row.name},200,{"Set-Cookie":cookie("fern_chat_session",sessionToken,maxAge)});
       });
       if(response.ok)await this.scheduleInactivityAlarm();
       return response;
     } catch(error) {
       recordFailure("Account storage or session setup failed");
       console.error("Chat registration storage failed", error.name, error.code, error.message);
       return err(500,"Registration could not save the account. Your invitation can be retried.");
     }
   }
   if(method==="POST"&&path==="/api/chat/login"){
     if(await this.rate(request,"chat-login",12,15*60000))return err(429,"Too many attempts. Try later.");
     const d=await readJson(request),email=trimmed(d.email,254).toLowerCase(),pass=d.password;
     if(!email||typeof pass!=="string"||pass.length>300)return err(401,"Email or password incorrect.");
     const user=this.rows("SELECT * FROM chat_users WHERE email=? AND status='active'",email)[0];
     if(!user||await passwordHash(pass,user.salt,user.password_hash)!==user.password_hash)return err(401,"Email or password incorrect.");
     return json({ok:true,name:user.name},200,{"Set-Cookie":await this.newSession("visitor",user.id)});
   }
   if(method==="POST"&&path==="/api/chat/logout"){
     const user=await this.session(request,"visitor");
     const body=await readJson(request).catch(()=>null);
     if(user&&typeof body?.endpoint==="string"){
       this.db.exec("DELETE FROM visitor_push_subscriptions WHERE user_id=? AND endpoint=?",user.id,body.endpoint);
     } else if(user&&(!body||!("endpoint" in body))){
       this.db.exec("DELETE FROM visitor_push_subscriptions WHERE user_id=?",user.id);
     }
     return this.logout(request,"visitor");
   }
   if(path.startsWith("/api/chat/visitor/")){
     const user=await this.session(request,"visitor");
     if(!user)return err(401,"Register through an approved invitation or sign in.");
     if(method==="POST"&&path==="/api/chat/visitor/heartbeat"){
       this.db.exec("INSERT INTO visitor_presence(user_id,last_seen) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_seen=excluded.last_seen",user.id,t());
       return json({ok:true});
     }
     if(method==="GET"&&path==="/api/chat/visitor/me")return json({ok:true,id:user.id,name:user.name,online:this.online(),profileComplete:this.profileComplete(user.id)});
     if(method==="GET"&&path==="/api/chat/visitor/push-key")return json({ok:true,publicKey:this.env.VAPID_PUBLIC_KEY||null});
     if(method==="POST"&&path==="/api/chat/visitor/push-subscribe"){
       const d=await readJson(request),sub=d?.subscription;
       if(!validPush(sub))return err(400,"Invalid notification subscription.");
       this.db.exec("INSERT INTO visitor_push_subscriptions(endpoint,user_id,subscription,created_at) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription=excluded.subscription,created_at=excluded.created_at",sub.endpoint,user.id,JSON.stringify(sub),t());
       const testStatus=d.test===true
         ?await this.rate(request,"visitor-push-test",6,60000)
           ?"Too many notification tests. Try again in a minute."
           :await testPush(this.env,sub,"/chat/")
         :undefined;
       return json({ok:true,testStatus});
     }
     if(method==="POST"&&path==="/api/chat/visitor/push-unsubscribe"){
       const d=await readJson(request);
       if(typeof d?.endpoint==="string")this.db.exec("DELETE FROM visitor_push_subscriptions WHERE endpoint=? AND user_id=?",d.endpoint,user.id);
       return json({ok:true});
     }
     if(method==="GET"&&path==="/api/chat/visitor/profile"){
       const p=this.profile(user.id);
       if(!p)return err(404,"Profile unavailable.");
       // Profile details are restricted to this signed-in person and the administrator.
       return json({ok:true,profile:{
         preferred_name:p.preferred_name,region:p.region,occupation:p.occupation,
         about:p.about,interests:p.interests,talking_points:p.talking_points,
         intentions:p.intentions,age:p.age,email:p.email
       }});
     }
     if(method==="POST"&&path==="/api/chat/visitor/profile"){
       if(await this.rate(request,"profile-update:"+user.id,25,3600000))return err(429,"Too many profile edits. Please try again later.");
       const d=await readJson(request);
       if(!d||typeof d!=="object"||Array.isArray(d))return err(400,"Invalid profile.");
       const limits={preferred_name:60,region:100,occupation:100,about:700,interests:400,talking_points:350,intentions:350};
       const values={};
       for(const [name,limit] of Object.entries(limits)){
         if(typeof d[name]!=="string"||d[name].length>limit)return err(400,"Please check your profile fields and their length limits.");
         values[name]=d[name].trim();
       }
       if(Object.values(values).some(value=>!value))return err(400,"Fill out all seven profile fields to unlock chat.");
       if(values.preferred_name.length<2)return err(400,"Please provide a name of at least two characters.");
       this.ctx.storage.transactionSync(()=>{
       this.db.exec("INSERT INTO chat_profiles(user_id,preferred_name,region,occupation,about,interests,talking_points,intentions,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET preferred_name=excluded.preferred_name,region=excluded.region,occupation=excluded.occupation,about=excluded.about,interests=excluded.interests,talking_points=excluded.talking_points,intentions=excluded.intentions,updated_at=excluded.updated_at",
         user.id,values.preferred_name,values.region,values.occupation,values.about,values.interests,values.talking_points,values.intentions,t());
       this.db.exec("INSERT OR IGNORE INTO confirmed_chat_profiles(user_id) VALUES(?)",user.id);
       });
       return json({ok:true,profile:this.profile(user.id),profileComplete:true});
     }
     if(path==="/api/chat/visitor/messages"&&!this.profileComplete(user.id)){
       return err(403,"Save your private profile to unlock chat.");
     }
     if(method==="GET"&&path==="/api/chat/visitor/messages"){
       const after=Math.max(0,Math.min(999999999,Number(u.searchParams.get("after")||0)||0));
       return json({ok:true,online:this.online(),messages:this.rows("SELECT id,sender,body,created_at FROM messages WHERE thread_id=? AND id>? ORDER BY id ASC LIMIT 150",user.id,after)});
     }
     if(method==="POST"&&path==="/api/chat/visitor/messages"){
       if(await this.rate(request,"chat-message:"+user.id,12,60000))return err(429,"Too many messages. Please wait a moment.");
       const d=await readJson(request),body=trimmed(d.message,1001);
       if(body.length<1||body.length>1000)return err(400,"Messages must be 1–1000 characters.");
       const now=t();
       this.ctx.storage.transactionSync(()=>{
        this.db.exec("INSERT INTO messages(thread_id,sender,body,created_at) VALUES(?,'visitor',?,?)",user.id,body,now);
        this.db.exec("INSERT INTO chat_activity(user_id,last_contact_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_contact_at=excluded.last_contact_at",user.id,now);
       });
       await this.scheduleInactivityAlarm();
       this.ctx.waitUntil(this.announce({title:"New private chat message",body:user.name+" sent you a message.",url:"/admin/?chat="+user.id,tag:"fern-chat-"+user.id}));
       return json({ok:true});
     }
     return err(404,"Unknown private chat route.");
   }
   return err(404,"Not found.");
  }catch(e){
   console.error("ChatHub error",String(e));
   return err(500,"The chat service could not complete that request.");
  }
 }
}
