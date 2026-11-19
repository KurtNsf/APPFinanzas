const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = n => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(n)||0);
const today = () => new Date().toISOString().slice(0,10);
const monthKey = d => (d||today()).slice(0,7);
const uid = () => Math.random().toString(36).slice(2,10);
const SUPABASE_URL = 'https://daecimtaelilelinhjav.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_QxnpE_-fLfHrYoBWKqghtw_7cUQBoyY';
const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
let currentUser = null, cloudTimer = null, cloudBusy = false, cloudDirty = false, cloudVersion = null, authMode = 'login';
const categories = ['Alimentación','Transporte','Vivienda','Servicios','Salud','Educación','Entretenimiento','Compras','Mascotas','Deudas','Ahorro','Salario','Ventas','Otros'];
const icons = {'Alimentación':'🍽️','Transporte':'🚗','Vivienda':'🏠','Servicios':'💡','Salud':'🩺','Educación':'📚','Entretenimiento':'🎬','Compras':'🛍️','Mascotas':'🐾','Deudas':'💳','Ahorro':'🎯','Salario':'💼','Ventas':'🧾','Otros':'📌'};
const defaultData = () => ({transactions:[],accounts:[{id:'cash',name:'Efectivo',type:'Efectivo',balance:0}],budgets:[],goals:[],debts:[],recurring:[],subscriptions:[],theme:'dark'});
let data;
try{data=JSON.parse(localStorage.getItem('nico-finanzas-v1'))||defaultData()}catch{data=defaultData()}
data.subscriptions ||= []; data.recurring ||= []; data.goals ||= []; data.debts ||= []; data.budgets ||= []; data.accounts ||= []; data.customCategories ||= []; data.customCategoryIcons ||= {};
function localDataKey(){return currentUser?'nico-finanzas-user-'+currentUser.id:'nico-finanzas-v1'}
function save(){localStorage.setItem(localDataKey(),JSON.stringify(data));render();if(currentUser)scheduleCloudSave()}
function scheduleCloudSave(){clearTimeout(cloudTimer);cloudTimer=setTimeout(syncToCloud,700)}
function setAuthStatus(msg){const el=$('#authStatus');if(el)el.textContent=msg}
function displayUser(user){const label=user?.user_metadata?.display_name?.trim()||user?.email||'Mi cuenta';const btn=$('#authOpen');if(btn){btn.textContent=label;btn.title=user?.email||label;btn.setAttribute('aria-label','Cuenta: '+label)}}
function hasUsefulData(obj){return !!(obj&&(obj.transactions?.length||obj.accounts?.length>1||obj.budgets?.length||obj.goals?.length||obj.debts?.length||obj.recurring?.length||obj.subscriptions?.length||obj.customCategories?.length))}
async function syncToCloud(){
  if(!currentUser||!supabaseClient)return false;
  if(cloudBusy){cloudDirty=true;return;}
  cloudBusy=true;
  try{
    do{
      cloudDirty=false;
      const snapshot=JSON.parse(JSON.stringify(data));
      const {data:result,error}=await supabaseClient.rpc('sync_finanzas_data',{
        p_data:snapshot,
        p_expected_updated_at:cloudVersion
      });
      if(error)throw error;
      if(!result?.ok)throw new Error('Supabase no confirmó la sincronización relacional.');
      cloudVersion=result.sync_version||result.synced_at||cloudVersion;
      setAuthStatus('Sincronizado · '+new Date(result.synced_at||Date.now()).toLocaleTimeString('es-CO'));
      if(JSON.stringify(snapshot)!==JSON.stringify(data))cloudDirty=true;
    }while(cloudDirty&&currentUser);
    return true;
  }catch(e){
    console.error('Error sincronizando Finanzas:',e);
    const message=e.message||'Comprueba las funciones SQL y los permisos.';
    if(message.includes('SYNC_CONFLICT')){
      setAuthStatus('Conflicto: hay cambios más recientes en otro dispositivo. Cierra sesión y vuelve a entrar para recuperar la versión más reciente.');
      toast('Conflicto de sincronización. Tu copia local se conserva.');
    }else{
      setAuthStatus('Error al sincronizar: '+message);
      toast('No se pudo sincronizar. La copia local se conserva.');
    }
    return false;
  }
  finally{cloudBusy=false;}
}
function openAuth(){ $('#authModal').classList.add('show'); setAuthStatus(currentUser?'Sesión activa: '+currentUser.email:''); $('#authLogout').hidden=!currentUser; $('#authForm').hidden=!!currentUser; $('#authReset').hidden=!!currentUser; $('#authSignup').hidden=!!currentUser; $('#authSubmit').hidden=!!currentUser; $('#authTitle').textContent=currentUser?'Cuenta conectada':'Tu cuenta de Finanzas'; $('#authSubtitle').textContent=currentUser?'Tus datos están vinculados a esta cuenta.':'Regístrate o inicia sesión para sincronizar tus finanzas.' }
async function handleAuth(mode){
  const email=$('#authEmail').value.trim(),password=$('#authPassword').value,name=$('#authName')?.value.trim()||'';
  if(!email||!password){setAuthStatus('Escribe tu correo y contraseña.');return}
  setAuthStatus('Conectando…');
  let result;
  if(mode==='signup')result=await supabaseClient.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname,data:{display_name:name}}});
  else result=await supabaseClient.auth.signInWithPassword({email,password});
  if(result.error){setAuthStatus(result.error.message);return}
  if(mode==='signup'&&!result.data.session){setAuthStatus('Cuenta creada. Revisa tu correo para confirmar la dirección y luego inicia sesión.');return}
  if(result.data.user)await activateUser(result.data.user);
}
async function activateUser(user){
  // Nunca mostrar datos de la sesion anterior mientras se carga otra cuenta.
  currentUser=user;
  cloudVersion=null;
  data=defaultData();
  displayUser(user);
  setAuthStatus('Cargando tus datos privados…');
  render();
  try{
    const anonymous=JSON.parse(localStorage.getItem('nico-finanzas-v1')||'null');
    const userLocal=JSON.parse(localStorage.getItem('nico-finanzas-user-'+user.id)||'null');
    // Primero intentamos recuperar desde las tablas relacionales.
    const {data:relational,error:relError}=await supabaseClient.rpc('get_finanzas_data');
    if(relError)throw relError;
    cloudVersion=relational?._syncVersion||null;
    if(relational&&Object.prototype.hasOwnProperty.call(relational,'_syncVersion'))delete relational._syncVersion;
    const relationalHasData=relational&&Array.isArray(relational.transactions)&&(
      relational.transactions.length||relational.accounts?.length>1||relational.budgets?.length||
      relational.goals?.length||relational.debts?.length||relational.recurring?.length||
      relational.subscriptions?.length||relational.customCategories?.length);
    if(relationalHasData){
      data=relational;
      setAuthStatus('Datos recuperados desde tus tablas individuales.');
      localStorage.setItem(localDataKey(),JSON.stringify(data));
    }else{
      // Primera migración: conservar lo que ya estaba en app_data.
      const {data:profile,error}=await supabaseClient.from('profiles').select('app_data,updated_at').eq('id',user.id).single();
      if(error)throw error;
      cloudVersion=profile?.updated_at||cloudVersion;
      const cloud=profile?.app_data;
      if(cloud&&typeof cloud==='object'&&Array.isArray(cloud.transactions)&&hasUsefulData(cloud)){
        data=cloud;localStorage.setItem(localDataKey(),JSON.stringify(data));
        setAuthStatus('Migrando tus datos anteriores a las tablas individuales…');
        await syncToCloud();
      }else if(hasUsefulData(userLocal)){
        data=userLocal;localStorage.setItem(localDataKey(),JSON.stringify(data));
        setAuthStatus('Migrando la copia local de tu cuenta…');await syncToCloud();
      }else if(hasUsefulData(anonymous)){
        if(confirm('Encontramos datos locales que no están asociados a esta cuenta. ¿Confirmas que son tuyos y deseas importarlos? Si este dispositivo es compartido o pertenecen a otra persona, pulsa Cancelar. La copia original se conservará.')){
          data=anonymous;localStorage.setItem(localDataKey(),JSON.stringify(data));await syncToCloud();
        }else{
          data=defaultData();localStorage.setItem(localDataKey(),JSON.stringify(data));await syncToCloud();
        }
      }else{
        data=defaultData();localStorage.setItem(localDataKey(),JSON.stringify(data));await syncToCloud();
      }
    }
    displayUser(user);$('#authLogout').hidden=false;applyTheme();render();
  }catch(e){console.error('Error activando/migrando cuenta:',e);data=defaultData();render();setAuthStatus('No se pudo cargar esta cuenta. Tus datos locales se conservaron. Error: '+(e.message||'Error desconocido'));displayUser(user);}
}
async function initializeAuth(){
  if(!supabaseClient){$('#authOpen').textContent='Auth no disponible';return}
  $('#authOpen').onclick=openAuth;
  $('#authClose').onclick=()=>$('#authModal').classList.remove('show');
  $('#authModal').onclick=e=>{if(e.target.id==='authModal')$('#authModal').classList.remove('show')};
  $('#authForm').onsubmit=async e=>{e.preventDefault();await handleAuth(authMode)};
  $('#authSignup').onclick=()=>{authMode=authMode==='login'?'signup':'login';$('#authSubmit').textContent=authMode==='signup'?'Crear cuenta':'Iniciar sesión';$('#authSignup').textContent=authMode==='signup'?'Volver a iniciar sesión':'Crear cuenta';$('#authNameField').hidden=authMode!=='signup';setAuthStatus(authMode==='signup'?'Puedes indicar tu nombre para mostrarlo en tu cuenta.':'');};
  $('#authReset').onclick=async()=>{const email=$('#authEmail').value.trim();if(!email){setAuthStatus('Escribe primero tu correo.');return}const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});setAuthStatus(error?error.message:'Te enviamos instrucciones si el correo está registrado.')};
  $('#authLogout').onclick=async()=>{await syncToCloud();const {error}=await supabaseClient.auth.signOut();if(error){setAuthStatus('No se pudo cerrar sesión: '+error.message);return}currentUser=null;cloudVersion=null;data=defaultData();$('#authOpen').textContent='Iniciar sesión';$('#authOpen').title='';$('#authModal').classList.remove('show');render()};
  const {data:{session},error}=await supabaseClient.auth.getSession();if(error)throw error;if(session?.user)await activateUser(session.user);
  supabaseClient.auth.onAuthStateChange(async(event,session)=>{if(event==='SIGNED_IN'&&session?.user&&currentUser?.id!==session.user.id)await activateUser(session.user);if(event==='SIGNED_OUT'){currentUser=null;cloudVersion=null;data=defaultData();$('#authOpen').textContent='Iniciar sesión';$('#authOpen').title='';render();}});
}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2400)}
function monthTx(){return data.transactions.filter(t=>monthKey(t.date)===monthKey())}
function totals(){let tx=monthTx();return {income:tx.filter(t=>t.type==='income').reduce((a,t)=>a+t.amount,0),expense:tx.filter(t=>t.type==='expense').reduce((a,t)=>a+t.amount,0)}}
function isCredit(a){return (a?.type||'').toLowerCase().includes('crédito')}
function accountTotal(){return data.accounts.filter(a=>!isCredit(a)).reduce((s,a)=>s+Number(a.balance||0),0)}
function getAccount(id){return data.accounts.find(a=>a.id===id)?.name||'Sin cuenta'}
function nav(page){$$('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+page));$$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===page));window.scrollTo({top:0,behavior:'smooth'});render()}
$$('.nav-btn').forEach(b=>b.onclick=()=>nav(b.dataset.page));
$$('[data-goto]').forEach(b=>b.onclick=()=>nav(b.dataset.goto));
$('#todayLabel').textContent=new Intl.DateTimeFormat('es-CO',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());
$('#themeBtn').onclick=()=>{data.theme=data.theme==='dark'?'light':'dark';applyTheme();save()};
function applyTheme(){document.documentElement.dataset.theme=data.theme||'light';$('#themeBtn').textContent=data.theme==='dark'?'☾':'☼';document.querySelector('meta[name="theme-color"]').content=data.theme==='dark'?'#171719':'#f3f3f4'}
function openModal(title,html,onSubmit){$('#modalTitle').textContent=title;$('#modalForm').innerHTML=html;$('#modal').classList.add('show');$('#modalForm').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.target);onSubmit(fd);$('#modal').classList.remove('show')}}
function closeModal(){$('#modal').classList.remove('show')}
$('#closeModal').onclick=closeModal;$('#modal').onclick=e=>{if(e.target.id==='modal')closeModal()};
const field=(label,name,type='text',value='',extra='')=>`<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${value}" ${extra} required></div>`;
const selectField=(label,name,opts)=>`<div class="field"><label>${label}</label><select name="${name}">${opts.map(o=>`<option value="${o[0]}">${o[1]}</option>`).join('')}</select></div>`;
function allCategories(){return [...categories,...(data.customCategories||[])];}
function categorySelect(label='Categoría',name='category',filter=()=>true){let opts=allCategories().filter(filter).map(c=>[c,c]);opts.push(['__create_category__','＋ Crear categoría…']);return selectField(label,name,opts);}
function categoryIcon(name){return (data.customCategoryIcons&&data.customCategoryIcons[name])||icons[name]||'📌';}
function createCategory(){let name=prompt('Nombre de la nueva categoría:');if(!name)return null;name=name.trim();if(!name)return null;let existing=allCategories().find(c=>c.toLocaleLowerCase()===name.toLocaleLowerCase());if(existing){toast('Esa categoría ya existe');return existing;}let emoji=prompt('Elige un emoji para identificarla (opcional):','📌')||'📌';data.customCategories.push(name);data.customCategoryIcons[name]=emoji.trim()||'📌';save();toast('Categoría creada');return name;}
function attachCategoryCreator(form){let sel=form.querySelector('select[name=category]');if(!sel)return;sel.addEventListener('change',()=>{if(sel.value!=='__create_category__')return;let previous=sel.dataset.previous||'';let created=createCategory();sel.innerHTML=allCategories().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')+`<option value="__create_category__">＋ Crear categoría…</option>`;sel.value=created||previous||allCategories()[0]||'';sel.dataset.previous=sel.value;});sel.addEventListener('focus',()=>{sel.dataset.previous=sel.value;});}
function manageCategories(){let rows=(data.customCategories||[]).map(c=>`<div class="list-card"><div><b>${esc(categoryIcon(c))} ${esc(c)}</b><div class="sub">Categoría personalizada</div></div><button class="ghost small-btn danger" data-remove-category="${esc(c)}">Eliminar</button></div>`).join('');openModal('Mis categorías',`<p class="muted" style="font-size:13px">Tus categorías personalizadas aparecen en movimientos, presupuestos y gastos recurrentes.</p><div id="managedCategories">${rows||'<div class="empty">Todavía no has creado categorías personalizadas.</div>'}</div><div class="actions"><button type="button" class="ghost" id="closeCategories">Cerrar</button><button type="button" class="primary" id="newCategory">+ Crear categoría</button></div>`,()=>{});$('#closeCategories').onclick=closeModal;$('#newCategory').onclick=()=>{createCategory();manageCategories()};$$('[data-remove-category]').forEach(b=>b.onclick=()=>{let c=b.dataset.removeCategory;if(!confirm(`¿Quitar la categoría "${c}" de tus opciones? Los movimientos anteriores conservarán su nombre.`))return;data.customCategories=data.customCategories.filter(x=>x!==c);delete data.customCategoryIcons[c];save();manageCategories()});}
function txForm(t={}){
 let editing=!!t.id;
 openModal(editing?'Editar movimiento':'Registrar movimiento',`<div class="form-grid">
 ${selectField('Tipo de movimiento','type',[['expense','Egreso'],['income','Ingreso'],['transfer','Transferencia entre mis cuentas']])}
 ${field('Valor (COP)','amount','number',t.amount||'','min="1" step="1"')}
 ${field('Motivo / descripción','description','text',t.description||'','placeholder="Ej. Mercado, salario, traslado…"')}
 <div id="categoryField">${categorySelect('Categoría','category')}</div>
 <div id="sourceField">${selectField('Cuenta de origen','account',data.accounts.map(a=>[a.id,a.name+' · '+a.type]))}</div>
 <div id="destinationField">${selectField('Cuenta de destino','toAccount',data.accounts.map(a=>[a.id,a.name+' · '+a.type]))}</div>
 ${field('Fecha','date','date',t.date||today())}
 <div class="field"><label for="txNote">Nota (opcional)</label><input id="txNote" name="note" type="text" value="${String(t.note||'').replace(/&/g,'&amp;').replace(/\"/g,'&quot;').replace(/</g,'&lt;')}" placeholder="Puedes dejar este campo vacío"></div>
 </div><div class="actions"><button type="button" class="ghost" id="cancelForm">Cancelar</button><button class="primary">Guardar movimiento</button></div>`,fd=>{
  const v={id:t.id||uid(),type:fd.get('type'),amount:Number(fd.get('amount')),description:fd.get('description'),category:fd.get('category')||'Transferencia',account:fd.get('account'),toAccount:fd.get('type')==='transfer'?fd.get('toAccount'):'',date:fd.get('date'),note:(fd.get('note')||'').trim()};
  if(v.type==='transfer'&&(!v.account||!v.toAccount||v.account===v.toAccount)){toast('Selecciona dos cuentas diferentes');return}
  if(editing){const old=data.transactions.find(x=>x.id===t.id);if(old)adjustBalance(old,-1);Object.assign(old,v);adjustBalance(v,1)}
  else{data.transactions.unshift(v);adjustBalance(v,1)}
  save();toast(v.type==='transfer'?'Transferencia registrada':'Movimiento guardado')
 });
 const form=$('#modalForm');
 attachCategoryCreator(form);
 form.querySelector('[name=type]').value=t.type||'expense';
 form.querySelector('[name=category]').value=t.category||'Alimentación';
 if(t.account)form.querySelector('[name=account]').value=t.account;
 if(t.toAccount)form.querySelector('[name=toAccount]').value=t.toAccount;
 const sync=()=>{let transfer=form.querySelector('[name=type]').value==='transfer';form.querySelector('#categoryField').style.display=transfer?'none':'';form.querySelector('#destinationField').style.display=transfer?'':'none';form.querySelector('#sourceField').querySelector('label').textContent=transfer?'Cuenta de origen':'Cuenta desde la que se paga';};
 form.querySelector('[name=type]').onchange=sync;sync();
 $('#cancelForm').onclick=closeModal;
}
function adjustBalance(t,sign){
 if(t?._balanceApplied===false)return;
 const source=data.accounts.find(a=>a.id===t.account),dest=data.accounts.find(a=>a.id===t.toAccount);
 if(t.type==='transfer'){
  if(source)source.balance=Number(source.balance||0)+(isCredit(source)?1:-1)*Number(t.amount)*sign;
  if(dest)dest.balance=Number(dest.balance||0)+(isCredit(dest)?-1:1)*Number(t.amount)*sign;
  return;
 }
 if(source){const delta=t.type==='income'?(isCredit(source)?-1:1):(isCredit(source)?1:-1);source.balance=Number(source.balance||0)+delta*Number(t.amount)*sign}
}
function delTx(id){let t=data.transactions.find(x=>x.id===id);if(!t)return;if(confirm('¿Eliminar este movimiento?')){adjustBalance(t,-1);data.transactions=data.transactions.filter(x=>x.id!==id);save();toast('Movimiento eliminado')}}
function txHTML(t){let transfer=t.type==='transfer';let label=transfer?`${getAccount(t.account)} → ${getAccount(t.toAccount)}`:`${esc(t.category)} · ${esc(getAccount(t.account))}`;return `<div class="movement"><div class="move-left"><div class="move-icon">${transfer?'⇄':icons[t.category]||'📌'}</div><div style="min-width:0"><div class="move-title">${esc(t.description)}</div><div class="move-meta">${label} · ${new Date(t.date+'T12:00:00').toLocaleDateString('es-CO')}</div></div></div><div style="text-align:right"><div class="amount ${t.type==='income'?'positive':transfer?'':'negative'}">${transfer?'⇄ ':t.type==='income'?'+':'−'}${money(t.amount)}</div><div><button class="ghost small-btn" data-edit="${t.id}">Editar</button> <button class="ghost small-btn danger" data-del="${t.id}">×</button></div></div></div>`}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function bindTxActions(root=document){root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{let t=data.transactions.find(x=>x.id===b.dataset.edit);if(t)txForm(t)});root.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delTx(b.dataset.del))}
function renderTransactions(){let q=($('#searchTx')?.value||'').toLowerCase(),type=$('#filterType')?.value||'all';let tx=data.transactions.filter(t=>(type==='all'||t.type===type)&&[t.description,t.category,t.note].join(' ').toLowerCase().includes(q));$('#transactionList').innerHTML=tx.length?tx.map(txHTML).join(''):'<div class="empty">Todavía no hay movimientos. Registra tu primer ingreso o gasto.</div>';bindTxActions($('#transactionList'))}
$('#searchTx').oninput=renderTransactions;$('#filterType').onchange=renderTransactions;
$('#quickAdd').onclick=$('#addTx').onclick=()=>txForm();
function upcomingItems(){
 const items=[];
 data.subscriptions.filter(s=>s.status==='active'&&s.nextDate).forEach(s=>items.push({name:s.customName||s.service,date:s.nextDate,amount:s.amount,kind:'Suscripción',account:getAccount(s.account)}));
 data.recurring.filter(r=>r.dueDay).forEach(r=>{let d=nextChargeDate(Number(r.dueDay),r.frequency==='Anual'?'Anual':'Mensual',today(),new Date().getMonth());items.push({name:r.name,date:d,amount:r.amount,kind:'Gasto recurrente',account:'Por confirmar'})});
 return items.filter(x=>{let diff=(new Date(x.date+'T12:00:00')-new Date(today()+'T12:00:00'))/86400000;return diff>=0&&diff<=7}).sort((a,b)=>a.date.localeCompare(b.date));
}
function renderUpcoming(){
 const el=$('#upcomingList');if(!el)return;const items=upcomingItems();
 el.innerHTML=items.length?items.map(x=>`<div class="list-card"><div><b>${esc(x.name)}</b><div class="sub">${esc(x.kind)} · ${new Date(x.date+'T12:00:00').toLocaleDateString('es-CO',{weekday:'short',day:'numeric',month:'short'})} · ${esc(x.account)}</div></div><b class="negative">${money(x.amount)}</b></div>`).join(''):'<div class="empty">No tienes pagos programados para los próximos 7 días. Añade el día de cobro a tus gastos recurrentes o registra tus suscripciones.</div>';
}
function renderHome(){let t=totals();$('#totalBalance').textContent=money(accountTotal());$('#monthIncome').textContent=money(t.income);$('#monthExpense').textContent=money(t.expense);$('#incomeStat').textContent=money(t.income);$('#expenseStat').textContent=money(t.expense);
let recent=data.transactions.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);$('#recentList').innerHTML=recent.length?recent.map(txHTML).join(''):'<div class="empty">Tus movimientos aparecerán aquí.</div>';bindTxActions($('#recentList'));
let spent={};monthTx().filter(x=>x.type==='expense').forEach(x=>spent[x.category]=(spent[x.category]||0)+x.amount);let entries=Object.entries(spent).sort((a,b)=>b[1]-a[1]).slice(0,5),totalSpent=entries.reduce((sum,x)=>sum+x[1],0),palette=['#ef536b','#f29a55','#f2c45b','#8c83d9','#54b7a2'];let cursor=0,stops=entries.map((entry,i)=>{let start=cursor;cursor+=totalSpent?entry[1]/totalSpent*100:0;return `${palette[i%palette.length]} ${start}% ${cursor}%`}).join(',');$('#categoryChart').innerHTML=entries.length?`<div class="category-overview"><div class="category-donut" style="--donut-stops:${stops}"><div class="donut-center"><strong>${money(totalSpent)}</strong><span>Este mes</span></div></div><div class="category-legend">${entries.map(([k,v],i)=>`<div class="category-legend-row"><i class="category-dot" style="background:${palette[i%palette.length]}"></i><span>${categoryIcon(k)} ${esc(k)}</span><b>${Math.round(v/totalSpent*100)}%</b></div>`).join('')}</div></div>`:'<div class="empty">Aún no hay gastos este mes.</div>';
let budgets=data.budgets.slice(0,4);$('#budgetPreview').innerHTML=budgets.length?budgets.map(b=>budgetBar(b)).join(''):'<div class="empty">Crea un presupuesto para empezar.</div>';renderUpcoming();drawFlow()}
function budgetSpent(b){return monthTx().filter(t=>t.type==='expense'&&t.category===b.category).reduce((s,t)=>s+t.amount,0)}
function budgetBar(b){let s=budgetSpent(b),p=Math.min(100,s/b.limit*100);return `<div class="bar-row"><div class="bar-label"><span>${esc(b.category)}</span><b>${money(s)} / ${money(b.limit)}</b></div><div class="track"><div class="fill" style="width:${p}%;background:${p>=100?'var(--red)':'var(--accent)'}"></div></div><div class="sub">${p.toFixed(0)}% utilizado</div></div>`}
function drawFlow(){let c=$('#flowChart');if(!c)return;let ctx=c.getContext('2d'),w=c.clientWidth,h=c.clientHeight,dpr=devicePixelRatio||1;c.width=w*dpr;c.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);let labels=[],inc=[],exp=[];for(let i=5;i>=0;i--){let d=new Date();d.setDate(1);d.setMonth(d.getMonth()-i);let key=d.toISOString().slice(0,7);labels.push(d.toLocaleDateString('es-CO',{month:'short'}));let a=data.transactions.filter(t=>monthKey(t.date)===key);inc.push(a.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0));exp.push(a.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0))}let max=Math.max(1,...inc,...exp),pad=25,base=h-27,usable=h-50,step=(w-pad*2)/6;ctx.font='11px sans-serif';ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--muted');labels.forEach((l,i)=>{let x=pad+i*step+step/2;ctx.fillText(l,x-10,h-7);let bh=inc[i]/max*usable,eh=exp[i]/max*usable;ctx.fillStyle='#20ad83';ctx.fillRect(x-10,base-bh,8,bh);ctx.fillStyle='#e16a79';ctx.fillRect(x+1,base-eh,8,eh)});ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue('--line');ctx.beginPath();ctx.moveTo(pad,base);ctx.lineTo(w-pad,base);ctx.stroke()}
function renderBudgets(){$('#budgetList').innerHTML=data.budgets.length?data.budgets.map(b=>`<div class="card half"><div class="section-head"><h3>${esc(b.category)}</h3><button class="ghost small-btn danger" data-rmb="${b.id}">Eliminar</button></div>${budgetBar(b)}<div class="sub">Límite mensual: ${money(b.limit)}</div></div>`).join(''):'<div class="card full empty">Aún no tienes presupuestos creados.</div>';$$('[data-rmb]').forEach(x=>x.onclick=()=>{data.budgets=data.budgets.filter(b=>b.id!==x.dataset.rmb);save()})}
$('#addBudget').onclick=()=>openModal('Crear presupuesto',`<div class="form-grid">${categorySelect('Categoría','category',c=>!['Salario','Ventas'].includes(c))}${field('Límite mensual (COP)','limit','number','','min="1"')}</div><div class="actions"><button class="primary">Crear presupuesto</button></div>`,fd=>{data.budgets.push({id:uid(),category:fd.get('category'),limit:Number(fd.get('limit'))});save();toast('Presupuesto creado')});attachCategoryCreator($('#modalForm'));
function renderGoals(){$('#goalList').innerHTML=data.goals.length?data.goals.map(g=>{let p=Math.min(100,g.saved/g.target*100);return `<div class="card half"><div class="section-head"><h3>${esc(g.name)}</h3><button class="ghost small-btn danger" data-rmg="${g.id}">Eliminar</button></div><div class="goal-amount">${money(g.saved)} <span class="muted" style="font-size:13px;font-weight:400">de ${money(g.target)}</span></div><div class="track" style="margin:12px 0"><div class="fill" style="width:${p}%"></div></div><div class="row muted" style="font-size:12px">${p.toFixed(0)}% · Faltan ${money(Math.max(0,g.target-g.saved))}</div><div class="actions"><button class="ghost small-btn" data-addsave="${g.id}">+ Añadir ahorro</button></div></div>`}).join(''):'<div class="card full empty">Crea una meta: viaje, emergencia, nuevo equipo…</div>';$$('[data-rmg]').forEach(b=>b.onclick=()=>{data.goals=data.goals.filter(g=>g.id!==b.dataset.rmg);save()});$$('[data-addsave]').forEach(b=>b.onclick=()=>{let g=data.goals.find(x=>x.id===b.dataset.addsave);openModal('Añadir a '+g.name,field('Valor (COP)','amount','number','','min="1"'),fd=>{g.saved+=Number(fd.get('amount'));save();toast('Ahorro actualizado')})})}
$('#addGoal').onclick=()=>openModal('Nueva meta de ahorro',`<div class="form-grid">${field('Nombre de la meta','name')}${field('Objetivo (COP)','target','number','','min="1"')}</div><div class="actions"><button class="primary">Crear meta</button></div>`,fd=>{data.goals.push({id:uid(),name:fd.get('name'),target:Number(fd.get('target')),saved:0});save()});

