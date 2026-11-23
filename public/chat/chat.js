(()=>{
"use strict";
const E=id=>document.getElementById(id);
const api=async(path,method="GET",body)=>{
 const options={method,credentials:"same-origin",headers:{Accept:"application/json"}};
 if(body!==undefined){options.headers["Content-Type"]="application/json";options.body=JSON.stringify(body)}
 const r=await fetch("/api/chat/"+path,options),j=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(j.error||"Unable to complete request");return j;
};
const register=E("register-form");
if(register){
 const params=new URLSearchParams(location.search),token=params.get("token")||"",intro=E("invite-intro"),status=E("reg-status");
 async function check(){
  if(token.length<32){intro.textContent="This page requires a personal invitation link from Fern.";return}
  try{const r=await api("invite?token="+encodeURIComponent(token));intro.textContent="Welcome, "+r.name+". Your introduction has been approved. Create a password to enter your private chat.";register.hidden=false}
  catch(e){intro.textContent=e.message;register.hidden=true}
 }
 register.onsubmit=async event=>{
  event.preventDefault();status.textContent="";
  const password=E("new-password").value;
  if(password!==E("repeat-password").value){status.textContent="The passwords don't match.";return}
  const button=register.querySelector("button");button.disabled=true;
  try{await api("register","POST",{token,password});history.replaceState(null,"","/chat/register/");location.replace("/chat/")}
  catch(e){status.textContent=e.message;button.disabled=false}
 };
 check();
 return;
}
const login=E("visitor-login"),conversation=E("private-conversation"),log=E("chat-log"),status=E("chat-status");
if(!login||!conversation)return;
let active=false,last=0;
let installPrompt=null;
const profileForm=E("profile-form"),profileStatus=E("profile-status");
let profileDirty=false;
async function loadProfile(){
 if(!active||profileDirty)return;
 try{
  const response=await api("visitor/profile"),p=response.profile||{};
  for(const name of ["preferred_name","region","occupation","about","interests","talking_points","intentions"]){
   if(profileForm.elements[name])profileForm.elements[name].value=p[name]||"";
  }
  profileStatus.textContent="";
 }catch(error){profileStatus.textContent="Could not load your profile: "+error.message}
}
profileForm.addEventListener("input",()=>{profileDirty=true});
profileForm.addEventListener("submit",async event=>{
 event.preventDefault();
 const button=profileForm.querySelector("button[type=submit]");button.disabled=true;
 const fields=["preferred_name","region","occupation","about","interests","talking_points","intentions"];
 const payload=Object.fromEntries(fields.map(f=>[f,profileForm.elements[f].value.trim()]));
 try{await api("visitor/profile","POST",payload);profileDirty=false;profileStatus.textContent="Saved privately for you and Fern."}
 catch(error){profileStatus.textContent=error.message}
 finally{button.disabled=false}
});
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;E("install-chat").hidden=false});
E("install-chat").addEventListener("click",async()=>{if(!installPrompt)return;await installPrompt.prompt();installPrompt=null;E("install-chat").hidden=true});
E("enable-chat-notices").addEventListener("click",async()=>{
 const button=E("enable-chat-notices");
 try{
  if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window))throw Error("Reply alerts aren't supported by this browser.");
  const config=await api("visitor/push-key");
  if(!config.publicKey)throw Error("Reply alerts haven't been configured yet.");
  const permission=await Notification.requestPermission();
  if(permission!=="granted")throw Error("Notification permission wasn't granted.");
  const reg=await navigator.serviceWorker.register("/chat/sw.js",{scope:"/chat/"});
  await navigator.serviceWorker.ready;
  const str=config.publicKey.replace(/-/g,"+").replace(/_/g,"/");
  const key=Uint8Array.from(atob(str+"=".repeat((4-str.length%4)%4)),c=>c.charCodeAt(0));
  let subscription=await reg.pushManager.getSubscription();
  if(!subscription)subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key.buffer});
  await api("visitor/push-subscribe","POST",{subscription:subscription.toJSON()});
  button.textContent="Reply alerts enabled ✓";status.textContent="Your phone can notify you when Fern replies.";
 }catch(error){status.textContent=error.message}
});

const bubble=m=>{
 const el=document.createElement("div");el.className="bubble"+(m.sender==="visitor"?" mine":"");
 const content=document.createElement("div");content.textContent=m.body;const when=document.createElement("small");when.textContent=(m.sender==="visitor"?"You":"Fern")+" · "+new Date(m.created_at).toLocaleString();
 el.append(content,when);log.append(el);
};
function presence(v){
 for(const suffix of ["","-inner"]){
  const text=E("online-text"+suffix),dot=E("online-dot"+suffix);
  if(text)text.textContent=v?"Fern is online":"Fern is currently offline — you can still leave a message.";
  if(dot)dot.classList.toggle("on",Boolean(v));
 }
}
async function messages(){
 if(!active)return;
 try{
  const r=await api("visitor/messages?after="+last);
  presence(r.online);
  if(r.messages.length===0&&last===0&&log.childElementCount===0){const empty=document.createElement("p");empty.textContent="Your private correspondence begins here.";empty.className="status";log.append(empty)}
  if(r.messages.length){if(last===0)log.replaceChildren();r.messages.forEach(m=>{bubble(m);last=Math.max(last,m.id)});log.scrollTop=log.scrollHeight}
 }catch(e){status.textContent=e.message}
}
async function restore(){
 try{const me=await api("visitor/me");active=true;login.hidden=true;conversation.hidden=false;E("chat-title").textContent="Hello, "+me.name+".";presence(me.online);await Promise.all([messages(),loadProfile()])}
 catch{active=false;login.hidden=false;conversation.hidden=true;try{const p=await api("presence");presence(p.online)}catch{}}
}
E("visitor-login-form").onsubmit=async event=>{
 event.preventDefault();E("login-status").textContent="";
 try{await api("login","POST",{email:E("visitor-email").value.trim(),password:E("visitor-password").value});E("visitor-password").value="";last=0;log.replaceChildren();await restore()}
 catch(e){E("login-status").textContent=e.message}
};
E("visitor-logout").onclick=async()=>{try{await api("logout","POST",{})}catch{}location.reload()};
E("chat-compose").onsubmit=async event=>{
 event.preventDefault();const input=E("message-input"),message=input.value.trim();if(!message)return;
 const button=E("chat-compose").querySelector("button");button.disabled=true;
 try{await api("visitor/messages","POST",{message});input.value="";status.textContent="Message delivered.";await messages()}
 catch(e){status.textContent=e.message}
 finally{button.disabled=false}
};
setInterval(()=>{if(document.visibilityState==="visible")messages()},6500);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")messages()});
restore();
})();