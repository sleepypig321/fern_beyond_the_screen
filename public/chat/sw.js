self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("push",event=>{
 let data={title:"Fern · Private Chat",body:"You have a new private reply.",url:"/chat/"};
 try{if(event.data)data={...data,...event.data.json()}}catch{}
 event.waitUntil(self.registration.showNotification("Fern · Private Chat",{body:"You have a new private reply.",tag:"fern-reply",data:{url:"/chat/"},icon:"/chat/icons/icon-192.png",badge:"/chat/icons/icon-192.png"}));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of clients){if(new URL(client.url).origin===self.location.origin){await client.navigate("/chat/");return client.focus()}}
  return self.clients.openWindow("/chat/");
 })());
});
