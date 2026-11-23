(function(){
"use strict";
const scene=document.getElementById("threshold"),portal=document.querySelector(".threshold-portal"),door=document.getElementById("threshold-door"),button=document.getElementById("threshold-enter"),status=document.getElementById("threshold-status");
if(!scene||!portal||!door||!button)return;
let opening=false;
function arrive(){try{sessionStorage.setItem("fern-door-entered","1");}catch(e){} window.location.assign("/inquire/letter/");}
function stepInside(){
scene.classList.add("is-opening");
if(status)status.textContent="The door is opening.";
window.setTimeout(function(){
const p=portal.getBoundingClientRect(),s=scene.getBoundingClientRect(),cx=p.left+p.width/2,cy=p.top+p.height*.5;
scene.style.setProperty("--door-origin-x",cx-s.left+"px");scene.style.setProperty("--door-origin-y",cy-s.top+"px");
scene.style.setProperty("--door-shift-x",innerWidth/2-cx+"px");scene.style.setProperty("--door-shift-y",innerHeight/2-cy+"px");
scene.classList.add("is-entering");
if(status)status.textContent="Stepping through the doorway to your private letter.";
window.setTimeout(arrive,1100);
},590);
}
function enter(e){
if(e&&(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey))return;
if(e)e.preventDefault();
if(opening)return;opening=true;button.setAttribute("aria-disabled","true");door.setAttribute("aria-disabled","true");button.tabIndex=-1;door.tabIndex=-1;
if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){arrive();return;}
const p=portal.getBoundingClientRect();
if(p.top<70||p.bottom>innerHeight-18){portal.scrollIntoView({behavior:"smooth",block:"center"});window.setTimeout(stepInside,420);}else stepInside();
}
door.addEventListener("click",enter);button.addEventListener("click",enter);
})();