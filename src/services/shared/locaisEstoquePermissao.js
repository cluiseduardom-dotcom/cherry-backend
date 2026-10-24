// Quem enxerga qual local de estoque. Regra única para acerto, conferências, listagem e saldos:
// a equipe (admin/estoquista) vê qualquer local; os demais, só a PRÓPRIA maleta.
const ehEquipe = (usuario) => usuario.role === 'admin' || usuario.role === 'estoquista';

const ehDonoDaMaleta = (local, usuario) => local?.tipo === 'maleta' && local.usuario_id === usuario.id;

const podeVerLocal = (local, usuario) => Boolean(local) && (ehEquipe(usuario) || ehDonoDaMaleta(local, usuario));

module.exports = { ehEquipe, ehDonoDaMaleta, podeVerLocal };
