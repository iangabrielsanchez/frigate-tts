import { ALL_CAMERAS } from "./config.js";

export const MAIN_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FrigateTTS</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#2f6fed">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="FrigateTTS">
<style>
:root{--bg:#f6f6f4;--card:#fff;--fg:#1d1d1b;--mute:#6b6b66;--line:#ddd;--acc:#2f6fed}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--card:#1e1e1e;--fg:#eee;--mute:#999;--line:#333;--acc:#5b8dff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 system-ui,sans-serif}
main{max-width:520px;margin:0 auto;padding:24px 16px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
h1{font-size:20px;margin:0}
a.gear{color:var(--mute);text-decoration:none;font-size:20px}
textarea,select,button{font:inherit;width:100%;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:12px}
textarea{min-height:110px;resize:vertical}
.row{display:flex;gap:10px;margin:10px 0}.row>*{flex:1}
label{font-size:13px;color:var(--mute);display:block;margin-bottom:4px}
button{background:var(--acc);color:#fff;border:0;font-weight:600;padding:14px;cursor:pointer}
button:disabled{opacity:.5}
button.ghost{background:var(--card);color:var(--fg);border:1px solid var(--line)}
#status{margin-top:12px;color:var(--mute);min-height:1.4em}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px}
.chips button{width:auto;background:var(--card);color:var(--fg);border:1px solid var(--line);font-weight:400;padding:6px 12px;font-size:14px}
.chips.presets{margin-top:8px}
.chips.presets button{border-color:var(--acc);color:var(--acc)}
#ptt{margin-top:10px;padding:22px;background:var(--card);color:var(--fg);border:2px solid var(--line);
 touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
#ptt.on{background:#d93a3a;border-color:#d93a3a;color:#fff}
#micnote{font-size:13px;color:var(--mute);margin-top:6px}
details{margin-top:20px}
summary{cursor:pointer;color:var(--mute);font-size:14px}
.soundrow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}
.soundrow button{width:auto;padding:6px 14px;font-size:13px}
</style></head><body><main>
<div class="top"><h1>&#128226; <span id="appName">FrigateTTS</span></h1><a class="gear" href="/settings" title="Settings">&#9881;</a></div>
<textarea id="t" placeholder="Type something to say... (Ctrl+Enter to send)"></textarea>
<div class="chips presets" id="presets"></div>
<div class="row">
 <div><label>Camera</label><select id="cam"></select></div>
 <div><label>Speed</label><select id="spd"><option value="0.85">Slow</option><option value="1" selected>Normal</option><option value="1.2">Fast</option></select></div>
</div>
<div class="row">
 <button id="go">Say it</button>
 <button class="ghost" id="preview">&#9654; Preview</button>
</div>
<button id="ptt">&#127908; Hold to talk</button>
<div id="micnote"></div>
<div id="status"></div>
<div class="chips" id="hist"></div>
<details id="soundboard">
 <summary>&#128266; Soundboard - play an existing sound file</summary>
 <div id="soundList" style="margin-top:8px"></div>
</details>
<audio id="previewAudio" style="display:none"></audio>
<script>
const $=id=>document.getElementById(id);
let cfg={cameras:[],show_history:true,ptt_mode:'record',presets:[]};
let hist=[];try{hist=JSON.parse(localStorage.getItem('hist')||'[]')}catch(e){}

function draw(){
 $('hist').innerHTML='';
 if(!cfg.show_history)return;
 hist.forEach(h=>{const b=document.createElement('button');b.textContent=h;
  b.onclick=()=>{$('t').value=h;$('t').focus()};$('hist').append(b)});
}
function renderPresets(){
 $('presets').innerHTML='';
 (cfg.presets||[]).forEach(p=>{
  const b=document.createElement('button');b.textContent=p;
  b.onclick=()=>say(p);
  $('presets').append(b);
 });
}
function remember(text){
 hist=[text,...hist.filter(h=>h!==text)].slice(0,8);
 try{localStorage.setItem('hist',JSON.stringify(hist))}catch(e){}
 draw();
}
function syncButtons(){
 const has=$('t').value.trim().length>0;
 $('go').disabled=!has;$('preview').disabled=!has;
}
$('t').addEventListener('input',syncButtons);
syncButtons();

async function say(presetText){
 const text=(presetText!==undefined?presetText:$('t').value).trim();if(!text)return;
 $('go').disabled=true;$('status').textContent='Generating and sending...';
 try{const r=await fetch('/say',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({text,cam:$('cam').value,speed:+$('spd').value})});
  const j=await r.json();$('status').textContent=j.ok?('Playing on '+j.cameras.join(', ')+' ('+j.seconds+'s)'):'Error: '+j.error;
  if(j.ok){if(presetText===undefined)remember(text);try{localStorage.setItem('cam',$('cam').value)}catch(e){}}
 }catch(e){$('status').textContent='Error: '+e}
 syncButtons();
}
$('go').onclick=()=>say();$('t').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))say()};

