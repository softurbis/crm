import assert from 'node:assert/strict'
import { validarPlan, NESHUYA, CASHIBO } from '../src/lib/conciliacion.js'

const id='00000000-0000-4000-8000-000000000001'
const raw={lots:[],sales:[],expenses:[{id,project_id:CASHIBO,amount:100,status:'confirmado',request_doc_url:null,receipt_url:null,voucher_url:'conservar'}]}
const plan={version:1,project_id:CASHIBO,operations:[{table:'expenses',action:'update',id,reason:'Comprobante cotejado',values:{amount:120},expected:{amount:100}}]}
assert.equal(validarPlan(plan,raw),1)
const clone=()=>structuredClone(plan)
let p=clone();p.project_id=NESHUYA;assert.throws(()=>validarPlan(p,raw),/ajeno/)
p=clone();p.operations[0].values.project_id=NESHUYA;p.operations[0].expected.project_id=CASHIBO;assert.throws(()=>validarPlan(p,raw),/mover/)
p=clone();p.operations[0].table='daily_income';assert.throws(()=>validarPlan(p,raw),/solo admite gastos/)
p=clone();p.operations[0].expected.amount=90;assert.throws(()=>validarPlan(p,raw),/cambió/)
p=clone();p.operations[0].values.approved_at='2026-10-03';assert.throws(()=>validarPlan(p,raw),/Campo no autorizado/)
p=clone();p.operations[0].values.status='pagado';assert.throws(()=>validarPlan(p,raw),/Estado/)
p=clone();p.operations.push(p.operations[0]);assert.throws(()=>validarPlan(p,raw),/repetido/)
for(const campo of ['request_doc_url','receipt_url','voucher_url']) {
 p=clone();p.operations[0].values={[campo]:'https://drive.google.com/file/d/documento-original/view'};p.operations[0].expected={[campo]:raw.expenses[0][campo] ?? null}
 assert.equal(validarPlan(p,raw),1)
 p.operations[0].values[campo]=null;assert.equal(validarPlan(p,raw),1)
 p.operations[0].values[campo]='javascript:alert(1)';assert.throws(()=>validarPlan(p,raw),/Origen/)
 p.operations[0].values[campo]='https://drive.google.com.ejemplo.com/file';assert.throws(()=>validarPlan(p,raw),/Origen/)
 p.operations[0].values[campo]='https://usuario:clave@drive.google.com/file';assert.throws(()=>validarPlan(p,raw),/Origen/)
 p=clone();p.operations[0].values={[campo]:'https://drive.google.com/file/d/documento-original/view'};assert.throws(()=>validarPlan(p,raw),/Falta comprobar/)
}
console.log('Verificado: gastos de Cashibo, aislamiento de proyectos, concurrencia y preservación de firmas.')
