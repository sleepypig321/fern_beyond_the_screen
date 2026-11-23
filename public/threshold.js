(function(){
  "use strict";
  const scene=document.getElementById("threshold");
  const entry=document.getElementById("hello");
  const door=document.getElementById("threshold-door");
  const button=document.getElementById("threshold-enter");
  const live=document.getElementById("threshold-status");
  if(!scene||!entry||!door||!button)return;
  let opened=false;
  function reveal(){
    if(opened)return;
    opened=true;
    scene.classList.add("is-opening");
    door.setAttribute("aria-expanded","true");
    door.setAttribute("aria-disabled","true");
    door.disabled=true;
    button.disabled=true;
    live.textContent="The door is opening. Your private inquiry form is next.";
    const reducedMotion=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(function(){
      entry.hidden=false;
      scene.classList.remove("is-opening");
      scene.classList.add("is-open");
      live.textContent="The door is open. Your private inquiry form is ready.";
      entry.scrollIntoView({behavior:reducedMotion?"auto":"smooth",block:"start"});
      const heading=document.getElementById("inquiry-title");
      if(heading){heading.setAttribute("tabindex","-1");heading.focus({preventScroll:true});}
    },reducedMotion?0:1100);
  }
  door.addEventListener("click",reveal);
  button.addEventListener("click",reveal);
})();