function renderMonthlyReport(){
 const input=$('#reportMonth'),host=$('#monthlyReport');if(!input||!host)return;
 const selected=input.value||monthKey(today());
 const rows=data.transactions.filter(t=>monthKey(t.date)===selected);
 const income=rows.filter(t=>t.type==='income').reduce((sum,t)=>sum+Number(t.amount||0),0);
 const expense=rows.filter(t=>t.type==='expense').reduce((sum,t)=>sum+Number(t.amount||0),0);
 const transfers=rows.filter(t=>t.type==='transfer').length;
 const byCategory={};rows.filter(t=>t.type==='expense').forEach(t=>byCategory[t.category||'Otros']=(byCategory[t.category||'Otros']||0)+Number(t.amount||0));
 const top=Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).slice(0,5);
 const net=income-expense;
 const label=new Date(selected+'-15T12:00:00').toLocaleDateString('es-CO',{month:'long',year:'numeric'});
 host.innerHTML=`<div class="card half"><div class="eyebrow">Ingresos · ${label}</div><div class="balance-value positive">${money(income)}</div></div><div class="card half"><div class="eyebrow">Egresos · ${label}</div><div class="balance-value negative">${money(expense)}</div></div><div class="card half"><div class="eyebrow">Balance neto del mes</div><div class="balance-value ${net>=0?'positive':'negative'}">${money(net)}</div><div class="sub">Ingresos menos egresos</div></div><div class="card half"><div class="eyebrow">Actividad</div><div class="balance-value">${rows.length}</div><div class="sub">Movimientos · ${transfers} transferencias</div></div><div class="card full"><div class="section-head"><h3>Principales categorías de gasto</h3><small>${top.length} categorías</small></div>${top.length?top.map(([name,value])=>`<div class="bar-row"><div class="bar-label"><span>${esc(categoryIcon(name))} ${esc(name)}</span><b>${money(value)}</b></div><div class="track"><div class="fill" style="width:${value/Math.max(1,...top.map(x=>x[1]))*100}%"></div></div></div>`).join(''):'<div class="empty">No hay egresos registrados en este mes.</div>'}</div>`;
}