async function preview(){
 const text=$('t').value.trim();if(!text)return;
 $('preview').disabled=true;$('status').textContent='Generating preview...';
 try{
  const r=await fetch('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({text,speed:+$('spd').value})});
  if(!r.ok){const j=await r.json();throw new Error(j.error)}
  const blob=await r.blob(),a=$('previewAudio');
  a.src=URL.createObjectURL(blob);a.play();
  $('status').textContent='Previewing in your browser (not sent to a camera)';
 }catch(e){$('status').textContent='Error: '+e}
 syncButtons();
}
$('preview').onclick=preview;

const ptt=$('ptt'),MAX_MS=60000;
let pressed=false,rec=null,stream=null,chunks=[],t0=0,maxTimer=0,segTimer=0,liveToken=null,liveCam=null;
if(!window.isSecureContext)$('micnote').textContent='Microphone needs HTTPS (or localhost).';

async function startTalk(e){
 e.preventDefault();if(pressed)return;pressed=true;ptt.classList.add('on');
 try{ptt.setPointerCapture(e.pointerId)}catch(_){}
 if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){$('status').textContent='Microphone needs HTTPS';return stopTalk()}
 try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})}
 catch(err){$('status').textContent='Mic error: '+err.message;return stopTalk()}
 if(!pressed){stream.getTracks().forEach(t=>t.stop());return} // let go during the permission prompt
 t0=Date.now();$('status').textContent='';
 maxTimer=setTimeout(stopTalk,MAX_MS);
 if(cfg.ptt_mode==='live')startLiveTalk(); else startRecordTalk();
}
function stopTalk(){
 if(!pressed)return;pressed=false;clearTimeout(maxTimer);clearTimeout(segTimer);
 ptt.classList.remove('on');ptt.textContent='\u{1F399}\uFE0F Hold to talk';
 if(cfg.ptt_mode==='live')stopLiveTalk(); else stopRecordTalk();
}

function startRecordTalk(){
 chunks=[];rec=new MediaRecorder(stream);rec.ondataavailable=ev=>{if(ev.data.size)chunks.push(ev.data)};rec.onstop=sendRecordTalk;
 rec.start();ptt.textContent='Recording... release to send';
}
function stopRecordTalk(){if(rec&&rec.state==='recording')rec.stop()}
async function sendRecordTalk(){
 stream.getTracks().forEach(t=>t.stop());
 if(Date.now()-t0<400){$('status').textContent='Too short. Hold the button while you talk.';return}
 const blob=new Blob(chunks,{type:rec.mimeType}),cam=$('cam').value;
 ptt.disabled=true;$('status').textContent='Sending...';
 try{const r=await fetch('/talk?cam='+encodeURIComponent(cam),{method:'POST',headers:{'Content-Type':blob.type||'application/octet-stream'},body:blob});
  const j=await r.json();$('status').textContent=j.ok?('Playing on '+j.cameras.join(', ')+' ('+j.seconds+'s)'):'Error: '+j.error;
  if(j.ok)try{localStorage.setItem('cam',cam)}catch(_){}
 }catch(err){$('status').textContent='Error: '+err}
 ptt.disabled=false;
}

