import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import { respaldoProyectos, validarPlan, aplicarOperacion } from '../lib/conciliacion'

function descargar(nombre,data) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}))
  const a=document.createElement('a');a.href=url;a.download=nombre;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export default function Conciliacion() {
  const {puedeCorregir,profile}=useAuth(),{projects}=useProject()
  const [raw,setRaw]=useState(null),[plan,setPlan]=useState(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState(null)
  const seleccion=projects.filter(p=>/neshuya|praderas de cashibo/i.test(p.name))
  async function leer() {
    setBusy(true);setPlan(null);setResult(null)
    try {
      if(seleccion.length!==2)throw new Error('Falta uno de los dos proyectos')
      const r=await respaldoProyectos(supabase,seleccion,setMsg);setRaw(r)
      descargar('respaldo-proyectos-'+r.fecha.slice(0,10)+'.json',r)
      setMsg('Respaldo completo descargado. Se leyeron todas las páginas.')
    }catch(e){setRaw(null);setMsg('ERROR: '+e.message)}finally{setBusy(false)}
  }
  async function abrir(e) {
    setPlan(null);setResult(null)
    try {
      const f=e.target.files?.[0];if(!f)return
      if(f.size>5*1024*1024)throw new Error('Archivo demasiado grande')
      const p=JSON.parse(await f.text());validarPlan(p,raw);setPlan(p);setMsg('Plan validado. Aún no se cambió ningún registro.')
    }catch(er){setMsg('ERROR: '+er.message)}finally{e.target.value=''}
  }
  async function aplicar() {
    if(!plan || !raw)return
    setBusy(true);const journal={fecha:new Date().toISOString(),operations:[]};setResult(null)
    try {
      validarPlan(plan,raw)
      for(let i=0;i<plan.operations.length;i++) {
        const op=plan.operations[i];setMsg(`Aplicando ${i+1} de ${plan.operations.length}: ${op.label || op.table}`)
        const estado=await aplicarOperacion(supabase,op,profile);journal.operations.push({...op,estado})
      }
      setResult(journal);setPlan(null);setRaw(null);setMsg('Carga terminada. Descargar un nuevo respaldo para verificar los totales.')
    }catch(er){journal.error=er.message;setResult(journal);setPlan(null);setRaw(null);setMsg('Carga detenida: '+er.message+'. Revisar el detalle antes de continuar.')}
    finally{descargar('resultado-conciliacion-'+Date.now()+'.json',journal);setBusy(false)}
  }
  if(!puedeCorregir)return <p>Esta pantalla requiere permiso para corregir registros.</p>
  return <>
    <h1>Conciliación de Neshuya y respaldo de proyectos</h1>
    <div className="glass" style={{padding:20,marginBottom:16}}>
      <p>Leer el sistema actual antes de conciliar el Desglosado. El respaldo contiene ventas, pagos, gastos, cronogramas y lotes de Neshuya y Las Praderas de Cashibo.</p>
      <button className="btn-primary" onClick={leer} disabled={busy}>Descargar respaldo actual</button>
      <p role="status">{msg}</p>
      {raw && <p>{raw.lots.length} lotes, {raw.sales.length} ventas, {raw.daily_income.length} aplicaciones de pagos, {raw.expenses.length} gastos y {raw.installments.length} cuotas.</p>}
      {raw && <details><summary>Ver respaldo para copiar o revisar</summary><p>Si el navegador no guarda la descarga, puedes copiar este respaldo completo.</p><textarea aria-label="Contenido del respaldo completo" readOnly value={JSON.stringify(raw,null,2)} style={{width:'100%',height:240}} /></details>}
    </div>
    {raw && <div className="glass" style={{padding:20}}>
      <h2>Revisar cambios del Desglosado</h2>
      <p>La carga conserva los documentos existentes y registra el motivo de cada cambio. Los registros que cambien mientras se prepara el plan detienen la carga.</p>
      <label>Archivo del plan de conciliación<input type="file" accept=".json" onChange={abrir} disabled={busy}/></label>
      {plan && <>
        <p><b>{plan.operations.length} cambios</b>. {plan.summary}</p>
        {plan.notes?.map((n,i)=><p key={i} className="hint">{n}</p>)}
        <div style={{maxHeight:450,overflow:'auto'}}><table><thead><tr><th>Registro</th><th>Acción</th><th>Cambio</th><th>Motivo</th></tr></thead><tbody>{plan.operations.map(op=><tr key={op.table+op.id}><td>{op.label || op.table}</td><td>{op.action==='insert'?'Agregar':'Actualizar'}</td><td>{JSON.stringify(op.values)}</td><td>{op.reason}</td></tr>)}</tbody></table></div>
        <button className="btn-primary" onClick={aplicar} disabled={busy}>Aplicar cambios revisados de Neshuya</button>
      </>}
    </div>}
    {result && <p>{result.operations.length} operaciones aplicadas. El detalle se descargó con los valores anteriores y nuevos.</p>}
  </>
}
