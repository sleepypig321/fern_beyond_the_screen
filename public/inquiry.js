(function(){
"use strict";
  const form=document.getElementById("inquiry-form");
  const send=document.getElementById("inquiry-submit");
  const status=document.getElementById("inquiry-status");
  const file=document.getElementById("inquiry-photo");
  const preview=document.getElementById("photo-preview");
  const photoPreview=document.getElementById("photo-preview-image");
  const photoName=document.getElementById("photo-preview-name");
  let photoUrl=null, turnstileId=null, ready=false;
  function report(message,error){status.textContent=message;status.dataset.error=String(Boolean(error));}
  function clearPhoto(){
    if(photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl=null;file.value="";photoPreview.removeAttribute("src");preview.hidden=true;photoName.textContent="";
  }
  file.addEventListener("change",function(){
    const chosen=file.files && file.files[0];
    if(photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl=null;preview.hidden=true;
    if(!chosen) return;
    if(!["image/jpeg","image/png","image/webp"].includes(chosen.type)||chosen.size>3*1024*1024){
      clearPhoto();report("Choose a JPG, PNG, or WebP photo under 3 MB.",true);return;
    }
    photoUrl=URL.createObjectURL(chosen);
    photoPreview.src=photoUrl;
    photoName.textContent=chosen.name;
    preview.hidden=false;
    if(ready)report("Your photo is attached. Complete the form to send your note.",false);
  });
  document.getElementById("clear-photo").addEventListener("click",clearPhoto);

  function launchTurnstile(sitekey){
    const script=document.createElement("script");
    script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async=true;
    script.onload=function(){
      if(!window.turnstile){report("The security check could not load. Refresh to try again.",true);return;}
      turnstileId=window.turnstile.render("#fern-turnstile",{sitekey:sitekey,theme:"dark"});
      ready=true;send.disabled=false;report("Ready for your private introduction.",false);
    };
    script.onerror=function(){report("The security check is unavailable. Refresh to try again.",true);};
    document.head.appendChild(script);
  }
  fetch("/api/config",{headers:{"Accept":"application/json"},cache:"no-store"})
    .then(function(response){if(!response.ok)throw Error("unavailable");return response.json();})
    .then(function(config){
      if(config.ready && config.turnstileSiteKey){launchTurnstile(config.turnstileSiteKey);}
      else{report("The private inquiry form is being connected. Submissions aren't available yet.",false);}
    })
    .catch(function(){report("The inquiry service couldn't be reached. Please check back later.",true);});

  form.addEventListener("submit",async function(event){
    event.preventDefault();
    if(!ready||send.disabled)return;
    if(!form.reportValidity())return;
    const email=form.elements.email.value.trim().toLowerCase();
    const confirmation=form.elements.email_confirm.value.trim().toLowerCase();
    if(email!==confirmation){report("Your email addresses do not match. Please double-check both entries.",true);form.elements.email_confirm.focus();return;}
    const selected=file.files && file.files[0];
    if(!selected||selected.size>3*1024*1024){report("Please attach a photo under 3 MB.",true);return;}
    send.disabled=true;report("Sending your introduction privately…",false);
    try{
      const response=await fetch("/api/inquiry",{method:"POST",body:new FormData(form),headers:{"Accept":"application/json"}});
      const result=await response.json();
      if(!response.ok||!result.ok)throw Error(result.error||"Unable to send the form.");
      report("Your introduction has been sent privately. Thank you! If approved, watch your inbox and Spam or Junk folder for an invitation.",false);
      form.reset();clearPhoto();
    }catch(error){report(error.message||"Delivery failed. Please try again.",true);}
    finally{
      if(window.turnstile && turnstileId!==null)window.turnstile.reset(turnstileId);
      send.disabled=!ready;
    }
  });

})();