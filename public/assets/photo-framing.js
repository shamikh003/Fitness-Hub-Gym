/* Shared non-destructive framing: the original photo is never overwritten. */
(() => {
  const normalize=(value,trainer=false)=>({
    fit:value?.fit==='contain'?'contain':value?.fit==='cover'?'cover':trainer?'contain':'cover',
    x:Number.isFinite(value?.x)?Math.max(0,Math.min(100,value.x)):50,
    y:Number.isFinite(value?.y)?Math.max(0,Math.min(100,value.y)):50,
    zoom:Number.isFinite(value?.zoom)?Math.max(1,Math.min(3,value.zoom)):1
  });
  const apply=(image,value,trainer=false)=>{
    const frame=normalize(value,trainer);
    image.style.objectFit=frame.fit;
    image.style.objectPosition=`${frame.x}% ${frame.y}%`;
    image.style.transformOrigin=`${frame.x}% ${frame.y}%`;
    image.style.transform=`scale(${frame.zoom})`;
  };
  const preview=(image,value,trainer=false)=>{
    if(!image.parentElement.classList.contains('photo-frame')){
      const wrapper=document.createElement('div');wrapper.className='photo-frame';
      image.replaceWith(wrapper);wrapper.append(image);
    }
    image.parentElement.classList.toggle('wide-photo-frame',!trainer);
    apply(image,value,trainer);
  };
  window.GymPhotoFraming={normalize,apply,preview};
})();
