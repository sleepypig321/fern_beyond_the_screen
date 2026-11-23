(()=>{
"use strict";
const el=id=>document.getElementById(id);
const app=el("admin-app"),login=el("admin-login"),actions=el("admin-actions"),list=el("item-list"),detail=el("detail");
let mode="inquiries",selected="",inquiries=[],threads=[],enabled=false,signedIn=false,installPrompt=null,prevMessages="";
const api=async(path,method="GET",body)=>{
 const opts={method,credentials:"same-origin",headers:{Accept:"application/json"}};
 if(body!==undefined){opts.headers["Content-Type"]="application/json";opts.body=JSON.stringify(body)}
 const res=await fetch("/api/chat/"+path,opts),data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(data.error||"Something went wrong.");
 return data;
};
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
const btn=(text,cls,fn)=>{const n=node("button",cls,text);n.type="button";n.addEventListener("click",fn);return n};
const stamp=ms=>new Date(ms).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
function toast(s){const b=el("app-status");b.textContent=s;b.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>b.classList.remove("show"),5000)}
function setOnline(online){const b=el("online-button");b.dataset.online=String(online);b.setAttribute("aria-pressed",String(enabled));el("online-label").textContent=online?"Online":enabled?"Reconnecting…":"Offline"}
async function session(){
 try{const me=await api("admin/me");signedIn=true;enabled=me.enabled;setOnline(me.online);login.hidden=true;app.hidden=false;actions.hidden=false;void enableAdminNotices(false);await refresh()}
 catch{signedIn=false;login.hidden=false;app.hidden=true;actions.hidden=true}
}
el("login-form").addEventListener("submit",async e=>{e.preventDefault();el("login-status").textContent="";try{await api("admin/login","POST",{password:el("admin-password").value});el("admin-password").value="";await session()}catch(x){el("login-status").textContent=x.message}});
el("logout").addEventListener("click",async()=>{try{await api("admin/logout","POST",{})}catch{}location.reload()});
el("online-button").addEventListener("click",async()=>{try{const state=!enabled;const data=await api("admin/availability","POST",{online:state});enabled=state;setOnline(data.online);toast(state?"You are now online.":"You are now offline.")}catch(x){toast(x.message)}});
el("refresh").addEventListener("click",refresh);
el("tab-inquiries").addEventListener("click",()=>changeMode("inquiries"));
el("tab-conversations").addEventListener("click",()=>changeMode("conversations"));
function blank(){
 detail.replaceChildren();const shell=node("div","empty-state");
 const img=node("img");img.src="/assets/mushroom-mark.svg";img.alt="";
 shell.append(img,node("h2","",mode==="inquiries"?"Choose a letter.":"Private correspondence."),node("p","",mode==="inquiries"?"Read an introduction and decide who can register.":"Select a conversation to reply."));
 detail.append(shell)
}
function changeMode(value){mode=value;selected="";prevMessages="";el("tab-inquiries").classList.toggle("active",value==="inquiries");el("tab-conversations").classList.toggle("active",value==="conversations");el("list-label").textContent=value==="inquiries"?"PRIVATE INTRODUCTIONS":"APPROVED CONVERSATIONS";renderList();blank()}
function renderList(){
 list.replaceChildren();const data=mode==="inquiries"?inquiries:threads;
 if(!data.length){list.append(node("p","empty",mode==="inquiries"?"No introductions yet.":"No registered conversations yet."));return}
 for(const r of data){
   const item=btn("","item"+(selected===r.id?" active":""),()=>{selected=r.id;renderList();mode==="inquiries"?showInquiry(r.id,true):showThread(r.id,true)});
   const header=node("span","row");
   header.append(node("strong","",r.name),node("small","state",r.status));
   item.append(header,node("small","",stamp(mode==="inquiries"?r.created_at:r.last_at)),node("span","preview",mode==="inquiries"?r.message:(r.last_message||"No messages yet")));
   list.append(item)
 }
}
async function refresh(){
 if(!signedIn)return;
 try{
  const [a,b,me]=await Promise.all([api("admin/inquiries"),api("admin/threads"),api("admin/me")]);
  inquiries=a.inquiries||[];threads=b.threads||[];enabled=me.enabled;setOnline(me.online);
  el("inquiry-count").textContent=inquiries.filter(x=>x.status==="pending").length;
  el("thread-count").textContent=threads.length;
  renderList();
  if(selected){mode==="inquiries"?showInquiry(selected,false):showThread(selected,false)}
 }catch(x){toast(x.message)}
}
function info(label,value){const box=node("section","info-line");box.append(node("h3","",label),node("p","",value||"—"));return box}
function showInquiry(id,scroll){
 const d=inquiries.find(x=>x.id===id);if(!d||mode!=="inquiries")return;
 detail.replaceChildren();
 detail.append(node("span","overline","PRIVATE INTRODUCTION"),node("h2","",d.name),node("p","meta",d.age+" years old · "+d.city+" · "+stamp(d.created_at)+" · "+d.status.toUpperCase()));
 const img=node("img","detail-photo");img.src="/api/chat/admin/inquiries/"+d.id+"/photo";img.loading="lazy";img.alt="Private applicant photograph";
 detail.append(img,info("Contact for invitation",d.email),info("Their interests",d.interests),info("Potential connection",d.connection),info("Their introduction",d.message));
 const ops=node("div","detail-actions");
 if(d.status==="pending")ops.append(btn("Approve and invite","primary",()=>approve(d)),btn("Decline","danger",()=>decline(d)));
 if(d.status==="declined")ops.append(btn("Send decline email again","outline",()=>decline(d)));
 if(d.status==="approved"&&!d.invite_used)ops.append(btn("Issue new invitation","outline",()=>approve(d)));
 detail.append(ops);
 if(d.status==="approved")detail.append(node("p","meta",d.invite_used?"Registered to chat":"Approved · awaiting registration"));
 if(scroll&&innerWidth<600)detail.scrollIntoView({behavior:"smooth",block:"start"})
}
function confirmDecision(title, description, action, destructive=false){
 const dialog=el("decision-dialog");
 el("decision-title").textContent=title;
 el("decision-description").textContent=description;
 const submit=el("decision-confirm");
 submit.textContent=action;
 submit.className=destructive?"danger":"primary";
 return new Promise(resolve=>{
  dialog.addEventListener("close",()=>resolve(dialog.returnValue==="confirm"),{once:true});
  dialog.returnValue="";
  dialog.showModal();
 });
}
async function approve(d){
 if(!await confirmDecision("Approve this introduction?","Create a private registration link for "+d.name+" and try to send it by email.","Approve and invite"))return;
 try{
  const a=await api("admin/inquiries/"+d.id+"/approve","POST",{});
  // Keep the private link visible after refresh.
  await refresh();
  const box=node("div","invite-result");
  box.append(node("h3","","Registration link"),node("small","",a.emailed?"Invitation sent by email.":"Invitation prepared, but email wasn't sent automatically. Copy and share this link privately."));
  const input=node("input");input.type="text";input.readOnly=true;input.value=a.inviteUrl;
  box.append(input,btn("Copy link","outline",async()=>{try{await navigator.clipboard.writeText(input.value);toast("Copied private invitation.")}catch{input.select();toast("Copy the selected link.")}}));
  detail.append(box);toast("Approved. Only this invite can create their chat account.");
 }catch(x){toast(x.message)}
}
async function decline(d){
 const retry=d.status==="declined";
 if(!await confirmDecision(retry?"Send decline email again?":"Decline this introduction?",retry?"Send a courtesy email to "+d.name+" again. Check whether the earlier email arrived before retrying.":"Decline "+d.name+"’s introduction, revoke any existing chat access, and try to send a courtesy email.",retry?"Send email again":"Decline introduction",true))return;
 try{
  const result=await api("admin/inquiries/"+d.id+"/decline","POST",{});
  await refresh();
  const message=result.emailed?"Decline email accepted by the email provider.":result.emailError||"Introduction declined. The email provider did not accept the message. You can retry here.";
  if(selected===d.id&&mode==="inquiries")detail.append(node("p","message",message));
  toast(message);
 }catch(x){toast(x.message)}
}
async function showThread(id,scroll){
 if(mode!=="conversations"||!threads.some(x=>x.id===id))return;
 try{
  const d=await api("admin/threads/"+id+"/messages");
  if(selected!==id||mode!=="conversations")return;
  const stampMessages=JSON.stringify({messages:d.messages,profile:d.profile,private_note:d.private_note});
  if(prevMessages===stampMessages&&detail.querySelector(".chat-compose"))return;
  prevMessages=stampMessages;
  detail.replaceChildren();detail.append(node("span","overline","PRIVATE CONVERSATION"),node("h2","",d.profile?.preferred_name||d.user.name),node("p","meta",d.user.status==="active"?"Approved account · Private profile available":"Account disabled"));
  const p=d.profile||{},profileCard=node("details","admin-profile-card");
  profileCard.open=true;
  const summary=node("summary","","Their profile · Your conversation reference");
  const profileBody=node("div","admin-profile-body");
  const infoRows=[
    ["Preferred name",p.preferred_name],["Age from inquiry",p.age!=null?String(p.age):""],
    ["Email",p.email],["General region",p.region],["Work, studies or projects",p.occupation],
    ["More about them",p.about],["Interests & favorites",p.interests],
    ["Conversation topics",p.talking_points],["What they're looking for",p.intentions]
  ];
  for(const [label,value] of infoRows){
    if(!value)continue;
    const row=node("div","admin-profile-row");
    row.append(node("strong","",label),node("p","",String(value)));
    profileBody.append(row);
  }
  const original=node("details","original-introduction");
  original.append(node("summary","","Original approved introduction"));
  const originalText=node("div","original-fields");
  for(const [label,value] of [["Name on inquiry",p.account_name],["Region submitted",p.original_region],["Original interests",p.original_interests],["Initial connection idea",p.original_connection],["Introduction message",p.original_message]]){
    if(!value)continue;
    const row=node("div","admin-profile-row");row.append(node("strong","",label),node("p","",String(value)));originalText.append(row);
  }
  original.append(originalText);
  profileBody.append(original);
  const noteForm=node("form","profile-notes");
  const noteLabel=node("label","","Your private notes · visible only to you");
  const noteArea=node("textarea");
  noteArea.maxLength=2000;noteArea.rows=3;
  noteArea.value=d.private_note||"";
  noteArea.placeholder="A favorite topic, something to remember, or a future question…";
  noteArea.setAttribute("aria-label","Your private notes about this conversation");
  const noteBtn=node("button","outline","Save my notes");noteBtn.type="submit";
  const noteStatus=node("small","notes-feedback","");
  noteForm.append(noteLabel,noteArea,noteBtn,noteStatus);
  noteForm.addEventListener("submit",async event=>{
    event.preventDefault();noteBtn.disabled=true;
    try{await api("admin/threads/"+id+"/notes","POST",{note:noteArea.value});noteStatus.textContent="Private notes saved.";prevMessages=""}
    catch(error){noteStatus.textContent=error.message}
    finally{noteBtn.disabled=false}
  });
  profileBody.append(noteForm);profileCard.append(summary,profileBody);
  detail.append(profileCard);
  const log=node("div","chat-messages");log.setAttribute("role","log");
  for(const msg of d.messages){const bubble=node("div","bubble"+(msg.sender==="admin"?" mine":""));bubble.append(node("div","",msg.body),node("small","",(msg.sender==="admin"?"You":"Visitor")+" · "+stamp(msg.created_at)));log.append(bubble)}
  if(!d.messages.length)log.append(node("p","empty","No messages yet."));
  const form=node("form","chat-compose"),area=node("textarea");area.placeholder="Write your private reply…";area.maxLength=1000;area.required=true;area.setAttribute("aria-label","Your reply");
  const send=node("button","primary","Send reply");send.type="submit";send.disabled=d.user.status!=="active";
  form.append(area,send);
  form.addEventListener("submit",async e=>{e.preventDefault();if(!area.value.trim())return;send.disabled=true;try{await api("admin/threads/"+id+"/messages","POST",{message:area.value.trim()});prevMessages="";await showThread(id,false);await refresh()}catch(x){toast(x.message);send.disabled=false}});
  detail.append(log,form);log.scrollTop=log.scrollHeight;
  if(scroll&&innerWidth<600)detail.scrollIntoView({behavior:"smooth",block:"start"});
 }catch(x){toast(x.message)}
}
async function enableAdminNotices(interactive){
 if(!interactive&&(!("Notification" in window)||Notification.permission!=="granted"))return;
 try{
  if(!("Notification" in window)||!("serviceWorker" in navigator)||!("PushManager" in window))throw Error("Push notifications aren't supported here.");
  const data=await api("admin/push-key");
  if(!data.publicKey)throw Error("Push notifications aren't configured in Cloudflare yet.");
  const permission=interactive?await Notification.requestPermission():Notification.permission;
  if(permission!=="granted")throw Error("Notification permission wasn't granted.");
  const registration=await navigator.serviceWorker.register("/admin/sw.js",{scope:"/admin/"});
  await navigator.serviceWorker.ready;
  const raw=atob(data.publicKey.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-data.publicKey.length%4)%4));
  const key=Uint8Array.from(raw,c=>c.charCodeAt(0));
  let subscription=await registration.pushManager.getSubscription();
  if(!interactive&&!subscription)return;
  const subscribedKey=subscription?.options.applicationServerKey;
  if(subscription&&(!subscribedKey||subscribedKey.byteLength!==key.byteLength||
    !new Uint8Array(subscribedKey).every((value,index)=>value===key[index]))){
    await subscription.unsubscribe();
    subscription=null;
  }
  if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key.buffer});
  const result=await api("admin/push-subscribe","POST",{subscription:subscription.toJSON(),test:interactive});
  el("push-button").textContent="Notifications on ✓";
  if(interactive)toast(result.testStatus||"Notification subscription saved.");
 }catch(x){if(interactive)toast(x.message)}
}
el("push-button").addEventListener("click",()=>enableAdminNotices(true));
addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;el("install-prompt").hidden=false});
el("install-prompt").addEventListener("click",async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;el("install-prompt").hidden=true}});
setInterval(async()=>{if(!signedIn||document.visibilityState!=="visible")return;if(enabled){try{const r=await api("admin/heartbeat","POST",{});setOnline(r.online)}catch{}}await refresh()},18000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&signedIn)refresh()});
const query=new URLSearchParams(location.search);
if(query.has("chat")){mode="conversations";selected=query.get("chat");el("tab-inquiries").classList.remove("active");el("tab-conversations").classList.add("active");el("list-label").textContent="APPROVED CONVERSATIONS"}
else if(query.has("inquiry")){mode="inquiries";selected=query.get("inquiry");el("tab-inquiries").classList.add("active");el("tab-conversations").classList.remove("active");el("list-label").textContent="PRIVATE INTRODUCTIONS"}
session();
})();