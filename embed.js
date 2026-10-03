/* TFAA Stipend Dashboard embed.
   Paste on the host page:
   <div id="tfaa-stipend-dashboard"></div>
   <script src="https://timlinley.github.io/tfaa-stipend-dashboard/embed.js" async></script>
   The dashboard loads in a frame that grows to fit its content, so visitors scroll the page, not a box. */
(function(){
  var me=document.currentScript||document.querySelector('script[src*="tfaa-stipend-dashboard/embed.js"]');
  var base=me.src.replace(/embed\.js(\?.*)?$/,'');
  var origin=new URL(base).origin;
  var box=document.getElementById('tfaa-stipend-dashboard');
  if(!box){box=document.createElement('div');me.parentNode.insertBefore(box,me)}
  var f=document.createElement('iframe');
  f.src=base+'index.html';f.title='TFAA Stipend Survey Dashboard';f.loading='lazy';
  f.setAttribute('style','display:block;width:100%;min-height:900px;border:0;overflow:hidden');
  f.setAttribute('scrolling','no');
  box.appendChild(f);
  var a=document.createElement('a');
  a.href=base;a.target='_blank';a.rel='noopener';a.textContent='Open the dashboard in its own window';
  a.setAttribute('style','display:inline-block;margin-top:8px;font-size:14px');
  box.appendChild(a);
  window.addEventListener('message',function(e){
    if(e.origin!==origin||e.source!==f.contentWindow||!e.data||typeof e.data.tfaaStipendHeight!=='number')return;
    f.style.height=Math.ceil(e.data.tfaaStipendHeight)+'px';
  });
})();
