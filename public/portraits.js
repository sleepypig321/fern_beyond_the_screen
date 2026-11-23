document.querySelectorAll(".portrait-holder[data-image]").forEach((frame) => {
  const img = new Image();
  img.className = "real-photo";
  img.alt = "A photograph of Fern";
  img.onload = () => {
    frame.appendChild(img);
    frame.dataset.hasPhoto = "true";
  };
  img.src = frame.dataset.image;
});
