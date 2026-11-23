import { DurableObject } from "cloudflare:workers";
import webpush from "web-push";

const json=(o,s=200,headers={})=>new Response(JSON.stringify(o),{status:s,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...headers}});
const err=(s,m)=>json({ok:false,error:m},s);
const t=()=>Date.now();
const rand=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
const hex=async value=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,"0")).join("");
const validId=s=>typeof s==="string"&&/^[a-f0-9-]{36}$/.test(s);
const readJson=async request=>{if(Number(request.headers.get("content-length"))>6000000)throw Error("too large");return request.json()};
const trimmed=(value,n)=>typeof value==="string"?value.trim().slice(0,n):"";
const cookie=(k,value,age)=>k+"="+value+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+age;
const clearCookie=name=>cookie(name,"",0);
const cookieValue=(request,name)=>request.headers.get("cookie")?.match(new RegExp("(?:^|; )"+name+"=([^;]+)"))?.[1]||"";
const sqlRows=(db,s,...params)=>db.exec(s,...params).toArray();
const limitKey=(request)=>request.headers.get("CF-Connecting-IP")||"anonymous";
function validPush(s) {
  if(!s||typeof s.endpoint!=="string"||s.endpoint.length>1200||!s.keys||typeof s.keys.auth!=="string"||typeof s.keys.p256dh!=="string")return false;
  try{
    const u=new URL(s.endpoint);
    const allowed=u.hostname==="fcm.googleapis.com"||u.hostname==="updates.push.services.mozilla.com"||u.hostname==="push.services.mozilla.com"||u.hostname==="web.push.apple.com"||u.hostname.endsWith(".push.apple.com")||u.hostname.endsWith(".notify.windows.com");
    return u.protocol==="https:"&&allowed&&s.keys.auth.length<150&&s.keys.p256dh.length<200;
  }catch{return false}
}
async function passwordHash(password,salt) {
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
 const bytes=await crypto.subtle.deriveBits({name:"PBKDF2",salt:new TextEncoder().encode(salt),iterations:160000,hash:"SHA-256"},key,256);
 return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,"0")).join("");
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
 }
 rows(query,...args){return sqlRows(this.db,query,...args)}
 rate(request,purpose,max,ms){
  const key=purpose+":"+limitKey(request),when=t(),r=this.rows("SELECT count,since FROM rate_limits WHERE key=?",key)[0];
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
  try {webpush.setVapidDetails(this.env.VAPID_SUBJECT,this.env.VAPID_PUBLIC_KEY,this.env.VAPID_PRIVATE_KEY)}
  catch(e){console.log("Push configuration invalid",String(e));return}
  const subs=this.rows("SELECT endpoint,subscription FROM push_subscriptions");
  await Promise.allSettled(subs.map(async row=>{
    try{await webpush.sendNotification(JSON.parse(row.subscription),JSON.stringify(payload),{TTL:240})}
    catch(e){if([404,410].includes(e.statusCode))this.db.exec("DELETE FROM push_subscriptions WHERE endpoint=?",row.endpoint)}
  }));
 }
 async fetch(request){
  const u=new URL(request.url),path=u.pathname,method=request.method;
  try{
   // Public: the only side channel is whether Fern is currently available.
   if(method==="GET"&&path==="/api/chat/presence")return json({ok:true,online:this.online()});
   if(method==="GET"&&path==="/api/chat/config")return json({ok:true,registration:"approval-only",pushReady:Boolean(this.env.VAPID_PUBLIC_KEY&&this.env.VAPID_PRIVATE_KEY)});
   if(method==="POST"&&path==="/api/chat/system/inquiry"){
    const d=await readJson(request);
    if(!d||!validId(d.id)||!d.name||!d.email||!d.message||d.age<25||d.age>110||!["image/png","image/jpeg","image/webp"].includes(d.photo_type)||typeof d.photo64!=="string"||d.photo64.length>4200000)return err(400,"Invalid introduction.");
    if(this.rate(request,"new-inquiry",6,3600000))return err(429,"Please try again later.");
    this.db.exec("INSERT INTO inquiries(id,name,email,age,city,interests,connection,message,photo_type,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?)",d.id,d.name,d.email,d.age,d.city,d.interests,d.connection,d.message,d.photo_type,t(),t());
    await this.ctx.storage.put("photo:"+d.id,d.photo64);
    this.ctx.waitUntil(this.announce({title:"New private introduction",body:"You have a new inquiry to review.",url:"/admin/?inquiries=1",tag:"fern-inquiry"}));
    return json({ok:true,id:d.id});
   }
   // Single administrator: login requires a Cloudflare secret, not a public signup form.
   if(method==="POST"&&path==="/api/chat/admin/login"){
     if(!this.env.ADMIN_PASSWORD)return err(503,"Admin login hasn't been configured.");
     if(this.rate(request,"admin-login",8,15*60000))return err(429,"Too many attempts. Try again later.");
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
       return json({ok:true,inquiries:this.rows("SELECT id,name,email,age,city,interests,connection,message,status,created_at,updated_at,invite_expires,invite_used FROM inquiries ORDER BY created_at DESC LIMIT 120")});
     }
     const photoMatch=path.match(/^\/api\/chat\/admin\/inquiries\/([0-9a-f-]{36})\/photo$/);
     if(method==="GET"&&photoMatch){
       const id=photoMatch[1],r=this.rows("SELECT photo_type FROM inquiries WHERE id=?",id)[0];
       if(!r)return err(404,"Not found.");
       const b64=await this.ctx.storage.get("photo:"+id);
       if(!b64)return err(404,"Photo unavailable.");
       const raw=atob(b64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
       return new Response(bytes,{headers:{"Content-Type":r.photo_type,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
     }
     const action=path.match(/^\/api\/chat\/admin\/inquiries\/([0-9a-f-]{36})\/(approve|decline)$/);
     if(method==="POST"&&action){
       const id=action[1],kind=action[2],row=this.rows("SELECT id,name,email,status FROM inquiries WHERE id=?",id)[0];
       if(!row)return err(404,"Inquiry not found.");
       if(kind==="decline"){
         this.db.exec("UPDATE inquiries SET status='declined',invite_hash=NULL,invite_expires=NULL,updated_at=? WHERE id=?",t(),id);
         this.db.exec("UPDATE chat_users SET status='blocked' WHERE id=?",id);
         this.db.exec("DELETE FROM sessions WHERE user_id=?",id);
         return json({ok:true});
       }
       if(row.status==="declined")return err(409,"Declined inquiries cannot be approved without reopening them.");
       if(row.status==="approved"&&this.rows("SELECT id FROM chat_users WHERE id=?",id).length)return err(409,"Already registered.");
       const invite=rand(),expires=t()+7*86400000;
       this.db.exec("UPDATE inquiries SET status='approved',invite_hash=?,invite_expires=?,invite_used=0,updated_at=? WHERE id=?",await hex(invite),expires,t(),id);
       return json({ok:true,token:invite,name:row.name,email:row.email,expires});
     }
     if(method==="GET"&&path==="/api/chat/admin/threads"){
       return json({ok:true,threads:this.rows("SELECT u.id,u.name,u.email,u.status,COALESCE((SELECT body FROM messages WHERE thread_id=u.id ORDER BY id DESC LIMIT 1),'') AS last_message,COALESCE((SELECT MAX(created_at) FROM messages WHERE thread_id=u.id),u.created_at) AS last_at,COALESCE((SELECT COUNT(*) FROM messages WHERE thread_id=u.id AND sender='visitor'),0) AS incoming FROM chat_users u ORDER BY last_at DESC LIMIT 160")});
     }
     const thread=path.match(/^\/api\/chat\/admin\/threads\/([0-9a-f-]{36})\/messages$/);
     if(thread){
       const id=thread[1],user=this.rows("SELECT id,name,status FROM chat_users WHERE id=?",id)[0];
       if(!user)return err(404,"Conversation not found.");
       if(method==="GET")return json({ok:true,user,messages:this.rows("SELECT id,sender,body,created_at FROM messages WHERE thread_id=? ORDER BY id DESC LIMIT 180",id).reverse()});
       if(method==="POST"){
         const d=await readJson(request),body=trimmed(d.message,1001);
         if(body.length<1||body.length>1000)return err(400,"Message must be 1–1000 characters.");
         if(user.status!=="active")return err(403,"This conversation is closed.");
         this.db.exec("INSERT INTO messages(thread_id,sender,body,created_at) VALUES(?,'admin',?,?)",id,body,t());
         return json({ok:true});
       }
     }
     if(method==="GET"&&path==="/api/chat/admin/push-key")return json({ok:true,publicKey:this.env.VAPID_PUBLIC_KEY||null});
     if(method==="POST"&&path==="/api/chat/admin/push-subscribe"){
       const d=await readJson(request);
       if(!validPush(d.subscription))return err(400,"Invalid browser push subscription.");
       const sub=d.subscription;
       this.db.exec("INSERT OR REPLACE INTO push_subscriptions(endpoint,subscription,created_at) VALUES(?,?,?)",sub.endpoint,JSON.stringify(sub),t());
       return json({ok:true});
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
     return json({ok:true,name:row.name});
   }
   if(method==="POST"&&path==="/api/chat/register"){
     if(this.rate(request,"chat-register",12,3600000))return err(429,"Please try later.");
     const d=await readJson(request),pass=d.password,inv=d.token;
     if(typeof pass!=="string"||pass.length<12||pass.length>128||typeof inv!=="string"||inv.length<32||inv.length>150)return err(400,"A valid invitation and a password of 12–128 characters are required.");
     const row=this.rows("SELECT id,name,email,invite_expires,invite_used FROM inquiries WHERE invite_hash=? AND status='approved'",await hex(inv))[0];
     if(!row||row.invite_used||row.invite_expires<t())return err(410,"The invitation is invalid or expired.");
     if(this.rows("SELECT id FROM chat_users WHERE email=?",row.email).length)return err(409,"This email already has a chat account.");
     const salt=rand(),hash=await passwordHash(pass,salt);
     this.db.exec("INSERT INTO chat_users(id,email,name,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)",row.id,row.email,row.name,salt,hash,t());
     this.db.exec("UPDATE inquiries SET invite_used=1,invite_hash=NULL,updated_at=? WHERE id=?",t(),row.id);
     return json({ok:true,name:row.name},200,{"Set-Cookie":await this.newSession("visitor",row.id)});
   }
   if(method==="POST"&&path==="/api/chat/login"){
     if(this.rate(request,"chat-login",12,15*60000))return err(429,"Too many attempts. Try later.");
     const d=await readJson(request),email=trimmed(d.email,254).toLowerCase(),pass=d.password;
     if(!email||typeof pass!=="string"||pass.length>300)return err(401,"Email or password incorrect.");
     const user=this.rows("SELECT * FROM chat_users WHERE email=? AND status='active'",email)[0];
     if(!user||await passwordHash(pass,user.salt)!==user.password_hash)return err(401,"Email or password incorrect.");
     return json({ok:true,name:user.name},200,{"Set-Cookie":await this.newSession("visitor",user.id)});
   }
   if(method==="POST"&&path==="/api/chat/logout")return this.logout(request,"visitor");
   if(path.startsWith("/api/chat/visitor/")){
     const user=await this.session(request,"visitor");
     if(!user)return err(401,"Register through an approved invitation or sign in.");
     if(method==="GET"&&path==="/api/chat/visitor/me")return json({ok:true,name:user.name,online:this.online()});
     if(method==="GET"&&path==="/api/chat/visitor/messages"){
       const after=Math.max(0,Math.min(999999999,Number(u.searchParams.get("after")||0)||0));
       return json({ok:true,online:this.online(),messages:this.rows("SELECT id,sender,body,created_at FROM messages WHERE thread_id=? AND id>? ORDER BY id ASC LIMIT 150",user.id,after)});
     }
     if(method==="POST"&&path==="/api/chat/visitor/messages"){
       if(this.rate(request,"chat-message:"+user.id,12,60000))return err(429,"Too many messages. Please wait a moment.");
       const d=await readJson(request),body=trimmed(d.message,1001);
       if(body.length<1||body.length>1000)return err(400,"Messages must be 1–1000 characters.");
       this.db.exec("INSERT INTO messages(thread_id,sender,body,created_at) VALUES(?,'visitor',?,?)",user.id,body,t());
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
