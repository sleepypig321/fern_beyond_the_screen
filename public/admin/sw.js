self.addEventListener("install",event=>{self.skipWaiting()});
self.addEventListener("activate",event=>{event.waitUntil(self.clients.claim())});
self.addEventListener("push",event=>{
  let data={title:"Fern · Private Inbox",body:"You have a new private message.",url:"/admin/"};
  try{if(event.data)data={...data,...event.data.json()}}catch{}
  const target=(typeof data.url==="string"&&data.url.startsWith("/admin/"))?data.url:"/admin/";
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,tag:data.tag||"fern-new-message",icon:"/chat/icons/icon-192.png",badge:"/chat/icons/icon-192.png",data:{url:target}}));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||"/admin/",self.location.origin).href;
  event.waitUntil((async()=>{
    const all=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of all){if(new URL(client.url).origin===self.location.origin&&"focus" in client){await client.navigate(target);return client.focus()}}
    return self.clients.openWindow(target);
  })());
});