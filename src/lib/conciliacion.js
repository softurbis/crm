// Lecturas completas y cambios revisables. No usa claves de servidor ni borra filas.
export const CAMPOS_CONCILIACION = {
  daily_income: ['date','amount','observation','income_type','operation_number','operation_type','origin','approved','project_id','lot_id','sale_id','client_id','installment_id','financial_account_id'],
  expenses: ['type','amount','issue_date','reception_date','description','status','project_id','recipient','sender','company','document_type','payment_method','discount_from','detail','request_doc_url'],
  installments: ['sale_id','installment_number','amount','amount_paid','due_date','paid_date','status'],
  sales: ['sale_date','total_sale_price','initial_amount_paid','financed_amount','monthly_amount','installments_count'],
}
export const NESHUYA = 'e40aa565-1127-41e6-9306-a477f018bd2e'
export const CASHIBO = '84fab987-937b-5444-8ce1-fdc02f7088d7'
const igual = (a,b) => a === b || (a != null && b != null && String(a) === String(b))
export async function leerTodas(hacer) {
  const filas=[]
  for(let desde=0;;desde+=500) {
    const {data,error,count}=await hacer().order('id').range(desde,desde+499)
    if(error) throw new Error(error.message)
    filas.push(...(data || []))
    if(!data || data.length<500) {
      if(count != null && count!==filas.length) throw new Error('La lectura quedó incompleta')
      return filas
    }
  }
}
export async function respaldoProyectos(sb, proyectos, avance=()=>{}) {
  const ids=proyectos.map(p=>p.id), raw={version:1,fecha:new Date().toISOString(),projects:proyectos}
  for(const t of ['lots','daily_income','expenses','financial_accounts']) {
    avance('Leyendo '+t);raw[t]=await leerTodas(()=>sb.from(t).select('*',{count:'exact'}).in('project_id',ids))
  }
  for(const t of ['sales','separations']) {
    avance('Leyendo '+t);raw[t]=await leerTodas(()=>sb.from(t).select('*,lot:lots!inner(project_id)',{count:'exact'}).in('lot.project_id',ids))
  }
  for(const t of ['installments','commissions']) {
    avance('Leyendo '+t);raw[t]=await leerTodas(()=>sb.from(t).select('*,sale:sales!inner(lot:lots!inner(project_id))',{count:'exact'}).in('sale.lot.project_id',ids))
  }
  const clientIds=[...new Set([...raw.sales.flatMap(s=>[s.client_id,s.co_client_id]),...raw.separations.map(s=>s.client_id),...raw.daily_income.map(p=>p.client_id)].filter(Boolean))]
  raw.clients=[]
  for(let i=0;i<clientIds.length;i+=100) raw.clients.push(...await leerTodas(()=>sb.from('clients').select('*',{count:'exact'}).in('id',clientIds.slice(i,i+100))))
  raw.lot_status_changes=[]
  for(let i=0;i<raw.lots.length;i+=100)raw.lot_status_changes.push(...await leerTodas(()=>sb.from('lot_status_changes').select('*',{count:'exact'}).in('lot_id',raw.lots.slice(i,i+100).map(l=>l.id))))
  return raw
}
export function validarPlan(plan, raw) {
  const proyecto=plan?.project_id
  if(plan?.version!==1 || ![NESHUYA,CASHIBO].includes(proyecto) || !Array.isArray(plan.operations) || plan.operations.length>2000)throw new Error('Plan de conciliación inválido')
  const lotIds=new Set(raw.lots.filter(l=>l.project_id===NESHUYA).map(l=>l.id))
  const saleIds=new Set(raw.sales.filter(s=>lotIds.has(s.lot_id)).map(s=>s.id))
  const vistos=new Set()
  for(const op of plan.operations) {
    if(!CAMPOS_CONCILIACION[op.table] || !['insert','update'].includes(op.action) || !/^[a-f0-9-]{36}$/i.test(op.id) || !op.reason || !op.values || !Object.keys(op.values).length)throw new Error('Operación inválida')
    if(proyecto===CASHIBO && op.table!=='expenses')throw new Error('La conciliación de Cashibo solo admite gastos')
    const key=op.table+op.id;if(vistos.has(key))throw new Error('Registro repetido en el plan');vistos.add(key)
    for(const k of Object.keys(op.values))if(!CAMPOS_CONCILIACION[op.table].includes(k))throw new Error('Campo no autorizado: '+k)
    if(op.values.amount!=null && !(Number(op.values.amount)>0))throw new Error('Importe inválido')
    const anterior=(raw[op.table] || []).find(r=>r.id===op.id)
    const scope=anterior || op.values
    if(['daily_income','expenses'].includes(op.table) ? scope.project_id!==proyecto : op.table==='sales' ? !lotIds.has(scope.lot_id) : !saleIds.has(scope.sale_id))throw new Error('Registro ajeno al proyecto del plan')
    if(op.values.project_id!=null && op.values.project_id!==proyecto)throw new Error('No se puede mover un registro a otro proyecto')
    if(op.table==='expenses' && op.values.status!=null && !['solicitado','confirmado'].includes(op.values.status))throw new Error('Estado de gasto inválido')
    if(op.values.lot_id!=null && !lotIds.has(op.values.lot_id))throw new Error('El lote pertenece a otro proyecto')
    if(op.values.sale_id!=null && !saleIds.has(op.values.sale_id))throw new Error('La venta pertenece a otro proyecto')
    if(op.action==='insert' && ['sales'].includes(op.table))throw new Error('Las ventas nuevas se registran desde la ficha del lote')
    if(op.action==='update') {
      if(!anterior || !op.expected)throw new Error('Falta el registro anterior')
      for(const k of Object.keys(op.values))if(!(k in op.expected))throw new Error('Falta comprobar el valor anterior: '+k)
      for(const [k,v] of Object.entries(op.expected))if(!igual(anterior[k],v))throw new Error('El registro cambió después de preparar el plan: '+op.id)
    } else if(anterior)throw new Error('La inserción ya existe; preparar de nuevo el plan')
  }
  return plan.operations.length
}
export async function aplicarOperacion(sb,op,usuario) {
  const {data:actual,error}=await sb.from(op.table).select('*').eq('id',op.id).maybeSingle()
  if(error)throw new Error(error.message)
  if(actual && Object.entries(op.values).every(([k,v])=>igual(actual[k],v)))return 'ya aplicado'
  if(op.action==='insert' && actual)throw new Error('Ya existe el registro con otros datos')
  if(op.action==='update' && (!actual || Object.entries(op.expected).some(([k,v])=>!igual(actual[k],v))))throw new Error('Registro cambiado; la carga se detuvo')
  const {error:ae}=await sb.from('activity_log').insert({action:op.action==='insert'?'INSERT':'UPDATE',entity_type:op.table,entity_id:op.id,user_email:usuario?.email,user_id:usuario?.id,details:{cambio:op.table==='expenses'?'conciliacion_documental_gastos':'conciliacion_desglosado',project_id:actual?.project_id || op.values.project_id || NESHUYA,motivo:op.reason,antes:op.expected || null,despues:op.values,estado:'intento'}})
  if(ae)throw new Error('No se pudo registrar el motivo: '+ae.message)
  let q
  if(op.action==='insert')q=sb.from(op.table).insert({id:op.id,...op.values})
  else {
    q=sb.from(op.table).update(op.values).eq('id',op.id)
    for(const [k,v] of Object.entries(op.expected))q=v==null?q.is(k,null):q.eq(k,v)
  }
  const {data,error:we}=await q.select('id')
  if(we || data?.length!==1)throw new Error(we?.message || 'El registro cambió durante la carga')
  return 'aplicado'
}