function renderMore(){
 const reportInput=$('#reportMonth');if(reportInput&&!reportInput.value){reportInput.value=monthKey(today());reportInput.onchange=renderMonthlyReport;}renderMonthlyReport();
 $('#accountList').innerHTML=data.accounts.map(a=>`<div class="list-card"><div><b>${esc(a.name)}</b><div class="sub">${esc(a.type)}</div></div><div style="text-align:right"><b>${money(a.balance)}</b><div class="sub">${isCredit(a)?'Deuda utilizada':'Saldo disponible'}</div><div class="actions"><button class="ghost small-btn" data-edit-account="${a.id}">Editar</button><button class="ghost small-btn danger" data-delete-account="${a.id}">Eliminar</button></div></div></div>`).join('');
 $('#debtList').innerHTML=data.debts.length?data.debts.map(d=>`<div class="list-card"><div><b>${esc(d.name)}</b><div class="sub">${d.kind==='owe'?'Debo':'Me deben'}</div></div><div style="text-align:right"><b>${money(d.amount)}</b><div class="actions"><button class="ghost small-btn" data-edit-debt="${d.id}">Editar</button><button class="ghost small-btn danger" data-delete-debt="${d.id}">Eliminar</button></div></div></div>`).join(''):'<div class="empty">Sin deudas registradas.</div>';
 $('#recurringList').innerHTML=data.recurring.length?data.recurring.map(r=>`<div class="list-card"><div><b>${esc(r.name)}</b><div class="sub">${esc(r.frequency)} · ${esc(r.category)}${r.dueDay?' · Día '+r.dueDay:''}</div></div><div style="text-align:right"><b>${money(r.amount)}</b><div class="actions"><button class="ghost small-btn" data-edit-recurring="${r.id}">Editar</button><button class="ghost small-btn danger" data-delete-recurring="${r.id}">Eliminar</button></div></div></div>`).join(''):'<div class="empty">Sin gastos recurrentes.</div>';
 $('#customCategoryList').innerHTML=(data.customCategories||[]).length?data.customCategories.map(c=>`<div class="list-card"><div><b>${esc(categoryIcon(c))} ${esc(c)}</b><div class="sub">Personalizada</div></div></div>`).join(''):'<div class="empty">Aún no has creado categorías.</div>';
 $$('[data-edit-account]').forEach(b=>b.onclick=()=>editAccount(b.dataset.editAccount));
 $$('[data-delete-account]').forEach(b=>b.onclick=()=>deleteAccount(b.dataset.deleteAccount));
 $$('[data-edit-debt]').forEach(b=>b.onclick=()=>editDebt(b.dataset.editDebt));
 $$('[data-delete-debt]').forEach(b=>b.onclick=()=>deleteDebt(b.dataset.deleteDebt));
 $$('[data-edit-recurring]').forEach(b=>b.onclick=()=>editRecurring(b.dataset.editRecurring));
 $$('[data-delete-recurring]').forEach(b=>b.onclick=()=>deleteRecurring(b.dataset.deleteRecurring));
}
const accountTypes=[['Efectivo','Efectivo'],['Cuenta bancaria','Cuenta bancaria'],['Billetera digital','Billetera digital'],['Tarjeta débito','Tarjeta débito'],['Tarjeta de crédito','Tarjeta de crédito'],['Otro','Otro']];
function accountForm(item={}){let editing=!!item.id;openModal(editing?'Editar cuenta o medio de pago':'Añadir cuenta o medio de pago',`<div class="form-grid">${field('Nombre de la cuenta o tarjeta','name','text',item.name||'')}${selectField('Tipo de cuenta','type',accountTypes)}${field('Saldo de referencia actual (COP)','balance','number',item.balance??0,'step="1"')}</div><p class="sub">Este es tu saldo de referencia. Los ingresos, egresos y transferencias lo ajustan automáticamente. Si lo editas, estableces un nuevo saldo de referencia para esa cuenta. En tarjetas de crédito representa la deuda utilizada.</p><div class="actions"><button type="button" class="ghost" id="cancelAccount">Cancelar</button><button class="primary">${editing?'Guardar cambios':'Guardar cuenta'}</button></div>`,fd=>{let v={name:fd.get('name').trim(),type:fd.get('type'),balance:Number(fd.get('balance'))||0};if(editing)Object.assign(data.accounts.find(a=>a.id===item.id),v);else data.accounts.push({id:uid(),...v});save();toast(editing?'Cuenta actualizada':'Cuenta añadida')});$('#modalForm [name=type]').value=item.type||'Efectivo';$('#cancelAccount').onclick=closeModal}
function editAccount(id){let a=data.accounts.find(x=>x.id===id);if(a)accountForm(a)}
function deleteAccount(id){let a=data.accounts.find(x=>x.id===id);if(!a)return;let used=data.transactions.some(t=>t.account===id||t.toAccount===id)||data.subscriptions.some(s=>s.account===id);if(used){toast('No puedes eliminar una cuenta vinculada a movimientos o suscripciones. Puedes editar su nombre.');return}if(!confirm(`¿Eliminar la cuenta "${a.name}"?`))return;data.accounts=data.accounts.filter(x=>x.id!==id);save();toast('Cuenta eliminada')}
$('#addAccount').onclick=()=>accountForm();
$('#manageCategories').onclick=manageCategories;
function debtForm(item={}){let editing=!!item.id;openModal(editing?'Editar deuda o préstamo':'Registrar deuda o préstamo',`<div class="form-grid">${field('Concepto / persona','name','text',item.name||'')}${selectField('Tipo','kind',[['owe','Yo debo'],['owed','Me deben']])}${field('Valor pendiente (COP)','amount','number',item.amount??'','min="1"')}</div><div class="actions"><button type="button" class="ghost" id="cancelDebt">Cancelar</button><button class="primary">${editing?'Guardar cambios':'Guardar'}</button></div>`,fd=>{let v={name:fd.get('name').trim(),kind:fd.get('kind'),amount:Number(fd.get('amount'))};if(editing)Object.assign(data.debts.find(x=>x.id===item.id),v);else data.debts.push({id:uid(),...v});save();toast(editing?'Deuda actualizada':'Deuda registrada')});$('#modalForm [name=kind]').value=item.kind||'owe';$('#cancelDebt').onclick=closeModal}
function editDebt(id){let d=data.debts.find(x=>x.id===id);if(d)debtForm(d)}
function deleteDebt(id){let d=data.debts.find(x=>x.id===id);if(!d)return;if(confirm(`¿Eliminar la deuda "${d.name}"?`)){data.debts=data.debts.filter(x=>x.id!==id);save();toast('Deuda eliminada')}}
$('#addDebt').onclick=()=>debtForm();
function recurringForm(item={}){let editing=!!item.id;openModal(editing?'Editar gasto recurrente':'Gasto recurrente',`<div class="form-grid">${field('Nombre','name','text',item.name||'')}${field('Valor (COP)','amount','number',item.amount??'','min="1"')}${categorySelect('Categoría','category')}${selectField('Frecuencia','frequency',[['Semanal','Semanal'],['Quincenal','Quincenal'],['Mensual','Mensual'],['Anual','Anual']])}${field('Día del mes (opcional)','dueDay','number',item.dueDay||'','min="1" max="31"')}</div><div class="actions"><button type="button" class="ghost" id="cancelRecurring">Cancelar</button><button class="primary">${editing?'Guardar cambios':'Guardar'}</button></div>`,fd=>{let v={name:fd.get('name').trim(),amount:Number(fd.get('amount')),category:fd.get('category'),frequency:fd.get('frequency'),dueDay:Number(fd.get('dueDay'))||null};if(editing)Object.assign(data.recurring.find(x=>x.id===item.id),v);else data.recurring.push({id:uid(),...v});save();toast(editing?'Gasto recurrente actualizado':'Gasto recurrente añadido')});$('#modalForm [name=category]').value=item.category||'Alimentación';$('#modalForm [name=frequency]').value=item.frequency||'Mensual';attachCategoryCreator($('#modalForm'));$('#cancelRecurring').onclick=closeModal}
function editRecurring(id){let r=data.recurring.find(x=>x.id===id);if(r)recurringForm(r)}
function deleteRecurring(id){let r=data.recurring.find(x=>x.id===id);if(!r)return;if(confirm(`¿Eliminar el gasto recurrente "${r.name}"?`)){data.recurring=data.recurring.filter(x=>x.id!==id);save();toast('Gasto recurrente eliminado')}}
$('#addRecurring').onclick=()=>recurringForm();
const servicePresets = {
  'Netflix':{initial:'N',color:'#E50914'},'Spotify':{initial:'≋',color:'#1DB954'},'Disney+':{initial:'D+',color:'#113CCF'},'YouTube Premium':{initial:'▶',color:'#FF0033'},'Amazon Prime':{initial:'a',color:'#00A8E0'},'Apple Music':{initial:'♫',color:'#FC3C44'},'iCloud':{initial:'☁',color:'#3693F3'},'HBO Max':{initial:'M',color:'#5822B4'},'Crunchyroll':{initial:'C',color:'#F47521'},'ChatGPT':{initial:'✳',color:'#10A37F'},'Gemini':{initial:'✦',color:'#4285F4'},'Plan de datos':{initial:'5G',color:'#2784D8'},'Claro':{initial:'C',color:'#DA291C'},'Movistar':{initial:'M',color:'#019DF4'},'Tigo':{initial:'T',color:'#003DA5'},'Duolingo':{initial:'D',color:'#58CC02'},'Smart Fit':{initial:'SF',color:'#F6B900'},'Bodytech':{initial:'BT',color:'#222222'},'Rappi Pro':{initial:'R',color:'#F04438'},'Prime Video':{initial:'▶',color:'#1688C9'},'Max':{initial:'M',color:'#4935A5'},'Otro servicio':{initial:'+',color:'#6658E8'}
};
function monthlyCost(s){let a=Number(s.amount)||0;return s.frequency==='Anual'?a/12:s.frequency==='Semanal'?a*4.333:s.frequency==='Quincenal'?a*2.167:a}
function dateForDay(year,month,day){let last=new Date(year,month+1,0).getDate();return new Date(year,month,Math.min(Number(day)||1,last),12).toISOString().slice(0,10)}
function nextChargeDate(day,frequency,fromDate=today(),startMonth=null){let base=new Date((fromDate||today())+'T12:00:00');let y=base.getFullYear(),m=base.getMonth();if(frequency==='Anual'){let targetMonth=startMonth===null?m:Number(startMonth);let candidate=dateForDay(y,targetMonth,day);if(candidate<=fromDate)candidate=dateForDay(y+1,targetMonth,day);return candidate}let candidate=dateForDay(y,m,day);if(candidate<=fromDate){m++;if(m>11){m=0;y++}candidate=dateForDay(y,m,day)}return candidate}
function subscriptionForm(item={}){
  let editing=!!item.id, selectedService=item.service||'Netflix', selectedDay=Number(item.billingDay||((item.nextDate||today()).slice(8,10)))||1;
  const serviceTiles=Object.entries(servicePresets).map(([name,b])=>`<button type="button" class="service-choice ${name===selectedService?'selected':''}" data-service="${esc(name)}"><span class="service-mark" style="--service-color:${b.color}">${esc(b.initial)}</span><span>${esc(name)}</span></button>`).join('');
  openModal(editing?'Editar suscripción':'Añadir suscripción',`<div class="subscription-wizard">
    <div class="field"><label>¿A qué plataforma te vas a suscribir?</label><div class="service-picker">${serviceTiles}</div><input type="hidden" name="service" value="${esc(selectedService)}"></div>
    <div class="form-grid"><div class="field span2"><label>Nombre personalizado (opcional)</label><input name="customName" type="text" value="${esc(item.customName||'')}" placeholder="Ej. Netflix familiar"></div>
    <div class="field"><label>Valor del cobro (COP)</label><input name="amount" type="number" value="${item.amount||''}" min="1" step="1" required></div>
    <div class="field"><label>Frecuencia</label><select name="frequency"><option>Mensual</option><option>Anual</option></select></div>
    <div class="field span2"><label>¿Qué día del mes realizan el cobro?</label><div class="day-picker" id="billingDayPicker">${Array.from({length:31},(_,i)=>i+1).map(d=>`<button type="button" class="day-choice ${d===selectedDay?'selected':''}" data-day="${d}">${d}</button>`).join('')}</div><input type="hidden" name="billingDay" value="${selectedDay}"></div>
    ${selectField('Cuenta desde la que se paga','account',data.accounts.map(a=>[a.id,a.name]))}
    ${selectField('Estado','status',[['active','Activa'],['paused','Pausada'],['cancelled','Cancelada']])}
    </div><div class="field"><label>Próximo cobro estimado</label><div class="next-charge-preview" id="nextChargePreview">${new Date(nextChargeDate(selectedDay,item.frequency||'Mensual',today(),item.startMonth)+'T12:00:00').toLocaleDateString('es-CO',{day:'numeric',month:'long',year:'numeric'})}</div></div>
    <div class="actions"><button type="button" class="ghost" id="cancelSubscription">Cancelar</button><button class="primary">Guardar suscripción</button></div>
  </div>`,fd=>{
    let service=fd.get('service'),brand=servicePresets[service]||servicePresets['Otro servicio'],frequency=fd.get('frequency'),billingDay=Number(fd.get('billingDay'));
    let startMonth=item.startMonth??new Date().getMonth();
    let nextDate=editing&&item.nextDate?item.nextDate:nextChargeDate(billingDay,frequency,today(),startMonth);
    let v={id:item.id||uid(),service,customName:fd.get('customName'),amount:Number(fd.get('amount')),frequency,billingDay,startMonth,nextDate,account:fd.get('account'),status:fd.get('status'),initial:brand.initial,color:brand.color};
    if(editing)Object.assign(data.subscriptions.find(x=>x.id===item.id),v);else data.subscriptions.push(v);save();toast('Suscripción guardada')
  });
  $('#modalForm').querySelector('[name=frequency]').value=item.frequency||'Mensual';$('#modalForm').querySelector('[name=status]').value=item.status||'active';if(item.account)$('#modalForm').querySelector('[name=account]').value=item.account;
  $('#modalForm').querySelectorAll('[data-service]').forEach(b=>b.onclick=()=>{$('#modalForm').querySelectorAll('[data-service]').forEach(x=>x.classList.toggle('selected',x===b));$('#modalForm [name=service]').value=b.dataset.service;let brand=servicePresets[b.dataset.service];$('#modalForm #selectedBrandPreview')?.remove()});
  $('#modalForm').querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{selectedDay=Number(b.dataset.day);$('#modalForm [name=billingDay]').value=selectedDay;$('#modalForm').querySelectorAll('[data-day]').forEach(x=>x.classList.toggle('selected',x===b));updatePreview()});
  $('#modalForm').querySelector('[name=frequency]').onchange=updatePreview;
  function updatePreview(){let f=$('#modalForm [name=frequency]').value;$('#nextChargePreview').textContent=new Date(nextChargeDate(selectedDay,f,today(),item.startMonth??new Date().getMonth())+'T12:00:00').toLocaleDateString('es-CO',{day:'numeric',month:'long',year:'numeric'})}
  $('#cancelSubscription').onclick=closeModal;
}
function paySubscription(id){let s=data.subscriptions.find(x=>x.id===id);if(!s)return;if(!confirm(`¿Registrar el pago de ${s.service} por ${money(s.amount)} como egreso?`))return;let tx={id:uid(),type:'expense',amount:Number(s.amount),description:`Suscripción: ${s.customName||s.service}`,category:'Entretenimiento',account:s.account,date:today(),note:`Pago registrado desde Suscripciones`};data.transactions.unshift(tx);adjustBalance(tx,1);s.nextDate=nextChargeDate(s.billingDay||Number((s.nextDate||today()).slice(8,10)),s.frequency,s.nextDate||today(),s.startMonth);save();toast('Pago registrado y próximo cobro actualizado')}
function renderSubscriptions(){let active=data.subscriptions.filter(s=>s.status==='active');let monthly=active.reduce((sum,s)=>sum+monthlyCost(s),0);$('#subscriptionMonthly').textContent=money(monthly);$('#subscriptionCount').textContent=`${active.length} suscripción${active.length===1?' activa':'es activas'} · costo mensual aproximado`;let list=data.subscriptions.slice().sort((a,b)=>(a.nextDate||'').localeCompare(b.nextDate||''));$('#subscriptionList').innerHTML=list.length?list.map(s=>{let label=s.customName||s.service;let status=s.status==='active'?'Activa':s.status==='paused'?'Pausada':'Cancelada';let due=s.nextDate?new Date(s.nextDate+'T12:00:00').toLocaleDateString('es-CO',{day:'numeric',month:'long'}):'Sin fecha';return `<div class="card half subscription-card" style="--brand-color:${s.color||'#6658E8'};margin:0 0 12px"><div class="section-head"><span class="pill ${s.status==='active'?'tag-active':'tag-paused'}">${status}</span><span class="subscription-meta">${esc(s.frequency)}</span></div><div class="subscription-top"><div class="subscription-logo" style="background:${s.color||'#6658E8'}">${esc(s.initial||s.service?.slice(0,1)||'?')}</div><div style="min-width:0;flex:1"><div class="move-title">${esc(label)}</div><div class="subscription-meta">Cobro cada ${s.billingDay||'—'} · Próximo: ${due}</div></div><div class="subscription-price">${money(s.amount)}</div></div><div class="subscription-meta" style="margin-top:10px">${money(monthlyCost(s))} aprox. al mes · ${esc(getAccount(s.account))}</div><div class="subscription-actions"><button class="ghost small-btn" data-sub-edit="${s.id}">Editar</button>${s.status==='active'?`<button class="primary small-btn" data-sub-pay="${s.id}">Registrar pago</button>`:''}<button class="ghost small-btn danger" data-sub-del="${s.id}">Eliminar</button></div></div>`}).join(''):'<div class="card full empty">Todavía no tienes suscripciones. Selecciona una plataforma para comenzar.</div>';$$('[data-sub-edit]').forEach(b=>b.onclick=()=>{let s=data.subscriptions.find(x=>x.id===b.dataset.subEdit);if(s)subscriptionForm(s)});$$('[data-sub-pay]').forEach(b=>b.onclick=()=>paySubscription(b.dataset.subPay));$$('[data-sub-del]').forEach(b=>b.onclick=()=>{if(confirm('¿Eliminar esta suscripción?')){data.subscriptions=data.subscriptions.filter(s=>s.id!==b.dataset.subDel);save()}})}
$('#addSubscription').onclick=()=>subscriptionForm();