async function startLiveTalk(){
 ptt.textContent='Connecting...';
 try{
  const r=await fetch('/talk-live/start?cam='+encodeURIComponent($('cam').value),{method:'POST'});
  const j=await r.json();
  if(!j.ok){$('status').textContent='Error: '+j.error;return stopTalk()}
  liveToken=j.token;liveCam=j.cameras.join(', ');
 }catch(err){$('status').textContent='Error: '+err;return stopTalk()}
 if(!pressed)return stopLiveTalk(); // released while connecting
 ptt.textContent='Live... release to stop';
 recordSegment();
}
function recordSegment(){
 if(!pressed||!liveToken)return;
 chunks=[];
 rec=new MediaRecorder(stream);
 rec.ondataavailable=ev=>{if(ev.data.size)chunks.push(ev.data)};
 rec.onstop=()=>{
  if(chunks.length){
   const blob=new Blob(chunks,{type:rec.mimeType});
   fetch('/talk-live/chunk?token='+liveToken,{method:'POST',headers:{'Content-Type':blob.type||'application/octet-stream'},body:blob}).catch(()=>{});
  }
  if(pressed)recordSegment();
 };
 rec.start();
 segTimer=setTimeout(()=>{if(rec&&rec.state==='recording')rec.stop()},700);
}
function stopLiveTalk(){
 if(rec&&rec.state==='recording')rec.stop();
 if(stream)stream.getTracks().forEach(t=>t.stop());
 if(liveToken){
  const tok=liveToken;liveToken=null;
  fetch('/talk-live/stop?token='+tok,{method:'POST'})
   .then(()=>{$('status').textContent='Done on '+liveCam})
   .catch(err=>{$('status').textContent='Error: '+err});
 }
}
ptt.addEventListener('pointerdown',startTalk);
['pointerup','pointercancel'].forEach(ev=>ptt.addEventListener(ev,stopTalk));
ptt.addEventListener('contextmenu',e=>e.preventDefault());

async function loadSoundboard(){
 $('soundList').innerHTML='Loading...';
 try{
  const sounds=await (await fetch('/api/sounds')).json();
  $('soundList').innerHTML='';
  if(!sounds.length){$('soundList').innerHTML='<div style="color:var(--mute);font-size:13px">No sound files found in the sounds folder.</div>';return}
  sounds.forEach(name=>{
   const row=document.createElement('div');row.className='soundrow';
   row.innerHTML='<span>'+name+'</span>';
   const b=document.createElement('button');b.textContent='Play';
   b.onclick=()=>playSound(name,b);
   row.append(b);$('soundList').append(row);
  });
 }catch(e){$('soundList').textContent='Error: '+e}
}
async function playSound(name,btn){
 btn.disabled=true;$('status').textContent='Sending...';
 try{
  const r=await fetch('/api/sounds/play',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({file:name,cam:$('cam').value})});
  const j=await r.json();
  $('status').textContent=j.ok?('Playing '+name+' on '+j.cameras.join(', ')+' ('+j.seconds+'s)'):'Error: '+j.error;
 }catch(e){$('status').textContent='Error: '+e}
 btn.disabled=false;
}
let soundboardLoaded=false;
$('soundboard').addEventListener('toggle',function(){if(this.open&&!soundboardLoaded){soundboardLoaded=true;loadSoundboard()}});

