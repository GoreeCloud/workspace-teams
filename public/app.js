const $ = selector => document.querySelector(selector);
const state = {user:null, initialized:false, spaces:[],space:null,channels:[],channel:null,tool:'messages',events:null,notes:[],replyTo:null};
const inviteFromURL = new URLSearchParams(location.search).get('invite');
let toastTimer;
let useExistingAccount = false;
function showToast(message) {const toast=$('#toast'); toast.textContent=message;toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),4500);}
async function api(path,{method='GET',data}={}) {const response=await fetch('/api'+path,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,credentials:'same-origin'});const result=await response.json();if(!response.ok)throw new Error(result.error||'Something went wrong');return result;}
function el(tag,classes,text) {const node=document.createElement(tag);if(classes)node.className=classes;if(text!==undefined)node.textContent=text;return node;}
function clear(node) {node.replaceChildren();}
function authMode() {const mode=state.initialized?(inviteFromURL&&!useExistingAccount?'register':'login'):'bootstrap';$('#auth-title').textContent={bootstrap:'Your workspace begins here.',login:'Welcome back.',register:'You’re invited.'}[mode];$('#auth-description').textContent={bootstrap:'Set up the first account on your private instance.',login:'Sign in to your self-hosted space.',register:'Create an account to join this private space.'}[mode];$('#display-label').hidden=mode==='login';$('#display-name').hidden=mode==='login';$('#auth-submit').textContent={bootstrap:'Create my space ↗',login:'Sign in ↗',register:'Accept invitation ↗'}[mode];$('#password').autocomplete=mode==='login'?'current-password':'new-password';$('#auth-form').dataset.mode=mode;$('#auth-switch').hidden=!inviteFromURL||!state.initialized;$('#auth-switch').textContent=mode==='register'?'Already have an account? Sign in':'New here? Accept invitation';$('#app').hidden=true;$('#auth').hidden=false;}
async function initialize(){try {const result=await api('/me');state.initialized=result.initialized;state.user=result.user;if(!result.user){authMode();return;}if(inviteFromURL&&location.search.includes('invite=')){try{await api('/invites/accept',{method:'POST',data:{invite:inviteFromURL}});showToast('Invitation accepted.');history.replaceState({},'',location.pathname);}catch(e){if(e.message==='Already a member'||e.message==='Invitation invalid or expired')history.replaceState({},'',location.pathname);else showToast(e.message);}}$('#auth').hidden=true;$('#app').hidden=false;$('#member-name').textContent=result.user.displayName;$('#profile-menu').textContent=result.user.displayName.slice(0,1).toUpperCase();await loadSpaces();}catch(e){showToast(e.message);}}
$('#auth-switch').addEventListener('click',()=>{useExistingAccount=!useExistingAccount;authMode();});
$('#auth-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('#auth-submit');button.disabled=true;const form=new FormData(event.target),mode=event.target.dataset.mode;const data={username:String(form.get('username')||''),password:String(form.get('password')||'')};if(mode!=='login')data.displayName=String(form.get('displayName')||'')||data.username;if(mode==='register')data.invite=inviteFromURL;try{await api('/'+mode,{method:'POST',data});if(inviteFromURL)history.replaceState({},'',location.pathname);await initialize();}catch(e){showToast(e.message);}finally{button.disabled=false;}});
function addSpaceButton(space){const button=el('button','rail-item'+(state.space?.id===space.id?' active':''),space.name.slice(0,1).toUpperCase());button.type='button';button.title=space.name;button.setAttribute('aria-label','Open '+space.name);button.addEventListener('click',()=>selectSpace(space));$('#space-rail-list').append(button);}
async function loadSpaces(){const result=await api('/spaces');state.spaces=result.spaces;const wanted=state.spaces.find(s=>s.id===state.space?.id)||state.spaces[0];if(!wanted)return;await selectSpace(wanted);}
async function selectSpace(space){state.space=space;state.channel=null;state.replyTo=null;$('#reply-banner').hidden=true;if(state.events)state.events.close();state.events=null;clear($('#space-rail-list'));state.spaces.forEach(addSpaceButton);$('#space-title').textContent=space.name;$('#context-space').textContent=space.name;$('#context-kind').textContent=space.kind+' space';$('#space-subtitle').textContent=space.kind==='personal'?'A little corner of your cloud.':'Your shared corner of the cloud.';$('#new-channel').hidden=space.role!=='owner';$('#invite-btn').hidden=space.role!=='owner';const {channels}=await api(`/spaces/${space.id}/channels`);state.channels=channels;clear($('#channel-list'));channels.forEach(channel=>{const button=el('button','nav-link','# '+channel.name);button.type='button';button.dataset.channel=channel.id;button.addEventListener('click',()=>selectChannel(channel));$('#channel-list').append(button);});if(channels[0])await selectChannel(channels[0]);else await selectTool('tasks');}
function activeNav(){document.querySelectorAll('.nav-link').forEach(node=>{const active=state.tool==='messages'?node.dataset.channel===state.channel?.id:node.dataset.tool===state.tool;node.classList.toggle('active',active);if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});}
function view(tool,title,eyebrow){state.tool=tool;$('#messages-view').hidden=tool!=='messages';$('#tasks-view').hidden=tool!=='tasks';$('#notes-view').hidden=tool!=='notes';$('#search-view').hidden=tool!=='search';$('#members-view').hidden=tool!=='members';$('#files-view').hidden=tool!=='files';$('#view-title').textContent=title;$('#view-eyebrow').textContent=eyebrow;activeNav();}
async function selectChannel(channel){state.channel=channel;state.replyTo=null;$('#reply-banner').hidden=true;if(state.events)state.events.close();state.events=null;view('messages','# '+channel.name,'CONVERSATIONS');$('#message-input').placeholder='Message #'+channel.name;await loadMessages();const source=new EventSource(`/api/channels/${channel.id}/stream`);source.addEventListener('message',event=>{try{const message=JSON.parse(event.data);if(state.channel?.id===channel.id){if($('#messages').querySelector('.welcome-message'))clear($('#messages'));if(!$('#messages').querySelector(`[data-message-id="${message.id}"]`))appendMessage(message);$('#messages').scrollTop=$('#messages').scrollHeight;}}catch{}});source.addEventListener('message-updated',()=>{if(state.channel?.id===channel.id)loadMessages().catch(e=>showToast(e.message));});source.addEventListener('message-deleted',()=>{if(state.channel?.id===channel.id)loadMessages().catch(e=>showToast(e.message));});source.onerror=()=>{$('#connection').style.background='var(--gc-negative)';};source.onopen=()=>{$('#connection').style.background='';};state.events=source;}
function appendMessage(message){
  const row=el('article','message');row.dataset.messageId=message.id;
  const avatar=el('div','message-avatar'+(message.author?.charCodeAt(0)%2?' alternate':''),(message.author||'?').slice(0,1).toUpperCase());
  const content=el('div','message-content'),head=el('div','message-head');
  head.append(el('strong','',message.author||'Member'));
  const time=el('time','',new Date(message.createdAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}));time.dateTime=message.createdAt;head.append(time);
  if(message.updatedAt)head.append(el('small','muted','edited'));
  if(message.parentId)content.append(el('div','reply-context','↳ In reply to an earlier message'));
  content.append(head,el('div','message-body',message.body));
  const actions=el('div','message-actions');
  const reply=el('button','quiet small-action','Reply');reply.type='button';reply.addEventListener('click',()=>{state.replyTo=message;$('#reply-label').textContent=`Replying to ${message.author}: ${message.body.slice(0,65)}`;$('#reply-banner').hidden=false;$('#message-input').focus();});actions.append(reply);
  if(message.authorId===state.user?.id||state.space?.role==='owner'){
    if(message.authorId===state.user?.id){const edit=el('button','quiet small-action','Edit');edit.type='button';edit.addEventListener('click',()=>openModal({eyebrow:'EDIT MESSAGE',title:'Edit your message',fields:[{name:'body',label:'Message',multiline:true,maxLength:4000,value:message.body}],submit:'Save',action:async data=>{await api(`/messages/${message.id}`,{method:'PATCH',data});await loadMessages();}}));actions.append(edit);}
    const remove=el('button','quiet small-action','Delete');remove.type='button';remove.setAttribute('aria-label','Delete message by '+message.author);remove.addEventListener('click',async()=>{if(!confirm('Delete this message permanently?'))return;try{await api(`/messages/${message.id}`,{method:'DELETE'});await loadMessages();}catch(e){showToast(e.message);}});actions.append(remove);
  }
  content.append(actions);row.append(avatar,content);$('#messages').append(row);
}
async function loadMessages(){if(!state.channel)return;const id=state.channel.id;const {messages}=await api(`/channels/${id}/messages`);if(state.channel?.id!==id)return;clear($('#messages'));if(!messages.length){const welcome=el('div','welcome-message');welcome.append(el('span','welcome-symbol','#'),el('h2','','This is the beginning of #'+state.channel.name),el('p','','Start a conversation. Everyone with access to this channel can join in.'));$('#messages').append(welcome);}messages.forEach(appendMessage);$('#messages').scrollTop=$('#messages').scrollHeight;}
$('#message-form').addEventListener('submit',async e=>{e.preventDefault();if(!state.channel)return;const input=$('#message-input'),value=input.value;if(!value.trim())return;try{await api(`/channels/${state.channel.id}/messages`,{method:'POST',data:{body:value,...(state.replyTo?{parentId:state.replyTo.id}:{})}});input.value='';state.replyTo=null;$('#reply-banner').hidden=true;if(state.events?.readyState!==EventSource.OPEN)await loadMessages();}catch(err){showToast(err.message);}});
$('#message-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#message-form').requestSubmit();}});
async function selectTool(tool){if(state.events){state.events.close();state.events=null;}view(tool,({tasks:'Tasks',notes:'Notes',files:'Files',search:'Search',members:'Members'})[tool]||tool,'YOUR TOOLS');if(tool==='tasks')await loadTasks();if(tool==='notes')await loadNotes();if(tool==='files')await loadFiles();if(tool==='members')await loadMembers();}
document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>selectTool(button.dataset.tool)));
$('#cancel-reply').addEventListener('click',()=>{state.replyTo=null;$('#reply-banner').hidden=true;});
$('#quick-tasks').addEventListener('click',()=>selectTool('tasks'));$('#quick-notes').addEventListener('click',()=>selectTool('notes'));
async function loadMembers(){
  const {members}=await api(`/spaces/${state.space.id}/members`);
  const list=$('#members-list');clear(list);
  for(const member of members){
    const row=el('div','member-row');const identity=el('div');identity.append(el('strong','',member.displayName),el('small','muted','@'+member.username+' · '+member.role));row.append(identity);
    if(state.space.role==='owner'&&member.role!=='owner'){
      const remove=el('button','small-outline','Remove');remove.type='button';remove.addEventListener('click',async()=>{if(!confirm(`Remove ${member.displayName} from this space?`))return;try{await api(`/spaces/${state.space.id}/members/${member.id}`,{method:'DELETE'});await loadMembers();showToast('Access removed.');}catch(e){showToast(e.message);}});row.append(remove);
    }
    list.append(row);
  }
  const management=$('#invite-management');management.hidden=state.space.role!=='owner';
  if(!management.hidden){
    const {invites}=await api(`/spaces/${state.space.id}/invites`);
    const list=$('#invite-list');clear(list);
    if(!invites.length)list.append(el('p','muted','No active invitations.'));
    for(const invite of invites){
      const row=el('div','member-row');
      row.append(el('span','',`Expires ${new Date(invite.expiresAt).toLocaleString()}`));
      const revoke=el('button','small-outline','Revoke');revoke.type='button';
      revoke.addEventListener('click',async()=>{try{await api(`/spaces/${state.space.id}/invites/${invite.id}`,{method:'DELETE'});await loadMembers();showToast('Invitation revoked.');}catch(error){showToast(error.message);}});
      row.append(revoke);list.append(row);
    }
  }

}
$('#search-form').addEventListener('submit',async event=>{
  event.preventDefault();const query=$('#search-input').value.trim();if(query.length<2)return;
  const results=$('#search-results');clear(results);results.append(el('p','muted','Searching this space…'));
  try{
    const data=await api(`/search?q=${encodeURIComponent(query)}&spaceId=${encodeURIComponent(state.space.id)}`);clear(results);
    for(const [kind,entries] of [['Messages',data.messages],['Notes',data.notes],['Tasks',data.tasks]]){
      results.append(el('h3','search-heading',`${kind} · ${entries.length}`));
      if(!entries.length)results.append(el('p','muted','No matches.'));
      for(const item of entries){const card=el('div','search-card');card.append(el('small','muted',item.channel?'# '+item.channel:item.space),el('strong','',item.title||item.body.slice(0,180)));if(item.excerpt)card.append(el('p','',item.excerpt));
        if(item.channelId){const jump=el('button','quiet','Open channel');jump.type='button';jump.addEventListener('click',()=>{const channel=state.channels.find(c=>c.id===item.channelId);if(channel)selectChannel(channel).catch(e=>showToast(e.message));});card.append(jump);}
        if(kind==='Notes'||kind==='Tasks'){const jump=el('button','quiet',`Open ${kind.toLowerCase()}`);jump.type='button';jump.addEventListener('click',()=>selectTool(kind.toLowerCase()).catch(e=>showToast(e.message)));card.append(jump);}
        results.append(card);
      }
    }
  }catch(e){clear(results);showToast(e.message);}
});
async function loadFiles(){
  const spaceId=state.space.id;
  const {files}=await api(`/spaces/${spaceId}/files`);
  if(state.space?.id!==spaceId)return;
  const list=$('#file-list');clear(list);
  if(!files.length){list.append(el('p','muted','No files yet. Choose a small file to share with members of this space.'));return;}
  for(const file of files){
    const row=el('div','file-row');
    const meta=el('div','file-meta');meta.append(el('strong','',file.name),el('small','muted',`${(file.size/1024).toFixed(1)} KiB · ${new Date(file.uploadedAt).toLocaleDateString()}`));
    const link=el('a','small-outline','Download');link.href=`/api/files/${file.id}/download`;link.download=file.name;
    row.append(meta,link);
    if(file.uploaderId===state.user.id||state.space.role==='owner'){
      const remove=el('button','quiet','Remove');remove.type='button';remove.setAttribute('aria-label',`Remove ${file.name}`);
      remove.addEventListener('click',async()=>{if(!confirm(`Delete ${file.name} from this space?`))return;try{await api(`/files/${file.id}`,{method:'DELETE'});await loadFiles();}catch(e){showToast(e.message);}});
      row.append(remove);
    }
    list.append(row);
  }
}
$('#file-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const file=$('#file-input').files?.[0];if(!file)return;
  if(file.size===0||file.size>2*1024*1024){showToast('Choose a nonempty file up to 2 MiB.');return;}
  const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;
  const spaceId=state.space.id;
  try{
    const response=await fetch(`/api/spaces/${spaceId}/files?name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file,credentials:'same-origin'});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Upload failed');
    $('#file-input').value='';if(state.space?.id===spaceId)await loadFiles();showToast('File saved to this private space.');
  }catch(error){showToast(error.message);}finally{button.disabled=false;}
});
async function loadTasks(){const {tasks}=await api(`/spaces/${state.space.id}/tasks`);const list=$('#task-list');clear(list);if(!tasks.length){list.append(el('p','muted','All clear. Add a task to get started.'));return;}tasks.forEach(task=>{const row=el('div','task-row'),check=el('input'),label=el('span',task.done?'completed':'',task.title),remove=el('button','quiet','Remove');check.type='checkbox';check.checked=!!task.done;check.setAttribute('aria-label','Complete '+task.title);check.addEventListener('change',async()=>{try{await api(`/tasks/${task.id}`,{method:'PATCH',data:{done:check.checked}});await loadTasks();}catch(e){showToast(e.message);await loadTasks();}});remove.type='button';remove.setAttribute('aria-label','Remove '+task.title);remove.addEventListener('click',async()=>{try{await api(`/tasks/${task.id}`,{method:'DELETE'});await loadTasks();}catch(e){showToast(e.message);}});row.append(check,label,remove);list.append(row);});}
$('#task-form').addEventListener('submit',async e=>{e.preventDefault();const input=$('#task-title');try{await api(`/spaces/${state.space.id}/tasks`,{method:'POST',data:{title:input.value}});input.value='';await loadTasks();}catch(err){showToast(err.message);}});
async function loadNotes(){const result=await api(`/spaces/${state.space.id}/notes`);state.notes=result.notes;clear($('#note-list'));if(!state.notes.length){$('#note-list').append(el('p','muted','No notes yet. Create one for your first idea.'));return;}state.notes.forEach(note=>{const button=el('button','note-card');button.type='button';button.append(el('strong','',note.title),el('p','',note.body||'An empty page ready for ideas.'),el('small','',new Date(note.updatedAt).toLocaleDateString()));button.addEventListener('click',()=>openNote(note));$('#note-list').append(button);});}
const modal=$('#modal');let modalAction=null;
function openModal({eyebrow='CREATE',title,description='',fields,submit='Save',action}){$('#modal-eyebrow').textContent=eyebrow;$('#modal-title').textContent=title;$('#modal-description').textContent=description;$('#modal-fields').replaceChildren();for(const field of fields){const label=el('label','',field.label);label.htmlFor='modal-'+field.name;const input=el(field.multiline?'textarea':field.select?'select':'input');input.id='modal-'+field.name;input.name=field.name;input.required=field.required!==false;if(field.maxLength)input.maxLength=field.maxLength;if(field.value!==undefined)input.value=field.value;if(field.placeholder)input.placeholder=field.placeholder;if(field.select)field.select.forEach(option=>{const item=el('option','',option);item.value=option;input.append(item);});if(field.multiline)input.rows=7;$('#modal-fields').append(label,input);}$('#modal-submit').textContent=submit;modalAction=action;modal.showModal();}
$('#modal-form').addEventListener('submit',async e=>{e.preventDefault();if(!modalAction)return;const data=Object.fromEntries(new FormData(e.target));$('#modal-submit').disabled=true;try{const shouldClose=await modalAction(data);if(shouldClose!==false)modal.close();}catch(err){showToast(err.message);}finally{$('#modal-submit').disabled=false;}});$('#modal-cancel').addEventListener('click',()=>modal.close());$('#modal-close').addEventListener('click',()=>modal.close());
$('#new-space').addEventListener('click',()=>openModal({title:'Create a new space',description:'For yourself, your family, friends, or community.',fields:[{name:'name',label:'Space name',maxLength:80,placeholder:'Our little corner'},{name:'kind',label:'Space type',select:['personal','family','community','team']}],submit:'Create space',action:async data=>{const result=await api('/spaces',{method:'POST',data});state.space={id:result.id};await loadSpaces();showToast('Your new space is ready.');}}));
$('#new-channel').addEventListener('click',()=>openModal({title:'Create a channel',description:'A place to share ideas and conversations.',fields:[{name:'name',label:'Channel name',maxLength:48,placeholder:'ideas-and-updates'}],submit:'Create channel',action:async data=>{await api(`/spaces/${state.space.id}/channels`,{method:'POST',data});await selectSpace(state.space);}}));
function openNote(note){openModal({eyebrow:note?'EDIT NOTE':'NEW NOTE',title:note?'Edit your note':'Capture a thought',fields:[{name:'title',label:'Title',maxLength:120,placeholder:'A name for this idea',value:note?.title||''},{name:'body',label:'Note',required:false,multiline:true,maxLength:20000,placeholder:'Start writing…',value:note?.body||''}],submit:note?'Save changes':'Create note',action:async data=>{await api(note?`/notes/${note.id}`:`/spaces/${state.space.id}/notes`,{method:note?'PATCH':'POST',data});await loadNotes();}});}
$('#new-note').addEventListener('click',()=>openNote(null));
$('#invite-btn').addEventListener('click',async()=>{try{const {invite}=await api(`/spaces/${state.space.id}/invites`,{method:'POST',data:{}});const url=new URL(location.origin);url.searchParams.set('invite',invite);openModal({eyebrow:'INVITATION',title:'Bring someone in',description:'This one-time link expires after 24 hours. Share it privately with someone you trust.',fields:[{name:'url',label:'Private invitation link',value:url.toString(),required:false}],submit:'Copy link',action:async data=>{await navigator.clipboard.writeText(data.url);showToast('Invitation link copied.');}});}catch(err){showToast(err.message);}});
$('#logout').addEventListener('click',async()=>{try{await api('/logout',{method:'POST'});if(state.events)state.events.close();state.user=null;await initialize();}catch(err){showToast(err.message);}});
$('#profile-menu').addEventListener('click',()=>showToast('You are signed in to your self-hosted workspace.'));
initialize();
