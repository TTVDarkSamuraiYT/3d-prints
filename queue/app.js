const SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY";
const $=id=>document.getElementById(id);
const configured=!SUPABASE_URL.includes("YOUR_PROJECT_REF")&&!SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY");
let db,user,prints=[];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function msg(id,s,bad=false){$(id).textContent=s;$(id).style.color=bad?"#fca5a5":""}
async function boot(){
 if(!configured){$("config-warning").hidden=false;$("auth-panel").hidden=true;return}
 db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
 const {data:{session}}=await db.auth.getSession();if(session)await showApp(session.user);
 db.auth.onAuthStateChange((_e,s)=>setTimeout(()=>s?showApp(s.user):showAuth(),0));
}
function showAuth(){$("auth-panel").hidden=false;$("app-panel").hidden=true;user=null}
async function showApp(u){user=u;$("auth-panel").hidden=true;$("app-panel").hidden=false;$("signed-in").textContent="Signed in as "+u.email;await refreshAll()}
$("login-form").addEventListener("submit",async e=>{e.preventDefault();msg("auth-message","Signing in…");const {error}=await db.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});msg("auth-message",error?error.message:"Signed in.",!!error)});
$("sign-out").addEventListener("click",async()=>db.auth.signOut());
$("refresh").addEventListener("click",refreshAll);
$("upload-form").addEventListener("submit",async e=>{
 e.preventDefault();const file=$("print-file").files[0],name=$("print-name").value.trim(),tested=$("tested-confirm").checked;
 if(!file||!name)return msg("upload-message","Choose a file and name.",true);
 if(!/\.(3mf|gcode)$/i.test(file.name))return msg("upload-message","Only pre-sliced .3mf or .gcode files are accepted.",true);
 if(file.size>100*1024*1024)return msg("upload-message","File limit is 100 MB.",true);
 if(tested&&$("tested-printer").value==="not-tested")return msg("upload-message","Select which printer tested this file.",true);
 msg("upload-message","Uploading…");const path=user.id+"/"+crypto.randomUUID()+"-"+file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
 const {error:upErr}=await db.storage.from("print-files").upload(path,file,{contentType:"application/octet-stream",upsert:false});
 if(upErr)return msg("upload-message",upErr.message,true);
 const {error}=await db.from("print_library").insert({owner_id:user.id,name,notes:$("print-notes").value.trim(),file_name:file.name,file_path:path,file_size:file.size,tested_printer:$("tested-printer").value,tested});
 if(error){await db.storage.from("print-files").remove([path]);return msg("upload-message",error.message,true)}
 $("upload-form").reset();msg("upload-message","Saved to private library.");await loadLibrary()
});
async function refreshAll(){if(!db||!user)return;await Promise.all([loadLibrary(),loadQueue()])}
async function loadLibrary(){
 const {data,error}=await db.from("print_library").select("id,name,notes,file_name,file_path,file_size,tested_printer,tested,created_at").order("created_at",{ascending:false});
 if(error){$("library").textContent="Library error: "+error.message;return}prints=data||[];
 $("library").innerHTML=prints.length?prints.map(p=>'<div class="library-item"><div><strong>'+esc(p.name)+'</strong><p>'+esc(p.file_name)+' · '+(p.tested?"Tested":"Not tested")+' · '+esc(p.tested_printer)+'</p><p>'+esc(p.notes)+'</p></div><div class="library-actions"><button data-queue="'+p.id+'" '+(!p.tested?"disabled":"")+'>Queue</button></div></div>').join(""):'<p class="muted">No saved prints yet.</p>';
 $("library").querySelectorAll("[data-queue]").forEach(b=>b.addEventListener("click",()=>queuePrint(b.dataset.queue)))
}
async function queuePrint(id){
 const p=prints.find(x=>x.id===id);if(!p||!p.tested)return;
 const target=prompt("Target printer: 1, 2, or any","any");if(target===null)return;
 const t=target.trim().toLowerCase();if(!["1","2","any"].includes(t))return msg("queue-message","Enter 1, 2, or any.",true);
 const {error}=await db.from("print_jobs").insert({owner_id:user.id,print_id:id,target_printer:t,status:"queued"});
 if(error)return msg("queue-message",error.message,true);
 msg("queue-message","Queued. Automatic printer submission remains disabled until protocol verification.");await loadQueue()
}
async function loadQueue(){
 const {data,error}=await db.from("print_jobs").select("id,status,target_printer,created_at,error_message,print_library(name)").order("created_at",{ascending:false}).limit(100);
 if(error){$("queue-rows").innerHTML='<tr><td colspan="5">'+esc(error.message)+'</td></tr>';return}
 $("queue-rows").innerHTML=(data||[]).map(j=>'<tr><td>'+esc(j.print_library?.name||"Print")+(j.error_message?'<br>'+esc(j.error_message):"")+'</td><td>'+esc(j.target_printer)+'</td><td>'+esc(j.status)+'</td><td>'+esc(new Date(j.created_at).toLocaleString())+'</td><td>'+(j.status==="queued"?'<button class="secondary" data-cancel="'+j.id+'">Cancel</button>':"")+'</td></tr>').join("")||'<tr><td colspan="5" class="muted">Queue is empty.</td></tr>';
 $("queue-rows").querySelectorAll("[data-cancel]").forEach(b=>b.addEventListener("click",async()=>{const {error}=await db.from("print_jobs").update({status:"cancelled"}).eq("id",b.dataset.cancel).eq("status","queued");msg("queue-message",error?error.message:"Job cancelled.",!!error);await loadQueue()}))
}
boot().catch(e=>msg("auth-message","Setup error: "+e.message,true));