(async function init(){
 try{
  cfg=await (await fetch('/api/settings')).json();
  document.title=cfg.app_name;$('appName').textContent=cfg.app_name;
  document.querySelector('meta[name="apple-mobile-web-app-title"]').setAttribute('content',cfg.app_name);
  $('cam').innerHTML=cfg.cameras.map(c=>'<option value="'+c+'">'+c+'</option>').join('')
    +(cfg.cameras.length>1?'<option value="${ALL_CAMERAS}">All cameras</option>':'');
  try{const c=localStorage.getItem('cam');if(c&&(cfg.cameras.includes(c)||c==='${ALL_CAMERAS}'))$('cam').value=c}catch(e){}
  draw();renderPresets();
 }catch(e){$('status').textContent='Could not load settings: '+e}
})();
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
</script></main></body></html>`;

export const SETTINGS_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FrigateTTS - Settings</title>
<link rel="icon" href="/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#2f6fed">
<style>
:root{--bg:#f6f6f4;--card:#fff;--fg:#1d1d1b;--mute:#6b6b66;--line:#ddd;--acc:#2f6fed;--ok:#1f9254;--err:#d93a3a}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--card:#1e1e1e;--fg:#eee;--mute:#999;--line:#333;--acc:#5b8dff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 system-ui,sans-serif}
main{max-width:560px;margin:0 auto;padding:24px 16px 48px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
h1{font-size:20px;margin:0}
a{color:var(--acc);text-decoration:none}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
h2{font-size:13px;margin:0 0 10px;color:var(--mute);text-transform:uppercase;letter-spacing:.04em}
label{font-size:13px;color:var(--mute);display:block;margin:10px 0 4px}
label:first-child{margin-top:0}
input,select,textarea,button{font:inherit;width:100%;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg);padding:10px}
textarea{min-height:60px}
.row{display:flex;gap:10px}.row>*{flex:1}
button{background:var(--acc);color:#fff;border:0;font-weight:600;cursor:pointer;width:auto;padding:10px 16px}
button.ghost{background:var(--card);color:var(--fg);border:1px solid var(--line)}
button:disabled{opacity:.5}
.check{display:flex;align-items:center;gap:8px;font-size:14px;margin-top:10px}
.check input{width:auto}
.pick{display:block;font-size:14px;margin-top:10px}
.pick input{width:auto;margin-right:6px}
.note{font-size:12px;color:var(--mute);margin-top:6px}
.msg{font-size:13px;margin-top:8px;min-height:1.2em}
.msg.ok{color:var(--ok)}.msg.err{color:var(--err)}
audio{width:100%;margin-top:8px}
#save{width:100%;padding:14px;margin-top:4px}
</style></head><body><main>
<div class="top"><h1>&#9881; Settings</h1><a href="/">&lt;- Back</a></div>

<section>
 <h2>General</h2>
 <label>App name</label>
 <input id="app_name" maxlength="40">
 <div class="note">Shown as the page title and on the main page.</div>
</section>

<section>
 <h2>Cameras and connection</h2>
 <label>go2rtc URL</label>
 <div class="row"><input id="go2rtc_url"><button class="ghost" id="testGo2rtc" style="flex:0 0 auto">Test connection</button></div>
 <div class="msg" id="go2rtcMsg"></div>
 <label>Camera names (comma-separated go2rtc stream names)</label>
 <textarea id="cameras"></textarea>
 <div class="note" id="discovered"></div>
 <label>Rate limit (camera messages per minute, 0 = unlimited)</label>
 <input id="rate_limit_per_min" type="number" step="1" min="0" max="120">
 <div class="note">Protects against a runaway script (or a bored housemate) spamming the camera.</div>
</section>

<section>
 <h2>Voice</h2>
 <label>Voice</label>
 <select id="voice"></select>
 <details id="moreVoices" style="margin-top:8px">
  <summary style="cursor:pointer;color:var(--acc);font-size:13px">Browse more voices (free, downloaded on demand)</summary>
  <input id="voiceSearch" placeholder="Search by name or language..." style="margin-top:10px">
  <div id="catalogList" style="max-height:220px;overflow:auto;margin-top:8px;border:1px solid var(--line);border-radius:8px"></div>
  <div class="msg" id="catalogMsg"></div>
 </details>
 <div class="row">
  <div><label>Leading silence (s)</label><input id="pad_seconds" type="number" step="0.5" min="0" max="10"></div>
  <div><label>Trailing silence (s)</label><input id="tail_seconds" type="number" step="0.5" min="0" max="10"></div>
 </div>
 <div class="note">Leading silence gives the camera time to open its audio channel before speech starts, so the first word doesn't get clipped.</div>
 <div class="check"><input id="play_chime" type="checkbox"><label for="play_chime" style="margin:0">Play announcement chime</label></div>
 <div class="note">Plays a supermarket-style chime before the message: leading silence, chime, half a second, then speech.</div>
 <label>Try it</label>
 <div class="row"><input id="previewText" value="Testing one two three"><button class="ghost" id="preview" style="flex:0 0 auto">Preview</button></div>
 <div class="note">Plays in your browser only, not through a camera.</div>
 <audio id="previewAudio" controls style="display:none"></audio>
 <div class="msg" id="previewMsg"></div>
</section>

<section>
 <h2>Quick replies</h2>
 <label>One phrase per line - shown as buttons on the main page, sent immediately when clicked</label>
 <textarea id="presets" style="min-height:110px"></textarea>
</section>

<section>
 <h2>History</h2>
 <div class="check"><input id="show_history" type="checkbox"><label for="show_history" style="margin:0">Show recent messages as quick-reuse buttons</label></div>
 <div class="note">Clicking a history item fills the message box instead of sending it right away.</div>
</section>

<section>
 <h2>Push to talk</h2>
 <label class="pick"><input type="radio" name="ptt_mode" value="record"> Record, then send</label>
 <div class="note">Waits until you let go, so the clip gets the full leading/trailing silence above. Clearest audio.</div>
 <label class="pick" style="margin-top:12px"><input type="radio" name="ptt_mode" value="live"> Live (stream while held)</label>
 <div class="note">Starts playing on the camera within about a second, closer to a real push-to-talk radio. Recorded clips above are noticeably clearer because of the padding above - live audio can clip the first word and have small gaps every ~0.7s.</div>
</section>

<section>
 <h2>Login (Basic Auth)</h2>
 <div class="note">Leave both blank for no login. Set a username and password to require them for every page on this app.</div>
 <label>Username</label>
 <input id="auth_username">
 <label>New password <span style="opacity:.7">(leave blank to keep the current one)</span></label>
 <input id="auth_password" type="password" autocomplete="new-password">
 <div class="row" style="margin-top:10px"><button class="ghost" id="disableAuth">Remove login</button></div>
</section>

<button id="save">Save settings</button>
<div class="msg" id="saveMsg"></div>

<script>
const $=id=>document.getElementById(id);
function setMsg(el,text,ok){el.textContent=text;el.className='msg '+(ok?'ok':'err')}

async function load(){
 const s=await (await fetch('/api/settings')).json();
 document.title=s.app_name+' - Settings';
 $('app_name').value=s.app_name;
 $('go2rtc_url').value=s.go2rtc_url;
 $('cameras').value=s.cameras.join(', ');
 $('rate_limit_per_min').value=s.rate_limit_per_min;
 $('pad_seconds').value=s.pad_seconds;
 $('tail_seconds').value=s.tail_seconds;
 $('play_chime').checked=s.play_chime;
 $('presets').value=(s.presets||[]).join('\\n');
 $('show_history').checked=s.show_history;
 $('auth_username').value=s.auth_username||'';
 document.querySelector('input[name=ptt_mode][value="'+s.ptt_mode+'"]').checked=true;
 const voices=await (await fetch('/api/voices')).json();
 $('voice').innerHTML=voices.map(v=>'<option value="'+v+'">'+v+'</option>').join('')||'<option value="">(none found)</option>';
 if(voices.includes(s.voice))$('voice').value=s.voice;
}
load();

$('testGo2rtc').onclick=async()=>{
 $('testGo2rtc').disabled=true;setMsg($('go2rtcMsg'),'Testing...',true);
 try{
  const r=await fetch('/api/test-go2rtc?url='+encodeURIComponent($('go2rtc_url').value));
  const j=await r.json();
  if(j.ok){
   setMsg($('go2rtcMsg'),'Connected - '+j.streams.length+' stream(s) found',true);
   $('discovered').innerHTML='Found: '+j.streams.map(s=>'<a href="#" data-s="'+s+'">'+s+'</a>').join(', ');
   $('discovered').querySelectorAll('a').forEach(a=>a.onclick=e=>{
    e.preventDefault();
    const cur=$('cameras').value.split(',').map(x=>x.trim()).filter(Boolean);
    if(!cur.includes(a.dataset.s)){cur.push(a.dataset.s);$('cameras').value=cur.join(', ')}
   });
  }else{setMsg($('go2rtcMsg'),'Error: '+j.error,false)}
 }catch(e){setMsg($('go2rtcMsg'),'Error: '+e,false)}
 $('testGo2rtc').disabled=false;
};

$('preview').onclick=async()=>{
 $('preview').disabled=true;setMsg($('previewMsg'),'Generating...',true);
 try{
  const r=await fetch('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({text:$('previewText').value,voice:$('voice').value,
     pad_seconds:+$('pad_seconds').value,tail_seconds:+$('tail_seconds').value,play_chime:$('play_chime').checked})});
  if(!r.ok){const j=await r.json();throw new Error(j.error)}
  const blob=await r.blob();
  $('previewAudio').src=URL.createObjectURL(blob);$('previewAudio').style.display='block';$('previewAudio').play();
  setMsg($('previewMsg'),'',true);
 }catch(e){setMsg($('previewMsg'),'Error: '+e,false)}
 syncPreviewBtn();
};
function syncPreviewBtn(){$('preview').disabled=!$('previewText').value.trim()}
$('previewText').addEventListener('input',syncPreviewBtn);
syncPreviewBtn();

let catalog=[],installed=[];
async function loadCatalog(){
 try{
  catalog=await (await fetch('/api/catalog')).json();
  installed=await (await fetch('/api/voices')).json();
  renderCatalog();
 }catch(e){setMsg($('catalogMsg'),'Could not load the voice list: '+e,false)}
}
function renderCatalog(){
 const q=($('voiceSearch').value||'').toLowerCase();
 const rows=catalog.filter(v=>!q||v.key.toLowerCase().includes(q)||v.language.toLowerCase().includes(q)).slice(0,200);
 $('catalogList').innerHTML=rows.map(v=>{
  const have=installed.includes(v.key);
  return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line);font-size:13px">'
   +'<span>'+v.language+' - '+v.key+' <span style="color:var(--mute)">('+v.quality+', '+v.mb+'MB)</span></span>'
   +(have?'<span style="color:var(--ok)">(installed)</span>':'<button class="ghost dl" data-k="'+v.key+'" style="width:auto;padding:4px 10px;font-size:12px">Download</button>')
   +'</div>';
 }).join('')||'<div style="padding:10px;color:var(--mute);font-size:13px">No matches</div>';
 $('catalogList').querySelectorAll('.dl').forEach(b=>b.onclick=()=>downloadVoice(b.dataset.k,b));
}
$('voiceSearch').oninput=renderCatalog;
async function downloadVoice(key,btn){
 btn.disabled=true;btn.textContent='Downloading...';
 try{
  const r=await fetch('/api/voices/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({voice:key})});
  const j=await r.json();
  if(!j.ok)throw new Error(j.error);
  installed=j.voices;
  $('voice').innerHTML=installed.map(v=>'<option value="'+v+'">'+v+'</option>').join('');
  $('voice').value=key;
  renderCatalog();
  setMsg($('catalogMsg'),key+' installed',true);
 }catch(e){setMsg($('catalogMsg'),'Error: '+e,false);btn.disabled=false;btn.textContent='Download'}
}
$('moreVoices').addEventListener('toggle',function(){if(this.open&&!catalog.length)loadCatalog()});

$('disableAuth').onclick=()=>{$('auth_username').value='';$('auth_password').value='';saveSettings()};

async function saveSettings(){
 setMsg($('saveMsg'),'Saving...',true);
 const body={
  app_name:$('app_name').value.trim(),
  go2rtc_url:$('go2rtc_url').value.trim(),
  cameras:$('cameras').value.split(',').map(s=>s.trim()).filter(Boolean),
  rate_limit_per_min:+$('rate_limit_per_min').value,
  voice:$('voice').value,
  pad_seconds:+$('pad_seconds').value,
  tail_seconds:+$('tail_seconds').value,
  play_chime:$('play_chime').checked,
  presets:$('presets').value.split('\\n').map(s=>s.trim()).filter(Boolean),
  show_history:$('show_history').checked,
  ptt_mode:document.querySelector('input[name=ptt_mode]:checked').value,
  auth_username:$('auth_username').value.trim(),
  auth_password:$('auth_password').value,
 };
 try{
  const r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json();
  if(!j.ok)throw new Error(j.error);
  $('auth_password').value='';
  document.title=body.app_name+' - Settings';
  setMsg($('saveMsg'),'Saved',true);
 }catch(e){setMsg($('saveMsg'),'Error: '+e,false)}
}
$('save').onclick=saveSettings;
</script></main></body></html>`;