function csvEscape(s){return '"'+String(s??'').replace(/"/g,'""')+'"'}
function exportCSV(){let rows=[['Fecha','Tipo','Descripción','Categoría','Cuenta origen','Cuenta destino','Valor COP','Nota'],...data.transactions.map(t=>[t.date,t.type==='income'?'Ingreso':t.type==='transfer'?'Transferencia':'Egreso',t.description,t.category||'',getAccount(t.account),t.toAccount?getAccount(t.toAccount):'',t.amount,t.note])];let csv='\ufeff'+rows.map(r=>r.map(csvEscape).join(';')).join('\r\n');download(new Blob([csv],{type:'text/csv;charset=utf-8'}),'finanzas-movimientos.csv');toast('Archivo listo para Excel')}
function download(blob,name){let a=document.createElement('a');let url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
$('#exportBtn').onclick=$('#exportCsv').onclick=exportCSV;
$('#backupBtn').onclick=()=>download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'finanzas-respaldo.json');
$('#restoreFile').onchange=async e=>{let f=e.target.files[0];if(!f)return;try{let obj=JSON.parse(await f.text());if(!obj.transactions||!obj.accounts)throw Error();if(!confirm('Restaurar esta copia reemplazará los datos activos de esta cuenta en este dispositivo y los sincronizará. ¿Continuar?')){e.target.value='';return}data=obj;save();toast('Copia restaurada')}catch(err){toast('El archivo no parece una copia válida')}e.target.value=''};

// FINANZAS 2.0: archivo local, consulta histórica y restauración sin duplicados.
let selectedArchiveFile=null;
function xmlEscape(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
function excelCell(value){let type=typeof value==='number'&&Number.isFinite(value)?'Number':'String';return `<Cell><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`}
function excelSheet(name,headers,rows){return `<Worksheet ss:Name="${xmlEscape(name).slice(0,31)}"><Table><Row>${headers.map(excelCell).join('')}</Row>${rows.map(row=>`<Row>${row.map(excelCell).join('')}</Row>`).join('')}</Table></Worksheet>`}
function excelWorkbook(sheets){const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.join('')}</Workbook>`;return new Blob([xml],{type:'application/vnd.ms-excel;charset=utf-8'})}
function txRows(list){return list.map(t=>[t.date,t.type==='income'?'Ingreso':t.type==='transfer'?'Transferencia':'Egreso',t.description||'',t.category||'',getAccount(t.account),t.toAccount?getAccount(t.toAccount):'',Number(t.amount)||0,t.note||''])}
function exportFullExcel(){const sheets=[];sheets.push(excelSheet('Movimientos',['Fecha','Tipo','Descripción','Categoría','Cuenta origen','Cuenta destino','Valor COP','Nota'],txRows(data.transactions)));sheets.push(excelSheet('Cuentas',['ID','Nombre','Tipo','Saldo de referencia COP'],data.accounts.map(a=>[a.id,a.name,a.type,Number(a.balance)||0])));sheets.push(excelSheet('Presupuestos',['ID','Categoría','Límite COP'],data.budgets.map(x=>[x.id,x.category,Number(x.limit)||0])));sheets.push(excelSheet('Ahorros',['ID','Meta','Objetivo COP','Ahorrado COP'],data.goals.map(x=>[x.id,x.name,Number(x.target)||0,Number(x.saved)||0])));sheets.push(excelSheet('Deudas',['ID','Nombre','Tipo','Valor COP'],data.debts.map(x=>[x.id,x.name,x.kind,Number(x.amount)||0])));sheets.push(excelSheet('Recurrentes',['ID','Nombre','Valor COP','Categoría','Frecuencia','Día'],data.recurring.map(x=>[x.id,x.name,Number(x.amount)||0,x.category,x.frequency,x.dueDay||''])));sheets.push(excelSheet('Suscripciones',['ID','Servicio','Nombre','Valor COP','Frecuencia','Próximo cobro','Cuenta','Estado'],data.subscriptions.map(x=>[x.id,x.service,x.customName||'',Number(x.amount)||0,x.frequency,x.nextDate||'',getAccount(x.account),x.status])));download(excelWorkbook(sheets),`finanzas-respaldo-${today()}.xls`);toast('Libro Excel descargado')}
$('#backupExcelBtn').onclick=exportFullExcel;
function archiveCandidates(){const cutoff=$('#archiveBefore').value;const host=$('#archiveCandidates');if(!cutoff){host.innerHTML='<div class="empty">Selecciona una fecha límite.</div>';return}const rows=data.transactions.filter(t=>t.date&&t.date<cutoff).sort((a,b)=>a.date.localeCompare(b.date));if(!rows.length){host.innerHTML='<div class="empty">No hay movimientos anteriores a esa fecha.</div>';$('#archiveSelectedBtn').disabled=true;return}host.innerHTML=`<div class="toolbar"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="archiveSelectAll" checked style="width:auto"> Seleccionar todos (${rows.length})</label><span class="pill">${money(rows.reduce((s,t)=>s+Number(t.amount||0),0))} en valores registrados</span></div>${rows.map(t=>`<label class="list-card" style="display:flex;align-items:center;gap:10px"><input type="checkbox" class="archive-tx-check" data-archive-tx="${esc(t.id)}" checked style="width:auto"><span style="flex:1;min-width:0"><b>${esc(t.description||'Movimiento')}</b><span class="sub" style="display:block">${esc(t.date)} · ${esc(t.type)} · ${esc(t.category||'Sin categoría')}</span></span><b>${money(t.amount)}</b></label>`).join('')}`;$('#archiveSelectAll').onchange=e=>{$$('.archive-tx-check').forEach(c=>c.checked=e.target.checked);updateArchiveButton()};$$('.archive-tx-check').forEach(c=>c.onchange=updateArchiveButton);updateArchiveButton()}
function updateArchiveButton(){$('#archiveSelectedBtn').disabled=!$$('.archive-tx-check:checked').length}
$('#findArchiveCandidates').onclick=archiveCandidates;
$('#archiveBefore').value=new Date(Date.now()-365*86400000).toISOString().slice(0,10);
async function archiveSelected(){if(!currentUser){toast('Inicia sesión para archivar movimientos sincronizados.');return}const ids=$$('.archive-tx-check:checked').map(c=>c.dataset.archiveTx);if(!ids.length)return;const selected=data.transactions.filter(t=>ids.includes(String(t.id)));if(selected.length!==ids.length){toast('La selección cambió. Vuelve a buscar los movimientos.');return}const archive={format:'finanzas-archive',version:2,createdAt:new Date().toISOString(),owner:currentUser.id,email:currentUser.email||'',currency:'COP',balanceNote:'Los saldos de referencia ya incluyen estos movimientos. Restaurarlos no debe modificar los saldos.',accounts:data.accounts.map(a=>({id:a.id,name:a.name,type:a.type,balance:a.balance})),transactions:selected.map(t=>({...t,_balanceApplied:false}))};const stamp=today();download(new Blob([JSON.stringify(archive,null,2)],{type:'application/json'}),`finanzas-archivo-${stamp}.json`);const archiveSheet=excelSheet('Movimientos archivados',['Fecha','Tipo','Descripción','Categoría','Cuenta origen','Cuenta destino','Valor COP','Nota'],txRows(selected));download(excelWorkbook([archiveSheet]),`finanzas-archivo-${stamp}.xls`);if(!confirm(`Se prepararon ${selected.length} movimientos en dos archivos: JSON y Excel (.xls).\n\nConfirma solo si ambos archivos se descargaron correctamente. Si no, cancela y los movimientos seguirán activos.`)){toast('No se archivó nada. Los movimientos siguen activos.');return}const previous=data.transactions;data.transactions=data.transactions.filter(t=>!ids.includes(String(t.id)));localStorage.setItem(localDataKey(),JSON.stringify(data));render();clearTimeout(cloudTimer);const ok=await syncToCloud();if(!ok){data.transactions=previous;localStorage.setItem(localDataKey(),JSON.stringify(data));render();toast('No se pudo confirmar la sincronización. Se restauraron los movimientos activos; conserva los archivos descargados.');return}toast(`${selected.length} movimientos archivados. Los saldos de referencia no cambiaron.`);archiveCandidates()}
$('#archiveSelectedBtn').onclick=archiveSelected;
function renderImportedArchive(archive){selectedArchiveFile=archive;const host=$('#archiveViewer');const rows=Array.isArray(archive.transactions)?archive.transactions:[];host.innerHTML=`<div class="section-head"><div><b>Archivo histórico cargado</b><div class="sub">${rows.length} movimientos · ${new Date(archive.createdAt||Date.now()).toLocaleString('es-CO')}</div></div><span class="pill">Solo lectura</span></div><div class="toolbar"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="historySelectAll" checked style="width:auto"> Seleccionar todos</label><button class="primary" id="restoreArchiveSelected">Restaurar seleccionados</button></div><div id="historyRows">${rows.map((t,i)=>`<label class="list-card" style="display:flex;align-items:center;gap:10px"><input type="checkbox" class="history-tx-check" data-history-index="${i}" checked style="width:auto"><span style="flex:1;min-width:0"><b>${esc(t.description||'Movimiento')}</b><span class="sub" style="display:block">${esc(t.date||'')} · ${esc(t.type||'')} · ${esc(t.category||'Sin categoría')}</span></span><b>${money(t.amount)}</b></label>`).join('')||'<div class="empty">Este archivo no contiene movimientos.</div>'}</div>`;$('#historySelectAll').onchange=e=>$$('.history-tx-check').forEach(c=>c.checked=e.target.checked);$('#restoreArchiveSelected').onclick=restoreArchiveSelected}
$('#openArchiveFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const obj=JSON.parse(await f.text());if(obj.format!=='finanzas-archive'||!Array.isArray(obj.transactions))throw Error('Este no es un archivo histórico JSON de Finanzas.');if(!currentUser||obj.owner!==currentUser.id)throw Error('Este archivo pertenece a otra cuenta o no has iniciado sesión.');renderImportedArchive(obj);toast('Historial cargado en modo consulta')}catch(err){toast(err.message||'No se pudo abrir el archivo')}e.target.value=''};
function restoreArchiveSelected(){if(!selectedArchiveFile||!currentUser){toast('Inicia sesión para restaurar movimientos.');return}if(selectedArchiveFile.owner!==currentUser.id){toast('Este archivo pertenece a otra cuenta.');return}const indexes=$$('.history-tx-check:checked').map(c=>Number(c.dataset.historyIndex));if(!indexes.length)return;const existing=new Set(data.transactions.map(t=>String(t.id)));const candidates=indexes.map(i=>selectedArchiveFile.transactions[i]).filter(t=>t&&!existing.has(String(t.id)));if(!candidates.length){toast('Los movimientos seleccionados ya existen o no son válidos.');return}if(!confirm(`Se restaurarán ${candidates.length} movimientos. No se modificarán los saldos de referencia porque esos movimientos ya estaban reflejados en ellos. ¿Continuar?`))return;data.transactions=[...candidates.map(t=>({...t,_balanceApplied:false})),...data.transactions];save();toast(`${candidates.length} movimientos restaurados sin duplicados.`);renderTransactions()}
$('#resetBtn').onclick=()=>{if(confirm('Esto eliminará todos tus registros guardados en este dispositivo. ¿Continuar?')){data=defaultData();save();toast('Datos borrados')}};
function render(){applyTheme();renderHome();renderTransactions();renderBudgets();renderGoals();renderMore();renderSubscriptions()}
window.addEventListener('resize',()=>{if($('#page-home').classList.contains('active'))drawFlow()});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
render();
// Inicializar Auth: en la versión anterior la función estaba definida, pero nunca se ejecutaba.
initializeAuth().catch(error=>{console.error('Error inicializando Supabase Auth:',error);const status=$('#authStatus');if(status)status.textContent='No se pudo iniciar la conexión con Supabase. Revisa la URL, la clave pública y la conexión a internet.';});