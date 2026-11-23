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
 try{const me=await api("visitor/me");active=true;login.hidden=true;conversation.hidden=false;E("chat-title").textContent="Hello, "+me.name+".";presence(me.online);await messages()}
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