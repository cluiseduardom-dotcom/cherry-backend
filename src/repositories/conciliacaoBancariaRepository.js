const db=require('../config/db');

async function criar(dados){
 const {rows}=await db.query(
  `INSERT INTO conciliacoes_bancarias
   (empresa_id,movimento_bancario_id,tipo,status,referencia_externa,valor_externo,data_externa,descricao_externa,usuario_id,observacao)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
  [dados.empresa_id,dados.movimento_bancario_id,dados.tipo??'MANUAL',
   dados.status??'CONCILIADA',dados.referencia_externa??null,dados.valor_externo??null,
   dados.data_externa??null,dados.descricao_externa??null,dados.usuario_id??null,dados.observacao??null]);
 return rows[0];
}
async function buscarPorMovimento(id,empresaId){
 const {rows}=await db.query('SELECT * FROM conciliacoes_bancarias WHERE movimento_bancario_id=$1 AND empresa_id=$2',[id,empresaId]);
 return rows[0]||null;
}
async function listar(empresaId,filtros={}){
 const params=[empresaId]; const where=['empresa_id=$1'];
 if(filtros.status){params.push(filtros.status);where.push(`status=$${params.length}`);}
 const {rows}=await db.query(`SELECT * FROM conciliacoes_bancarias WHERE ${where.join(' AND ')} ORDER BY conciliada_em DESC,id DESC`,params);
 return rows;
}
async function desfazer(id,empresaId){
 const {rows}=await db.query(
  `UPDATE conciliacoes_bancarias SET status='DESFEITA',updated_at=NOW()
   WHERE id=$1 AND empresa_id=$2 RETURNING *`,[id,empresaId]);
 return rows[0]||null;
}
module.exports={criar,buscarPorMovimento,listar,desfazer};
